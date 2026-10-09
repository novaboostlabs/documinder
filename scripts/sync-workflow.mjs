// Applies workflows/daily-review.sdk.js to the live n8n workflow without changing its ID
// or losing its version history.
//
//   node scripts/sync-workflow.mjs <liveWorkflowId> "<version name>"
//
// n8n's MCP update_workflow takes edit operations, not SDK code. So this script:
//   1. validates the SDK code (validate_workflow)
//   2. compiles it into a temporary draft (create_workflow_from_code)
//   3. diffs the draft against the live workflow and applies the difference as one
//      atomic update_workflow batch (add/update/remove nodes, settings, connections)
//   4. archives the temporary draft
//   5. exports the live workflow to workflows/daily-review.json

import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from './n8n-mcp.mjs';

const [liveId, versionName = 'Sync from workflows/daily-review.sdk.js'] = process.argv.slice(2);
if (!liveId) throw new Error('usage: node scripts/sync-workflow.mjs <liveWorkflowId> "<version name>"');

const root = new URL('..', import.meta.url);
const code = readFileSync(new URL('workflows/daily-review.sdk.js', root), 'utf8');
const mcp = await connect();

const validation = await mcp.call('validate_workflow', { code });
if (!validation.valid || (validation.warnings || []).length) {
  console.log(JSON.stringify(validation, null, 1));
  if (!validation.valid) process.exit(1);
}

const temp = await mcp.call('create_workflow_from_code', { code, name: `TEMP sync ${Date.now()}`, versionName: 'temporary compile for sync' });
try {
  const want = (await mcp.call('get_workflow_details', { workflowId: temp.workflowId })).workflow;
  const have = (await mcp.call('get_workflow_details', { workflowId: liveId })).workflow;
  const ops = [];
  const isSticky = (n) => n.type === 'n8n-nodes-base.stickyNote';
  const nodeSettings = (n) => ({ executeOnce: Boolean(n.executeOnce), alwaysOutputData: Boolean(n.alwaysOutputData) });

  // Sticky notes get generated names, so replace them wholesale (they have no connections).
  for (const n of have.nodes.filter(isSticky)) ops.push({ type: 'removeNode', nodeName: n.name });
  for (const n of want.nodes.filter(isSticky)) {
    ops.push({ type: 'addNode', node: { name: n.name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, position: n.position } });
  }

  const haveByName = new Map(have.nodes.filter((n) => !isSticky(n)).map((n) => [n.name, n]));
  const wantByName = new Map(want.nodes.filter((n) => !isSticky(n)).map((n) => [n.name, n]));
  for (const [name, n] of wantByName) {
    const h = haveByName.get(name);
    if (!h) {
      ops.push({ type: 'addNode', node: { name, type: n.type, typeVersion: n.typeVersion, parameters: n.parameters, position: n.position } });
    } else {
      if (JSON.stringify(h.parameters) !== JSON.stringify(n.parameters)) {
        ops.push({ type: 'updateNodeParameters', nodeName: name, parameters: n.parameters, replace: true });
      }
      if (JSON.stringify(h.position) !== JSON.stringify(n.position)) ops.push({ type: 'setNodePosition', nodeName: name, position: n.position });
    }
    if (!h || JSON.stringify(nodeSettings(h)) !== JSON.stringify(nodeSettings(n))) {
      ops.push({ type: 'setNodeSettings', nodeName: name, settings: nodeSettings(n) });
    }
  }
  for (const name of haveByName.keys()) if (!wantByName.has(name)) ops.push({ type: 'removeNode', nodeName: name });

  const edges = (conns) => {
    const out = new Set();
    for (const [source, byType] of Object.entries(conns)) {
      for (const [connectionType, outputs] of Object.entries(byType)) {
        outputs.forEach((targets, sourceIndex) => (targets || []).forEach((t) =>
          out.add(JSON.stringify({ source, target: t.node, sourceIndex, targetIndex: t.index, connectionType }))));
      }
    }
    return out;
  };
  const haveEdges = edges(have.connections);
  const wantEdges = edges(want.connections);
  for (const e of haveEdges) if (!wantEdges.has(e) && wantByName.has(JSON.parse(e).source) && wantByName.has(JSON.parse(e).target)) ops.push({ type: 'removeConnection', ...JSON.parse(e) });
  for (const e of wantEdges) if (!haveEdges.has(e)) ops.push({ type: 'addConnection', ...JSON.parse(e) });

  // Removing nodes or connections first keeps the batch valid.
  const order = { removeConnection: 0, removeNode: 1, addNode: 2, updateNodeParameters: 3, setNodeSettings: 4, setNodePosition: 5, addConnection: 6 };
  ops.sort((a, b) => order[a.type] - order[b.type]);
  console.log(`applying ${ops.length} operations:`, Object.entries(ops.reduce((a, o) => ({ ...a, [o.type]: (a[o.type] || 0) + 1 }), {})).map(([k, v]) => `${k}=${v}`).join(' '));
  const result = await mcp.call('update_workflow', { workflowId: liveId, operations: ops, versionName });
  if ((result.validationWarnings || []).length) console.log('warnings:', JSON.stringify(result.validationWarnings));
} finally {
  await mcp.call('archive_workflow', { workflowId: temp.workflowId });
}

// Export the live workflow as importable JSON (no credentials, unpublished).
const live = (await mcp.call('get_workflow_details', { workflowId: liveId })).workflow;
const exported = {
  name: live.name,
  nodes: live.nodes.map(({ credentials, ...n }) => n),
  connections: live.connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};
writeFileSync(new URL('workflows/daily-review.json', root), JSON.stringify(exported, null, 2) + '\n');
console.log(`synced ${live.name} (${live.nodes.length} nodes, active=${live.active}); exported workflows/daily-review.json`);
