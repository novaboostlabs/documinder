// Runs the live workflow in manual mode through MCP and prints the named report nodes.
//   node scripts/run-workflow.mjs <workflowId> "Phase 1 Test Report" "Phase 2 Run Summary"
import { connect } from './n8n-mcp.mjs';

const [workflowId, ...nodeNames] = process.argv.slice(2);
const mcp = await connect();
const { executionId } = await mcp.call('execute_workflow', { workflowId, executionMode: 'manual' });
let exec;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  exec = await mcp.call('get_workflow_execution', { workflowId, executionId, includeData: true, nodeNames });
  if (!['new', 'running', 'waiting'].includes(exec.execution.status)) break;
}
const runData = exec.data?.resultData?.runData || {};
const out = { executionId, status: exec.execution.status, error: exec.data?.resultData?.error?.message };
for (const name of nodeNames) out[name] = runData[name]?.[0]?.data?.main?.[0]?.map((i) => i.json) ?? '(did not run)';
console.log(JSON.stringify(out, null, 1));
