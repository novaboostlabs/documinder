// Documinder renewals — Phase 4: renewal intake and review (Workflow B).
// Deterministic, no LLM. Uses parseCalendarDate / resolveReferenceDate / latestVerified
// from documinder-core.js (in n8n the two files are concatenated into one Code node).
//
// History is never destroyed: approval archives the old version and adds a new one;
// rejection leaves every document row untouched.

/* n8n-strip-start */
const { parseCalendarDate, resolveReferenceDate, latestVerified } = require('./documinder-core.js');
/* n8n-strip-end */

const isTrueValue = (v) => v === true || v === 'true' || v === 1 || v === '1';
const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

// ---------- Intake ----------

// Decides what to do with one renewal submission:
//   pending_review    -> store it for a reviewer
//   invalid_submission-> store it with the reason (audit trail), nothing to review
//   duplicate         -> an open submission already exists; return it, store nothing
function evaluateSubmission({ submission, settings, drivers, requirements, documents, renewals, now = new Date(), renewalId }) {
  const driverId = clean(submission.driver_id).toUpperCase();
  const documentType = clean(submission.document_type).toUpperCase();
  const expRaw = clean(submission.submitted_expiration_date);
  const fileUrl = clean(submission.submitted_file_url);
  const ref = resolveReferenceDate(settings, now);

  const base = {
    renewal_id: renewalId,
    driver_id: driverId,
    document_type: documentType,
    submitted_expiration_date: expRaw,
    submitted_file_url: fileUrl,
    submitted_at: now.toISOString(),
    reviewed_at: '',
    reviewed_by: '',
    rejection_reason: '',
    previous_document_id: '',
    previous_version: null,
    previous_expiration_date: '',
    new_document_id: '',
    new_version: null,
  };

  const open = renewals.find((r) => r.driver_id === driverId && r.document_type === documentType && r.status === 'pending_review');
  if (open) {
    return { outcome: 'duplicate', store: false, renewal: open, message: `Renewal ${open.renewal_id} is already waiting for review; no new submission created.` };
  }

  const problems = [];
  const driver = drivers.find((d) => d.driver_id === driverId);
  if (!driver) problems.push(`unknown driver "${driverId}"`);
  else if (!isTrueValue(driver.active)) problems.push(`driver ${driverId} is inactive`);

  if (driver) {
    const req = requirements.find((r) => r.applicable_role === driver.role && r.document_type === documentType);
    if (!req) problems.push(`${documentType} is not a tracked document type for role ${driver.role}`);
    else if (!isTrueValue(req.required)) problems.push(`${documentType} is not required for role ${driver.role}`);
  }

  const exp = parseCalendarDate(expRaw);
  if (!exp.ok) problems.push(exp.reason === 'blank' ? 'expiration date is missing' : exp.reason);
  else if (exp.day <= ref.day) problems.push(`expiration ${exp.iso} is not after today (${ref.iso})`);

  const current = driver ? latestVerified(documents, driverId, documentType) : undefined;
  if (exp.ok && current) {
    const cur = parseCalendarDate(current.expiration_date);
    if (cur.ok && exp.day <= cur.day) problems.push(`expiration ${exp.iso} does not extend the current verified date ${cur.iso}`);
  }

  if (!/^https?:\/\/\S+$/i.test(fileUrl)) problems.push('a link to the renewed document (http/https) is required');

  if (problems.length) {
    return {
      outcome: 'invalid_submission',
      store: true,
      renewal: { ...base, status: 'invalid_submission', rejection_reason: problems.join('; ') },
      message: `Submission not accepted: ${problems.join('; ')}.`,
    };
  }
  return {
    outcome: 'pending_review',
    store: true,
    renewal: {
      ...base,
      status: 'pending_review',
      previous_document_id: current ? current.document_id : '',
      previous_version: current ? Number(current.version) : null,
      previous_expiration_date: current ? clean(current.expiration_date) : '',
    },
    message: `Renewal ${renewalId} received and waiting for compliance review. The verified record is unchanged until it is approved.`,
  };
}

// ---------- Review ----------

