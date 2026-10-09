import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

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
          { fieldLabel: 'Driver', fieldName: 'driver', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [{ option: 'D001 · Maya Torres' }, { option: 'D002 · Jordan Lee' }, { option: 'D003 · Chris Bennett' }, { option: 'D004 · Renee Patel' }, { option: 'D005 · Luis Alvarez' }, { option: 'D006 · Taylor Morgan' }, { option: 'D007 · Casey Brooks' }, { option: 'D008 · Morgan Reed' }, { option: 'D009 · Jamie Kim' }, { option: 'D010 · Avery Johnson' }, { option: 'D011 · Sam Rivera' }, { option: 'D012 · Drew Collins' }] } },
          { fieldLabel: 'Document type', fieldName: 'document_type', fieldType: 'dropdown', requiredField: true, fieldOptions: { values: [{ option: 'CDL' }, { option: 'MEDICAL_CERT' }, { option: 'TWIC' }, { option: 'HAZMAT_ENDORSEMENT' }, { option: 'TANKER_ENDORSEMENT' }, { option: 'DOUBLES_TRIPLES_ENDORSEMENT' }, { option: 'SAFETY_TRAINING' }] } },
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

const loadSettingsIn = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Settings (intake)',
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

const loadDriversIn = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Drivers (intake)',
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

const loadReqIn = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Requirements (intake)',
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

const loadDocsIn = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Documents (intake)',
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

const loadRenewalsIn = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Renewals (intake)',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_renewals' },
      returnAll: true,
    },
    position: [1200, 300],
  },
  output: [{ id: 1 }],
});

