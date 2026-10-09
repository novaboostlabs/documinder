import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = require('../src/documinder-core.js');
const ren = require('../src/documinder-renewals.js');
const fx = JSON.parse(readFileSync(new URL('../data/fixtures/fixtures.json', import.meta.url)));
const settings = fx.settings[0];
const reviewers = [{ reviewer_email: 'compliance.reviewer@example.com', full_name: 'Pat Reviewer', active: true }];
const now = new Date('2026-10-15T17:00:00Z');

const submit = (submission, renewals = [], documents = fx.documents) =>
  ren.evaluateSubmission({ submission, settings, drivers: fx.drivers, requirements: fx.requirements, documents, renewals, now, renewalId: 'RN-1' });

const taylorTwic = { driver_id: 'D006', document_type: 'TWIC', submitted_expiration_date: '2031-10-22', submitted_file_url: 'https://files.example.com/documinder/D006/twic-v2.pdf' };

// Applies an approval plan to in-memory tables the same way the n8n workflow does.
function applyPlan(plan, documents, notifications) {
  const docs = documents.map((d) => (plan.archive && d.document_id === plan.archive.document_id && Number(d.version) === plan.archive.version ? { ...d, status: 'archived' } : d));
  if (plan.new_document) docs.push(plan.new_document);
  const closed = new Map((plan.notifications_to_close || []).map((n) => [n.notification_id, n]));
  return { documents: docs, notifications: notifications.map((n) => (closed.has(n.notification_id) ? { ...n, ...closed.get(n.notification_id) } : n)) };
}

test('a valid submission is stored as pending_review and records the current version', () => {
  const r = submit(taylorTwic);
  assert.equal(r.outcome, 'pending_review');
  assert.equal(r.renewal.status, 'pending_review');
  assert.equal(r.renewal.previous_expiration_date, '2026-10-22');
});

test('a second submission for the same document returns the open one', () => {
  const first = submit(taylorTwic).renewal;
  const again = submit(taylorTwic, [first]);
  assert.equal(again.outcome, 'duplicate');
  assert.equal(again.store, false);
});

test('invalid submissions are recorded with reasons, never queued for review', () => {
  assert.match(submit({ ...taylorTwic, submitted_expiration_date: '2031-02-30' }).renewal.rejection_reason, /impossible calendar date/);
  assert.match(submit({ ...taylorTwic, submitted_expiration_date: '2026-10-01' }).renewal.rejection_reason, /not after today/);
  assert.match(submit({ ...taylorTwic, driver_id: 'D009' }).renewal.rejection_reason, /inactive/);
  assert.match(submit({ ...taylorTwic, driver_id: 'D010', document_type: 'HAZMAT_ENDORSEMENT' }).renewal.rejection_reason, /not required/);
  assert.match(submit({ ...taylorTwic, submitted_file_url: '' }).renewal.rejection_reason, /link/);
  assert.equal(submit({ ...taylorTwic, submitted_file_url: '' }).renewal.status, 'invalid_submission');
});

test('a renewal must extend the current expiration', () => {
  const r = submit({ driver_id: 'D001', document_type: 'CDL', submitted_expiration_date: '2027-01-01', submitted_file_url: 'https://files.example.com/x.pdf' });
  assert.match(r.renewal.rejection_reason, /does not extend/);
});

const review = (renewal, extra = {}, notifications = [], staffReview = [], documents = fx.documents) =>
  ren.evaluateReview({
    review: { renewal_id: renewal.renewal_id, reviewer_email: 'Compliance.Reviewer@example.com', decision: 'approve', rejection_reason: '', ...extra },
    settings, reviewers, renewals: [renewal], documents, notifications, staffReview, now,
  });

