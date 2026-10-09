import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Run Daily Review (manual)', position: [0, 300] },
  output: [{}],
});

const loadSettings = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Settings',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_settings' },
      returnAll: true,
    },
    position: [240, 300],
  },
  output: [{ business_timezone: 'America/Los_Angeles', test_reference_date: '2026-10-15', preview_only: true, test_recipient: 'test@example.com', reminder_from_name: 'Documinder' }],
});

const loadDrivers = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Drivers',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_drivers' },
      returnAll: true,
    },
    position: [480, 300],
  },
  output: [{ id: 1 }],
});

const loadRequirements = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Requirements',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_requirements' },
      returnAll: true,
    },
    position: [720, 300],
  },
  output: [{ id: 1 }],
});

const loadDocuments = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Documents',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      returnAll: true,
    },
    position: [960, 300],
  },
  output: [{ id: 1 }],
});

const loadHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Notification History',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
      returnAll: true,
    },
    position: [1200, 300],
  },
  output: [{ id: 1 }],
});

const loadReview = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Staff Review Queue',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_staff_review' },
      returnAll: true,
    },
    position: [1440, 300],
  },
  output: [{ id: 1 }],
});

const loadSimulations = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Provider Simulations',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_provider_simulations' },
      returnAll: true,
    },
    position: [1680, 300],
  },
  output: [{ id: 1 }],
});

const loadExpectations = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Test Expectations',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_test_expectations' },
      returnAll: true,
    },
    position: [1920, 300],
  },
  output: [{ id: 1 }],
});