const evaluateSubmission = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Submission',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Documinder core — deterministic credential classification (Phase 1).\n//\n// Pure functions with no dependencies, so the same code runs in three places:\n//   1. Node unit tests (tests/core.test.mjs)\n//   2. The n8n \"Classify credentials\" Code node (see workflows/)\n//   3. Anyone reading the repo who wants to understand the rules\n//\n// No LLM is involved. Dates are compared as calendar days, never as timestamps.\n\nconst MS_PER_DAY = 86400000;\n\nconst ENDORSEMENT_TYPES = ['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT'];\nconst DEFAULT_STAGES = [90, 60, 30, 14, 7, 0];\n\n// ---------- Dates ----------\n\n// Parses a strict YYYY-MM-DD string into a whole-day number (days since 1970-01-01).\n// Rejects malformed strings and impossible dates such as 2026-02-30.\nfunction parseCalendarDate(value) {\n  if (value === null || value === undefined || String(value).trim() === '') {\n    return { ok: false, reason: 'blank' };\n  }\n  const s = String(value).trim();\n  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);\n  if (!m) return { ok: false, reason: `malformed date \"${s}\" (expected YYYY-MM-DD)` };\n  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];\n  const ms = Date.UTC(y, mo - 1, d);\n  const check = new Date(ms);\n  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {\n    return { ok: false, reason: `impossible calendar date \"${s}\"` };\n  }\n  return { ok: true, day: Math.round(ms / MS_PER_DAY), iso: s };\n}\n\n// Today's calendar date (YYYY-MM-DD) in the business timezone.\nfunction todayInTimezone(timeZone, now = new Date()) {\n  const parts = new Intl.DateTimeFormat('en-CA', {\n    timeZone,\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(now);\n  const get = (t) => parts.find((p) => p.type === t).value;\n  return `${get('year')}-${get('month')}-${get('day')}`;\n}\n\n// The fixed test date wins when set; otherwise use the real date in the business timezone.\nfunction resolveReferenceDate(settings, now = new Date()) {\n  const tz = settings.business_timezone || 'America/Los_Angeles';\n  const fixed = settings.test_reference_date;\n  if (fixed !== null && fixed !== undefined && String(fixed).trim() !== '') {\n    const parsed = parseCalendarDate(fixed);\n    if (!parsed.ok) throw new Error(`Settings.test_reference_date is invalid: ${parsed.reason}`);\n    return { iso: parsed.iso, day: parsed.day, source: 'test_reference_date', timeZone: tz };\n  }\n  const iso = todayInTimezone(tz, now);\n  return { iso, day: parseCalendarDate(iso).day, source: 'current_date', timeZone: tz };\n}\n\n// ---------- Policy ----------\n\nfunction parseStages(value) {\n  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_STAGES.slice();\n  const stages = String(value)\n    .split(',')\n    .map((s) => Number(s.trim()))\n    .filter((n) => Number.isInteger(n) && n >= 0);\n  return [...new Set(stages)].sort((a, b) => b - a);\n}\n\n// State is defined by the reminder policy table in the build brief.\nfunction stateForDays(days) {\n  if (days < 0) return 'overdue';\n  if (days === 0) return 'expires_today';\n  if (days <= 7) return 'critical';\n  if (days <= 30) return 'urgent';\n  if (days <= 90) return 'approaching_expiry';\n  return 'current';\n}\n\n// Only the *current* applicable stage is returned; missed earlier stages are never replayed.\n// Example with stages 90,60,30,14,7,0: 45 days left -> D60, 90 -> D90, 91 -> none.\nfunction stageForDays(days, stages) {\n  if (days < 0) return 'OVERDUE';\n  const due = stages.filter((s) => s >= days);\n  if (due.length === 0) return '';\n  return `D${Math.min(...due)}`;\n}\n\nfunction actionFor(state, escalationPolicy) {\n  const escalates = escalationPolicy !== 'none';\n  switch (state) {\n    case 'approaching_expiry':\n    case 'urgent':\n    case 'critical':\n      return 'driver_reminder';\n    case 'expires_today':\n      return escalates ? 'driver_notice_and_staff_escalation' : 'driver_notice';\n    case 'overdue':\n      return escalates ? 'staff_escalation' : 'none';\n    case 'missing':\n    case 'invalid_date':\n      return 'staff_review';\n    default:\n      return 'none';\n  }\n}\n\n// ---------- Documents ----------\n\nfunction isTrue(v) {\n  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';\n}\n\n// Latest verified version of one document type for one driver (archived/pending rows ignored).\nfunction latestVerified(documents, driverId, documentType) {\n  return documents\n    .filter((d) => d.driver_id === driverId && d.document_type === documentType && d.status === 'verified')\n    .sort((a, b) => Number(b.version) - Number(a.version))[0];\n}\n\n// ---------- Classification ----------\n\nfunction classifyAll({ settings, drivers, requirements, documents, now = new Date() }) {\n  const ref = resolveReferenceDate(settings, now);\n  const rows = [];\n\n  for (const driver of drivers) {\n    const active = isTrue(driver.active);\n    const reqs = requirements.filter((r) => r.applicable_role === driver.role);\n\n    if (reqs.length === 0) {\n      rows.push(baseRow(ref, driver, { document_type: '*' }, {\n        state: 'invalid_date',\n        action: 'staff_review',\n        reason: `no requirements configured for role \"${driver.role}\"`,\n      }));\n      continue;\n    }\n\n    for (const req of reqs) {\n      if (!active) {\n        rows.push(baseRow(ref, driver, req, { state: 'inactive_skipped', reason: 'driver is inactive' }));\n        continue;\n      }\n      if (!isTrue(req.required)) {\n        rows.push(baseRow(ref, driver, req, { state: 'not_applicable', reason: `not required for role ${driver.role}` }));\n        continue;\n      }\n\n      const doc = latestVerified(documents, driver.driver_id, req.document_type);\n      if (!doc) {\n        rows.push(baseRow(ref, driver, req, {\n          state: 'missing',\n          action: actionFor('missing'),\n          reason: 'required document has no verified version on file',\n        }));\n        continue;\n      }\n\n      // Endorsements may share the CDL expiration date. Never invent a date:\n      // inherit only when the endorsement record is blank and a verified CDL exists.\n      let expirationRaw = doc.expiration_date;\n      let expirationSource = 'document';\n      if ((expirationRaw === null || expirationRaw === undefined || String(expirationRaw).trim() === '') &&\n          ENDORSEMENT_TYPES.includes(req.document_type)) {\n        const cdl = latestVerified(documents, driver.driver_id, 'CDL');\n        if (cdl) {\n          expirationRaw = cdl.expiration_date;\n          expirationSource = `inherited_from_cdl:${cdl.document_id}`;\n        }\n      }\n\n      const exp = parseCalendarDate(expirationRaw);\n      const docFields = {\n        document_id: doc.document_id,\n        document_version: Number(doc.version),\n        expiration_date: expirationRaw === null || expirationRaw === undefined ? '' : String(expirationRaw),\n        expiration_source: expirationSource,\n      };\n\n      if (!exp.ok) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: exp.reason === 'blank' ? 'expiration date not provided' : exp.reason,\n        }));\n        continue;\n      }\n\n      const issue = parseCalendarDate(doc.issue_date);\n      if (issue.ok && issue.day > exp.day) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: `issue_date ${issue.iso} is after expiration_date ${exp.iso}`,\n        }));\n        continue;\n      }\n\n      const days = exp.day - ref.day;\n      const state = stateForDays(days);\n      const stage = state === 'current' ? '' : stageForDays(days, parseStages(req.reminder_stages));\n      rows.push(baseRow(ref, driver, req, {\n        ...docFields,\n        days_remaining: days,\n        state,\n        reminder_stage: stage,\n        action: actionFor(state, req.escalation_policy),\n        reason: `${days} day(s) remaining as of ${ref.iso} (${ref.timeZone})`,\n      }));\n    }\n  }\n  return { reference: ref, rows };\n}\n\nfunction baseRow(ref, driver, req, fields) {\n  return {\n    reference_date: ref.iso,\n    reference_source: ref.source,\n    driver_id: driver.driver_id,\n    full_name: driver.full_name,\n    role: driver.role,\n    active: isTrue(driver.active),\n    requirement_id: req.requirement_id || '',\n    document_type: req.document_type,\n    document_id: '',\n    document_version: null,\n    expiration_date: '',\n    expiration_source: '',\n    days_remaining: null,\n    state: '',\n    reminder_stage: '',\n    action: 'none',\n    reason: '',\n    // Phase 2 dedup key: driver_id + document_id + document_version + reminder_stage\n    dedup_key: '',\n    ...fields,\n  };\n}\n\nfunction withDedupKeys(rows) {\n  return rows.map((r) => ({\n    ...r,\n    dedup_key: r.reminder_stage && r.document_id\n      ? `${r.driver_id}|${r.document_id}|${r.document_version}|${r.reminder_stage}`\n      : '',\n  }));\n}\n\n// Compares actual rows with expected rows keyed by driver_id + document_type.\nfunction compareWithExpected(rows, expected) {\n  const actualByKey = new Map(rows.map((r) => [`${r.driver_id}:${r.document_type}`, r]));\n  const results = expected.map((e) => {\n    const a = actualByKey.get(`${e.driver_id}:${e.document_type}`);\n    const actualState = a ? a.state : '(no row)';\n    const actualStage = a ? a.reminder_stage : '';\n    const pass = actualState === e.expected_state && (actualStage || '') === (e.expected_stage || '');\n    return {\n      driver_id: e.driver_id,\n      full_name: a ? a.full_name : '',\n      document_type: e.document_type,\n      primary_fixture: isTrue(e.primary_fixture),\n      expected_state: e.expected_state,\n      actual_state: actualState,\n      expected_stage: e.expected_stage || '',\n      actual_stage: actualStage || '',\n      days_remaining: a ? a.days_remaining : null,\n      pass,\n    };\n  });\n  const expectedKeys = new Set(expected.map((e) => `${e.driver_id}:${e.document_type}`));\n  const unexpected = rows.filter((r) => !expectedKeys.has(`${r.driver_id}:${r.document_type}`));\n  const failed = results.filter((r) => !r.pass).length + unexpected.length;\n  return { results, unexpected, total: results.length, passed: results.length - results.filter((r) => !r.pass).length, failed };\n}\n\nfunction summarize(rows) {\n  const counts = {};\n  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;\n  return counts;\n}\n\n// Documinder renewals — Phase 4: renewal intake and review (Workflow B).\n// Deterministic, no LLM. Uses parseCalendarDate / resolveReferenceDate / latestVerified\n// from documinder-core.js (in n8n the two files are concatenated into one Code node).\n//\n// History is never destroyed: approval archives the old version and adds a new one;\n// rejection leaves every document row untouched.\n\n\n\nconst isTrueValue = (v) => v === true || v === 'true' || v === 1 || v === '1';\nconst clean = (v) => (v === null || v === undefined ? '' : String(v).trim());\n\n// ---------- Intake ----------\n\n// Decides what to do with one renewal submission:\n//   pending_review    -> store it for a reviewer\n//   invalid_submission-> store it with the reason (audit trail), nothing to review\n//   duplicate         -> an open submission already exists; return it, store nothing\nfunction evaluateSubmission({ submission, settings, drivers, requirements, documents, renewals, now = new Date(), renewalId }) {\n  const driverId = clean(submission.driver_id).toUpperCase();\n  const documentType = clean(submission.document_type).toUpperCase();\n  const expRaw = clean(submission.submitted_expiration_date);\n  const fileUrl = clean(submission.submitted_file_url);\n  const ref = resolveReferenceDate(settings, now);\n\n  const base = {\n    renewal_id: renewalId,\n    driver_id: driverId,\n    document_type: documentType,\n    submitted_expiration_date: expRaw,\n    submitted_file_url: fileUrl,\n    submitted_at: now.toISOString(),\n    reviewed_at: '',\n    reviewed_by: '',\n    rejection_reason: '',\n    previous_document_id: '',\n    previous_version: null,\n    previous_expiration_date: '',\n    new_document_id: '',\n    new_version: null,\n  };\n\n  const open = renewals.find((r) => r.driver_id === driverId && r.document_type === documentType && r.status === 'pending_review');\n  if (open) {\n    return { outcome: 'duplicate', store: false, renewal: open, message: `Renewal ${open.renewal_id} is already waiting for review; no new submission created.` };\n  }\n\n  const problems = [];\n  const driver = drivers.find((d) => d.driver_id === driverId);\n  if (!driver) problems.push(`unknown driver \"${driverId}\"`);\n  else if (!isTrueValue(driver.active)) problems.push(`driver ${driverId} is inactive`);\n\n  if (driver) {\n    const req = requirements.find((r) => r.applicable_role === driver.role && r.document_type === documentType);\n    if (!req) problems.push(`${documentType} is not a tracked document type for role ${driver.role}`);\n    else if (!isTrueValue(req.required)) problems.push(`${documentType} is not required for role ${driver.role}`);\n  }\n\n  const exp = parseCalendarDate(expRaw);\n  if (!exp.ok) problems.push(exp.reason === 'blank' ? 'expiration date is missing' : exp.reason);\n  else if (exp.day <= ref.day) problems.push(`expiration ${exp.iso} is not after today (${ref.iso})`);\n\n  const current = driver ? latestVerified(documents, driverId, documentType) : undefined;\n  if (exp.ok && current) {\n    const cur = parseCalendarDate(current.expiration_date);\n    if (cur.ok && exp.day <= cur.day) problems.push(`expiration ${exp.iso} does not extend the current verified date ${cur.iso}`);\n  }\n\n  if (!/^https?:\\/\\/\\S+$/i.test(fileUrl)) problems.push('a link to the renewed document (http/https) is required');\n\n  if (problems.length) {\n    return {\n      outcome: 'invalid_submission',\n      store: true,\n      renewal: { ...base, status: 'invalid_submission', rejection_reason: problems.join('; ') },\n      message: `Submission not accepted: ${problems.join('; ')}.`,\n    };\n  }\n  return {\n    outcome: 'pending_review',\n    store: true,\n    renewal: {\n      ...base,\n      status: 'pending_review',\n      previous_document_id: current ? current.document_id : '',\n      previous_version: current ? Number(current.version) : null,\n      previous_expiration_date: current ? clean(current.expiration_date) : '',\n    },\n    message: `Renewal ${renewalId} received and waiting for compliance review. The verified record is unchanged until it is approved.`,\n  };\n}\n\n// ---------- Review ----------\n\n// Decides one review. Returns a plan the workflow executes:\n//   refuse  -> nothing changes (not found, already reviewed, unauthorized, missing reason)\n//   reject  -> renewal row updated only\n//   approve -> archive old version, insert new verified version, update renewal,\n//              close old-version notifications, resolve related staff-review items\nfunction evaluateReview({ review, settings, reviewers, renewals, documents, notifications, staffReview, now = new Date() }) {\n  const renewalId = clean(review.renewal_id).toUpperCase();\n  const reviewerEmail = clean(review.reviewer_email).toLowerCase();\n  const decision = clean(review.decision).toLowerCase();\n  const reason = clean(review.rejection_reason);\n  const refuse = (message) => ({ action: 'refuse', message, renewal_id: renewalId });\n\n  const renewal = renewals.find((r) => clean(r.renewal_id).toUpperCase() === renewalId);\n  if (!renewal) return refuse(`Renewal ${renewalId} was not found.`);\n  if (renewal.status !== 'pending_review') {\n    return refuse(`Renewal ${renewalId} is ${renewal.status}${renewal.reviewed_by ? ` (by ${renewal.reviewed_by})` : ''}; it can only be reviewed once.`);\n  }\n  const reviewer = reviewers.find((r) => clean(r.reviewer_email).toLowerCase() === reviewerEmail && isTrueValue(r.active));\n  if (!reviewer) return refuse(`${reviewerEmail || 'This reviewer'} is not an authorized reviewer.`);\n  if (decision !== 'approve' && decision !== 'reject') return refuse('Decision must be approve or reject.');\n\n  const reviewedAt = now.toISOString();\n  if (decision === 'reject') {\n    if (!reason) return refuse('A rejection needs a reason so the driver knows what to fix.');\n    return {\n      action: 'reject',\n      renewal_id: renewalId,\n      renewal_update: { status: 'rejected', reviewed_at: reviewedAt, reviewed_by: reviewerEmail, rejection_reason: reason },\n      message: `Renewal ${renewalId} rejected: ${reason.replace(/[.\\s]+$/, '')}. The verified document was not changed.`,\n    };\n  }\n\n  // Approve: re-check against the documents as they are now, not as they were at submission.\n  const exp = parseCalendarDate(renewal.submitted_expiration_date);\n  if (!exp.ok) return refuse(`Submitted expiration date is invalid: ${exp.reason}.`);\n  const current = latestVerified(documents, renewal.driver_id, renewal.document_type);\n  if (current) {\n    const cur = parseCalendarDate(current.expiration_date);\n    if (cur.ok && exp.day <= cur.day) return refuse(`Submitted date ${exp.iso} no longer extends the verified date ${cur.iso}.`);\n  }\n  const versions = documents\n    .filter((d) => d.driver_id === renewal.driver_id && d.document_type === renewal.document_type)\n    .map((d) => Number(d.version) || 0);\n  const newVersion = (versions.length ? Math.max(...versions) : 0) + 1;\n  const documentId = current ? current.document_id : `DOC-${renewalId}`;\n  const ref = resolveReferenceDate(settings, now);\n\n  const newDocument = {\n    document_id: documentId,\n    driver_id: renewal.driver_id,\n    document_type: renewal.document_type,\n    version: newVersion,\n    issue_date: ref.iso,\n    expiration_date: exp.iso,\n    status: 'verified',\n    source_file_url: renewal.submitted_file_url,\n    verified_at: reviewedAt,\n    verified_by: reviewerEmail,\n  };\n\n  const closedReason = `superseded by renewal ${renewalId} (v${newVersion})`;\n  const notificationsToClose = current\n    ? notifications\n        .filter((n) => n.document_id === current.document_id && Number(n.document_version) === Number(current.version) && !clean(n.closed_at))\n        .map((n) => ({ notification_id: n.notification_id, closed_at: reviewedAt, closed_reason: closedReason }))\n    : [];\n  const closedIds = new Set(notificationsToClose.map((n) => n.notification_id));\n  const reviewItemsToResolve = staffReview\n    .filter((s) => s.status === 'open' && (closedIds.has(s.notification_id) ||\n      (s.driver_id === renewal.driver_id && s.document_type === renewal.document_type && (s.category === 'missing_document' || s.category === 'invalid_date'))))\n    .map((s) => ({ review_key: s.review_key, status: 'resolved', resolved_at: reviewedAt, resolution: closedReason }));\n\n  return {\n    action: 'approve',\n    renewal_id: renewalId,\n    archive: current ? { document_id: current.document_id, version: Number(current.version) } : null,\n    new_document: newDocument,\n    renewal_update: {\n      status: 'approved',\n      reviewed_at: reviewedAt,\n      reviewed_by: reviewerEmail,\n      rejection_reason: '',\n      new_document_id: documentId,\n      new_version: newVersion,\n    },\n    notifications_to_close: notificationsToClose,\n    review_items_to_resolve: reviewItemsToResolve,\n    message: `Renewal ${renewalId} approved: ${renewal.document_type} for ${renewal.driver_id} is now v${newVersion}, expiring ${exp.iso}.` +\n      (current ? ` v${current.version} archived; ${notificationsToClose.length} reminder(s) closed.` : ' First verified version on file.'),\n  };\n}\n\n// ---------- n8n glue ----------\nconst form = $('Submit Renewal Form').first().json;\nconst submission = {\n  driver_id: String(form.driver || '').split(' ')[0],\n  document_type: form.document_type,\n  submitted_expiration_date: form.submitted_expiration_date,\n  submitted_file_url: form.submitted_file_url,\n};\nconst result = evaluateSubmission({\n  submission,\n  settings: $('Load Settings (intake)').first().json,\n  drivers: $('Load Drivers (intake)').all().map((i) => i.json),\n  requirements: $('Load Requirements (intake)').all().map((i) => i.json),\n  documents: $('Load Documents (intake)').all().map((i) => i.json),\n  renewals: $('Load Renewals (intake)').all().map((i) => i.json).filter((r) => r.renewal_id),\n  renewalId: 'RN-' + $execution.id,\n});\nreturn [{ json: { outcome: result.outcome, store: result.store, message: result.message, ...result.renewal } }];\n",
    },
    position: [1440, 300],
  },
  output: [{"outcome":"pending_review","store":true,"message":"sample","renewal_id":"sample","driver_id":"sample","document_type":"sample","submitted_expiration_date":"sample","submitted_file_url":"sample","status":"sample","submitted_at":"sample","reviewed_at":"sample","reviewed_by":"sample","rejection_reason":"sample","previous_document_id":"sample","previous_version":"sample","previous_expiration_date":"sample","new_document_id":"sample","new_version":"sample"}],
});

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
  output: [{"outcome":"pending_review","store":true,"message":"sample","renewal_id":"sample","driver_id":"sample","document_type":"sample","submitted_expiration_date":"sample","submitted_file_url":"sample","status":"sample","submitted_at":"sample","reviewed_at":"sample","reviewed_by":"sample","rejection_reason":"sample","previous_document_id":"sample","previous_version":"sample","previous_expiration_date":"sample","new_document_id":"sample","new_version":"sample"}],
});

