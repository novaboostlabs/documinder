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
  output: [{ id: 1 }],
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
    position: [1440, 300],
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
      jsCode: "// Documinder core — deterministic credential classification (Phase 1).\n//\n// Pure functions with no dependencies, so the same code runs in three places:\n//   1. Node unit tests (tests/core.test.mjs)\n//   2. The n8n \"Classify credentials\" Code node (see workflows/)\n//   3. Anyone reading the repo who wants to understand the rules\n//\n// No LLM is involved. Dates are compared as calendar days, never as timestamps.\n\nconst MS_PER_DAY = 86400000;\n\nconst ENDORSEMENT_TYPES = ['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT'];\nconst DEFAULT_STAGES = [90, 60, 30, 14, 7, 0];\n\n// ---------- Dates ----------\n\n// Parses a strict YYYY-MM-DD string into a whole-day number (days since 1970-01-01).\n// Rejects malformed strings and impossible dates such as 2026-02-30.\nfunction parseCalendarDate(value) {\n  if (value === null || value === undefined || String(value).trim() === '') {\n    return { ok: false, reason: 'blank' };\n  }\n  const s = String(value).trim();\n  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);\n  if (!m) return { ok: false, reason: `malformed date \"${s}\" (expected YYYY-MM-DD)` };\n  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];\n  const ms = Date.UTC(y, mo - 1, d);\n  const check = new Date(ms);\n  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {\n    return { ok: false, reason: `impossible calendar date \"${s}\"` };\n  }\n  return { ok: true, day: Math.round(ms / MS_PER_DAY), iso: s };\n}\n\n// Today's calendar date (YYYY-MM-DD) in the business timezone.\nfunction todayInTimezone(timeZone, now = new Date()) {\n  const parts = new Intl.DateTimeFormat('en-CA', {\n    timeZone,\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(now);\n  const get = (t) => parts.find((p) => p.type === t).value;\n  return `${get('year')}-${get('month')}-${get('day')}`;\n}\n\n// The fixed test date wins when set; otherwise use the real date in the business timezone.\nfunction resolveReferenceDate(settings, now = new Date()) {\n  const tz = settings.business_timezone || 'America/Los_Angeles';\n  const fixed = settings.test_reference_date;\n  if (fixed !== null && fixed !== undefined && String(fixed).trim() !== '') {\n    const parsed = parseCalendarDate(fixed);\n    if (!parsed.ok) throw new Error(`Settings.test_reference_date is invalid: ${parsed.reason}`);\n    return { iso: parsed.iso, day: parsed.day, source: 'test_reference_date', timeZone: tz };\n  }\n  const iso = todayInTimezone(tz, now);\n  return { iso, day: parseCalendarDate(iso).day, source: 'current_date', timeZone: tz };\n}\n\n// ---------- Policy ----------\n\nfunction parseStages(value) {\n  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_STAGES.slice();\n  const stages = String(value)\n    .split(',')\n    .map((s) => Number(s.trim()))\n    .filter((n) => Number.isInteger(n) && n >= 0);\n  return [...new Set(stages)].sort((a, b) => b - a);\n}\n\n// State is defined by the reminder policy table in the build brief.\nfunction stateForDays(days) {\n  if (days < 0) return 'overdue';\n  if (days === 0) return 'expires_today';\n  if (days <= 7) return 'critical';\n  if (days <= 30) return 'urgent';\n  if (days <= 90) return 'approaching_expiry';\n  return 'current';\n}\n\n// Only the *current* applicable stage is returned; missed earlier stages are never replayed.\n// Example with stages 90,60,30,14,7,0: 45 days left -> D60, 90 -> D90, 91 -> none.\nfunction stageForDays(days, stages) {\n  if (days < 0) return 'OVERDUE';\n  const due = stages.filter((s) => s >= days);\n  if (due.length === 0) return '';\n  return `D${Math.min(...due)}`;\n}\n\nfunction actionFor(state, escalationPolicy) {\n  const escalates = escalationPolicy !== 'none';\n  switch (state) {\n    case 'approaching_expiry':\n    case 'urgent':\n    case 'critical':\n      return 'driver_reminder';\n    case 'expires_today':\n      return escalates ? 'driver_notice_and_staff_escalation' : 'driver_notice';\n    case 'overdue':\n      return escalates ? 'staff_escalation' : 'none';\n    case 'missing':\n    case 'invalid_date':\n      return 'staff_review';\n    default:\n      return 'none';\n  }\n}\n\n// ---------- Documents ----------\n\nfunction isTrue(v) {\n  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';\n}\n\n// Latest verified version of one document type for one driver (archived/pending rows ignored).\nfunction latestVerified(documents, driverId, documentType) {\n  return documents\n    .filter((d) => d.driver_id === driverId && d.document_type === documentType && d.status === 'verified')\n    .sort((a, b) => Number(b.version) - Number(a.version))[0];\n}\n\n// ---------- Classification ----------\n\nfunction classifyAll({ settings, drivers, requirements, documents, now = new Date() }) {\n  const ref = resolveReferenceDate(settings, now);\n  const rows = [];\n\n  for (const driver of drivers) {\n    const active = isTrue(driver.active);\n    const reqs = requirements.filter((r) => r.applicable_role === driver.role);\n\n    if (reqs.length === 0) {\n      rows.push(baseRow(ref, driver, { document_type: '*' }, {\n        state: 'invalid_date',\n        action: 'staff_review',\n        reason: `no requirements configured for role \"${driver.role}\"`,\n      }));\n      continue;\n    }\n\n    for (const req of reqs) {\n      if (!active) {\n        rows.push(baseRow(ref, driver, req, { state: 'inactive_skipped', reason: 'driver is inactive' }));\n        continue;\n      }\n      if (!isTrue(req.required)) {\n        rows.push(baseRow(ref, driver, req, { state: 'not_applicable', reason: `not required for role ${driver.role}` }));\n        continue;\n      }\n\n      const doc = latestVerified(documents, driver.driver_id, req.document_type);\n      if (!doc) {\n        rows.push(baseRow(ref, driver, req, {\n          state: 'missing',\n          action: actionFor('missing'),\n          reason: 'required document has no verified version on file',\n        }));\n        continue;\n      }\n\n      // Endorsements may share the CDL expiration date. Never invent a date:\n      // inherit only when the endorsement record is blank and a verified CDL exists.\n      let expirationRaw = doc.expiration_date;\n      let expirationSource = 'document';\n      if ((expirationRaw === null || expirationRaw === undefined || String(expirationRaw).trim() === '') &&\n          ENDORSEMENT_TYPES.includes(req.document_type)) {\n        const cdl = latestVerified(documents, driver.driver_id, 'CDL');\n        if (cdl) {\n          expirationRaw = cdl.expiration_date;\n          expirationSource = `inherited_from_cdl:${cdl.document_id}`;\n        }\n      }\n\n      const exp = parseCalendarDate(expirationRaw);\n      const docFields = {\n        document_id: doc.document_id,\n        document_version: Number(doc.version),\n        expiration_date: expirationRaw === null || expirationRaw === undefined ? '' : String(expirationRaw),\n        expiration_source: expirationSource,\n      };\n\n      if (!exp.ok) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: exp.reason === 'blank' ? 'expiration date not provided' : exp.reason,\n        }));\n        continue;\n      }\n\n      const issue = parseCalendarDate(doc.issue_date);\n      if (issue.ok && issue.day > exp.day) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: `issue_date ${issue.iso} is after expiration_date ${exp.iso}`,\n        }));\n        continue;\n      }\n\n      const days = exp.day - ref.day;\n      const state = stateForDays(days);\n      const stage = state === 'current' ? '' : stageForDays(days, parseStages(req.reminder_stages));\n      rows.push(baseRow(ref, driver, req, {\n        ...docFields,\n        days_remaining: days,\n        state,\n        reminder_stage: stage,\n        action: actionFor(state, req.escalation_policy),\n        reason: `${days} day(s) remaining as of ${ref.iso} (${ref.timeZone})`,\n      }));\n    }\n  }\n  return { reference: ref, rows };\n}\n\nfunction baseRow(ref, driver, req, fields) {\n  return {\n    reference_date: ref.iso,\n    reference_source: ref.source,\n    driver_id: driver.driver_id,\n    full_name: driver.full_name,\n    role: driver.role,\n    active: isTrue(driver.active),\n    requirement_id: req.requirement_id || '',\n    document_type: req.document_type,\n    document_id: '',\n    document_version: null,\n    expiration_date: '',\n    expiration_source: '',\n    days_remaining: null,\n    state: '',\n    reminder_stage: '',\n    action: 'none',\n    reason: '',\n    // Phase 2 dedup key: driver_id + document_id + document_version + reminder_stage\n    dedup_key: '',\n    ...fields,\n  };\n}\n\nfunction withDedupKeys(rows) {\n  return rows.map((r) => ({\n    ...r,\n    dedup_key: r.reminder_stage && r.document_id\n      ? `${r.driver_id}|${r.document_id}|${r.document_version}|${r.reminder_stage}`\n      : '',\n  }));\n}\n\n// Compares actual rows with expected rows keyed by driver_id + document_type.\nfunction compareWithExpected(rows, expected) {\n  const actualByKey = new Map(rows.map((r) => [`${r.driver_id}:${r.document_type}`, r]));\n  const results = expected.map((e) => {\n    const a = actualByKey.get(`${e.driver_id}:${e.document_type}`);\n    const actualState = a ? a.state : '(no row)';\n    const actualStage = a ? a.reminder_stage : '';\n    const pass = actualState === e.expected_state && (actualStage || '') === (e.expected_stage || '');\n    return {\n      driver_id: e.driver_id,\n      full_name: a ? a.full_name : '',\n      document_type: e.document_type,\n      primary_fixture: isTrue(e.primary_fixture),\n      expected_state: e.expected_state,\n      actual_state: actualState,\n      expected_stage: e.expected_stage || '',\n      actual_stage: actualStage || '',\n      days_remaining: a ? a.days_remaining : null,\n      pass,\n    };\n  });\n  const expectedKeys = new Set(expected.map((e) => `${e.driver_id}:${e.document_type}`));\n  const unexpected = rows.filter((r) => !expectedKeys.has(`${r.driver_id}:${r.document_type}`));\n  const failed = results.filter((r) => !r.pass).length + unexpected.length;\n  return { results, unexpected, total: results.length, passed: results.length - results.filter((r) => !r.pass).length, failed };\n}\n\nfunction summarize(rows) {\n  const counts = {};\n  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;\n  return counts;\n}\n\n// ---------- n8n glue ----------\n// Reads the four tables loaded upstream and returns one item per driver x requirement.\nconst settings = $('Load Settings').first().json;\nconst drivers = $('Load Drivers').all().map((i) => i.json);\nconst requirements = $('Load Requirements').all().map((i) => i.json);\nconst documents = $('Load Documents').all().map((i) => i.json);\n\nconst { rows } = classifyAll({ settings, drivers, requirements, documents });\nreturn withDedupKeys(rows).map((r) => ({ json: r }));\n",
    },
    position: [1680, 300],
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
      jsCode: "// Phase 1 exit check: compare every classified row with documinder_test_expectations.\nconst rows = $input.all().map((i) => i.json);\nconst expected = $('Load Test Expectations').all().map((i) => i.json);\nconst byKey = new Map(rows.map((r) => [r.driver_id + ':' + r.document_type, r]));\n\nconst results = expected.map((e) => {\n  const a = byKey.get(e.driver_id + ':' + e.document_type);\n  const actualState = a ? a.state : '(no row)';\n  const actualStage = a ? a.reminder_stage || '' : '';\n  return {\n    driver: a ? a.full_name : e.driver_id,\n    document_type: e.document_type,\n    primary_fixture: e.primary_fixture === true,\n    expected: e.expected_state + (e.expected_stage ? ' / ' + e.expected_stage : ''),\n    actual: actualState + (actualStage ? ' / ' + actualStage : ''),\n    days_remaining: a ? a.days_remaining : null,\n    pass: actualState === e.expected_state && actualStage === (e.expected_stage || ''),\n  };\n});\nconst expectedKeys = new Set(expected.map((e) => e.driver_id + ':' + e.document_type));\nconst unexpectedRows = rows.filter((r) => !expectedKeys.has(r.driver_id + ':' + r.document_type));\n\nconst stateCounts = {};\nfor (const r of rows) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;\nconst failures = results.filter((r) => !r.pass);\n\nreturn [{\n  json: {\n    phase: 'Phase 1: classification engine',\n    reference_date: rows[0] ? rows[0].reference_date : null,\n    reference_source: rows[0] ? rows[0].reference_source : null,\n    exit_check: failures.length === 0 && unexpectedRows.length === 0 ? 'PASS' : 'FAIL',\n    checked: results.length,\n    passed: results.length - failures.length,\n    failed: failures.length + unexpectedRows.length,\n    state_counts: stateCounts,\n    reminders_due: rows.filter((r) => r.reminder_stage).length,\n    staff_review_needed: rows.filter((r) => r.action === 'staff_review' || r.action.includes('escalation')).length,\n    primary_fixtures: results.filter((r) => r.primary_fixture),\n    failures,\n    unexpected_rows: unexpectedRows.map((r) => r.driver_id + ':' + r.document_type),\n  },\n}];\n",
    },
    position: [1920, 300],
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
      jsCode: "// Documinder reminders — Phase 2: compose preview reminders and deduplicate them\n// against notification history. Deterministic templates, no LLM.\n//\n// Runs in Node tests (tests/reminders.test.mjs) and in the n8n\n// \"Plan Reminders (dedup)\" Code node (embedded by scripts/build-workflow.mjs).\n\n// Statuses that mean \"this reminder already went out, or may have\": never create another.\n// A 'failed' attempt does not block, so it can be retried. 'closed' belongs to a superseded version.\nconst BLOCKING_STATUSES = ['previewed', 'sent', 'uncertain'];\n\nconst DOCUMENT_LABELS = {\n  CDL: 'Commercial Driver\\'s License (CDL)',\n  MEDICAL_CERT: 'Medical Examiner\\'s Certificate',\n  TWIC: 'TWIC card',\n  HAZMAT_ENDORSEMENT: 'Hazmat endorsement',\n  TANKER_ENDORSEMENT: 'Tanker endorsement',\n  DOUBLES_TRIPLES_ENDORSEMENT: 'Doubles/triples endorsement',\n  SAFETY_TRAINING: 'Defensive-driving / safety training',\n};\n\nconst MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];\n\nfunction formatDate(iso) {\n  const [y, m, d] = String(iso).split('-').map(Number);\n  return `${MONTHS[m - 1]} ${d}, ${y}`;\n}\n\nfunction whenPhrase(days) {\n  if (days > 1) return `in ${days} days`;\n  if (days === 1) return 'tomorrow';\n  if (days === 0) return 'today';\n  return `${-days} day${days === -1 ? '' : 's'} ago`;\n}\n\n// Who the reminder is meant for, by stage. Overdue goes to staff only (no repeated driver emails).\nfunction audienceFor(stage) {\n  if (stage === 'OVERDUE') return 'staff';\n  if (stage === 'D0') return 'driver_and_staff';\n  return 'driver';\n}\n\nfunction composeReminder(row, driver, settings) {\n  const label = DOCUMENT_LABELS[row.document_type] || row.document_type;\n  const audience = audienceFor(row.reminder_stage);\n  const when = whenPhrase(row.days_remaining);\n  const expires = formatDate(row.expiration_date);\n  const inherited = String(row.expiration_source || '').startsWith('inherited_from_cdl')\n    ? ' (this endorsement shares your CDL expiration date)'\n    : '';\n\n  const recipients = [];\n  if (audience !== 'staff') recipients.push(driver.email);\n  if (audience !== 'driver') recipients.push(driver.manager_email);\n\n  let subject;\n  let lines;\n  if (audience === 'staff') {\n    subject = `Staff escalation: ${driver.full_name}'s ${label} expired ${when}`;\n    lines = [\n      `${driver.full_name} (${driver.driver_id}) has an expired ${label}.`,\n      `Expiration date: ${expires}${inherited}.`,\n      'Please follow up with the driver and record a renewal. Documinder will not keep emailing the driver about this.',\n    ];\n  } else {\n    const urgency = { D90: 'Heads-up', D60: 'Reminder', D30: 'Action needed', D14: 'Action needed', D7: 'Final reminder', D0: 'Expires today' }[row.reminder_stage] || 'Reminder';\n    subject = row.reminder_stage === 'D0'\n      ? `Expires today: your ${label}`\n      : `${urgency}: your ${label} expires ${when}`;\n    lines = [\n      `Hi ${driver.full_name.split(' ')[0]},`,\n      `Your ${label} expires ${when}, on ${expires}${inherited}.`,\n      'Please submit your renewed document so the compliance team can verify it.',\n    ];\n    if (audience === 'driver_and_staff') lines.push(`Your manager (${driver.manager_email}) has been copied.`);\n  }\n\n  return { audience, recipients, subject, body: lines.join('\\n\\n') };\n}\n\n// Decides, for every row with a due reminder stage, whether to create a new preview\n// notification or skip it because a blocking attempt already exists.\nfunction planNotifications({ rows, drivers, settings, history, now = new Date(), runId = 'local' }) {\n  const previewOnly = settings.preview_only === true || settings.preview_only === 'true';\n  if (previewOnly && !String(settings.test_recipient || '').trim()) {\n    throw new Error('preview_only is on but Settings.test_recipient is empty; refusing to address any reminder.');\n  }\n\n  const blocked = new Set(\n    history\n      .filter((n) => n && n.dedup_key && BLOCKING_STATUSES.includes(n.status))\n      .map((n) => n.dedup_key),\n  );\n  const driversById = new Map(drivers.map((d) => [d.driver_id, d]));\n  const attemptedAt = now.toISOString();\n  const plans = [];\n  let seq = 0;\n\n  for (const row of rows) {\n    if (!row.reminder_stage || !row.dedup_key) continue;\n    const driver = driversById.get(row.driver_id);\n    const base = {\n      dedup_key: row.dedup_key,\n      driver_id: row.driver_id,\n      full_name: row.full_name,\n      document_id: row.document_id,\n      document_type: row.document_type,\n      document_version: row.document_version,\n      reminder_stage: row.reminder_stage,\n      days_remaining: row.days_remaining,\n    };\n\n    if (blocked.has(row.dedup_key)) {\n      plans.push({ ...base, decision: 'skip_duplicate' });\n      continue;\n    }\n    blocked.add(row.dedup_key); // never plan the same key twice in one run\n\n    const msg = composeReminder(row, driver, settings);\n    const intended = msg.recipients.join(', ');\n    seq += 1;\n    plans.push({\n      ...base,\n      decision: 'create',\n      notification: {\n        notification_id: `NTF-${runId}-${String(seq).padStart(3, '0')}`,\n        driver_id: row.driver_id,\n        document_id: row.document_id,\n        document_version: row.document_version,\n        reminder_stage: row.reminder_stage,\n        dedup_key: row.dedup_key,\n        audience: msg.audience,\n        intended_recipient: intended,\n        delivered_to: previewOnly ? settings.test_recipient : intended,\n        delivery_mode: previewOnly ? 'preview' : 'live',\n        subject: (previewOnly ? `[PREVIEW for ${intended}] ` : '') + msg.subject,\n        body: msg.body,\n        from_name: settings.reminder_from_name || 'Documinder',\n        provider_message_id: '',\n        status: 'previewed',\n        attempted_at: attemptedAt,\n        error_detail: '',\n      },\n    });\n  }\n  return plans;\n}\n\nfunction summarizePlans(plans) {\n  const created = plans.filter((p) => p.decision === 'create');\n  return {\n    reminders_due: plans.length,\n    created: created.length,\n    skipped_duplicates: plans.length - created.length,\n    created_by_stage: created.reduce((acc, p) => ({ ...acc, [p.reminder_stage]: (acc[p.reminder_stage] || 0) + 1 }), {}),\n  };\n}\n\n// ---------- n8n glue ----------\n// One item per due reminder stage, each with decision = create | skip_duplicate.\nconst settings = $('Load Settings').first().json;\nconst drivers = $('Load Drivers').all().map((i) => i.json);\n// Empty table on the first run: n8n emits one empty item, so keep only real rows.\nconst history = $('Load Notification History').all().map((i) => i.json).filter((n) => n.dedup_key);\nconst rows = $input.all().map((i) => i.json);\n\nconst plans = planNotifications({ rows, drivers, settings, history, runId: $execution.id });\nreturn plans.map((p) => ({\n  json: {\n    decision: p.decision,\n    full_name: p.full_name,\n    document_type: p.document_type,\n    days_remaining: p.days_remaining,\n    ...(p.notification || { dedup_key: p.dedup_key, driver_id: p.driver_id, reminder_stage: p.reminder_stage }),\n  },\n}));\n",
    },
    position: [1920, 760],
  },
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
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
    position: [2160, 760],
  },
  output: [{"decision":"create","full_name":"Jordan Lee","document_type":"MEDICAL_CERT","days_remaining":90,"notification_id":"sample","driver_id":"sample","document_id":"sample","document_version":2,"reminder_stage":"sample","dedup_key":"sample","audience":"sample","intended_recipient":"sample","delivered_to":"sample","delivery_mode":"sample","subject":"sample","body":"sample","from_name":"sample","provider_message_id":"sample","status":"sample","attempted_at":"sample","error_detail":"sample"}],
});

