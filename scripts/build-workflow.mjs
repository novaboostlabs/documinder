// Builds the n8n Workflow SDK code for Documinder from the modules in src/, so the logic in
// the repo and the logic in n8n stay identical.
//
//   node scripts/build-workflow.mjs
//     -> workflows/daily-review.sdk.js   "Documinder · A · Daily Review"
//     -> workflows/renewals.sdk.js       "Documinder · B · Renewal Intake & Review"
//     -> workflows/reset-demo.sdk.js     "Documinder · Dev · Reset Demo Data"
//
// Apply to n8n with scripts/sync-workflow.mjs (existing workflow) or MCP
// create_workflow_from_code (first time).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Drop the Node-only export block; everything else runs unchanged in the Code node.
const forN8n = (file) =>
  readFileSync(join(root, file), 'utf8')
    .replace(/\/\* n8n-export-start \*\/[\s\S]*\/\* n8n-export-end \*\//, '')
    .replace(/\/\* n8n-strip-start \*\/[\s\S]*?\/\* n8n-strip-end \*\//g, '')
    .trim();
const coreForN8n = forN8n('src/documinder-core.js');
const remindersForN8n = forN8n('src/documinder-reminders.js');
const deliveryForN8n = forN8n('src/documinder-delivery.js');
const renewalsForN8n = forN8n('src/documinder-renewals.js');
const fixtures = JSON.parse(readFileSync(join(root, 'data/fixtures/fixtures.json'), 'utf8'));

// Loads that may legitimately be empty emit one empty item (alwaysOutputData);
// glue code keeps only real rows.
const rowsOf = (nodeName, key) => `$('${nodeName}').all().map((i) => i.json).filter((r) => r.${key})`;

// ---------- Code node sources ----------

const classifyCode = `${coreForN8n}

// ---------- n8n glue ----------
// Reads the tables loaded upstream and returns one item per driver x requirement.
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
    compares_against: 'the fixture baseline in data/fixtures. Approved renewals intentionally change results; run \"Documinder · Dev · Reset Demo Data\" to restore the baseline.',
    reference_date: rows[0] ? rows[0].reference_date : null,
    reference_source: rows[0] ? rows[0].reference_source : null,
    exit_check: failures.length === 0 && unexpectedRows.length === 0 ? 'PASS' : 'FAIL',
    checked: results.length,
    passed: results.length - failures.length,
    failed: failures.length + unexpectedRows.length,
    state_counts: stateCounts,
    primary_fixtures: results.filter((r) => r.primary_fixture),
    failures,
    unexpected_rows: unexpectedRows.map((r) => r.driver_id + ':' + r.document_type),
  },
}];
`;

const planCode = `${remindersForN8n}

// ---------- n8n glue ----------
// One item per due reminder stage, each with decision = create | skip_duplicate.
const settings = $('Load Settings').first().json;
const drivers = $('Load Drivers').all().map((i) => i.json);
const history = ${rowsOf('Load Notification History', 'dedup_key')};
const simulations = ${rowsOf('Load Provider Simulations', 'driver_id')};
const rows = $input.all().map((i) => i.json);

const plans = planNotifications({ rows, drivers, settings, history, simulations, runId: $execution.id });
return plans.map((p) => ({
  json: {
    decision: p.decision,
    full_name: p.full_name,
    document_type: p.document_type,
    days_remaining: p.days_remaining,
    ...(p.notification || { dedup_key: p.dedup_key, driver_id: p.driver_id, reminder_stage: p.reminder_stage }),
  },
}));
`;

const simulateCode = `${deliveryForN8n}

// ---------- n8n glue ----------
// Test-only stand-in for the email provider (preview mode only, see Load Provider Simulations).
return { json: simulatedResponse($('Plan Reminders (dedup)').item.json.simulated_outcome) };
`;

const interpretCode = `${deliveryForN8n}

// ---------- n8n glue ----------
// Input: the provider response (success output, error output, or simulation) for one reminder.
const n = $('Plan Reminders (dedup)').item.json;
const result = interpretProviderResult($json);
return {
  json: {
    notification_id: n.notification_id,
    dedup_key: n.dedup_key,
    driver_id: n.driver_id,
    full_name: n.full_name,
    document_type: n.document_type,
    reminder_stage: n.reminder_stage,
    simulated_outcome: n.simulated_outcome,
    delivered_to: n.delivered_to,
    ...result,
    attempted_at: new Date().toISOString(),
  },
};
`;

const staffReviewCode = `${deliveryForN8n}

// ---------- n8n glue ----------
// New staff-review items: failed / uncertain deliveries, stuck pendings, missing or invalid documents.
const rows = $('Classify Credentials').all().map((i) => i.json);
// A node fed by two branches (simulated + real provider) runs once per branch; collect every run.
const allRuns = (name) => {
  const out = [];
  for (let run = 0; run < 20; run++) {
    let items;
    try { items = $(name).all(0, run); } catch (e) { break; }
    if (!items || items.length === 0) break;
    out.push(...items.map((i) => i.json));
  }
  return out;
};
const deliveries = allRuns('Interpret Provider Result');
const history = ${rowsOf('Load Notification History', 'dedup_key')};
const existingKeys = ${rowsOf('Load Staff Review Queue', 'review_key')}.map((r) => r.review_key);

const items = buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt: null });
return items.map((i) => ({ json: i }));
`;

const summaryCode = `// Run summary: what was due, sent, failed, uncertain, skipped, and queued for staff review.
const tryAll = (name) => { try { return $(name).all().map((i) => i.json); } catch (e) { return []; } };
// A node fed by two branches (simulated + real provider) runs once per branch; collect every run.
const allRuns = (name) => {
  const out = [];
  for (let run = 0; run < 20; run++) {
    let items;
    try { items = $(name).all(0, run); } catch (e) { break; }
    if (!items || items.length === 0) break;
    out.push(...items.map((i) => i.json));
  }
  return out;
};

const settings = $('Load Settings').first().json;
const history = ${rowsOf('Load Notification History', 'dedup_key')};
const plans = tryAll('Plan Reminders (dedup)');
const deliveries = allRuns('Interpret Provider Result');
const newReview = tryAll('Build Staff Review Items');
const openBefore = ${rowsOf('Load Staff Review Queue', 'review_key')}.filter((r) => r.status === 'open');

const count = (list, status) => list.filter((d) => d.status === status).length;
const historyStatus = (key) => history.filter((n) => n.dedup_key === key).map((n) => n.status);
const created = plans.filter((p) => p.decision === 'create');
const skipped = plans.filter((p) => p.decision === 'skip_duplicate');

return [{
  json: {
    phase: 'Phase 3: delivery outcomes + staff review',
    run_at: $now.toISO(),
    preview_only: settings.preview_only,
    all_messages_delivered_to: settings.preview_only ? settings.test_recipient : '(live recipients)',
    reminders_due: plans.length,
    attempted: created.length,
    sent: count(deliveries, 'sent'),
    failed: count(deliveries, 'failed'),
    uncertain: count(deliveries, 'uncertain'),
    skipped_duplicates: skipped.length,
    retried_after_failure: created.filter((p) => historyStatus(p.dedup_key).includes('failed')).length,
    held_because_uncertain: skipped.filter((p) => historyStatus(p.dedup_key).includes('uncertain')).length,
    staff_review_new: newReview.length,
    staff_review_open_total: openBefore.length + newReview.length,
    deliveries: deliveries.map((d) => ({ stage: d.reminder_stage, driver: d.full_name, document: d.document_type, status: d.status, simulated: d.simulated_outcome || '', provider_message_id: d.provider_message_id, error_detail: d.error_detail })),
    staff_review_new_items: newReview.map((r) => ({ category: r.category, severity: r.severity, driver_id: r.driver_id, document_type: r.document_type, detail: r.detail })),
  },
}];
`;

// ---------- Column mappings ----------

const NOTIFICATION_COLUMNS = [
  'notification_id', 'driver_id', 'document_id', 'document_version', 'reminder_stage', 'dedup_key',
  'audience', 'intended_recipient', 'delivered_to', 'delivery_mode', 'subject', 'body', 'from_name',
  'simulated_outcome', 'provider_message_id', 'status', 'attempted_at', 'error_detail',
];
const RESULT_COLUMNS = ['status', 'provider_message_id', 'error_detail', 'attempted_at'];
const REVIEW_COLUMNS = ['review_key', 'created_at', 'category', 'severity', 'status', 'driver_id', 'document_type', 'notification_id', 'dedup_key', 'detail', 'recommended_action'];

const sample = (cols, extra = {}) =>
  JSON.stringify({ ...extra, ...Object.fromEntries(cols.map((c) => [c, c === 'document_version' ? 2 : 'sample'])) });
const sampleNotification = sample(NOTIFICATION_COLUMNS, { decision: 'create', full_name: 'Jordan Lee', document_type: 'MEDICAL_CERT', days_remaining: 90 });

const mapping = (cols) => cols.map((c) => `          ${c}: expr('{{ $json.${c} }}'),`).join('\n');
const schema = (cols) => cols.map((c) =>
  `          { id: '${c}', displayName: '${c}', required: false, defaultMatch: false, display: true, type: '${c === 'document_version' ? 'number' : 'string'}', canBeUsedToMatch: true },`).join('\n');

// ---------- Node helpers ----------

const loadNode = (varName, name, table, x, extra = '', output = '{ id: 1 }') => `const ${varName} = node({
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
  output: [${output}],
});
`;
const SETTINGS_SAMPLE = "{ business_timezone: 'America/Los_Angeles', test_reference_date: '2026-10-15', preview_only: true, test_recipient: 'test@example.com', reminder_from_name: 'Documinder' }";
const ONCE = 'executeOnce: true,\n    ';
const ONCE_MAYBE_EMPTY = 'executeOnce: true,\n    alwaysOutputData: true,\n    ';

const codeNode = (varName, name, code, [x, y], mode, output) => `const ${varName} = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: '${name}',
    parameters: {
      mode: '${mode}',
      language: 'javaScript',
      jsCode: ${JSON.stringify(code)},
    },
    position: [${x}, ${y}],
  },
  output: [${output}],
});
`;

const stickyNote = (varName, lines, color, [x, y], [w, h]) =>
  `const ${varName} = sticky(\n  ${JSON.stringify(lines.join('\n'))},\n  [],\n  { color: ${color}, position: [${x}, ${y}], width: ${w}, height: ${h} }\n);\n`;

// ---------- Daily review workflow ----------

const dailyReview = `import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Daily Review (manual)', position: [0, 300] },
  output: [{}],
});

${loadNode('loadSettings', 'Load Settings', 'documinder_settings', 240, '', SETTINGS_SAMPLE)}
${loadNode('loadDrivers', 'Load Drivers', 'documinder_drivers', 480, ONCE)}
${loadNode('loadRequirements', 'Load Requirements', 'documinder_requirements', 720, ONCE)}
${loadNode('loadDocuments', 'Load Documents', 'documinder_documents', 960, ONCE)}
${loadNode('loadHistory', 'Load Notification History', 'documinder_notifications', 1200, ONCE_MAYBE_EMPTY)}
${loadNode('loadReview', 'Load Staff Review Queue', 'documinder_staff_review', 1440, ONCE_MAYBE_EMPTY)}
${loadNode('loadSimulations', 'Load Provider Simulations', 'documinder_provider_simulations', 1680, ONCE_MAYBE_EMPTY)}
${loadNode('loadExpectations', 'Load Test Expectations', 'documinder_test_expectations', 1920, ONCE)}
${codeNode('classify', 'Classify Credentials', classifyCode, [2160, 300], 'runOnceForAllItems',
  "{ driver_id: 'D002', full_name: 'Jordan Lee', document_type: 'MEDICAL_CERT', document_id: 'DOC0008', expiration_date: '2027-01-13', days_remaining: 90, state: 'approaching_expiry', reminder_stage: 'D90', action: 'driver_reminder', reason: 'sample', dedup_key: 'D002|DOC0008|2|D90' }")}
${codeNode('report', 'Phase 1 Test Report', reportCode, [2400, 300], 'runOnceForAllItems', "{ exit_check: 'PASS', checked: 84, passed: 84, failed: 0 }")}
${codeNode('plan', 'Plan Reminders (dedup)', planCode, [2400, 760], 'runOnceForAllItems', sampleNotification)}
const isNew = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'New Reminder?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.decision }}'), rightValue: 'create', operator: { type: 'string', operation: 'equals' } }],
      },
    },
    position: [2640, 760],
  },
  output: [${sampleNotification}],
});

const recordPending = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Record Pending Notification',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
${mapping(NOTIFICATION_COLUMNS)}
        },
        schema: [
${schema(NOTIFICATION_COLUMNS)}
        ],
      },
    },
    position: [2880, 760],
  },
  output: [${sampleNotification}],
});

const isSimulated = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'Simulated Outcome?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr("{{ $('Plan Reminders (dedup)').item.json.simulated_outcome }}"), rightValue: '', operator: { type: 'string', operation: 'notEquals' } }],
      },
    },
    position: [3120, 760],
  },
  output: [${sampleNotification}],
});

const sendEmail = node({
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Send Reminder Email',
    onError: 'continueErrorOutput',
    parameters: {
      operation: 'send',
      fromEmail: expr("{{ $('Load Settings').first().json.reminder_from_name }} <{{ $('Load Settings').first().json.test_recipient }}>"),
      toEmail: expr("{{ $('Load Settings').first().json.preview_only === true ? $('Load Settings').first().json.test_recipient : $('Plan Reminders (dedup)').item.json.delivered_to }}"),
      subject: expr("{{ $('Plan Reminders (dedup)').item.json.subject }}"),
      emailFormat: 'text',
      text: expr("{{ $('Plan Reminders (dedup)').item.json.body }}\\n\\n--\\nDocuminder reminder {{ $('Plan Reminders (dedup)').item.json.notification_id }} · {{ $('Plan Reminders (dedup)').item.json.dedup_key }}\\nFictional portfolio demo data."),
      options: { appendAttribution: false },
    },
    credentials: { smtp: { id: '16gAGqgjKdTaEC0w', name: 'Gmail SMTP' } },
    position: [3360, 680],
  },
  output: [{ messageId: '<sample@gmail.com>', accepted: ['test@example.com'], rejected: [], response: '250 2.0.0 OK' }],
});

${codeNode('simulate', 'Simulate Provider Response', simulateCode, [3360, 880], 'runOnceForEachItem', "{ error: { code: 'ETIMEDOUT', message: 'sample' } }")}
${codeNode('interpret', 'Interpret Provider Result', interpretCode, [3600, 760], 'runOnceForEachItem',
  "{ notification_id: 'NTF-1-001', dedup_key: 'D002|DOC0008|2|D90', driver_id: 'D002', full_name: 'Jordan Lee', document_type: 'MEDICAL_CERT', reminder_stage: 'D90', simulated_outcome: '', delivered_to: 'test@example.com', status: 'sent', provider_message_id: '<sample@gmail.com>', error_detail: '', attempted_at: '2026-10-15T15:00:00.000Z' }")}
const updateNotification = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Record Provider Result',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'notification_id', condition: 'eq', keyValue: expr('{{ $json.notification_id }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
${mapping(RESULT_COLUMNS)}
        },
        schema: [
${schema(RESULT_COLUMNS)}
        ],
      },
    },
    position: [3840, 760],
  },
  output: [{ id: 1 }],
});

${codeNode('buildReview', 'Build Staff Review Items', staffReviewCode, [2400, 1260], 'runOnceForAllItems', sample(REVIEW_COLUMNS))}
const insertReview = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Add to Staff Review Queue',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_staff_review' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
${mapping(REVIEW_COLUMNS)}
        },
        schema: [
${schema(REVIEW_COLUMNS)}
        ],
      },
    },
    position: [2640, 1260],
  },
  output: [{ id: 1 }],
});

${codeNode('summary', 'Run Summary', summaryCode, [2400, 1560], 'runOnceForAllItems', "{ reminders_due: 9, attempted: 9, sent: 7, failed: 1, uncertain: 1, skipped_duplicates: 0, staff_review_new: 4 }")}
${stickyNote('noteOverview', [
  '## Documinder · Daily Review',
  'Checks every required credential for every driver, classifies it with plain date math (no AI), sends the right reminder once, and routes problems to staff.',
  '',
  '**Safety:** while **preview_only** is on, every email goes only to the test inbox. The Send node re-checks this itself.',
  '',
  'Manual trigger, not published, no schedule yet. Fictional data only. Reference date: documinder_settings.test_reference_date.',
], 4, [-120, -20], [300, 480])}
${stickyNote('noteLoad', [
  '## 1 · Load',
  'Settings, drivers, role requirements, every document version, notification history, the staff-review queue, test-only provider simulations, and expected results. Each load runs once (executeOnce); tables that may be empty still emit one item so the run continues.',
], 7, [200, -20], [1860, 480])}
${stickyNote('noteClassify', ['## 2 · Classify', 'Latest **verified** version → validate date → whole days left in the business timezone → state + current stage (D90…D0, OVERDUE). Endorsements without a date inherit the CDL date.', '', 'Source: src/documinder-core.js'], 5, [2100, -20], [240, 480])}
${stickyNote('noteReport', ['## 3 · Exit check', 'Compares all 84 rows with documinder_test_expectations → **PASS / FAIL**.'], 6, [2360, -20], [240, 480])}
${stickyNote('noteDeliver', [
  '## 4 · Deliver once, record every outcome',
  '**Plan:** dedup key driver | document | version | stage. Skip if any attempt is pending, sent, or uncertain; **failed** may retry.',
  '**Record first:** save as **pending** before sending, so a crash mid-send cannot cause a duplicate.',
  '**Send:** Gmail SMTP, **no automatic retries**. Errors go out the error branch instead of stopping the run.',
  '**Interpret:** accepted → sent · rejected → failed · timeout / unknown → **uncertain** (never auto-resent).',
  'Source: src/documinder-reminders.js, src/documinder-delivery.js',
], 3, [2340, 540], [1640, 560])}
${stickyNote('noteReview', [
  '## 5 · Staff review + summary',
  'Queues failed and uncertain deliveries, stuck pendings, missing documents, and invalid dates, each **once** (stable review_key). The run summary counts sent / failed / uncertain / skipped.',
], 2, [2340, 1140], [560, 600])}
export default workflow('documinder-daily-review', 'Documinder · A · Daily Review')
  .add(start)
  .to(loadSettings)
  .to(loadDrivers)
  .to(loadRequirements)
  .to(loadDocuments)
  .to(loadHistory)
  .to(loadReview)
  .to(loadSimulations)
  .to(loadExpectations)
  .to(classify)
  .to(report)
  .add(classify)
  .to(plan)
  .to(isNew.onTrue(recordPending.to(isSimulated.onTrue(simulate.to(interpret)).onFalse(sendEmail))))
  .add(sendEmail)
  .to(interpret)
  .add(sendEmail)
  .onError(interpret)
  .add(interpret)
  .to(updateNotification)
  .add(classify)
  .to(buildReview)
  .to(insertReview)
  .add(classify)
  .to(summary)
  .add(noteOverview)
  .add(noteLoad)
  .add(noteClassify)
  .add(noteReport)
  .add(noteDeliver)
  .add(noteReview);
`;


// ---------- Renewal intake & review workflow (Phase 4) ----------

const submitCode = `${coreForN8n}

${renewalsForN8n}

// ---------- n8n glue ----------
const form = $('Submit Renewal Form').first().json;
const submission = {
  driver_id: String(form.driver || '').split(' ')[0],
  document_type: form.document_type,
  submitted_expiration_date: form.submitted_expiration_date,
  submitted_file_url: form.submitted_file_url,
};
const result = evaluateSubmission({
  submission,
  settings: $('Load Settings (intake)').first().json,
  drivers: $('Load Drivers (intake)').all().map((i) => i.json),
  requirements: $('Load Requirements (intake)').all().map((i) => i.json),
  documents: $('Load Documents (intake)').all().map((i) => i.json),
  renewals: ${rowsOf('Load Renewals (intake)', 'renewal_id')},
  renewalId: 'RN-' + $execution.id,
});
return [{ json: { outcome: result.outcome, store: result.store, message: result.message, ...result.renewal } }];
`;

const reviewCode = `${coreForN8n}

${renewalsForN8n}

// ---------- n8n glue ----------
const plan = evaluateReview({
  review: $('Review Renewal Form').first().json,
  settings: $('Load Settings (review)').first().json,
  reviewers: ${rowsOf('Load Reviewers', 'reviewer_email')},
  renewals: ${rowsOf('Load Renewals (review)', 'renewal_id')},
  documents: $('Load Documents (review)').all().map((i) => i.json),
  notifications: ${rowsOf('Load Notifications (review)', 'notification_id')},
  staffReview: ${rowsOf('Load Staff Review (review)', 'review_key')},
});
return [{ json: plan }];
`;

const splitCloseCode = `// One item per reminder of the superseded version (none for rejections or first versions).
return ($('Decide Review').first().json.notifications_to_close || []).map((n) => ({ json: n }));
`;
const splitResolveCode = `// One item per staff-review entry this renewal resolves.
return ($('Decide Review').first().json.review_items_to_resolve || []).map((r) => ({ json: r }));
`;

const RENEWAL_COLUMNS = ['renewal_id', 'driver_id', 'document_type', 'submitted_expiration_date', 'submitted_file_url', 'status', 'submitted_at', 'reviewed_at', 'reviewed_by', 'rejection_reason', 'previous_document_id', 'previous_version', 'previous_expiration_date', 'new_document_id', 'new_version'];
const DOCUMENT_COLUMNS = ['document_id', 'driver_id', 'document_type', 'version', 'issue_date', 'expiration_date', 'status', 'source_file_url', 'verified_at', 'verified_by'];
const NUMERIC = new Set(['version', 'previous_version', 'new_version', 'document_version']);
const typedSchema = (cols) => cols.map((c) =>
  `          { id: '${c}', displayName: '${c}', required: false, defaultMatch: false, display: true, type: '${NUMERIC.has(c) ? 'number' : 'string'}', canBeUsedToMatch: true },`).join('\n');
const mappingFrom = (cols, source) => cols.map((c) => `          ${c}: expr("{{ ${source}.${c} }}"),`).join('\n');

const tableNode = (varName, name, table, operation, [x, y], { columns, source, filters, extra = '' }) => `const ${varName} = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: '${name}',
    ${extra}parameters: {
      resource: 'row',
      operation: '${operation}',
      dataTableId: { __rl: true, mode: 'name', value: '${table}' },${filters ? `
      matchType: 'allConditions',
      filters: { conditions: [${filters}] },` : ''}
      columns: {
        mappingMode: 'defineBelow',
        value: {
${mappingFrom(columns, source)}
        },
        schema: [
${typedSchema(columns)}
        ],
      },
    },
    position: [${x}, ${y}],
  },
  output: [{ id: 1 }],
});
`;
const cond = (key, value) => `{ keyName: '${key}', condition: 'eq', keyValue: expr("{{ ${value} }}") }`;

const loadAt = (varName, name, table, [x, y], extra = '') => loadNode(varName, name, table, x, extra).replace(`position: [${x}, 300]`, `position: [${x}, ${y}]`);

const driverOptions = fixtures.drivers.map((d) => `{ option: '${d.driver_id} · ${d.full_name}' }`).join(', ');
const docTypeOptions = ['CDL', 'MEDICAL_CERT', 'TWIC', 'HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT', 'SAFETY_TRAINING'].map((t) => `{ option: '${t}' }`).join(', ');

const completion = (varName, name, title, message, [x, y]) => `const ${varName} = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: '${name}',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: ${title},
      completionMessage: ${message},
    },
    position: [${x}, ${y}],
  },
  output: [{}],
});
`;

const renewals = `import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const submitForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Submit Renewal Form',
    parameters: {
      formTitle: 'Documinder · Submit a renewed credential',
      formDescription: 'Fictional demo. Your verified record does not change until compliance approves this submission.',
      formFields: {
        values: [
          { fieldLabel: 'Driver', fieldName: 'driver', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [${driverOptions}] } },
          { fieldLabel: 'Document type', fieldName: 'document_type', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [${docTypeOptions}] } },
          { fieldLabel: 'New expiration date', fieldName: 'submitted_expiration_date', fieldType: 'date', requiredField: true },
          { fieldLabel: 'Link to the renewed document', fieldName: 'submitted_file_url', fieldType: 'text', placeholder: 'https://files.example.com/...', requiredField: true },
        ],
      },
      responseMode: 'onReceived',
      options: { path: 'documinder-submit-renewal', buttonLabel: 'Submit renewal', appendAttribution: false },
    },
    position: [0, 300],
  },
  output: [{ driver: 'D006 · Taylor Morgan', document_type: 'TWIC', submitted_expiration_date: '2031-10-22', submitted_file_url: 'https://files.example.com/twic.pdf', submittedAt: '2026-10-15T10:00:00.000-07:00', formMode: 'test' }],
});

${loadAt('loadSettingsIn', 'Load Settings (intake)', 'documinder_settings', [240, 300], '')}
${loadAt('loadDriversIn', 'Load Drivers (intake)', 'documinder_drivers', [480, 300], ONCE)}
${loadAt('loadReqIn', 'Load Requirements (intake)', 'documinder_requirements', [720, 300], ONCE)}
${loadAt('loadDocsIn', 'Load Documents (intake)', 'documinder_documents', [960, 300], ONCE)}
${loadAt('loadRenewalsIn', 'Load Renewals (intake)', 'documinder_renewals', [1200, 300], ONCE_MAYBE_EMPTY)}
${codeNode('evaluateSubmission', 'Evaluate Submission', submitCode, [1440, 300], 'runOnceForAllItems', sample(RENEWAL_COLUMNS, { outcome: 'pending_review', store: true, message: 'sample' }))}
const shouldStore = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'Store Submission?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.store }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
    },
    position: [1680, 300],
  },
  output: [${sample(RENEWAL_COLUMNS, { outcome: 'pending_review', store: true, message: 'sample' })}],
});

${tableNode('storeRenewal', 'Store Renewal (pending_review)', 'documinder_renewals', 'insert', [1920, 220], { columns: RENEWAL_COLUMNS, source: "$('Evaluate Submission').first().json" })}
${completion('showSubmission', 'Show Submission Result', `expr("{{ $('Evaluate Submission').first().json.outcome === 'pending_review' ? 'Renewal received' : ($('Evaluate Submission').first().json.outcome === 'duplicate' ? 'Already submitted' : 'Submission not accepted') }}")`, `expr("{{ $('Evaluate Submission').first().json.message }}")`, [2160, 300])}
const reviewForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Review Renewal Form',
    parameters: {
      formTitle: 'Documinder · Review a renewal (compliance)',
      formDescription: 'Fictional demo. Only reviewers listed in documinder_reviewers can decide. Each renewal can be reviewed once.',
      formFields: {
        values: [
          { fieldLabel: 'Renewal ID', fieldName: 'renewal_id', fieldType: 'text', placeholder: 'RN-123', requiredField: true },
          { fieldLabel: 'Reviewer email', fieldName: 'reviewer_email', fieldType: 'email', requiredField: true },
          { fieldLabel: 'Decision', fieldName: 'decision', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [{ option: 'approve' }, { option: 'reject' }] } },
          { fieldLabel: 'Rejection reason (required to reject)', fieldName: 'rejection_reason', fieldType: 'textarea' },
        ],
      },
      responseMode: 'onReceived',
      options: { path: 'documinder-review-renewal', buttonLabel: 'Record decision', appendAttribution: false },
    },
    position: [0, 900],
  },
  output: [{ renewal_id: 'RN-1', reviewer_email: 'compliance.reviewer@example.com', decision: 'approve', rejection_reason: '', submittedAt: '2026-10-15T10:00:00.000-07:00', formMode: 'test' }],
});

${loadAt('loadSettingsRv', 'Load Settings (review)', 'documinder_settings', [240, 900], '')}
${loadAt('loadReviewers', 'Load Reviewers', 'documinder_reviewers', [480, 900], ONCE_MAYBE_EMPTY)}
${loadAt('loadRenewalsRv', 'Load Renewals (review)', 'documinder_renewals', [720, 900], ONCE_MAYBE_EMPTY)}
${loadAt('loadDocsRv', 'Load Documents (review)', 'documinder_documents', [960, 900], ONCE)}
${loadAt('loadNotifRv', 'Load Notifications (review)', 'documinder_notifications', [1200, 900], ONCE_MAYBE_EMPTY)}
${loadAt('loadReviewRv', 'Load Staff Review (review)', 'documinder_staff_review', [1440, 900], ONCE_MAYBE_EMPTY)}
${codeNode('decide', 'Decide Review', reviewCode, [1680, 900], 'runOnceForAllItems', "{ action: 'approve', renewal_id: 'RN-1', message: 'sample', archive: { document_id: 'DOC0034', version: 1 }, new_document: { document_id: 'DOC0034', version: 2 }, renewal_update: { status: 'approved' }, notifications_to_close: [], review_items_to_resolve: [] }")}
const routeDecision = node({
  type: 'n8n-nodes-base.switch',
  version: 3.2,
  config: {
    name: 'Route Decision',
    parameters: {
      rules: {
        values: [
          { outputKey: 'approve', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: expr('{{ $json.action }}'), rightValue: 'approve', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
          { outputKey: 'reject', renameOutput: true, conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: expr('{{ $json.action }}'), rightValue: 'reject', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'refuse' },
    },
    position: [1920, 900],
  },
  output: [{ action: 'approve' }],
});

${tableNode('createVersion', 'Create New Verified Version', 'documinder_documents', 'insert', [2160, 780], { columns: DOCUMENT_COLUMNS, source: "$('Decide Review').first().json.new_document" })}
${tableNode('archiveVersion', 'Archive Previous Version', 'documinder_documents', 'update', [2400, 780], {
  columns: ['status'], source: "{ status: 'archived' }",
  filters: [cond('document_id', "$('Decide Review').first().json.archive ? $('Decide Review').first().json.archive.document_id : '__no_previous_version__'"), cond('version', "$('Decide Review').first().json.archive ? $('Decide Review').first().json.archive.version : -1")].join(', '),
  extra: 'alwaysOutputData: true,\n    ',
}).replace(`status: expr("{{ { status: 'archived' }.status }}")`, "status: 'archived'")}
${tableNode('recordDecision', 'Record Review Decision', 'documinder_renewals', 'update', [2640, 900], {
  columns: ['status', 'reviewed_at', 'reviewed_by', 'rejection_reason', 'new_document_id', 'new_version'],
  source: "$('Decide Review').first().json.renewal_update",
  filters: cond('renewal_id', "$('Decide Review').first().json.renewal_id"),
})}
${codeNode('splitClose', 'Reminders to Close', splitCloseCode, [2880, 780], 'runOnceForAllItems', "{ notification_id: 'NTF-1-001', closed_at: '2026-10-15T17:00:00.000Z', closed_reason: 'sample' }")}
${tableNode('closeReminder', 'Close Old-Version Reminder', 'documinder_notifications', 'update', [3120, 780], {
  columns: ['closed_at', 'closed_reason'], source: '$json', filters: cond('notification_id', '$json.notification_id'),
})}
${codeNode('splitResolve', 'Staff Review Items to Resolve', splitResolveCode, [2880, 1000], 'runOnceForAllItems', "{ review_key: 'delivery|NTF-1-001', status: 'resolved', resolved_at: '2026-10-15T17:00:00.000Z', resolution: 'sample' }")}
${tableNode('resolveReview', 'Resolve Staff Review Item', 'documinder_staff_review', 'update', [3120, 1000], {
  columns: ['status', 'resolved_at', 'resolution'], source: '$json', filters: cond('review_key', '$json.review_key'),
})}
${completion('showReview', 'Show Review Result', `expr("{{ { approve: 'Renewal approved', reject: 'Renewal rejected', refuse: 'No change made' }[$('Decide Review').first().json.action] }}")`, `expr("{{ $('Decide Review').first().json.message }}")`, [2880, 1220])}
${stickyNote('noteIntake', [
  '## B1 · Renewal intake',
  'A driver submits a renewed credential through the form. It is validated: active driver, a required document type, a real date that is in the future and extends the current one, and a link.',
  '',
  'Valid → stored as **pending_review**. Invalid → stored as invalid_submission with the reason. Already pending → the existing renewal is returned.',
  '**The verified document is never changed here.**',
], 4, [-120, 60], [2400, 420])}
${stickyNote('noteReview', [
  '## B2 · Review (compliance)',
  'Refused with no change: unknown renewal, already reviewed (so it can never be approved twice), reviewer not on the allow-list, or a reject without a reason.',
  '',
  '**Approve:** create v+1 as verified → archive the old version (kept, never deleted) → record the decision → close old-version reminders (delivery status kept) → resolve related staff-review items.',
  '**Reject:** record the reason only. Documents are untouched.',
  '',
  'Source: src/documinder-renewals.js',
], 6, [-120, 640], [3460, 760])}
export default workflow('documinder-renewals', 'Documinder · B · Renewal Intake & Review')
  .add(submitForm)
  .to(loadSettingsIn)
  .to(loadDriversIn)
  .to(loadReqIn)
  .to(loadDocsIn)
  .to(loadRenewalsIn)
  .to(evaluateSubmission)
  .to(shouldStore.onTrue(storeRenewal.to(showSubmission)).onFalse(showSubmission))
  .add(reviewForm)
  .to(loadSettingsRv)
  .to(loadReviewers)
  .to(loadRenewalsRv)
  .to(loadDocsRv)
  .to(loadNotifRv)
  .to(loadReviewRv)
  .to(decide)
  .to(routeDecision
    .onCase(0, createVersion.to(archiveVersion).to(recordDecision))
    .onCase(1, recordDecision)
    .onCase(2, showReview))
  .add(recordDecision)
  .to(splitClose)
  .to(closeReminder)
  .add(recordDecision)
  .to(splitResolve)
  .to(resolveReview)
  .add(recordDecision)
  .to(showReview)
  .add(noteIntake)
  .add(noteReview);
`;

// ---------- Dev reset workflow ----------

const clearNode = (varName, name, table, x) => `const ${varName} = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: '${name}',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: '${table}' },
    },
    position: [${x}, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});
`;

const resetDemo = `import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Reset Demo Data (manual)', position: [0, 300] },
  output: [{}],
});

${loadNode('loadSettings', 'Load Settings', 'documinder_settings', 240, '', SETTINGS_SAMPLE)}
const isPreview = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'Preview Mode Only?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.preview_only }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
    },
    position: [480, 300],
  },
  output: [{ preview_only: true }],
});

${clearNode('clearNotifications', 'Clear Notification History', 'documinder_notifications', 720)}
${clearNode('clearReview', 'Clear Staff Review Queue', 'documinder_staff_review', 960)}
${clearNode('clearSimulations', 'Clear Provider Simulations', 'documinder_provider_simulations', 1200)}
${clearNode('clearRenewals', 'Clear Renewals', 'documinder_renewals', 1440)}
${clearNode('clearDocuments', 'Clear Documents', 'documinder_documents', 1680)}
${codeNode('fixtureDocs', 'Fixture Documents', `// The 61 fictional documents from data/fixtures/fixtures.json (embedded at build time).\nreturn ${JSON.stringify(fixtures.documents)}.map((d) => ({ json: d }));\n`, [1920, 300], 'runOnceForAllItems', JSON.stringify(fixtures.documents[0]))}
const restoreDocs = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Restore Fixture Documents',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
${mapping(DOCUMENT_COLUMNS)}
        },
        schema: [
${typedSchema(DOCUMENT_COLUMNS)}
        ],
      },
    },
    position: [2160, 300],
  },
  output: [{ id: 1 }],
});

${stickyNote('note', [
  '## Dev · Reset demo data',
  'Returns the demo to the fixture baseline: clears notification history, the staff-review queue, provider simulations, and renewals, then restores the 61 fictional documents (undoing any approved renewals).',
  '',
  '**Guard:** does nothing unless documinder_settings.preview_only is true, so it can never wipe live history. Drivers, requirements, reviewers, and settings are not touched.',
], 4, [-120, -40], [2460, 520])}
export default workflow('documinder-reset-demo', 'Documinder · Dev · Reset Demo Data')
  .add(start)
  .to(loadSettings)
  .to(isPreview.onTrue(clearNotifications.to(clearReview).to(clearSimulations).to(clearRenewals).to(clearDocuments).to(fixtureDocs).to(restoreDocs)))
  .add(note);
`;

writeFileSync(join(root, 'workflows/daily-review.sdk.js'), dailyReview);
writeFileSync(join(root, 'workflows/reset-demo.sdk.js'), resetDemo);
writeFileSync(join(root, 'workflows/renewals.sdk.js'), renewals);
console.log(`wrote daily-review.sdk.js (${dailyReview.length}), renewals.sdk.js (${renewals.length}), reset-demo.sdk.js (${resetDemo.length})`);