const storeRenewal = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Store Renewal (pending_review)',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_renewals' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          renewal_id: expr("{{ $('Evaluate Submission').first().json.renewal_id }}"),
          driver_id: expr("{{ $('Evaluate Submission').first().json.driver_id }}"),
          document_type: expr("{{ $('Evaluate Submission').first().json.document_type }}"),
          submitted_expiration_date: expr("{{ $('Evaluate Submission').first().json.submitted_expiration_date }}"),
          submitted_file_url: expr("{{ $('Evaluate Submission').first().json.submitted_file_url }}"),
          status: expr("{{ $('Evaluate Submission').first().json.status }}"),
          submitted_at: expr("{{ $('Evaluate Submission').first().json.submitted_at }}"),
          reviewed_at: expr("{{ $('Evaluate Submission').first().json.reviewed_at }}"),
          reviewed_by: expr("{{ $('Evaluate Submission').first().json.reviewed_by }}"),
          rejection_reason: expr("{{ $('Evaluate Submission').first().json.rejection_reason }}"),
          previous_document_id: expr("{{ $('Evaluate Submission').first().json.previous_document_id }}"),
          previous_version: expr("{{ $('Evaluate Submission').first().json.previous_version }}"),
          previous_expiration_date: expr("{{ $('Evaluate Submission').first().json.previous_expiration_date }}"),
          new_document_id: expr("{{ $('Evaluate Submission').first().json.new_document_id }}"),
          new_version: expr("{{ $('Evaluate Submission').first().json.new_version }}"),
        },
        schema: [
          { id: 'renewal_id', displayName: 'renewal_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'driver_id', displayName: 'driver_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_type', displayName: 'document_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'submitted_expiration_date', displayName: 'submitted_expiration_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'submitted_file_url', displayName: 'submitted_file_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'submitted_at', displayName: 'submitted_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'reviewed_at', displayName: 'reviewed_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'reviewed_by', displayName: 'reviewed_by', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'rejection_reason', displayName: 'rejection_reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'previous_document_id', displayName: 'previous_document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'previous_version', displayName: 'previous_version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'previous_expiration_date', displayName: 'previous_expiration_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'new_document_id', displayName: 'new_document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'new_version', displayName: 'new_version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
        ],
      },
    },
    position: [1920, 220],
  },
  output: [{ id: 1 }],
});