const record = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Record Preview Notification',
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
          { id: 'provider_message_id', displayName: 'provider_message_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'attempted_at', displayName: 'attempted_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'error_detail', displayName: 'error_detail', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2400, 700],
  },
  output: [{ id: 1 }],
});

const summary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Phase 2 Run Summary',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Phase 2 run summary: what was due, what was created, what dedup skipped.\nconst plans = $input.all().map((i) => i.json);\nconst created = plans.filter((p) => p.decision === 'create');\nconst skipped = plans.filter((p) => p.decision === 'skip_duplicate');\nconst history = $('Load Notification History').all().map((i) => i.json).filter((n) => n.dedup_key);\nconst settings = $('Load Settings').first().json;\n\n// Integrity check: after this run, no dedup key may have more than one blocking attempt.\nconst blocking = ['previewed', 'sent', 'uncertain'];\nconst counts = {};\nfor (const n of [...history, ...created]) {\n  if (blocking.includes(n.status)) counts[n.dedup_key] = (counts[n.dedup_key] || 0) + 1;\n}\nconst duplicateKeys = Object.keys(counts).filter((k) => counts[k] > 1);\n\nreturn [{\n  json: {\n    phase: 'Phase 2: safe reminder preview + dedup',\n    run_at: $now.toISO(),\n    preview_only: settings.preview_only,\n    all_previews_delivered_to: settings.test_recipient,\n    reminders_due: plans.length,\n    created: created.length,\n    skipped_duplicates: skipped.length,\n    history_before_run: history.length,\n    duplicate_keys_after_run: duplicateKeys,\n    dedup_integrity: duplicateKeys.length === 0 ? 'OK' : 'DUPLICATES FOUND',\n    created_reminders: created.map((p) => ({ stage: p.reminder_stage, driver: p.full_name, document: p.document_type, intended: p.intended_recipient, subject: p.subject })),\n    skipped_keys: skipped.map((p) => p.dedup_key),\n  },\n}];\n",
    },
    position: [2160, 1000],
  },
  output: [{ reminders_due: 9, created: 9, skipped_duplicates: 0, dedup_integrity: 'OK' }],
});