const classify = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify Credentials',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Documinder core — deterministic credential classification (Phase 1).\n//\n// Pure functions with no dependencies, so the same code runs in three places:\n//   1. Node unit tests (tests/core.test.mjs)\n//   2. The n8n \"Classify credentials\" Code node (see workflows/)\n//   3. Anyone reading the repo who wants to understand the rules\n//\n// No LLM is involved. Dates are compared as calendar days, never as timestamps.\n\nconst MS_PER_DAY = 86400000;\n\nconst ENDORSEMENT_TYPES = ['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT'];\nconst DEFAULT_STAGES = [90, 60, 30, 14, 7, 0];\n\n// ---------- Dates ----------\n\n// Parses a strict YYYY-MM-DD string into a whole-day number (days since 1970-01-01).\n// Rejects malformed strings and impossible dates such as 2026-02-30.\nfunction parseCalendarDate(value) {\n  if (value === null || value === undefined || String(value).trim() === '') {\n    return { ok: false, reason: 'blank' };\n  }\n  const s = String(value).trim();\n  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);\n  if (!m) return { ok: false, reason: `malformed date \"${s}\" (expected YYYY-MM-DD)` };\n  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];\n  const ms = Date.UTC(y, mo - 1, d);\n  const check = new Date(ms);\n  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {\n    return { ok: false, reason: `impossible calendar date \"${s}\"` };\n  }\n  return { ok: true, day: Math.round(ms / MS_PER_DAY), iso: s };\n}\n\n// Today's calendar date (YYYY-MM-DD) in the business timezone.\nfunction todayInTimezone(timeZone, now = new Date()) {\n  const parts = new Intl.DateTimeFormat('en-CA', {\n    timeZone,\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(now);\n  const get = (t) => parts.find((p) => p.type === t).value;\n  return `${get('year')}-${get('month')}-${get('day')}`;\n}\n\n// The fixed test date wins when set; otherwise use the real date in the business timezone.\nfunction resolveReferenceDate(settings, now = new Date()) {\n  const tz = settings.business_timezone || 'America/Los_Angeles';\n  const fixed = settings.test_reference_date;\n  if (fixed !== null && fixed !== undefined && String(fixed).trim() !== '') {\n    const parsed = parseCalendarDate(fixed);\n    if (!parsed.ok) throw new Error(`Settings.test_reference_date is invalid: ${parsed.reason}`);\n    return { iso: parsed.iso, day: parsed.day, source: 'test_reference_date', timeZone: tz };\n  }\n  const iso = todayInTimezone(tz, now);\n  return { iso, day: parseCalendarDate(iso).day, source: 'current_date', timeZone: tz };\n}\n\n// ---------- Policy ----------\n\nfunction parseStages(value) {\n  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_STAGES.slice();\n  const stages = String(value)\n    .split(',')\n    .map((s) => Number(s.trim()))\n    .filter((n) => Number.isInteger(n) && n >= 0);\n  return [...new Set(stages)].sort((a, b) => b - a);\n}\n\n// State is defined by the reminder policy table in the build brief.\nfunction stateForDays(days) {\n  if (days < 0) return 'overdue';\n  if (days === 0) return 'expires_today';\n  if (days <= 7) return 'critical';\n  if (days <= 30) return 'urgent';\n  if (days <= 90) return 'approaching_expiry';\n  return 'current';\n}\n\n// Only the *current* applicable stage is returned; missed earlier stages are never replayed.\n// Example with stages 90,60,30,14,7,0: 45 days left -> D60, 90 -> D90, 91 -> none.\nfunction stageForDays(days, stages) {\n  if (days < 0) return 'OVERDUE';\n  const due = stages.filter((s) => s >= days);\n  if (due.length === 0) return '';\n  return `D${Math.min(...due)}`;\n}\n\nfunction actionFor(state, escalationPolicy) {\n  const escalates = escalationPolicy !== 'none';\n  switch (state) {\n    case 'approaching_expiry':\n    case 'urgent':\n    case 'critical':\n      return 'driver_reminder';\n    case 'expires_today':\n      return escalates ? 'driver_notice_and_staff_escalation' : 'driver_notice';\n    case 'overdue':\n      return escalates ? 'staff_escalation' : 'none';\n    case 'missing':\n    case 'invalid_date':\n      return 'staff_review';\n    default:\n      return 'none';\n  }\n}\n\n// ---------- Documents ----------\n\nfunction isTrue(v) {\n  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';\n}\n\n// Latest verified version of one document type for one driver (archived/pending rows ignored).\nfunction latestVerified(documents, driverId, documentType) {\n  return documents\n    .filter((d) => d.driver_id === driverId && d.document_type === documentType && d.status === 'verified')\n    .sort((a, b) => Number(b.version) - Number(a.version))[0];\n}\n\n// ---------- Classification ----------\n\nfunction classifyAll({ settings, drivers, requirements, documents, now = new Date() }) {\n  const ref = resolveReferenceDate(settings, now);\n  const rows = [];\n\n  for (const driver of drivers) {\n    const active = isTrue(driver.active);\n    const reqs = requirements.filter((r) => r.applicable_role === driver.role);\n\n    if (reqs.length === 0) {\n      rows.push(baseRow(ref, driver, { document_type: '*' }, {\n        state: 'invalid_date',\n        action: 'staff_review',\n        reason: `no requirements configured for role \"${driver.role}\"`,\n      }));\n      continue;\n    }\n\n    for (const req of reqs) {\n      if (!active) {\n        rows.push(baseRow(ref, driver, req, { state: 'inactive_skipped', reason: 'driver is inactive' }));\n        continue;\n      }\n      if (!isTrue(req.required)) {\n        rows.push(baseRow(ref, driver, req, { state: 'not_applicable', reason: `not required for role ${driver.role}` }));\n        continue;\n      }\n\n      const doc = latestVerified(documents, driver.driver_id, req.document_type);\n      if (!doc) {\n        rows.push(baseRow(ref, driver, req, {\n          state: 'missing',\n          action: actionFor('missing'),\n          reason: 'required document has no verified version on file',\n        }));\n        continue;\n      }\n\n      // Endorsements may share the CDL expiration date. Never invent a date:\n      // inherit only when the endorsement record is blank and a verified CDL exists.\n      let expirationRaw = doc.expiration_date;\n      let expirationSource = 'document';\n      if ((expirationRaw === null || expirationRaw === undefined || String(expirationRaw).trim() === '') &&\n          ENDORSEMENT_TYPES.includes(req.document_type)) {\n        const cdl = latestVerified(documents, driver.driver_id, 'CDL');\n        if (cdl) {\n          expirationRaw = cdl.expiration_date;\n          expirationSource = `inherited_from_cdl:${cdl.document_id}`;\n        }\n      }\n\n      const exp = parseCalendarDate(expirationRaw);\n      const docFields = {\n        document_id: doc.document_id,\n        document_version: Number(doc.version),\n        expiration_date: expirationRaw === null || expirationRaw === undefined ? '' : String(expirationRaw),\n        expiration_source: expirationSource,\n      };\n\n      if (!exp.ok) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: exp.reason === 'blank' ? 'expiration date not provided' : exp.reason,\n        }));\n        continue;\n      }\n\n      const issue = parseCalendarDate(doc.issue_date);\n      if (issue.ok && issue.day > exp.day) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: `issue_date ${issue.iso} is after expiration_date ${exp.iso}`,\n        }));\n        continue;\n      }\n\n      const days = exp.day - ref.day;\n      const state = stateForDays(days);\n      const stage = state === 'current' ? '' : stageForDays(days, parseStages(req.reminder_stages));\n      rows.push(baseRow(ref, driver, req, {\n        ...docFields,\n        days_remaining: days,\n        state,\n        reminder_stage: stage,\n        action: actionFor(state, req.escalation_policy),\n        reason: `${days} day(s) remaining as of ${ref.iso} (${ref.timeZone})`,\n      }));\n    }\n  }\n  return { reference: ref, rows };\n}\n\nfunction baseRow(ref, driver, req, fields) {\n  return {\n    reference_date: ref.iso,\n    reference_source: ref.source,\n    driver_id: driver.driver_id,\n    full_name: driver.full_name,\n    role: driver.role,\n    active: isTrue(driver.active),\n    requirement_id: req.requirement_id || '',\n    document_type: req.document_type,\n    document_id: '',\n    document_version: null,\n    expiration_date: '',\n    expiration_source: '',\n    days_remaining: null,\n    state: '',\n    reminder_stage: '',\n    action: 'none',\n    reason: '',\n    // Phase 2 dedup key: driver_id + document_id + document_version + reminder_stage\n    dedup_key: '',\n    ...fields,\n  };\n}\n\nfunction withDedupKeys(rows) {\n  return rows.map((r) => ({\n    ...r,\n    dedup_key: r.reminder_stage && r.document_id\n      ? `${r.driver_id}|${r.document_id}|${r.document_version}|${r.reminder_stage}`\n      : '',\n  }));\n}\n\n// Compares actual rows with expected rows keyed by driver_id + document_type.\nfunction compareWithExpected(rows, expected) {\n  const actualByKey = new Map(rows.map((r) => [`${r.driver_id}:${r.document_type}`, r]));\n  const results = expected.map((e) => {\n    const a = actualByKey.get(`${e.driver_id}:${e.document_type}`);\n    const actualState = a ? a.state : '(no row)';\n    const actualStage = a ? a.reminder_stage : '';\n    const pass = actualState === e.expected_state && (actualStage || '') === (e.expected_stage || '');\n    return {\n      driver_id: e.driver_id,\n      full_name: a ? a.full_name : '',\n      document_type: e.document_type,\n      primary_fixture: isTrue(e.primary_fixture),\n      expected_state: e.expected_state,\n      actual_state: actualState,\n      expected_stage: e.expected_stage || '',\n      actual_stage: actualStage || '',\n      days_remaining: a ? a.days_remaining : null,\n      pass,\n    };\n  });\n  const expectedKeys = new Set(expected.map((e) => `${e.driver_id}:${e.document_type}`));\n  const unexpected = rows.filter((r) => !expectedKeys.has(`${r.driver_id}:${r.document_type}`));\n  const failed = results.filter((r) => !r.pass).length + unexpected.length;\n  return { results, unexpected, total: results.length, passed: results.length - results.filter((r) => !r.pass).length, failed };\n}\n\nfunction summarize(rows) {\n  const counts = {};\n  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;\n  return counts;\n}\n\n// ---------- n8n glue ----------\n// Reads the tables loaded upstream and returns one item per driver x requirement.\nconst settings = $('Load Settings').first().json;\nconst drivers = $('Load Drivers').all().map((i) => i.json);\nconst requirements = $('Load Requirements').all().map((i) => i.json);\nconst documents = $('Load Documents').all().map((i) => i.json);\n\nconst { rows } = classifyAll({ settings, drivers, requirements, documents });\nreturn withDedupKeys(rows).map((r) => ({ json: r }));\n",
    },
    position: [2160, 300],
  },
  output: [{ driver_id: 'D002', full_name: 'Jordan Lee', document_type: 'MEDICAL_CERT', document_id: 'DOC0008', expiration_date: '2027-01-13', days_remaining: 90, state: 'approaching_expiry', reminder_stage: 'D90', action: 'driver_reminder', reason: 'sample', dedup_key: 'D002|DOC0008|2|D90' }],
});