const showSubmission = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Show Submission Result',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: expr("{{ $('Evaluate Submission').first().json.outcome === 'pending_review' ? 'Renewal received' : ($('Evaluate Submission').first().json.outcome === 'duplicate' ? 'Already submitted' : 'Submission not accepted') }}"),
      completionMessage: expr("{{ $('Evaluate Submission').first().json.message }}"),
    },
    position: [2160, 300],
  },
  output: [{}],
});

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

const loadSettingsRv = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Settings (review)',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_settings' },
      returnAll: true,
    },
    position: [240, 900],
  },
  output: [{ id: 1 }],
});

const loadReviewers = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Reviewers',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_reviewers' },
      returnAll: true,
    },
    position: [480, 900],
  },
  output: [{ id: 1 }],
});

const loadRenewalsRv = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Renewals (review)',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_renewals' },
      returnAll: true,
    },
    position: [720, 900],
  },
  output: [{ id: 1 }],
});

const loadDocsRv = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Documents (review)',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      returnAll: true,
    },
    position: [960, 900],
  },
  output: [{ id: 1 }],
});

const loadNotifRv = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Notifications (review)',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
      returnAll: true,
    },
    position: [1200, 900],
  },
  output: [{ id: 1 }],
});

const loadReviewRv = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Staff Review (review)',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_staff_review' },
      returnAll: true,
    },
    position: [1440, 900],
  },
  output: [{ id: 1 }],
});