const notePreview = sticky(
  '## 4 · Reminder preview + dedup (Phase 2)\n' +
  'Due stages get a fixed-template reminder (no AI). While **preview_only** is on, every message is addressed to the **test inbox**; the real driver/manager is only recorded as intended_recipient.\n\n' +
  'Dedup key: driver | document | version | stage. A reminder is created only if no attempt with that key is previewed, sent, or uncertain. failed can retry.\n\n' +
  'Source: src/documinder-reminders.js',
  [],
  { color: 3, position: [1860, 540], width: 760, height: 640 }
);

const noteOverview = sticky(
  '## Documinder · Daily Review\n' +
  'Checks every required credential for every driver, then classifies it with plain date math (no AI).\n\n' +
  '**Phases 1–2:** classification, then preview reminders with dedup. Nothing is actually sent, and there is no AI node and no schedule. The workflow is not published.\n\n' +
  'Fictional data only. Reference date comes from documinder_settings.test_reference_date (2026-10-15, America/Los_Angeles).',
  [],
  { color: 4, position: [-120, -20], width: 300, height: 480 }
);

const noteLoad = sticky(
  '## 1 · Load\n' +
  'Settings, drivers, role requirements, every document version, notification history, and the expected test results come from n8n Data Tables. ' +
  'Each load runs once (executeOnce) so items never multiply.',
  [],
  { color: 7, position: [200, -20], width: 1380, height: 480 }
);

