// Documinder core — deterministic credential classification (Phase 1).
//
// Pure functions with no dependencies, so the same code runs in three places:
//   1. Node unit tests (tests/core.test.mjs)
//   2. The n8n "Classify credentials" Code node (see workflows/)
//   3. Anyone reading the repo who wants to understand the rules
//
// No LLM is involved. Dates are compared as calendar days, never as timestamps.

const MS_PER_DAY = 86400000;

const ENDORSEMENT_TYPES = ['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT'];
const DEFAULT_STAGES = [90, 60, 30, 14, 7, 0];

// ---------- Dates ----------

// Parses a strict YYYY-MM-DD string into a whole-day number (days since 1970-01-01).
// Rejects malformed strings and impossible dates such as 2026-02-30.
function parseCalendarDate(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { ok: false, reason: 'blank' };
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, reason: `malformed date "${s}" (expected YYYY-MM-DD)` };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return { ok: false, reason: `impossible calendar date "${s}"` };
  }
  return { ok: true, day: Math.round(ms / MS_PER_DAY), iso: s };
}

// Today's calendar date (YYYY-MM-DD) in the business timezone.
function todayInTimezone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// The fixed test date wins when set; otherwise use the real date in the business timezone.
function resolveReferenceDate(settings, now = new Date()) {
  const tz = settings.business_timezone || 'America/Los_Angeles';
  const fixed = settings.test_reference_date;
  if (fixed !== null && fixed !== undefined && String(fixed).trim() !== '') {
    const parsed = parseCalendarDate(fixed);
    if (!parsed.ok) throw new Error(`Settings.test_reference_date is invalid: ${parsed.reason}`);
    return { iso: parsed.iso, day: parsed.day, source: 'test_reference_date', timeZone: tz };
  }
  const iso = todayInTimezone(tz, now);
  return { iso, day: parseCalendarDate(iso).day, source: 'current_date', timeZone: tz };
}

// ---------- Policy ----------

function parseStages(value) {
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_STAGES.slice();
  const stages = String(value)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  return [...new Set(stages)].sort((a, b) => b - a);
}

// State is defined by the reminder policy table in the build brief.
function stateForDays(days) {
  if (days < 0) return 'overdue';
  if (days === 0) return 'expires_today';
  if (days <= 7) return 'critical';
  if (days <= 30) return 'urgent';
  if (days <= 90) return 'approaching_expiry';
  return 'current';
}

// Only the *current* applicable stage is returned; missed earlier stages are never replayed.
// Example with stages 90,60,30,14,7,0: 45 days left -> D60, 90 -> D90, 91 -> none.
function stageForDays(days, stages) {
  if (days < 0) return 'OVERDUE';
  const due = stages.filter((s) => s >= days);
  if (due.length === 0) return '';
  return `D${Math.min(...due)}`;
}

function actionFor(state, escalationPolicy) {
  const escalates = escalationPolicy !== 'none';
  switch (state) {
    case 'approaching_expiry':
    case 'urgent':
    case 'critical':
      return 'driver_reminder';
    case 'expires_today':
      return escalates ? 'driver_notice_and_staff_escalation' : 'driver_notice';
    case 'overdue':
      return escalates ? 'staff_escalation' : 'none';
    case 'missing':
    case 'invalid_date':
      return 'staff_review';
    default:
      return 'none';
  }
}

// ---------- Documents ----------