const decide = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Decide Review',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Documinder core — deterministic credential classification (Phase 1).\n//\n// Pure functions with no dependencies, so the same code runs in three places:\n//   1. Node unit tests (tests/core.test.mjs)\n//   2. The n8n \"Classify credentials\" Code node (see workflows/)\n//   3. Anyone reading the repo who wants to understand the rules\n//\n// No LLM is involved. Dates are compared as calendar days, never as timestamps.\n\nconst MS_PER_DAY = 86400000;\n\nconst ENDORSEMENT_TYPES = ['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT'];\nconst DEFAULT_STAGES = [90, 60, 30, 14, 7, 0];\n\n// ---------- Dates ----------\n\n// Parses a strict YYYY-MM-DD string into a whole-day number (days since 1970-01-01).\n// Rejects malformed strings and impossible dates such as 2026-02-30.\nfunction parseCalendarDate(value) {\n  if (value === null || value === undefined || String(value).trim() === '') {\n    return { ok: false, reason: 'blank' };\n  }\n  const s = String(value).trim();\n  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);\n  if (!m) return { ok: false, reason: `malformed date \"${s}\" (expected YYYY-MM-DD)` };\n  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];\n  const ms = Date.UTC(y, mo - 1, d);\n  const check = new Date(ms);\n  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {\n    return { ok: false, reason: `impossible calendar date \"${s}\"` };\n  }\n  return { ok: true, day: Math.round(ms / MS_PER_DAY), iso: s };\n}\n\n// Today's calendar date (YYYY-MM-DD) in the business timezone.\nfunction todayInTimezone(timeZone, now = new Date()) {\n  const parts = new Intl.DateTimeFormat('en-CA', {\n    timeZone,\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(now);\n  const get = (t) => parts.find((p) => p.type === t).value;\n  return `${get('year')}-${get('month')}-${get('day')}`;\n}\n\n// The fixed test date wins when set; otherwise use the real date in the business timezone.\nfunction resolveReferenceDate(settings, now = new Date()) {\n  const tz = settings.business_timezone || 'America/Los_Angeles';\n  const fixed = settings.test_reference_date;\n  if (fixed !== null && fixed !== undefined && String(fixed).trim() !== '') {\n    const parsed = parseCalendarDate(fixed);\n    if (!parsed.ok) throw new Error(`Settings.test_reference_date is invalid: ${parsed.reason}`);\n    return { iso: parsed.iso, day: parsed.day, source: 'test_reference_date', timeZone: tz };\n  }\n  const iso = todayInTimezone(tz, now);\n  return { iso, day: parseCalendarDate(iso).day, source: 'current_date', timeZone: tz };\n}\n\n// ---------- Policy ----------\n\nfunction parseStages(value) {\n  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_STAGES.slice();\n  const stages = String(value)\n    .split(',')\n    .map((s) => Number(s.trim()))\n    .filter((n) => Number.isInteger(n) && n >= 0);\n  return [...new Set(stages)].sort((a, b) => b - a);\n}\n\n// State is defined by the reminder policy table in the build brief.\nfunction stateForDays(days) {\n  if (days < 0) return 'overdue';\n  if (days === 0) return 'expires_today';\n  if (days <= 7) return 'critical';\n  if (days <= 30) return 'urgent';\n  if (days <= 90) return 'approaching_expiry';\n  return 'current';\n}\n\n// Only the *current* applicable stage is returned; missed earlier stages are never replayed.\n// Example with stages 90,60,30,14,7,0: 45 days left -> D60, 90 -> D90, 91 -> none.\nfunction stageForDays(days, stages) {\n  if (days < 0) return 'OVERDUE';\n  const due = stages.filter((s) => s >= days);\n  if (due.length === 0) return '';\n  return `D${Math.min(...due)}`;\n}\n\nfunction actionFor(state, escalationPolicy) {\n  const escalates = escalationPolicy !== 'none';\n  switch (state) {\n    case 'approaching_expiry':\n    case 'urgent':\n    case 'critical':\n      return 'driver_reminder';\n    case 'expires_today':\n      return escalates ? 'driver_notice_and_staff_escalation' : 'driver_notice';\n    case 'overdue':\n      return escalates ? 'staff_escalation' : 'none';\n    case 'missing':\n    case 'invalid_date':\n      return 'staff_review';\n    default:\n      return 'none';\n  }\n}\n\n// ---------- Documents ----------\n\nfunction isTrue(v) {\n  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';\n}\n\n// Latest verified version of one document type for one driver (archived/pending rows ignored).\nfunction latestVerified(documents, driverId, documentType) {\n  return documents\n    .filter((d) => d.driver_id === driverId && d.document_type === documentType && d.status === 'verified')\n    .sort((a, b) => Number(b.version) - Number(a.version))[0];\n}\n\n// ---------- Classification ----------\n\nfunction classifyAll({ settings, drivers, requirements, documents, now = new Date() }) {\n  const ref = resolveReferenceDate(settings, now);\n  const rows = [];\n\n  for (const driver of drivers) {\n    const active = isTrue(driver.active);\n    const reqs = requirements.filter((r) => r.applicable_role === driver.role);\n\n    if (reqs.length === 0) {\n      rows.push(baseRow(ref, driver, { document_type: '*' }, {\n        state: 'invalid_date',\n        action: 'staff_review',\n        reason: `no requirements configured for role \"${driver.role}\"`,\n      }));\n      continue;\n    }\n\n    for (const req of reqs) {\n      if (!active) {\n        rows.push(baseRow(ref, driver, req, { state: 'inactive_skipped', reason: 'driver is inactive' }));\n        continue;\n      }\n      if (!isTrue(req.required)) {\n        rows.push(baseRow(ref, driver, req, { state: 'not_applicable', reason: `not required for role ${driver.role}` }));\n        continue;\n      }\n\n      const doc = latestVerified(documents, driver.driver_id, req.document_type);\n      if (!doc) {\n        rows.push(baseRow(ref, driver, req, {\n          state: 'missing',\n          action: actionFor('missing'),\n          reason: 'required document has no verified version on file',\n        }));\n        continue;\n      }\n\n      // Endorsements may share the CDL expiration date. Never invent a date:\n      // inherit only when the endorsement record is blank and a verified CDL exists.\n      let expirationRaw = doc.expiration_date;\n      let expirationSource = 'document';\n      if ((expirationRaw === null || expirationRaw === undefined || String(expirationRaw).trim() === '') &&\n          ENDORSEMENT_TYPES.includes(req.document_type)) {\n        const cdl = latestVerified(documents, driver.driver_id, 'CDL');\n        if (cdl) {\n          expirationRaw = cdl.expiration_date;\n          expirationSource = `inherited_from_cdl:${cdl.document_id}`;\n        }\n      }\n\n      const exp = parseCalendarDate(expirationRaw);\n      const docFields = {\n        document_id: doc.document_id,\n        document_version: Number(doc.version),\n        expiration_date: expirationRaw === null || expirationRaw === undefined ? '' : String(expirationRaw),\n        expiration_source: expirationSource,\n      };\n\n      if (!exp.ok) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: exp.reason === 'blank' ? 'expiration date not provided' : exp.reason,\n        }));\n        continue;\n      }\n\n      const issue = parseCalendarDate(doc.issue_date);\n      if (issue.ok && issue.day > exp.day) {\n        rows.push(baseRow(ref, driver, req, {\n          ...docFields,\n          state: 'invalid_date',\n          action: actionFor('invalid_date'),\n          reason: `issue_date ${issue.iso} is after expiration_date ${exp.iso}`,\n        }));\n        continue;\n      }\n\n      const days = exp.day - ref.day;\n      const state = stateForDays(days);\n      const stage = state === 'current' ? '' : stageForDays(days, parseStages(req.reminder_stages));\n      rows.push(baseRow(ref, driver, req, {\n        ...docFields,\n        days_remaining: days,\n        state,\n        reminder_stage: stage,\n        action: actionFor(state, req.escalation_policy),\n        reason: `${days} day(s) remaining as of ${ref.iso} (${ref.timeZone})`,\n      }));\n    }\n  }\n  return { reference: ref, rows };\n}\n\nfunction baseRow(ref, driver, req, fields) {\n  return {\n    reference_date: ref.iso,\n    reference_source: ref.source,\n    driver_id: driver.driver_id,\n    full_name: driver.full_name,\n    role: driver.role,\n    active: isTrue(driver.active),\n    requirement_id: req.requirement_id || '',\n    document_type: req.document_type,\n    document_id: '',\n    document_version: null,\n    expiration_date: '',\n    expiration_source: '',\n    days_remaining: null,\n    state: '',\n    reminder_stage: '',\n    action: 'none',\n    reason: '',\n    // Phase 2 dedup key: driver_id + document_id + document_version + reminder_stage\n    dedup_key: '',\n    ...fields,\n  };\n}\n\nfunction withDedupKeys(rows) {\n  return rows.map((r) => ({\n    ...r,\n    dedup_key: r.reminder_stage && r.document_id\n      ? `${r.driver_id}|${r.document_id}|${r.document_version}|${r.reminder_stage}`\n      : '',\n  }));\n}\n\n// Compares actual rows with expected rows keyed by driver_id + document_type.\nfunction compareWithExpected(rows, expected) {\n  const actualByKey = new Map(rows.map((r) => [`${r.driver_id}:${r.document_type}`, r]));\n  const results = expected.map((e) => {\n    const a = actualByKey.get(`${e.driver_id}:${e.document_type}`);\n    const actualState = a ? a.state : '(no row)';\n    const actualStage = a ? a.reminder_stage : '';\n    const pass = actualState === e.expected_state && (actualStage || '') === (e.expected_stage || '');\n    return {\n      driver_id: e.driver_id,\n      full_name: a ? a.full_name : '',\n      document_type: e.document_type,\n      primary_fixture: isTrue(e.primary_fixture),\n      expected_state: e.expected_state,\n      actual_state: actualState,\n      expected_stage: e.expected_stage || '',\n      actual_stage: actualStage || '',\n      days_remaining: a ? a.days_remaining : null,\n      pass,\n    };\n  });\n  const expectedKeys = new Set(expected.map((e) => `${e.driver_id}:${e.document_type}`));\n  const unexpected = rows.filter((r) => !expectedKeys.has(`${r.driver_id}:${r.document_type}`));\n  const failed = results.filter((r) => !r.pass).length + unexpected.length;\n  return { results, unexpected, total: results.length, passed: results.length - results.filter((r) => !r.pass).length, failed };\n}\n\nfunction summarize(rows) {\n  const counts = {};\n  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;\n  return counts;\n}\n\n// Documinder renewals — Phase 4: renewal intake and review (Workflow B).\n// Deterministic, no LLM. Uses parseCalendarDate / resolveReferenceDate / latestVerified\n// from documinder-core.js (in n8n the two files are concatenated into one Code node).\n//\n// History is never destroyed: approval archives the old version and adds a new one;\n// rejection leaves every document row untouched.\n\n\n\nconst isTrueValue = (v) => v === true || v === 'true' || v === 1 || v === '1';\nconst clean = (v) => (v === null || v === undefined ? '' : String(v).trim());\n\n// ---------- Intake ----------\n\n// Decides what to do with one renewal submission:\n//   pending_review    -> store it for a reviewer\n//   invalid_submission-> store it with the reason (audit trail), nothing to review\n//   duplicate         -> an open submission already exists; return it, store nothing\nfunction evaluateSubmission({ submission, settings, drivers, requirements, documents, renewals, now = new Date(), renewalId }) {\n  const driverId = clean(submission.driver_id).toUpperCase();\n  const documentType = clean(submission.document_type).toUpperCase();\n  const expRaw = clean(submission.submitted_expiration_date);\n  const fileUrl = clean(submission.submitted_file_url);\n  const ref = resolveReferenceDate(settings, now);\n\n  const base = {\n    renewal_id: renewalId,\n    driver_id: driverId,\n    document_type: documentType,\n    submitted_expiration_date: expRaw,\n    submitted_file_url: fileUrl,\n    submitted_at: now.toISOString(),\n    reviewed_at: '',\n    reviewed_by: '',\n    rejection_reason: '',\n    previous_document_id: '',\n    previous_version: null,\n    previous_expiration_date: '',\n    new_document_id: '',\n    new_version: null,\n  };\n\n  const open = renewals.find((r) => r.driver_id === driverId && r.document_type === documentType && r.status === 'pending_review');\n  if (open) {\n    return { outcome: 'duplicate', store: false, renewal: open, message: `Renewal ${open.renewal_id} is already waiting for review; no new submission created.` };\n  }\n\n  const problems = [];\n  const driver = drivers.find((d) => d.driver_id === driverId);\n  if (!driver) problems.push(`unknown driver \"${driverId}\"`);\n  else if (!isTrueValue(driver.active)) problems.push(`driver ${driverId} is inactive`);\n\n  if (driver) {\n    const req = requirements.find((r) => r.applicable_role === driver.role && r.document_type === documentType);\n    if (!req) problems.push(`${documentType} is not a tracked document type for role ${driver.role}`);\n    else if (!isTrueValue(req.required)) problems.push(`${documentType} is not required for role ${driver.role}`);\n  }\n\n  const exp = parseCalendarDate(expRaw);\n  if (!exp.ok) problems.push(exp.reason === 'blank' ? 'expiration date is missing' : exp.reason);\n  else if (exp.day <= ref.day) problems.push(`expiration ${exp.iso} is not after today (${ref.iso})`);\n\n  const current = driver ? latestVerified(documents, driverId, documentType) : undefined;\n  if (exp.ok && current) {\n    const cur = parseCalendarDate(current.expiration_date);\n    if (cur.ok && exp.day <= cur.day) problems.push(`expiration ${exp.iso} does not extend the current verified date ${cur.iso}`);\n  }\n\n  if (!/^https?:\\/\\/\\S+$/i.test(fileUrl)) problems.push('a link to the renewed document (http/https) is required');\n\n  if (problems.length) {\n    return {\n      outcome: 'invalid_submission',\n      store: true,\n      renewal: { ...base, status: 'invalid_submission', rejection_reason: problems.join('; ') },\n      message: `Submission not accepted: ${problems.join('; ')}.`,\n    };\n  }\n  return {\n    outcome: 'pending_review',\n    store: true,\n    renewal: {\n      ...base,\n      status: 'pending_review',\n      previous_document_id: current ? current.document_id : '',\n      previous_version: current ? Number(current.version) : null,\n      previous_expiration_date: current ? clean(current.expiration_date) : '',\n    },\n    message: `Renewal ${renewalId} received and waiting for compliance review. The verified record is unchanged until it is approved.`,\n  };\n}\n\n// ---------- Review ----------\n\n// Decides one review. Returns a plan the workflow executes:\n//   refuse  -> nothing changes (not found, already reviewed, unauthorized, missing reason)\n//   reject  -> renewal row updated only\n//   approve -> archive old version, insert new verified version, update renewal,\n//              close old-version notifications, resolve related staff-review items\nfunction evaluateReview({ review, settings, reviewers, renewals, documents, notifications, staffReview, now = new Date() }) {\n  const renewalId = clean(review.renewal_id).toUpperCase();\n  const reviewerEmail = clean(review.reviewer_email).toLowerCase();\n  const decision = clean(review.decision).toLowerCase();\n  const reason = clean(review.rejection_reason);\n  const refuse = (message) => ({ action: 'refuse', message, renewal_id: renewalId });\n\n  const renewal = renewals.find((r) => clean(r.renewal_id).toUpperCase() === renewalId);\n  if (!renewal) return refuse(`Renewal ${renewalId} was not found.`);\n  if (renewal.status !== 'pending_review') {\n    return refuse(`Renewal ${renewalId} is ${renewal.status}${renewal.reviewed_by ? ` (by ${renewal.reviewed_by})` : ''}; it can only be reviewed once.`);\n  }\n  const reviewer = reviewers.find((r) => clean(r.reviewer_email).toLowerCase() === reviewerEmail && isTrueValue(r.active));\n  if (!reviewer) return refuse(`${reviewerEmail || 'This reviewer'} is not an authorized reviewer.`);\n  if (decision !== 'approve' && decision !== 'reject') return refuse('Decision must be approve or reject.');\n\n  const reviewedAt = now.toISOString();\n  if (decision === 'reject') {\n    if (!reason) return refuse('A rejection needs a reason so the driver knows what to fix.');\n    return {\n      action: 'reject',\n      renewal_id: renewalId,\n      renewal_update: { status: 'rejected', reviewed_at: reviewedAt, reviewed_by: reviewerEmail, rejection_reason: reason },\n      message: `Renewal ${renewalId} rejected: ${reason.replace(/[.\\s]+$/, '')}. The verified document was not changed.`,\n    };\n  }\n\n  // Approve: re-check against the documents as they are now, not as they were at submission.\n  const exp = parseCalendarDate(renewal.submitted_expiration_date);\n  if (!exp.ok) return refuse(`Submitted expiration date is invalid: ${exp.reason}.`);\n  const current = latestVerified(documents, renewal.driver_id, renewal.document_type);\n  if (current) {\n    const cur = parseCalendarDate(current.expiration_date);\n    if (cur.ok && exp.day <= cur.day) return refuse(`Submitted date ${exp.iso} no longer extends the verified date ${cur.iso}.`);\n  }\n  const versions = documents\n    .filter((d) => d.driver_id === renewal.driver_id && d.document_type === renewal.document_type)\n    .map((d) => Number(d.version) || 0);\n  const newVersion = (versions.length ? Math.max(...versions) : 0) + 1;\n  const documentId = current ? current.document_id : `DOC-${renewalId}`;\n  const ref = resolveReferenceDate(settings, now);\n\n  const newDocument = {\n    document_id: documentId,\n    driver_id: renewal.driver_id,\n    document_type: renewal.document_type,\n    version: newVersion,\n    issue_date: ref.iso,\n    expiration_date: exp.iso,\n    status: 'verified',\n    source_file_url: renewal.submitted_file_url,\n    verified_at: reviewedAt,\n    verified_by: reviewerEmail,\n  };\n\n  const closedReason = `superseded by renewal ${renewalId} (v${newVersion})`;\n  const notificationsToClose = current\n    ? notifications\n        .filter((n) => n.document_id === current.document_id && Number(n.document_version) === Number(current.version) && !clean(n.closed_at))\n        .map((n) => ({ notification_id: n.notification_id, closed_at: reviewedAt, closed_reason: closedReason }))\n    : [];\n  const closedIds = new Set(notificationsToClose.map((n) => n.notification_id));\n  const reviewItemsToResolve = staffReview\n    .filter((s) => s.status === 'open' && (closedIds.has(s.notification_id) ||\n      (s.driver_id === renewal.driver_id && s.document_type === renewal.document_type && (s.category === 'missing_document' || s.category === 'invalid_date'))))\n    .map((s) => ({ review_key: s.review_key, status: 'resolved', resolved_at: reviewedAt, resolution: closedReason }));\n\n  return {\n    action: 'approve',\n    renewal_id: renewalId,\n    archive: current ? { document_id: current.document_id, version: Number(current.version) } : null,\n    new_document: newDocument,\n    renewal_update: {\n      status: 'approved',\n      reviewed_at: reviewedAt,\n      reviewed_by: reviewerEmail,\n      rejection_reason: '',\n      new_document_id: documentId,\n      new_version: newVersion,\n    },\n    notifications_to_close: notificationsToClose,\n    review_items_to_resolve: reviewItemsToResolve,\n    message: `Renewal ${renewalId} approved: ${renewal.document_type} for ${renewal.driver_id} is now v${newVersion}, expiring ${exp.iso}.` +\n      (current ? ` v${current.version} archived; ${notificationsToClose.length} reminder(s) closed.` : ' First verified version on file.'),\n  };\n}\n\n// ---------- n8n glue ----------\nconst plan = evaluateReview({\n  review: $('Review Renewal Form').first().json,\n  settings: $('Load Settings (review)').first().json,\n  reviewers: $('Load Reviewers').all().map((i) => i.json).filter((r) => r.reviewer_email),\n  renewals: $('Load Renewals (review)').all().map((i) => i.json).filter((r) => r.renewal_id),\n  documents: $('Load Documents (review)').all().map((i) => i.json),\n  notifications: $('Load Notifications (review)').all().map((i) => i.json).filter((r) => r.notification_id),\n  staffReview: $('Load Staff Review (review)').all().map((i) => i.json).filter((r) => r.review_key),\n});\nreturn [{ json: plan }];\n",
    },
    position: [1680, 900],
  },
  output: [{ action: 'approve', renewal_id: 'RN-1', message: 'sample', archive: { document_id: 'DOC0034', version: 1 }, new_document: { document_id: 'DOC0034', version: 2 }, renewal_update: { status: 'approved' }, notifications_to_close: [], review_items_to_resolve: [] }],
});

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

