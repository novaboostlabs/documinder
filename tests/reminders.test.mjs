import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = require('../src/documinder-core.js');
const rem = require('../src/documinder-reminders.js');
const fixtures = JSON.parse(readFileSync(new URL('../data/fixtures/fixtures.json', import.meta.url)));
const settings = fixtures.settings[0];
const rows = core.withDedupKeys(core.classifyAll({ settings, drivers: fixtures.drivers, requirements: fixtures.requirements, documents: fixtures.documents }).rows);
const now = new Date('2026-10-15T15:00:00Z');
const plan = (history, runId = 'r1') => rem.planNotifications({ rows, drivers: fixtures.drivers, settings, history, now, runId });

test('first run creates one preview per due stage (Phase 2 exit check, part 1)', () => {
  const plans = plan([]);
  const s = rem.summarizePlans(plans);
  // 7 primary stages + Casey Brooks's 2 inherited endorsements (D0)
  assert.equal(s.reminders_due, 9);
  assert.equal(s.created, 9);
  assert.deepEqual(s.created_by_stage, { D90: 1, D60: 1, D30: 1, D14: 1, D7: 1, D0: 3, OVERDUE: 1 });
});

test('second identical run creates zero duplicates (Phase 2 exit check, part 2)', () => {
  const history = plan([]).map((p) => p.notification);
  const s = rem.summarizePlans(plan(history, 'r2'));
  assert.equal(s.created, 0);
  assert.equal(s.skipped_duplicates, 9);
});

test('uncertain blocks a resend; failed allows a retry', () => {
  const first = plan([]).map((p) => p.notification);
  const uncertain = first.map((n) => ({ ...n, status: 'uncertain' }));
  assert.equal(rem.summarizePlans(plan(uncertain)).created, 0);
  const failed = first.map((n) => ({ ...n, status: 'failed' }));
  assert.equal(rem.summarizePlans(plan(failed)).created, 9);
});

test('a new document version starts a fresh reminder cycle', () => {
  const history = plan([]).map((p) => p.notification).map((n) => ({ ...n, dedup_key: n.dedup_key.replace(/\|(\d+)\|/, '|99|') }));
  assert.equal(rem.summarizePlans(plan(history)).created, 9);
});

test('preview mode sends everything to the test inbox only', () => {
  for (const p of plan([])) {
    assert.equal(p.notification.delivered_to, settings.test_recipient);
    assert.equal(p.notification.delivery_mode, 'preview');
    assert.match(p.notification.subject, /^\[PREVIEW for /);
  }
});

test('preview mode refuses to run without a test inbox', () => {
  assert.throws(() => rem.planNotifications({ rows, drivers: fixtures.drivers, settings: { ...settings, test_recipient: '' }, history: [] }));
});

test('audience follows the reminder policy', () => {
  const byStage = Object.fromEntries(plan([]).map((p) => [p.reminder_stage + ':' + p.document_type, p.notification]));
  assert.equal(byStage['D90:MEDICAL_CERT'].audience, 'driver');
  assert.equal(byStage['D0:CDL'].audience, 'driver_and_staff');
  assert.match(byStage['D0:CDL'].intended_recipient, /casey\.brooks@example\.com, ops\.manager@example\.com/);
  assert.equal(byStage['OVERDUE:MEDICAL_CERT'].audience, 'staff');
  assert.equal(byStage['OVERDUE:MEDICAL_CERT'].intended_recipient, 'ops.manager@example.com');
});

test('reminder text is specific and deterministic', () => {
  const jordan = plan([]).find((p) => p.driver_id === 'D002').notification;
  assert.match(jordan.subject, /Heads-up: your Medical Examiner's Certificate expires in 90 days$/);
  assert.match(jordan.body, /on January 13, 2027/);
  assert.deepEqual(plan([])[0].notification.body, plan([])[0].notification.body);
});