const report = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Phase 1 Test Report',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Phase 1 exit check: compare every classified row with documinder_test_expectations.\nconst rows = $input.all().map((i) => i.json);\nconst expected = $('Load Test Expectations').all().map((i) => i.json);\nconst byKey = new Map(rows.map((r) => [r.driver_id + ':' + r.document_type, r]));\n\nconst results = expected.map((e) => {\n  const a = byKey.get(e.driver_id + ':' + e.document_type);\n  const actualState = a ? a.state : '(no row)';\n  const actualStage = a ? a.reminder_stage || '' : '';\n  return {\n    driver: a ? a.full_name : e.driver_id,\n    document_type: e.document_type,\n    primary_fixture: e.primary_fixture === true,\n    expected: e.expected_state + (e.expected_stage ? ' / ' + e.expected_stage : ''),\n    actual: actualState + (actualStage ? ' / ' + actualStage : ''),\n    days_remaining: a ? a.days_remaining : null,\n    pass: actualState === e.expected_state && actualStage === (e.expected_stage || ''),\n  };\n});\nconst expectedKeys = new Set(expected.map((e) => e.driver_id + ':' + e.document_type));\nconst unexpectedRows = rows.filter((r) => !expectedKeys.has(r.driver_id + ':' + r.document_type));\n\nconst stateCounts = {};\nfor (const r of rows) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;\nconst failures = results.filter((r) => !r.pass);\n\nreturn [{\n  json: {\n    phase: 'Phase 1: classification engine',\n    compares_against: 'the fixture baseline in data/fixtures. Approved renewals intentionally change results; run \"Documinder · Dev · Reset Demo Data\" to restore the baseline.',\n    reference_date: rows[0] ? rows[0].reference_date : null,\n    reference_source: rows[0] ? rows[0].reference_source : null,\n    exit_check: failures.length === 0 && unexpectedRows.length === 0 ? 'PASS' : 'FAIL',\n    checked: results.length,\n    passed: results.length - failures.length,\n    failed: failures.length + unexpectedRows.length,\n    state_counts: stateCounts,\n    primary_fixtures: results.filter((r) => r.primary_fixture),\n    failures,\n    unexpected_rows: unexpectedRows.map((r) => r.driver_id + ':' + r.document_type),\n  },\n}];\n",
    },
    position: [2400, 300],
  },
  output: [{ exit_check: 'PASS', checked: 84, passed: 84, failed: 0 }],
});

