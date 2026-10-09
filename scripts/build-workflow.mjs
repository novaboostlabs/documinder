// Builds the n8n Workflow SDK code for "Documinder · A · Daily Review" from
// src/documinder-core.js, so the logic in the repo and the logic in n8n stay identical.
//
//   node scripts/build-workflow.mjs   ->  workflows/daily-review.sdk.js
//
// The SDK file is what Claude Code sends to n8n's MCP server (validate_workflow,
// create_workflow_from_code / update_workflow). The importable workflow JSON is
// exported separately to workflows/daily-review.json after each change.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(join(root, 'src/documinder-core.js'), 'utf8');

// Drop the Node-only export block; everything else runs unchanged in the Code node.
const coreForN8n = core.replace(/\/\* n8n-export-start \*\/[\s\S]*\/\* n8n-export-end \*\//, '').trim();

const classifyCode = `${coreForN8n}

// ---------- n8n glue ----------
// Reads the four tables loaded upstream and returns one item per driver x requirement.
const settings = $('Load Settings').first().json;
const drivers = $('Load Drivers').all().map((i) => i.json);
const requirements = $('Load Requirements').all().map((i) => i.json);
const documents = $('Load Documents').all().map((i) => i.json);

const { rows } = classifyAll({ settings, drivers, requirements, documents });
return withDedupKeys(rows).map((r) => ({ json: r }));
`;

const reportCode = `// Phase 1 exit check: compare every classified row with documinder_test_expectations.
const rows = $input.all().map((i) => i.json);
const expected = $('Load Test Expectations').all().map((i) => i.json);
const byKey = new Map(rows.map((r) => [r.driver_id + ':' + r.document_type, r]));

const results = expected.map((e) => {
  const a = byKey.get(e.driver_id + ':' + e.document_type);
  const actualState = a ? a.state : '(no row)';
  const actualStage = a ? a.reminder_stage || '' : '';
  return {
    driver: a ? a.full_name : e.driver_id,
    document_type: e.document_type,
    primary_fixture: e.primary_fixture === true,
    expected: e.expected_state + (e.expected_stage ? ' / ' + e.expected_stage : ''),
    actual: actualState + (actualStage ? ' / ' + actualStage : ''),
    days_remaining: a ? a.days_remaining : null,
    pass: actualState === e.expected_state && actualStage === (e.expected_stage || ''),
  };
});
const expectedKeys = new Set(expected.map((e) => e.driver_id + ':' + e.document_type));
const unexpectedRows = rows.filter((r) => !expectedKeys.has(r.driver_id + ':' + r.document_type));

const stateCounts = {};
for (const r of rows) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;
const failures = results.filter((r) => !r.pass);

return [{
  json: {
    phase: 'Phase 1: classification engine',
    reference_date: rows[0] ? rows[0].reference_date : null,
    reference_source: rows[0] ? rows[0].reference_source : null,
    exit_check: failures.length === 0 && unexpectedRows.length === 0 ? 'PASS' : 'FAIL',
    checked: results.length,
    passed: results.length - failures.length,
    failed: failures.length + unexpectedRows.length,
    state_counts: stateCounts,
    reminders_due: rows.filter((r) => r.reminder_stage).length,
    staff_review_needed: rows.filter((r) => r.action === 'staff_review' || r.action.includes('escalation')).length,
    primary_fixtures: results.filter((r) => r.primary_fixture),
    failures,
    unexpected_rows: unexpectedRows.map((r) => r.driver_id + ':' + r.document_type),
  },
}];
`;

const loadNode = (varName, name, table, x, extra = '') => `const ${varName} = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: '${name}',
    ${extra}parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: '${table}' },
      returnAll: true,
    },
    position: [${x}, 300],
  },
  output: [{ id: 1 }],
});
`;

const sdk = `import { workflow, node, trigger, sticky } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Daily Review (manual)', position: [0, 300] },
  output: [{}],
});

${loadNode('loadSettings', 'Load Settings', 'documinder_settings', 240)}
${loadNode('loadDrivers', 'Load Drivers', 'documinder_drivers', 480, 'executeOnce: true,\n    ')}
${loadNode('loadRequirements', 'Load Requirements', 'documinder_requirements', 720, 'executeOnce: true,\n    ')}
${loadNode('loadDocuments', 'Load Documents', 'documinder_documents', 960, 'executeOnce: true,\n    ')}
${loadNode('loadExpectations', 'Load Test Expectations', 'documinder_test_expectations', 1200, 'executeOnce: true,\n    ')}
const classify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify Credentials',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${JSON.stringify(classifyCode)},
    },
    position: [1440, 300],
  },
  output: [{ driver_id: 'D002', document_type: 'MEDICAL_CERT', days_remaining: 90, state: 'approaching_expiry', reminder_stage: 'D90', action: 'driver_reminder', dedup_key: 'D002|DOC0008|2|D90' }],
});

const report = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Phase 1 Test Report',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${JSON.stringify(reportCode)},
    },
    position: [1680, 300],
  },
  output: [{ exit_check: 'PASS', checked: 84, passed: 84, failed: 0 }],
});

const noteOverview = sticky(
  '## Documinder · Daily Review\\n' +
  'Checks every required credential for every driver, then classifies it with plain date math (no AI).\\n\\n' +
  '**Phase 1:** classification only. There is no email, no AI node, and no schedule, and the workflow is not published.\\n\\n' +
  'Fictional data only. Reference date comes from documinder_settings.test_reference_date (2026-10-15, America/Los_Angeles).',
  [],
  { color: 4, position: [-120, -20], width: 300, height: 480 }
);

const noteLoad = sticky(
  '## 1 · Load\\n' +
  'Settings, drivers, role requirements, every document version, and the expected test results come from n8n Data Tables. ' +
  'Each load runs once (executeOnce) so items never multiply.',
  [],
  { color: 7, position: [200, -20], width: 1140, height: 480 }
);

const noteClassify = sticky(
  '## 2 · Classify\\n' +
  'Picks the latest **verified** version of each document and validates the date. Endorsements with no date inherit the CDL date. ' +
  'Counts whole days left in the business timezone, then assigns state + current reminder stage (D90, D60, D30, D14, D7, D0, OVERDUE).\\n\\n' +
  'Also flags: missing · invalid_date · inactive_skipped · not_applicable.\\n\\n' +
  'Source: src/documinder-core.js',
  [],
  { color: 5, position: [1380, -20], width: 240, height: 480 }
);

const noteReport = sticky(
  '## 3 · Exit check\\n' +
  'Compares every row with documinder_test_expectations (84 rows) and returns **PASS / FAIL** with per-fixture detail.',
  [],
  { color: 6, position: [1640, -20], width: 240, height: 480 }
);

export default workflow('documinder-daily-review', 'Documinder · A · Daily Review')
  .add(start)
  .to(loadSettings)
  .to(loadDrivers)
  .to(loadRequirements)
  .to(loadDocuments)
  .to(loadExpectations)
  .to(classify)
  .to(report)
  .add(noteOverview)
  .add(noteLoad)
  .add(noteClassify)
  .add(noteReport);
`;

writeFileSync(join(root, 'workflows/daily-review.sdk.js'), sdk);
console.log(`wrote workflows/daily-review.sdk.js (${sdk.length} chars)`);