function isTrue(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

// Latest verified version of one document type for one driver (archived/pending rows ignored).
function latestVerified(documents, driverId, documentType) {
  return documents
    .filter((d) => d.driver_id === driverId && d.document_type === documentType && d.status === 'verified')
    .sort((a, b) => Number(b.version) - Number(a.version))[0];
}

// ---------- Classification ----------

function classifyAll({ settings, drivers, requirements, documents, now = new Date() }) {
  const ref = resolveReferenceDate(settings, now);
  const rows = [];

  for (const driver of drivers) {
    const active = isTrue(driver.active);
    const reqs = requirements.filter((r) => r.applicable_role === driver.role);

    if (reqs.length === 0) {
      rows.push(baseRow(ref, driver, { document_type: '*' }, {
        state: 'invalid_date',
        action: 'staff_review',
        reason: `no requirements configured for role "${driver.role}"`,
      }));
      continue;
    }

    for (const req of reqs) {
      if (!active) {
        rows.push(baseRow(ref, driver, req, { state: 'inactive_skipped', reason: 'driver is inactive' }));
        continue;
      }
      if (!isTrue(req.required)) {
        rows.push(baseRow(ref, driver, req, { state: 'not_applicable', reason: `not required for role ${driver.role}` }));
        continue;
      }

      const doc = latestVerified(documents, driver.driver_id, req.document_type);
      if (!doc) {
        rows.push(baseRow(ref, driver, req, {
          state: 'missing',
          action: actionFor('missing'),
          reason: 'required document has no verified version on file',
        }));
        continue;
      }

      // Endorsements may share the CDL expiration date. Never invent a date:
      // inherit only when the endorsement record is blank and a verified CDL exists.
      let expirationRaw = doc.expiration_date;
      let expirationSource = 'document';
      if ((expirationRaw === null || expirationRaw === undefined || String(expirationRaw).trim() === '') &&
          ENDORSEMENT_TYPES.includes(req.document_type)) {
        const cdl = latestVerified(documents, driver.driver_id, 'CDL');
        if (cdl) {
          expirationRaw = cdl.expiration_date;
          expirationSource = `inherited_from_cdl:${cdl.document_id}`;
        }
      }

      const exp = parseCalendarDate(expirationRaw);
      const docFields = {
        document_id: doc.document_id,
        document_version: Number(doc.version),
        expiration_date: expirationRaw === null || expirationRaw === undefined ? '' : String(expirationRaw),
        expiration_source: expirationSource,
      };

      if (!exp.ok) {
        rows.push(baseRow(ref, driver, req, {
          ...docFields,
          state: 'invalid_date',
          action: actionFor('invalid_date'),
          reason: exp.reason === 'blank' ? 'expiration date not provided' : exp.reason,
        }));
        continue;
      }

      const issue = parseCalendarDate(doc.issue_date);
      if (issue.ok && issue.day > exp.day) {
        rows.push(baseRow(ref, driver, req, {
          ...docFields,
          state: 'invalid_date',
          action: actionFor('invalid_date'),
          reason: `issue_date ${issue.iso} is after expiration_date ${exp.iso}`,
        }));
        continue;
      }

      const days = exp.day - ref.day;
      const state = stateForDays(days);
      const stage = state === 'current' ? '' : stageForDays(days, parseStages(req.reminder_stages));
      rows.push(baseRow(ref, driver, req, {
        ...docFields,
        days_remaining: days,
        state,
        reminder_stage: stage,
        action: actionFor(state, req.escalation_policy),
        reason: `${days} day(s) remaining as of ${ref.iso} (${ref.timeZone})`,
      }));
    }
  }
  return { reference: ref, rows };
}

function baseRow(ref, driver, req, fields) {
  return {
    reference_date: ref.iso,
    reference_source: ref.source,
    driver_id: driver.driver_id,
    full_name: driver.full_name,
    role: driver.role,
    active: isTrue(driver.active),
    requirement_id: req.requirement_id || '',
    document_type: req.document_type,
    document_id: '',
    document_version: null,
    expiration_date: '',
    expiration_source: '',
    days_remaining: null,
    state: '',
    reminder_stage: '',
    action: 'none',
    reason: '',
    // Phase 2 dedup key: driver_id + document_id + document_version + reminder_stage
    dedup_key: '',
    ...fields,
  };
}

function withDedupKeys(rows) {
  return rows.map((r) => ({
    ...r,
    dedup_key: r.reminder_stage && r.document_id
      ? `${r.driver_id}|${r.document_id}|${r.document_version}|${r.reminder_stage}`
      : '',
  }));
}

// Compares actual rows with expected rows keyed by driver_id + document_type.
function compareWithExpected(rows, expected) {
  const actualByKey = new Map(rows.map((r) => [`${r.driver_id}:${r.document_type}`, r]));
  const results = expected.map((e) => {
    const a = actualByKey.get(`${e.driver_id}:${e.document_type}`);
    const actualState = a ? a.state : '(no row)';
    const actualStage = a ? a.reminder_stage : '';
    const pass = actualState === e.expected_state && (actualStage || '') === (e.expected_stage || '');
    return {
      driver_id: e.driver_id,
      full_name: a ? a.full_name : '',
      document_type: e.document_type,
      primary_fixture: isTrue(e.primary_fixture),
      expected_state: e.expected_state,
      actual_state: actualState,
      expected_stage: e.expected_stage || '',
      actual_stage: actualStage || '',
      days_remaining: a ? a.days_remaining : null,
      pass,
    };
  });
  const expectedKeys = new Set(expected.map((e) => `${e.driver_id}:${e.document_type}`));
  const unexpected = rows.filter((r) => !expectedKeys.has(`${r.driver_id}:${r.document_type}`));
  const failed = results.filter((r) => !r.pass).length + unexpected.length;
  return { results, unexpected, total: results.length, passed: results.length - results.filter((r) => !r.pass).length, failed };
}

function summarize(rows) {
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  return counts;
}

/* n8n-export-start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCalendarDate,
    todayInTimezone,
    resolveReferenceDate,
    parseStages,
    stateForDays,
    stageForDays,
    actionFor,
    latestVerified,
    classifyAll,
    withDedupKeys,
    compareWithExpected,
    summarize,
  };
}
/* n8n-export-end */