const plan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Plan Reminders (dedup)',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Documinder reminders — Phase 2: compose preview reminders and deduplicate them\n// against notification history. Deterministic templates, no LLM.\n//\n// Runs in Node tests (tests/reminders.test.mjs) and in the n8n\n// \"Plan Reminders (dedup)\" Code node (embedded by scripts/build-workflow.mjs).\n\n// Statuses that mean \"this reminder already went out, or may have\": never create another.\n//   pending   = recorded before the send; if a run dies mid-send it stays pending (treated as uncertain)\n//   previewed = composed without a provider (Phase 2 dry runs)\n// A 'failed' attempt does not block, so it can be retried. 'closed' belongs to a superseded version.\nconst BLOCKING_STATUSES = ['pending', 'previewed', 'sent', 'uncertain'];\n\nconst DOCUMENT_LABELS = {\n  CDL: 'Commercial Driver\\'s License (CDL)',\n  MEDICAL_CERT: 'Medical Examiner\\'s Certificate',\n  TWIC: 'TWIC card',\n  HAZMAT_ENDORSEMENT: 'Hazmat endorsement',\n  TANKER_ENDORSEMENT: 'Tanker endorsement',\n  DOUBLES_TRIPLES_ENDORSEMENT: 'Doubles/triples endorsement',\n  SAFETY_TRAINING: 'Defensive-driving / safety training',\n};\n\nconst MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];\n\nfunction formatDate(iso) {\n  const [y, m, d] = String(iso).split('-').map(Number);\n  return `${MONTHS[m - 1]} ${d}, ${y}`;\n}\n\nfunction whenPhrase(days) {\n  if (days > 1) return `in ${days} days`;\n  if (days === 1) return 'tomorrow';\n  if (days === 0) return 'today';\n  return `${-days} day${days === -1 ? '' : 's'} ago`;\n}\n\n// Who the reminder is meant for, by stage. Overdue goes to staff only (no repeated driver emails).\nfunction audienceFor(stage) {\n  if (stage === 'OVERDUE') return 'staff';\n  if (stage === 'D0') return 'driver_and_staff';\n  return 'driver';\n}\n\nfunction composeReminder(row, driver, settings) {\n  const label = DOCUMENT_LABELS[row.document_type] || row.document_type;\n  const audience = audienceFor(row.reminder_stage);\n  const when = whenPhrase(row.days_remaining);\n  const expires = formatDate(row.expiration_date);\n  const inherited = String(row.expiration_source || '').startsWith('inherited_from_cdl')\n    ? ' (this endorsement shares your CDL expiration date)'\n    : '';\n\n  const recipients = [];\n  if (audience !== 'staff') recipients.push(driver.email);\n  if (audience !== 'driver') recipients.push(driver.manager_email);\n\n  let subject;\n  let lines;\n  if (audience === 'staff') {\n    subject = `Staff escalation: ${driver.full_name}'s ${label} expired ${when}`;\n    lines = [\n      `${driver.full_name} (${driver.driver_id}) has an expired ${label}.`,\n      `Expiration date: ${expires}${inherited}.`,\n      'Please follow up with the driver and record a renewal. Documinder will not keep emailing the driver about this.',\n    ];\n  } else {\n    const urgency = { D90: 'Heads-up', D60: 'Reminder', D30: 'Action needed', D14: 'Action needed', D7: 'Final reminder', D0: 'Expires today' }[row.reminder_stage] || 'Reminder';\n    subject = row.reminder_stage === 'D0'\n      ? `Expires today: your ${label}`\n      : `${urgency}: your ${label} expires ${when}`;\n    lines = [\n      `Hi ${driver.full_name.split(' ')[0]},`,\n      `Your ${label} expires ${when}, on ${expires}${inherited}.`,\n      'Please submit your renewed document so the compliance team can verify it.',\n    ];\n    if (audience === 'driver_and_staff') lines.push(`Your manager (${driver.manager_email}) has been copied.`);\n  }\n\n  return { audience, recipients, subject, body: lines.join('\\n\\n') };\n}\n\n// Decides, for every row with a due reminder stage, whether to create a new preview\n// notification or skip it because a blocking attempt already exists.\n// simulations: optional [{ driver_id, document_type, outcome: 'failure' | 'timeout' }] used to force a\n// provider outcome in tests. Ignored unless preview_only is on, so it can never affect live sends.\nfunction planNotifications({ rows, drivers, settings, history, simulations = [], now = new Date(), runId = 'local' }) {\n  const previewOnly = settings.preview_only === true || settings.preview_only === 'true';\n  if (previewOnly && !String(settings.test_recipient || '').trim()) {\n    throw new Error('preview_only is on but Settings.test_recipient is empty; refusing to address any reminder.');\n  }\n\n  const blocked = new Set(\n    history\n      .filter((n) => n && n.dedup_key && BLOCKING_STATUSES.includes(n.status))\n      .map((n) => n.dedup_key),\n  );\n  const driversById = new Map(drivers.map((d) => [d.driver_id, d]));\n  const simulationFor = (row) => {\n    if (!previewOnly) return '';\n    const sim = simulations.find((x) => x && x.driver_id === row.driver_id && x.document_type === row.document_type);\n    return sim ? sim.outcome : '';\n  };\n  const attemptedAt = now.toISOString();\n  const plans = [];\n  let seq = 0;\n\n  for (const row of rows) {\n    if (!row.reminder_stage || !row.dedup_key) continue;\n    const driver = driversById.get(row.driver_id);\n    const base = {\n      dedup_key: row.dedup_key,\n      driver_id: row.driver_id,\n      full_name: row.full_name,\n      document_id: row.document_id,\n      document_type: row.document_type,\n      document_version: row.document_version,\n      reminder_stage: row.reminder_stage,\n      days_remaining: row.days_remaining,\n    };\n\n    if (blocked.has(row.dedup_key)) {\n      plans.push({ ...base, decision: 'skip_duplicate' });\n      continue;\n    }\n    blocked.add(row.dedup_key); // never plan the same key twice in one run\n\n    const msg = composeReminder(row, driver, settings);\n    const intended = msg.recipients.join(', ');\n    seq += 1;\n    plans.push({\n      ...base,\n      decision: 'create',\n      notification: {\n        notification_id: `NTF-${runId}-${String(seq).padStart(3, '0')}`,\n        driver_id: row.driver_id,\n        document_id: row.document_id,\n        document_version: row.document_version,\n        reminder_stage: row.reminder_stage,\n        dedup_key: row.dedup_key,\n        audience: msg.audience,\n        intended_recipient: intended,\n        delivered_to: previewOnly ? settings.test_recipient : intended,\n        delivery_mode: previewOnly ? 'preview' : 'live',\n        subject: (previewOnly ? `[PREVIEW for ${intended}] ` : '') + msg.subject,\n        body: msg.body,\n        from_name: settings.reminder_from_name || 'Documinder',\n        simulated_outcome: simulationFor(row),\n        provider_message_id: '',\n        status: 'pending',\n        attempted_at: attemptedAt,\n        error_detail: '',\n      },\n    });\n  }\n  return plans;\n}\n\nfunction summarizePlans(plans) {\n  const created = plans.filter((p) => p.decision === 'create');\n  return {\n    reminders_due: plans.length,\n    created: created.length,\n    skipped_duplicates: plans.length - created.length,\n    created_by_stage: created.reduce((acc, p) => ({ ...acc, [p.reminder_stage]: (acc[p.reminder_stage] || 0) + 1 }), {}),\n  };\n}\n\n// ---------- n8n glue ----------\n// One item per due reminder stage, each with decision = create | skip_duplicate.\nconst settings = $('Load Settings').first().json;\nconst drivers = $('Load Drivers').all().map((i) => i.json);\nconst history = $('Load Notification History').all().map((i) => i.json).filter((r) => r.dedup_key);\nconst simulations = $('Load Provider Simulations').all().map((i) => i.json).filter((r) => r.driver_id);\nconst rows = $input.all().map((i) => i.json);\n\nconst plans = planNotifications({ rows, drivers, settings, history, simulations, runId: $execution.id });\nreturn plans.map((p) => ({\n  json: {\n    decision: p.decision,\n    full_name: p.full_name,\n    document_type: p.document_type,\n    days_remaining: p.days_remaining,\n    ...(p.notification || { dedup_key: p.dedup_key, driver_id: p.driver_id, reminder_stage: p.reminder_stage }),\n  },\n}));\n",
    },
    position: [2400, 760],
  },
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","simulated_outcome":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
});

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
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","simulated_outcome":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
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
          notification_id: expr('{{ $json.notification_id }}'),
          driver_id: expr('{{ $json.driver_id }}'),
          document_id: expr('{{ $json.document_id }}'),
          document_version: expr('{{ $json.document_version }}'),
          reminder_stage: expr('{{ $json.reminder_stage }}'),
          dedup_key: expr('{{ $json.dedup_key }}'),
          audience: expr('{{ $json.audience }}'),
          intended_recipient: expr('{{ $json.intended_recipient }}'),
          delivered_to: expr('{{ $json.delivered_to }}'),
          delivery_mode: expr('{{ $json.delivery_mode }}'),
          subject: expr('{{ $json.subject }}'),
          body: expr('{{ $json.body }}'),
          from_name: expr('{{ $json.from_name }}'),
          simulated_outcome: expr('{{ $json.simulated_outcome }}'),
          provider_message_id: expr('{{ $json.provider_message_id }}'),
          status: expr('{{ $json.status }}'),
          attempted_at: expr('{{ $json.attempted_at }}'),
          error_detail: expr('{{ $json.error_detail }}'),
        },
        schema: [
          { id: 'notification_id', displayName: 'notification_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'driver_id', displayName: 'driver_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_id', displayName: 'document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_version', displayName: 'document_version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'reminder_stage', displayName: 'reminder_stage', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'dedup_key', displayName: 'dedup_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'audience', displayName: 'audience', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'intended_recipient', displayName: 'intended_recipient', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'delivered_to', displayName: 'delivered_to', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'delivery_mode', displayName: 'delivery_mode', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'subject', displayName: 'subject', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'body', displayName: 'body', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'from_name', displayName: 'from_name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'simulated_outcome', displayName: 'simulated_outcome', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'provider_message_id', displayName: 'provider_message_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'attempted_at', displayName: 'attempted_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'error_detail', displayName: 'error_detail', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2880, 760],
  },
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","simulated_outcome":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
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
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","simulated_outcome":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
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
      text: expr("{{ $('Plan Reminders (dedup)').item.json.body }}\n\n--\nDocuminder reminder {{ $('Plan Reminders (dedup)').item.json.notification_id }} · {{ $('Plan Reminders (dedup)').item.json.dedup_key }}\nFictional portfolio demo data."),
      options: { appendAttribution: false },
    },
    credentials: { smtp: { id: '16gAGqgjKdTaEC0w', name: 'Gmail SMTP' } },
    position: [3360, 680],
  },
  output: [{ messageId: '<sample@gmail.com>', accepted: ['test@example.com'], rejected: [], response: '250 2.0.0 OK' }],
});

const simulate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Simulate Provider Response',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: "// Documinder delivery — Phase 3: interpret provider outcomes and build the staff-review queue.\n// Deterministic, no LLM. Runs in Node tests (tests/delivery.test.mjs) and in the n8n\n// \"Interpret Provider Result\" and \"Build Staff Review Items\" Code nodes.\n\n// Errors that prove the message was NOT accepted: safe to mark failed (and retry later).\nconst DEFINITE_FAILURE = [\n  /\\b5\\d\\d\\b/, // permanent SMTP rejection, e.g. 550 mailbox unavailable\n  /\\b4\\d\\d\\b/, // temporary SMTP rejection, e.g. 421/451: provider refused before accepting\n  /EAUTH|Invalid login|authentication/i, // credentials rejected before anything was sent\n  /EENVELOPE|No recipients defined|recipient.*rejected/i,\n  /ECONNREFUSED|ENOTFOUND/i, // never connected\n];\n\n// Errors where the message may or may not have gone out: never auto-retry.\nconst UNCERTAIN = [/timeout|timed out|ETIMEDOUT|ESOCKET|ECONNRESET|socket hang up|EPIPE|connection closed/i];\n\n// Maps one provider response (SMTP node success output, error output, or a simulation)\n// to the status we record. Anything we cannot positively classify is 'uncertain'.\nfunction interpretProviderResult(response) {\n  const r = response || {};\n  const err = r.error;\n  if (err) {\n    const text = [err.code, err.responseCode, err.message, err.description, typeof err === 'string' ? err : '']\n      .filter(Boolean).join(' ').trim() || 'unknown provider error';\n    if (UNCERTAIN.some((re) => re.test(text))) {\n      return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain: ${text}` };\n    }\n    if (DEFINITE_FAILURE.some((re) => re.test(text))) {\n      return { status: 'failed', provider_message_id: '', error_detail: `failed: ${text}` };\n    }\n    return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain (unrecognized error): ${text}` };\n  }\n\n  const accepted = Array.isArray(r.accepted) ? r.accepted : [];\n  const rejected = Array.isArray(r.rejected) ? r.rejected : [];\n  if (r.messageId && accepted.length > 0 && rejected.length === 0) {\n    return { status: 'sent', provider_message_id: String(r.messageId), error_detail: '' };\n  }\n  if (accepted.length === 0 && rejected.length > 0) {\n    return { status: 'failed', provider_message_id: String(r.messageId || ''), error_detail: `failed: provider rejected ${rejected.join(', ')}` };\n  }\n  return {\n    status: 'uncertain',\n    provider_message_id: String(r.messageId || ''),\n    error_detail: `uncertain: unexpected provider response ${JSON.stringify({ messageId: r.messageId, accepted, rejected, response: r.response }).slice(0, 300)}`,\n  };\n}\n\n// Simulated provider responses, used only while preview_only is on.\nfunction simulatedResponse(outcome) {\n  if (outcome === 'failure') {\n    return { error: { code: 'EENVELOPE', responseCode: 550, message: '550 5.1.1 Recipient address rejected: mailbox unavailable (simulated)' } };\n  }\n  if (outcome === 'timeout') {\n    return { error: { code: 'ETIMEDOUT', message: 'Connection timeout after 30000ms (simulated)' } };\n  }\n  return { error: { message: `unknown simulation \"${outcome}\"` } };\n}\n\nconst RECOMMENDED_ACTION = {\n  delivery_failed: 'Provider rejected the message. Check the address or provider error; the next run retries automatically.',\n  delivery_uncertain: 'Delivery unknown. Check the inbox or provider logs before doing anything; Documinder will NOT resend. Then mark the notification sent or failed.',\n  delivery_stuck_pending: 'An earlier run recorded this reminder but never recorded a provider result. Treat as uncertain: confirm before resending.',\n  missing_document: 'Collect and verify the required document.',\n  invalid_date: 'Correct the expiration date in the source record.',\n};\n\n// New staff-review items for this run. Each item has a stable review_key, so a problem that\n// persists across daily runs is queued once, not every day.\nfunction buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt, now = new Date() }) {\n  const existing = new Set(existingKeys);\n  const items = [];\n  const add = (item) => {\n    if (existing.has(item.review_key)) return;\n    existing.add(item.review_key);\n    items.push({ created_at: now.toISOString(), status: 'open', recommended_action: RECOMMENDED_ACTION[item.category], ...item });\n  };\n\n  for (const d of deliveries) {\n    if (d.status !== 'failed' && d.status !== 'uncertain') continue;\n    add({\n      review_key: `delivery|${d.notification_id}`,\n      category: d.status === 'failed' ? 'delivery_failed' : 'delivery_uncertain',\n      severity: d.status === 'failed' ? 'medium' : 'high',\n      driver_id: d.driver_id,\n      document_type: d.document_type || '',\n      notification_id: d.notification_id,\n      dedup_key: d.dedup_key,\n      detail: d.error_detail,\n    });\n  }\n\n  // A 'pending' row from an earlier run means the run stopped between recording and confirming.\n  for (const n of history) {\n    if (n.status !== 'pending' || (runStartedAt && n.attempted_at >= runStartedAt)) continue;\n    add({\n      review_key: `delivery|${n.notification_id}`,\n      category: 'delivery_stuck_pending',\n      severity: 'high',\n      driver_id: n.driver_id,\n      document_type: '',\n      notification_id: n.notification_id,\n      dedup_key: n.dedup_key,\n      detail: `notification still pending since ${n.attempted_at}`,\n    });\n  }\n\n  for (const r of rows) {\n    if (r.state !== 'missing' && r.state !== 'invalid_date') continue;\n    add({\n      review_key: `data|${r.state}|${r.driver_id}|${r.document_type}|${r.document_id || ''}|${r.expiration_date || ''}`,\n      category: r.state === 'missing' ? 'missing_document' : 'invalid_date',\n      severity: 'medium',\n      driver_id: r.driver_id,\n      document_type: r.document_type,\n      notification_id: '',\n      dedup_key: '',\n      detail: r.reason,\n    });\n  }\n  return items;\n}\n\n// ---------- n8n glue ----------\n// Test-only stand-in for the email provider (preview mode only, see Load Provider Simulations).\nreturn { json: simulatedResponse($('Plan Reminders (dedup)').item.json.simulated_outcome) };\n",
    },
    position: [3360, 880],
  },
  output: [{ error: { code: 'ETIMEDOUT', message: 'sample' } }],
});

