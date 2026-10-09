// Documinder delivery — Phase 3: interpret provider outcomes and build the staff-review queue.
// Deterministic, no LLM. Runs in Node tests (tests/delivery.test.mjs) and in the n8n
// "Interpret Provider Result" and "Build Staff Review Items" Code nodes.

// Errors that prove the message was NOT accepted: safe to mark failed (and retry later).
const DEFINITE_FAILURE = [
  /\b5\d\d\b/, // permanent SMTP rejection, e.g. 550 mailbox unavailable
  /\b4\d\d\b/, // temporary SMTP rejection, e.g. 421/451: provider refused before accepting
  /EAUTH|Invalid login|authentication/i, // credentials rejected before anything was sent
  /EENVELOPE|No recipients defined|recipient.*rejected/i,
  /ECONNREFUSED|ENOTFOUND/i, // never connected
];

// Errors where the message may or may not have gone out: never auto-retry.
const UNCERTAIN = [/timeout|timed out|ETIMEDOUT|ESOCKET|ECONNRESET|socket hang up|EPIPE|connection closed/i];

// Maps one provider response (SMTP node success output, error output, or a simulation)
// to the status we record. Anything we cannot positively classify is 'uncertain'.
function interpretProviderResult(response) {
  const r = response || {};
  const err = r.error;
  if (err) {
    const text = [err.code, err.responseCode, err.message, err.description, typeof err === 'string' ? err : '']
      .filter(Boolean).join(' ').trim() || 'unknown provider error';
    if (UNCERTAIN.some((re) => re.test(text))) {
      return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain: ${text}` };
    }
    if (DEFINITE_FAILURE.some((re) => re.test(text))) {
      return { status: 'failed', provider_message_id: '', error_detail: `failed: ${text}` };
    }
    return { status: 'uncertain', provider_message_id: '', error_detail: `uncertain (unrecognized error): ${text}` };
  }

  const accepted = Array.isArray(r.accepted) ? r.accepted : [];
  const rejected = Array.isArray(r.rejected) ? r.rejected : [];
  if (r.messageId && accepted.length > 0 && rejected.length === 0) {
    return { status: 'sent', provider_message_id: String(r.messageId), error_detail: '' };
  }
  if (accepted.length === 0 && rejected.length > 0) {
    return { status: 'failed', provider_message_id: String(r.messageId || ''), error_detail: `failed: provider rejected ${rejected.join(', ')}` };
  }
  return {
    status: 'uncertain',
    provider_message_id: String(r.messageId || ''),
    error_detail: `uncertain: unexpected provider response ${JSON.stringify({ messageId: r.messageId, accepted, rejected, response: r.response }).slice(0, 300)}`,
  };
}

// Simulated provider responses, used only while preview_only is on.
function simulatedResponse(outcome) {
  if (outcome === 'failure') {
    return { error: { code: 'EENVELOPE', responseCode: 550, message: '550 5.1.1 Recipient address rejected: mailbox unavailable (simulated)' } };
  }
  if (outcome === 'timeout') {
    return { error: { code: 'ETIMEDOUT', message: 'Connection timeout after 30000ms (simulated)' } };
  }
  return { error: { message: `unknown simulation "${outcome}"` } };
}

const RECOMMENDED_ACTION = {
  delivery_failed: 'Provider rejected the message. Check the address or provider error; the next run retries automatically.',
  delivery_uncertain: 'Delivery unknown. Check the inbox or provider logs before doing anything; Documinder will NOT resend. Then mark the notification sent or failed.',
  delivery_stuck_pending: 'An earlier run recorded this reminder but never recorded a provider result. Treat as uncertain: confirm before resending.',
  missing_document: 'Collect and verify the required document.',
  invalid_date: 'Correct the expiration date in the source record.',
};

// New staff-review items for this run. Each item has a stable review_key, so a problem that
// persists across daily runs is queued once, not every day.
function buildStaffReviewItems({ rows, deliveries, history, existingKeys, runStartedAt, now = new Date() }) {
  const existing = new Set(existingKeys);
  const items = [];
  const add = (item) => {
    if (existing.has(item.review_key)) return;
    existing.add(item.review_key);
    items.push({ created_at: now.toISOString(), status: 'open', recommended_action: RECOMMENDED_ACTION[item.category], ...item });
  };

  for (const d of deliveries) {
    if (d.status !== 'failed' && d.status !== 'uncertain') continue;
    add({
      review_key: `delivery|${d.notification_id}`,
      category: d.status === 'failed' ? 'delivery_failed' : 'delivery_uncertain',
      severity: d.status === 'failed' ? 'medium' : 'high',
      driver_id: d.driver_id,
      document_type: d.document_type || '',
      notification_id: d.notification_id,
      dedup_key: d.dedup_key,
      detail: d.error_detail,
    });
  }

  // A 'pending' row from an earlier run means the run stopped between recording and confirming.
  for (const n of history) {
    if (n.status !== 'pending' || (runStartedAt && n.attempted_at >= runStartedAt)) continue;
    add({
      review_key: `delivery|${n.notification_id}`,
      category: 'delivery_stuck_pending',
      severity: 'high',
      driver_id: n.driver_id,
      document_type: '',
      notification_id: n.notification_id,
      dedup_key: n.dedup_key,
      detail: `notification still pending since ${n.attempted_at}`,
    });
  }

  for (const r of rows) {
    if (r.state !== 'missing' && r.state !== 'invalid_date') continue;
    add({
      review_key: `data|${r.state}|${r.driver_id}|${r.document_type}|${r.document_id || ''}|${r.expiration_date || ''}`,
      category: r.state === 'missing' ? 'missing_document' : 'invalid_date',
      severity: 'medium',
      driver_id: r.driver_id,
      document_type: r.document_type,
      notification_id: '',
      dedup_key: '',
      detail: r.reason,
    });
  }
  return items;
}

/* n8n-export-start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { interpretProviderResult, simulatedResponse, buildStaffReviewItems, RECOMMENDED_ACTION };
}
/* n8n-export-end */