const createVersion = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Create New Verified Version',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          document_id: expr("{{ $('Decide Review').first().json.new_document.document_id }}"),
          driver_id: expr("{{ $('Decide Review').first().json.new_document.driver_id }}"),
          document_type: expr("{{ $('Decide Review').first().json.new_document.document_type }}"),
          version: expr("{{ $('Decide Review').first().json.new_document.version }}"),
          issue_date: expr("{{ $('Decide Review').first().json.new_document.issue_date }}"),
          expiration_date: expr("{{ $('Decide Review').first().json.new_document.expiration_date }}"),
          status: expr("{{ $('Decide Review').first().json.new_document.status }}"),
          source_file_url: expr("{{ $('Decide Review').first().json.new_document.source_file_url }}"),
          verified_at: expr("{{ $('Decide Review').first().json.new_document.verified_at }}"),
          verified_by: expr("{{ $('Decide Review').first().json.new_document.verified_by }}"),
        },
        schema: [
          { id: 'document_id', displayName: 'document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'driver_id', displayName: 'driver_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_type', displayName: 'document_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'version', displayName: 'version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'issue_date', displayName: 'issue_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'expiration_date', displayName: 'expiration_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source_file_url', displayName: 'source_file_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'verified_at', displayName: 'verified_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'verified_by', displayName: 'verified_by', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2160, 780],
  },
  output: [{ id: 1 }],
});