const noteClassify = sticky(
  '## 2 · Classify\n' +
  'Picks the latest **verified** version of each document and validates the date. Endorsements with no date inherit the CDL date. ' +
  'Counts whole days left in the business timezone, then assigns state + current reminder stage (D90, D60, D30, D14, D7, D0, OVERDUE).\n\n' +
  'Also flags: missing · invalid_date · inactive_skipped · not_applicable.\n\n' +
  'Source: src/documinder-core.js',
  [],
  { color: 5, position: [1620, -20], width: 240, height: 480 }
);

const noteReport = sticky(
  '## 3 · Exit check\n' +
  'Compares every row with documinder_test_expectations (84 rows) and returns **PASS / FAIL** with per-fixture detail.',
  [],
  { color: 6, position: [1880, -20], width: 240, height: 480 }
);

export default workflow('documinder-daily-review', 'Documinder · A · Daily Review')
  .add(start)
  .to(loadSettings)
  .to(loadDrivers)
  .to(loadRequirements)
  .to(loadDocuments)
  .to(loadHistory)
  .to(loadExpectations)
  .to(classify)
  .to(report)
  .add(classify)
  .to(plan)
  .to(isNew.onTrue(record))
  .add(plan)
  .to(summary)
  .add(notePreview)
  .add(noteOverview)
  .add(noteLoad)
  .add(noteClassify)
  .add(noteReport);
