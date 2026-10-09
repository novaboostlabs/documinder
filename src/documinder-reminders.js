// Documinder reminders — Phase 2: compose preview reminders and deduplicate them
// against notification history. Deterministic templates, no LLM.
//
// Runs in Node tests (tests/reminders.test.mjs) and in the n8n
// "Plan Reminders (dedup)" Code node (embedded by scripts/build-workflow.mjs).

// Statuses that mean "this reminder already went out, or may have": never create another.
//   pending   = recorded before the send; if a run dies mid-send it stays pending (treated as uncertain)
//   previewed = composed without a provider (Phase 2 dry runs)
// A 'failed' attempt does not block, so it can be retried. 'closed' belongs to a superseded version.
const BLOCKING_STATUSES = ['pending', 'previewed', 'sent', 'uncertain'];

const DOCUMENT_LABELS = {
  CDL: 'Commercial Driver\'s License (CDL)',
  MEDICAL_CERT: 'Medical Examiner\'s Certificate',
  TWIC: 'TWIC card',
  HAZMAT_ENDORSEMENT: 'Hazmat endorsement',
  TANKER_ENDORSEMENT: 'Tanker endorsement',
  DOUBLES_TRIPLES_ENDORSEMENT: 'Doubles/triples endorsement',
  SAFETY_TRAINING: 'Defensive-driving / safety training',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function whenPhrase(days) {
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  return `${-days} day${days === -1 ? '' : 's'} ago`;
}

// Who the reminder is meant for, by stage. Overdue goes to staff only (no repeated driver emails).
function audienceFor(stage) {
  if (stage === 'OVERDUE') return 'staff';
  if (stage === 'D0') return 'driver_and_staff';
  return 'driver';
}

function composeReminder(row, driver, settings) {
  const label = DOCUMENT_LABELS[row.document_type] || row.document_type;
  const audience = audienceFor(row.reminder_stage);
  const when = whenPhrase(row.days_remaining);
  const expires = formatDate(row.expiration_date);
  const inherited = String(row.expiration_source || '').startsWith('inherited_from_cdl')
    ? ' (this endorsement shares your CDL expiration date)'
    : '';

  const recipients = [];
  if (audience !== 'staff') recipients.push(driver.email);
  if (audience !== 'driver') recipients.push(driver.manager_email);

  let subject;
  let lines;
  if (audience === 'staff') {
    subject = `Staff escalation: ${driver.full_name}'s ${label} expired ${when}`;
    lines = [
      `${driver.full_name} (${driver.driver_id}) has an expired ${label}.`,
      `Expiration date: ${expires}${inherited}.`,
      'Please follow up with the driver and record a renewal. Documinder will not keep emailing the driver about this.',
    ];
  } else {
    const urgency = { D90: 'Heads-up', D60: 'Reminder', D30: 'Action needed', D14: 'Action needed', D7: 'Final reminder', D0: 'Expires today' }[row.reminder_stage] || 'Reminder';
    subject = row.reminder_stage === 'D0'
      ? `Expires today: your ${label}`
      : `${urgency}: your ${label} expires ${when}`;
    lines = [
      `Hi ${driver.full_name.split(' ')[0]},`,
      `Your ${label} expires ${when}, on ${expires}${inherited}.`,
      'Please submit your renewed document so the compliance team can verify it.',
    ];
    if (audience === 'driver_and_staff') lines.push(`Your manager (${driver.manager_email}) has been copied.`);
  }

  return { audience, recipients, subject, body: lines.join('\n\n') };
}

// Decides, for every row with a due reminder stage, whether to create a new preview
// notification or skip it because a blocking attempt already exists.
// simulations: optional [{ driver_id, document_type, outcome: 'failure' | 'timeout' }] used to force a
// provider outcome in tests. Ignored unless preview_only is on, so it can never affect live sends.
function planNotifications({ rows, drivers, settings, history, simulations = [], now = new Date(), runId = 'local' }) {
  const previewOnly = settings.preview_only === true || settings.preview_only === 'true';
  if (previewOnly && !String(settings.test_recipient || '').trim()) {
    throw new Error('preview_only is on but Settings.test_recipient is empty; refusing to address any reminder.');
  }

  const blocked = new Set(
    history
      .filter((n) => n && n.dedup_key && BLOCKING_STATUSES.includes(n.status))
      .map((n) => n.dedup_key),
  );
  const driversById = new Map(drivers.map((d) => [d.driver_id, d]));
  const simulationFor = (row) => {
    if (!previewOnly) return '';
    const sim = simulations.find((x) => x && x.driver_id === row.driver_id && x.document_type === row.document_type);
    return sim ? sim.outcome : '';
  };
  const attemptedAt = now.toISOString();
  const plans = [];
  let seq = 0;

  for (const row of rows) {
    if (!row.reminder_stage || !row.dedup_key) continue;
    const driver = driversById.get(row.driver_id);
    const base = {
      dedup_key: row.dedup_key,
      driver_id: row.driver_id,
      full_name: row.full_name,
      document_id: row.document_id,
      document_type: row.document_type,
      document_version: row.document_version,
      reminder_stage: row.reminder_stage,
      days_remaining: row.days_remaining,
    };

    if (blocked.has(row.dedup_key)) {
      plans.push({ ...base, decision: 'skip_duplicate' });
      continue;
    }
    blocked.add(row.dedup_key); // never plan the same key twice in one run

    const msg = composeReminder(row, driver, settings);
    const intended = msg.recipients.join(', ');
    seq += 1;
    plans.push({
      ...base,
      decision: 'create',
      notification: {
        notification_id: `NTF-${runId}-${String(seq).padStart(3, '0')}`,
        driver_id: row.driver_id,
        document_id: row.document_id,
        document_version: row.document_version,
        reminder_stage: row.reminder_stage,
        dedup_key: row.dedup_key,
        audience: msg.audience,
        intended_recipient: intended,
        delivered_to: previewOnly ? settings.test_recipient : intended,
        delivery_mode: previewOnly ? 'preview' : 'live',
        subject: (previewOnly ? `[PREVIEW for ${intended}] ` : '') + msg.subject,
        body: msg.body,
        from_name: settings.reminder_from_name || 'Documinder',
        simulated_outcome: simulationFor(row),
        provider_message_id: '',
        status: 'pending',
        attempted_at: attemptedAt,
        error_detail: '',
      },
    });
  }
  return plans;
}

function summarizePlans(plans) {
  const created = plans.filter((p) => p.decision === 'create');
  return {
    reminders_due: plans.length,
    created: created.length,
    skipped_duplicates: plans.length - created.length,
    created_by_stage: created.reduce((acc, p) => ({ ...acc, [p.reminder_stage]: (acc[p.reminder_stage] || 0) + 1 }), {}),
  };
}

/* n8n-export-start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BLOCKING_STATUSES, composeReminder, planNotifications, summarizePlans, formatDate, whenPhrase };
}
/* n8n-export-end */