const archiveVersion = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Archive Previous Version',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'document_id', condition: 'eq', keyValue: expr("{{ $('Decide Review').first().json.archive ? $('Decide Review').first().json.archive.document_id : '__no_previous_version__' }}") }, { keyName: 'version', condition: 'eq', keyValue: expr("{{ $('Decide Review').first().json.archive ? $('Decide Review').first().json.archive.version : -1 }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: 'archived',
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2400, 780],
  },
  output: [{ id: 1 }],
});

const recordDecision = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Record Review Decision',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_renewals' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'renewal_id', condition: 'eq', keyValue: expr("{{ $('Decide Review').first().json.renewal_id }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: expr("{{ $('Decide Review').first().json.renewal_update.status }}"),
          reviewed_at: expr("{{ $('Decide Review').first().json.renewal_update.reviewed_at }}"),
          reviewed_by: expr("{{ $('Decide Review').first().json.renewal_update.reviewed_by }}"),
          rejection_reason: expr("{{ $('Decide Review').first().json.renewal_update.rejection_reason }}"),
          new_document_id: expr("{{ $('Decide Review').first().json.renewal_update.new_document_id }}"),
          new_version: expr("{{ $('Decide Review').first().json.renewal_update.new_version }}"),
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'reviewed_at', displayName: 'reviewed_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'reviewed_by', displayName: 'reviewed_by', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'rejection_reason', displayName: 'rejection_reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'new_document_id', displayName: 'new_document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'new_version', displayName: 'new_version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2640, 900],
  },
  output: [{ id: 1 }],
});