test('approval creates a new verified version without destroying history (Phase 4 exit check, part 1)', () => {
  const renewal = submit(taylorTwic).renewal;
  const oldDoc = core.latestVerified(fx.documents, 'D006', 'TWIC');
  const notifications = [
    { notification_id: 'N1', document_id: oldDoc.document_id, document_version: oldDoc.version, status: 'uncertain', closed_at: '' },
    { notification_id: 'N2', document_id: 'DOC9999', document_version: 1, status: 'sent', closed_at: '' },
  ];
  const staffReview = [{ review_key: 'delivery|N1', notification_id: 'N1', status: 'open', category: 'delivery_uncertain', driver_id: 'D006', document_type: 'TWIC' }];
  const plan = review(renewal, {}, notifications, staffReview);
  assert.equal(plan.action, 'approve');

  const after = applyPlan(plan, fx.documents, notifications);
  assert.equal(after.documents.length, fx.documents.length + 1, 'one row added, none removed');
  const versions = after.documents.filter((d) => d.driver_id === 'D006' && d.document_type === 'TWIC');
  assert.deepEqual(versions.map((d) => [d.version, d.status, d.expiration_date]), [[1, 'archived', '2026-10-22'], [2, 'verified', '2031-10-22']]);
  assert.equal(core.latestVerified(after.documents, 'D006', 'TWIC').expiration_date, '2031-10-22');

  assert.equal(after.notifications.find((n) => n.notification_id === 'N1').status, 'uncertain', 'delivery status kept');
  assert.match(after.notifications.find((n) => n.notification_id === 'N1').closed_reason, /superseded by renewal RN-1/);
  assert.equal(after.notifications.find((n) => n.notification_id === 'N2').closed_at, '', 'other documents untouched');
  assert.deepEqual(plan.review_items_to_resolve.map((r) => r.review_key), ['delivery|N1']);
});

test('after approval the daily review sees the renewed document as current', () => {
  const plan = review(submit(taylorTwic).renewal);
  const after = applyPlan(plan, fx.documents, []);
  const { rows } = core.classifyAll({ settings, drivers: fx.drivers, requirements: fx.requirements, documents: after.documents });
  const taylor = rows.find((r) => r.driver_id === 'D006' && r.document_type === 'TWIC');
  assert.equal(taylor.state, 'current');
  assert.equal(taylor.document_version, 2);
});

test('rejection changes no verified expiration date (Phase 4 exit check, part 2)', () => {
  const plan = review(submit(taylorTwic).renewal, { decision: 'reject', rejection_reason: 'Card image unreadable' });
  assert.equal(plan.action, 'reject');
  assert.equal(plan.new_document, undefined);
  assert.equal(plan.archive, undefined);
  assert.equal(plan.renewal_update.rejection_reason, 'Card image unreadable');
});

test('reviews are refused when unsafe', () => {
  const renewal = submit(taylorTwic).renewal;
  assert.equal(review(renewal, { reviewer_email: 'random.person@example.com' }).action, 'refuse');
  assert.equal(review(renewal, { decision: 'reject', rejection_reason: '' }).action, 'refuse');
  assert.equal(review(renewal, { decision: 'maybe' }).action, 'refuse');
  assert.equal(review({ ...renewal, status: 'approved', reviewed_by: 'x@example.com' }).action, 'refuse', 'cannot approve twice');
  assert.match(review({ ...renewal, renewal_id: 'RN-1' }, { renewal_id: 'RN-404' }).message, /not found/);
});

test('approving a renewal for a missing document creates version 1', () => {
  const renewal = submit({ driver_id: 'D011', document_type: 'TWIC', submitted_expiration_date: '2031-05-01', submitted_file_url: 'https://files.example.com/d011-twic.pdf' }).renewal;
  assert.equal(renewal.status, 'pending_review');
  const plan = review(renewal, {}, [], [{ review_key: 'data|missing|D011|TWIC||', status: 'open', category: 'missing_document', driver_id: 'D011', document_type: 'TWIC', notification_id: '' }]);
  assert.equal(plan.archive, null);
  assert.equal(plan.new_document.version, 1);
  assert.equal(plan.new_document.document_id, 'DOC-RN-1');
  assert.equal(plan.review_items_to_resolve.length, 1);
});