const interpret = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Interpret Provider Result',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: "// Documinder delivery — Phase 3: interpret provider outcomes and build the staff-review queue.\n// Deterministic, no LLM. Runs in Node tests (tests/delivery.test.mjs) and in the n8n\n// \"Interpret Provider Result\" and \"Build Staff Review Items\" Code nodes.\n\n// Errors that prove the message was NOT accepted: safe to mark failed (and retry later).\nconst DEFINITE_FAILURE = [\n  /\\b5\\d\\d\\b/, // permanent SMTP rejection, e.g. 550 mailbox unavailable\n  /\\b4\\d\\d\\b/, // temporary SMTP rejection, e.g. 421/451: provider refused before accepting\n  /EAUTH|Invalid login|authentication/i, // credentials rejected before anything was sent\n  /EENVELOPE|No recipients defined|recipient.*rejected/i,\n  /ECONNREFUSED|ENOTFOUND/i, // never connected\n];\n\n// Errors where the message may or may not have gone out: never auto-retry.\nconst UNCERTAIN = [/timeout|timed out|ETIMEDOUT|ESOCKET|ECONNRESET|socket hang up|EPIPE|connection closed/i];\n\n// Maps one provider response (SMTP node success output, error output, or a simulation)\n// to the status we record. Anything we cannot positively classify is 'uncertain'.\nfunction interpretProviderResult(response) {\n  const r = response || {};\n  const err = r.error;\n  if (err) {\n    const text = [err.code, err.responseCode, err.message, err.description, typeof err === 'string' ? err : '']\n      .filter(Boolean).join(' ').trim() || 'unknown provider error';\n    if (UNCERTAIN.some((re) => re.test(text))) {\n      return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain: ${text}` };\n    }\n    if (DEFINITE_FAILURE.some((re) => re.test(text))) {\n      return { status: 'failed', provider_message_id: '', error_detail: `failed: ${text}` };\n    }\n    return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain (unrecognized error): ${text}` };\n  }\n\n  const accepted = Array.isArray(r.accepted) ? r.accepted : [];\n  const rejected = Array.isArray(r.rejected) ? r.rejected : [];\n  if (r.messageId && accepted.length > 0 && rejected.length === 0) {\n    return { status: 'sent', provider_message_id: String(r.messageId), error_detail: '' };\n  }\n  if (accepted.length === 0 && rejected.length > 0) {\n    return { status: 'failed', provider_message_id: String(r.messageId || ''), error_detail: `failed: provider rejected ${rejected.join(', ')}` };\n  }\n  return {\n    status: 'uncertain',\n    provider_message_id: String(r.messageId || ''),\n    error_detail: `uncertain: unexpected provider response ${JSON.stringify({ messageId: r.messageId, accepted, rejected, response: r.response }).slice(0, 300)}`,\n  };\n}\n\n// Simulated provider responses, used only while preview_only is on.\nfunction simulatedResponse(outcome) {\n  if (outcome === 'failure') {\n    return { error: { code: 'EENVELOPE', responseCode: 550, message: '550 5.1.1 Recipient address rejected: mailbox unavailable (simulated)' } };\n  }\n  if (outcome === 'timeout') {\n    return { error: { code: 'ETIMEDOUT', message: 'Connection timeout after 30000ms (simulated)' } };\n  }\n  return { error: { message: `unknown simulation \"${outcome}\"` } };\n}\n\nconst RECOMMENDED_ACTION = {\n  delivery_failed: 'Provider rejected the message. Check the address or provider error; the next run retries automatically.',\n  delivery_uncertain: 'Delivery unknown. Check the inbox or provider logs before doing anything; Documinder will NOT resend. Then mark the notification sent or failed.',\n  delivery_stuck_pending: 'An earlier run recorded this reminder but never recorded a provider result. Treat as uncertain: confirm before resending.',\n  missing_document: 'Collect and verify the required document.',\n  invalid_date: 'Correct the expiration date in the source record.',\n};\n\n// New staff-review items for this run. Each item has a stable review_key, so a problem that\n// persists across daily runs is queued once, not every day.\nfunction buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt, now = new Date() }) {\n  const existing = new Set(existingKeys);\n  const items = [];\n  const add = (item) => {\n    if (existing.has(item.review_key)) return;\n    existing.add(item.review_key);\n    items.push({ created_at: now.toISOString(), status: 'open', recommended_action: RECOMMENDED_ACTION[item.category], ...item });\n  };\n\n  for (const d of deliveries) {\n    if (d.status !== 'failed' && d.status !== 'uncertain') continue;\n    add({\n      review_key: `delivery|${d.notification_id}`,\n      category: d.status === 'failed' ? 'delivery_failed' : 'delivery_uncertain',\n      severity: d.status === 'failed' ? 'medium' : 'high',\n      driver_id: d.driver_id,\n      document_type: d.document_type || '',\n      notification_id: d.notification_id,\n      dedup_key: d.dedup_key,\n      detail: d.error_detail,\n    });\n  }\n\n  // A 'pending' row from an earlier run means the run stopped between recording and confirming.\n  for (const n of history) {\n    if (n.status !== 'pending' || (runStartedAt && n.attempted_at >= runStartedAt)) continue;\n    add({\n      review_key: `delivery|${n.notification_id}`,\n      category: 'delivery_stuck_pending',\n      severity: 'high',\n      driver_id: n.driver_id,\n      document_type: '',\n      notification_id: n.notification_id,\n      dedup_key: n.dedup_key,\n      detail: `notification still pending since ${n.attempted_at}`,\n    });\n  }\n\n  for (const r of rows) {\n    if (r.state !== 'missing' && r.state !== 'invalid_date') continue;\n    add({\n      review_key: `data|${r.state}|${r.driver_id}|${r.document_type}|${r.document_id || ''}|${r.expiration_date || ''}`,\n      category: r.state === 'missing' ? 'missing_document' : 'invalid_date',\n      severity: 'medium',\n      driver_id: r.driver_id,\n      document_type: r.document_type,\n      notification_id: '',\n      dedup_key: '',\n      detail: r.reason,\n    });\n  }\n  return items;\n}\n\n// ---------- n8n glue ----------\n// Input: the provider response (success output, error output, or simulation) for one reminder.\nconst n = $('Plan Reminders (dedup)').item.json;\nconst result = interpretProviderResult($json);\nreturn {\n  json: {\n    notification_id: n.notification_id,\n    dedup_key: n.dedup_key,\n    driver_id: n.driver_id,\n    full_name: n.full_name,\n    document_type: n.document_type,\n    reminder_stage: n.reminder_stage,\n    simulated_outcome: n.simulated_outcome,\n    delivered_to: n.delivered_to,\n    ...result,\n    attempted_at: new Date().toISOString(),\n  },\n};\n",
    },
    position: [3600, 760],
  },
  output: [{ notification_id: 'NTF-1-001', dedup_key: 'D002|DOC0008|2|D90', driver_id: 'D002', full_name: 'Jordan Lee', document_type: 'MEDICAL_CERT', reminder_stage: 'D90', simulated_outcome: '', delivered_to: 'test@example.com', status: 'sent', provider_message_id: '<sample@gmail.com>', error_detail: '', attempted_at: '2026-10-15T15:00:00.000Z' }],
});

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
          status: expr('{{ $json.status }}'),
          provider_message_id: expr('{{ $json.provider_message_id }}'),
          error_detail: expr('{{ $json.error_detail }}'),
          attempted_at: expr('{{ $json.attempted_at }}'),
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'provider_message_id', displayName: 'provider_message_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'error_detail', displayName: 'error_detail', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'attempted_at', displayName: 'attempted_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [3840, 760],
  },
  output: [{ id: 1 }],
});