// Decides one review. Returns a plan the workflow executes:
//   refuse  -> nothing changes (not found, already reviewed, unauthorized, missing reason)
//   reject  -> renewal row updated only
//   approve -> archive old version, insert new verified version, update renewal,
//              close old-version notifications, resolve related staff-review items
function evaluateReview({ review, settings, reviewers, renewals, documents, notifications, staffReview, now = new Date() }) {
  const renewalId = clean(review.renewal_id).toUpperCase();
  const reviewerEmail = clean(review.reviewer_email).toLowerCase();
  const decision = clean(review.decision).toLowerCase();
  const reason = clean(review.rejection_reason);
  const refuse = (message) => ({ action: 'refuse', message, renewal_id: renewalId });

  const renewal = renewals.find((r) => clean(r.renewal_id).toUpperCase() === renewalId);
  if (!renewal) return refuse(`Renewal ${renewalId} was not found.`);
  if (renewal.status !== 'pending_review') {
    return refuse(`Renewal ${renewalId} is ${renewal.status}${renewal.reviewed_by ? ` (by ${renewal.reviewed_by})` : ''}; it can only be reviewed once.`);
  }
  const reviewer = reviewers.find((r) => clean(r.reviewer_email).toLowerCase() === reviewerEmail && isTrueValue(r.active));
  if (!reviewer) return refuse(`${reviewerEmail || 'This reviewer'} is not an authorized reviewer.`);
  if (decision !== 'approve' && decision !== 'reject') return refuse('Decision must be approve or reject.');

  const reviewedAt = now.toISOString();
  if (decision === 'reject') {
    if (!reason) return refuse('A rejection needs a reason so the driver knows what to fix.');
    return {
      action: 'reject',
      renewal_id: renewalId,
      renewal_update: { status: 'rejected', reviewed_at: reviewedAt, reviewed_by: reviewerEmail, rejection_reason: reason },
      message: `Renewal ${renewalId} rejected: ${reason.replace(/[.\s]+$/, '')}. The verified document was not changed.`,
    };
  }

  // Approve: re-check against the documents as they are now, not as they were at submission.
  const exp = parseCalendarDate(renewal.submitted_expiration_date);
  if (!exp.ok) return refuse(`Submitted expiration date is invalid: ${exp.reason}.`);
  const current = latestVerified(documents, renewal.driver_id, renewal.document_type);
  if (current) {
    const cur = parseCalendarDate(current.expiration_date);
    if (cur.ok && exp.day <= cur.day) return refuse(`Submitted date ${exp.iso} no longer extends the verified date ${cur.iso}.`);
  }
  const versions = documents
    .filter((d) => d.driver_id === renewal.driver_id && d.document_type === renewal.document_type)
    .map((d) => Number(d.version) || 0);
  const newVersion = (versions.length ? Math.max(...versions) : 0) + 1;
  const documentId = current ? current.document_id : `DOC-${renewalId}`;
  const ref = resolveReferenceDate(settings, now);

  const newDocument = {
    document_id: documentId,
    driver_id: renewal.driver_id,
    document_type: renewal.document_type,
    version: newVersion,
    issue_date: ref.iso,
    expiration_date: exp.iso,
    status: 'verified',
    source_file_url: renewal.submitted_file_url,
    verified_at: reviewedAt,
    verified_by: reviewerEmail,
  };

  const closedReason = `superseded by renewal ${renewalId} (v${newVersion})`;
  const notificationsToClose = current
    ? notifications
        .filter((n) => n.document_id === current.document_id && Number(n.document_version) === Number(current.version) && !clean(n.closed_at))
        .map((n) => ({ notification_id: n.notification_id, closed_at: reviewedAt, closed_reason: closedReason }))
    : [];
  const closedIds = new Set(notificationsToClose.map((n) => n.notification_id));
  const reviewItemsToResolve = staffReview
    .filter((s) => s.status === 'open' && (closedIds.has(s.notification_id) ||
      (s.driver_id === renewal.driver_id && s.document_type === renewal.document_type && (s.category === 'missing_document' || s.category === 'invalid_date'))))
    .map((s) => ({ review_key: s.review_key, status: 'resolved', resolved_at: reviewedAt, resolution: closedReason }));

  return {
    action: 'approve',
    renewal_id: renewalId,
    archive: current ? { document_id: current.document_id, version: Number(current.version) } : null,
    new_document: newDocument,
    renewal_update: {
      status: 'approved',
      reviewed_at: reviewedAt,
      reviewed_by: reviewerEmail,
      rejection_reason: '',
      new_document_id: documentId,
      new_version: newVersion,
    },
    notifications_to_close: notificationsToClose,
    review_items_to_resolve: reviewItemsToResolve,
    message: `Renewal ${renewalId} approved: ${renewal.document_type} for ${renewal.driver_id} is now v${newVersion}, expiring ${exp.iso}.` +
      (current ? ` v${current.version} archived; ${notificationsToClose.length} reminder(s) closed.` : ' First verified version on file.'),
  };
}

/* n8n-export-start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateSubmission, evaluateReview };
}
/* n8n-export-end */
