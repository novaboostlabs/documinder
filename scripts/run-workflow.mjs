// Runs a workflow in manual mode through MCP and prints the named nodes' output.
//   node scripts/run-workflow.mjs <workflowId> [--trigger "Trigger Name" --form '{"field":"value"}'] "Node A" "Node B"
import { connect } from './n8n-mcp.mjs';

const args = process.argv.slice(2);
const workflowId = args.shift();
let triggerNodeName;
let formData;
const nodeNames = [];
while (args.length) {
  const a = args.shift();
  if (a === '--trigger') triggerNodeName = args.shift();
  else if (a === '--form') formData = JSON.parse(args.shift());
  else nodeNames.push(a);
}

const mcp = await connect();
const { executionId } = await mcp.call('execute_workflow', {
  workflowId,
  executionMode: 'manual',
  ...(triggerNodeName ? { triggerNodeName } : {}),
  ...(formData ? { inputs: { formData } } : {}),
});
let exec;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  exec = await mcp.call('get_workflow_execution', { workflowId, executionId, includeData: true, nodeNames });
  // 'waiting' = paused on a form completion page that only a browser can display; the work is done.
  if (!['new', 'running'].includes(exec.execution.status)) break;
}
const runData = exec.data?.resultData?.runData || {};
const out = { executionId, status: exec.execution.status, error: exec.data?.resultData?.error?.message };
for (const name of nodeNames) out[name] = runData[name]?.[0]?.data?.main?.[0]?.map((i) => i.json) ?? '(did not run)';
console.log(JSON.stringify(out, null, 1));