const buildReview = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Staff Review Items',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Documinder delivery — Phase 3: interpret provider outcomes and build the staff-review queue.\n// Deterministic, no LLM. Runs in Node tests (tests/delivery.test.mjs) and in the n8n\n// \"Interpret Provider Result\" and \"Build Staff Review Items\" Code nodes.\n\n// Errors that prove the message was NOT accepted: safe to mark failed (and retry later).\nconst DEFINITE_FAILURE = [\n  /\\b5\\d\\d\\b/, // permanent SMTP rejection, e.g. 550 mailbox unavailable\n  /\\b4\\d\\d\\b/, // temporary SMTP rejection, e.g. 421/451: provider refused before accepting\n  /EAUTH|Invalid login|authentication/i, // credentials rejected before anything was sent\n  /EENVELOPE|No recipients defined|recipient.*rejected/i,\n  /ECONNREFUSED|ENOTFOUND/i, // never connected\n];\n\n// Errors where the message may or may not have gone out: never auto-retry.\nconst UNCERTAIN = [/timeout|timed out|ETIMEDOUT|ESOCKET|ECONNRESET|socket hang up|EPIPE|connection closed/i];\n\n// Maps one provider response (SMTP node success output, error output, or a simulation)\n// to the status we record. Anything we cannot positively classify is 'uncertain'.\nfunction interpretProviderResult(response) {\n  const r = response || {};\n  const err = r.error;\n  if (err) {\n    const text = [err.code, err.responseCode, err.message, err.description, typeof err === 'string' ? err : '']\n      .filter(Boolean).join(' ').trim() || 'unknown provider error';\n    if (UNCERTAIN.some((re) => re.test(text))) {\n      return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain: ${text}` };\n    }\n    if (DEFINITE_FAILURE.some((re) => re.test(text))) {\n      return { status: 'failed', provider_message_id: '', error_detail: `failed: ${text}` };\n    }\n    return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain (unrecognized error): ${text}` };\n  }\n\n  const accepted = Array.isArray(r.accepted) ? r.accepted : [];\n  const rejected = Array.isArray(r.rejected) ? r.rejected : [];\n  if (r.messageId && accepted.length > 0 && rejected.length === 0) {\n    return { status: 'sent', provider_message_id: String(r.messageId), error_detail: '' };\n  }\n  if (accepted.length === 0 && rejected.length > 0) {\n    return { status: 'failed', provider_message_id: String(r.messageId || ''), error_detail: `failed: provider rejected ${rejected.join(', ')}` };\n  }\n  return {\n    status: 'uncertain',\n    provider_message_id: String(r.messageId || ''),\n    error_detail: `uncertain: unexpected provider response ${JSON.stringify({ messageId: r.messageId, accepted, rejected, response: r.response }).slice(0, 300)}`,\n  };\n}\n\n// Simulated provider responses, used only while preview_only is on.\nfunction simulatedResponse(outcome) {\n  if (outcome === 'failure') {\n    return { error: { code: 'EENVELOPE', responseCode: 550, message: '550 5.1.1 Recipient address rejected: mailbox unavailable (simulated)' } };\n  }\n  if (outcome === 'timeout') {\n    return { error: { code: 'ETIMEDOUT', message: 'Connection timeout after 30000ms (simulated)' } };\n  }\n  return { error: { message: `unknown simulation \"${outcome}\"` } };\n}\n\nconst RECOMMENDED_ACTION = {\n  delivery_failed: 'Provider rejected the message. Check the address or provider error; the next run retries automatically.',\n  delivery_uncertain: 'Delivery unknown. Check the inbox or provider logs before doing anything; Documinder will NOT resend. Then mark the notification sent or failed.',\n  delivery_stuck_pending: 'An earlier run recorded this reminder but never recorded a provider result. Treat as uncertain: confirm before resending.',\n  missing_document: 'Collect and verify the required document.',\n  invalid_date: 'Correct the expiration date in the source record.',\n};\n\n// New staff-review items for this run. Each item has a stable review_key, so a problem that\n// persists across daily runs is queued once, not every day.\nfunction buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt, now = new Date() }) {\n  const existing = new Set(existingKeys);\n  const items = [];\n  const add = (item) => {\n    if (existing.has(item.review_key)) return;\n    existing.add(item.review_key);\n    items.push({ created_at: now.toISOString(), status: 'open', recommended_action: RECOMMENDED_ACTION[item.category], ...item });\n  };\n\n  for (const d of deliveries) {\n    if (d.status !== 'failed' && d.status !== 'uncertain') continue;\n    add({\n      review_key: `delivery|${d.notification_id}`,\n      category: d.status === 'failed' ? 'delivery_failed' : 'delivery_uncertain',\n      severity: d.status === 'failed' ? 'medium' : 'high',\n      driver_id: d.driver_id,\n      document_type: d.document_type || '',\n      notification_id: d.notification_id,\n      dedup_key: d.dedup_key,\n      detail: d.error_detail,\n    });\n  }\n\n  // A 'pending' row from an earlier run means the run stopped between recording and confirming.\n  for (const n of history) {\n    if (n.status !== 'pending' || (runStartedAt && n.attempted_at >= runStartedAt)) continue;\n    add({\n      review_key: `delivery|${n.notification_id}`,\n      category: 'delivery_stuck_pending',\n      severity: 'high',\n      driver_id: n.driver_id,\n      document_type: '',\n      notification_id: n.notification_id,\n      dedup_key: n.dedup_key,\n      detail: `notification still pending since ${n.attempted_at}`,\n    });\n  }\n\n  for (const r of rows) {\n    if (r.state !== 'missing' && r.state !== 'invalid_date') continue;\n    add({\n      review_key: `data|${r.state}|${r.driver_id}|${r.document_type}|${r.document_id || ''}|${r.expiration_date || ''}`,\n      category: r.state === 'missing' ? 'missing_document' : 'invalid_date',\n      severity: 'medium',\n      driver_id: r.driver_id,\n      document_type: r.document_type,\n      notification_id: '',\n      dedup_key: '',\n      detail: r.reason,\n    });\n  }\n  return items;\n}\n\n// ---------- n8n glue ----------\n// New staff-review items: failed / uncertain deliveries, stuck pendings, missing or invalid documents.\nconst rows = $('Classify Credentials').all().map((i) => i.json);\n// A node fed by two branches (simulated + real provider) runs once per branch; collect every run.\nconst allRuns = (name) => {\n  const out = [];\n  for (let run = 0; run < 20; run++) {\n    let items;\n    try { items = $(name).all(0, run); } catch (e) { break; }\n    if (!items || items.length === 0) break;\n    out.push(...items.map((i) => i.json));\n  }\n  return out;\n};\nconst deliveries = allRuns('Interpret Provider Result');\nconst history = $('Load Notification History').all().map((i) => i.json).filter((r) => r.dedup_key);\nconst existingKeys = $('Load Staff Review Queue').all().map((i) => i.json).filter((r) => r.review_key).map((r) => r.review_key);\n\nconst items = buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt: null });\nreturn items.map((i) => ({ json: i }));\n",
    },
    position: [2400, 1260],
  },
  output: [{"review_key":"sample","created_at":"sample","category":"sample","severity":"sample","status":"sample","driver_id":"sample","document_type":"sample","notification_id":"sample","dedup_key":"sample","detail":"sample","recommended_action":"sample"}],
});

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
          review_key: expr('{{ $json.review_key }}'),
          created_at: expr('{{ $json.created_at }}'),
          category: expr('{{ $json.category }}'),
          severity: expr('{{ $json.severity }}'),
          status: expr('{{ $json.status }}'),
          driver_id: expr('{{ $json.driver_id }}'),
          document_type: expr('{{ $json.document_type }}'),
          notification_id: expr('{{ $json.notification_id }}'),
          dedup_key: expr('{{ $json.dedup_key }}'),
          detail: expr('{{ $json.detail }}'),
          recommended_action: expr('{{ $json.recommended_action }}'),
        },
        schema: [
          { id: 'review_key', displayName: 'review_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'created_at', displayName: 'created_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'category', displayName: 'category', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'severity', displayName: 'severity', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'driver_id', displayName: 'driver_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_type', displayName: 'document_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'notification_id', displayName: 'notification_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'dedup_key', displayName: 'dedup_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'detail', displayName: 'detail', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'recommended_action', displayName: 'recommended_action', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2640, 1260],
  },
  output: [{ id: 1 }],
});