const splitClose = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Reminders to Close',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// One item per reminder of the superseded version (none for rejections or first versions).\nreturn ($('Decide Review').first().json.notifications_to_close || []).map((n) => ({ json: n }));\n",
    },
    position: [2880, 780],
  },
  output: [{ notification_id: 'NTF-1-001', closed_at: '2026-10-15T17:00:00.000Z', closed_reason: 'sample' }],
});

const closeReminder = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Close Old-Version Reminder',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'notification_id', condition: 'eq', keyValue: expr("{{ $json.notification_id }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          closed_at: expr("{{ $json.closed_at }}"),
          closed_reason: expr("{{ $json.closed_reason }}"),
        },
        schema: [
          { id: 'closed_at', displayName: 'closed_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'closed_reason', displayName: 'closed_reason', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [3120, 780],
  },
  output: [{ id: 1 }],
});

const splitResolve = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Staff Review Items to Resolve',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// One item per staff-review entry this renewal resolves.\nreturn ($('Decide Review').first().json.review_items_to_resolve || []).map((r) => ({ json: r }));\n",
    },
    position: [2880, 1000],
  },
  output: [{ review_key: 'delivery|NTF-1-001', status: 'resolved', resolved_at: '2026-10-15T17:00:00.000Z', resolution: 'sample' }],
});

const resolveReview = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Resolve Staff Review Item',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_staff_review' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'review_key', condition: 'eq', keyValue: expr("{{ $json.review_key }}") }] },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          status: expr("{{ $json.status }}"),
          resolved_at: expr("{{ $json.resolved_at }}"),
          resolution: expr("{{ $json.resolution }}"),
        },
        schema: [
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'resolved_at', displayName: 'resolved_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'resolution', displayName: 'resolution', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [3120, 1000],
  },
  output: [{ id: 1 }],
});

const showReview = node({
  type: 'n8n-nodes-base.form',
  version: 2.5,
  config: {
    name: 'Show Review Result',
    parameters: {
      operation: 'completion',
      respondWith: 'text',
      completionTitle: expr("{{ { approve: 'Renewal approved', reject: 'Renewal rejected', refuse: 'No change made' }[$('Decide Review').first().json.action] }}"),
      completionMessage: expr("{{ $('Decide Review').first().json.message }}"),
    },
    position: [2880, 1220],
  },
  output: [{}],
});

const noteIntake = sticky(
  "## B1 · Renewal intake\nA driver submits a renewed credential through the form. It is validated: active driver, a required document type, a real date that is in the future and extends the current one, and a link.\n\nValid → stored as **pending_review**. Invalid → stored as invalid_submission with the reason. Already pending → the existing renewal is returned.\n**The verified document is never changed here.**",
  [],
  { color: 4, position: [-120, 60], width: 2400, height: 420 }
);

const noteReview = sticky(
  "## B2 · Review (compliance)\nRefused with no change: unknown renewal, already reviewed (so it can never be approved twice), reviewer not on the allow-list, or a reject without a reason.\n\n**Approve:** create v+1 as verified → archive the old version (kept, never deleted) → record the decision → close old-version reminders (delivery status kept) → resolve related staff-review items.\n**Reject:** record the reason only. Documents are untouched.\n\nSource: src/documinder-renewals.js",
  [],
  { color: 6, position: [-120, 640], width: 3460, height: 760 }
);

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