const summary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Run Summary',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Run summary: what was due, sent, failed, uncertain, skipped, and queued for staff review.\nconst tryAll = (name) => { try { return $(name).all().map((i) => i.json); } catch (e) { return []; } };\n// A node fed by two branches (simulated + real provider) runs once per branch; collect every run.\nconst allRuns = (name) => {\n  const out = [];\n  for (let run = 0; run < 20; run++) {\n    let items;\n    try { items = $(name).all(0, run); } catch (e) { break; }\n    if (!items || items.length === 0) break;\n    out.push(...items.map((i) => i.json));\n  }\n  return out;\n};\n\nconst settings = $('Load Settings').first().json;\nconst history = $('Load Notification History').all().map((i) => i.json).filter((r) => r.dedup_key);\nconst plans = tryAll('Plan Reminders (dedup)');\nconst deliveries = allRuns('Interpret Provider Result');\nconst newReview = tryAll('Build Staff Review Items');\nconst openBefore = $('Load Staff Review Queue').all().map((i) => i.json).filter((r) => r.review_key).filter((r) => r.status === 'open');\n\nconst count = (list, status) => list.filter((d) => d.status === status).length;\nconst historyStatus = (key) => history.filter((n) => n.dedup_key === key).map((n) => n.status);\nconst created = plans.filter((p) => p.decision === 'create');\nconst skipped = plans.filter((p) => p.decision === 'skip_duplicate');\n\nreturn [{\n  json: {\n    phase: 'Phase 3: delivery outcomes + staff review',\n    run_at: $now.toISO(),\n    preview_only: settings.preview_only,\n    all_messages_delivered_to: settings.preview_only ? settings.test_recipient : '(live recipients)',\n    reminders_due: plans.length,\n    attempted: created.length,\n    sent: count(deliveries, 'sent'),\n    failed: count(deliveries, 'failed'),\n    uncertain: count(deliveries, 'uncertain'),\n    skipped_duplicates: skipped.length,\n    retried_after_failure: created.filter((p) => historyStatus(p.dedup_key).includes('failed')).length,\n    held_because_uncertain: skipped.filter((p) => historyStatus(p.dedup_key).includes('uncertain')).length,\n    staff_review_new: newReview.length,\n    staff_review_open_total: openBefore.length + newReview.length,\n    deliveries: deliveries.map((d) => ({ stage: d.reminder_stage, driver: d.full_name, document: d.document_type, status: d.status, simulated: d.simulated_outcome || '', provider_message_id: d.provider_message_id, error_detail: d.error_detail })),\n    staff_review_new_items: newReview.map((r) => ({ category: r.category, severity: r.severity, driver_id: r.driver_id, document_type: r.document_type, detail: r.detail })),\n  },\n}];\n",
    },
    position: [2400, 1560],
  },
  output: [{ reminders_due: 9, attempted: 9, sent: 7, failed: 1, uncertain: 1, skipped_duplicates: 0, staff_review_new: 4 }],
});

const noteOverview = sticky(
  "## Documinder · Daily Review\nChecks every required credential for every driver, classifies it with plain date math (no AI), sends the right reminder once, and routes problems to staff.\n\n**Safety:** while **preview_only** is on, every email goes only to the test inbox. The Send node re-checks this itself.\n\nManual trigger, not published, no schedule yet. Fictional data only. Reference date: documinder_settings.test_reference_date.",
  [],
  { color: 4, position: [-120, -20], width: 300, height: 480 }
);

const noteLoad = sticky(
  "## 1 · Load\nSettings, drivers, role requirements, every document version, notification history, the staff-review queue, test-only provider simulations, and expected results. Each load runs once (executeOnce); tables that may be empty still emit one item so the run continues.",
  [],
  { color: 7, position: [200, -20], width: 1860, height: 480 }
);

const noteClassify = sticky(
  "## 2 · Classify\nLatest **verified** version → validate date → whole days left in the business timezone → state + current stage (D90…D0, OVERDUE). Endorsements without a date inherit the CDL date.\n\nSource: src/documinder-core.js",
  [],
  { color: 5, position: [2100, -20], width: 240, height: 480 }
);

const noteReport = sticky(
  "## 3 · Exit check\nCompares all 84 rows with documinder_test_expectations → **PASS / FAIL**.",
  [],
  { color: 6, position: [2360, -20], width: 240, height: 480 }
);

const noteDeliver = sticky(
  "## 4 · Deliver once, record every outcome\n**Plan:** dedup key driver | document | version | stage. Skip if any attempt is pending, sent, or uncertain; **failed** may retry.\n**Record first:** save as **pending** before sending, so a crash mid-send cannot cause a duplicate.\n**Send:** Gmail SMTP, **no automatic retries**. Errors go out the error branch instead of stopping the run.\n**Interpret:** accepted → sent · rejected → failed · timeout / unknown → **uncertain** (never auto-resent).\nSource: src/documinder-reminders.js, src/documinder-delivery.js",
  [],
  { color: 3, position: [2340, 540], width: 1640, height: 560 }
);

const noteReview = sticky(
  "## 5 · Staff review + summary\nQueues failed and uncertain deliveries, stuck pendings, missing documents, and invalid dates, each **once** (stable review_key). The run summary counts sent / failed / uncertain / skipped.",
  [],
  { color: 2, position: [2340, 1140], width: 560, height: 600 }
);

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
