// Run: npm test   (uses Node's built-in test runner; no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = require('../src/documinder-core.js');
const fixtures = JSON.parse(readFileSync(new URL('../data/fixtures/fixtures.json', import.meta.url)));

const run = () =>
  core.classifyAll({
    settings: fixtures.settings[0],
    drivers: fixtures.drivers,
    requirements: fixtures.requirements,
    documents: fixtures.documents,
  });

test('every fixture matches its expected classification (Phase 1 exit check)', () => {
  const { rows } = run();
  const report = core.compareWithExpected(rows, fixtures.expected_phase1);
  const failures = report.results.filter((r) => !r.pass);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  assert.deepEqual(report.unexpected, []);
  assert.equal(report.passed, fixtures.expected_phase1.length);
});

test('repeated runs are identical', () => {
  assert.deepEqual(run(), run());
});

test('the fixed reference date beats the real clock', () => {
  const ref = core.resolveReferenceDate({ business_timezone: 'America/Los_Angeles', test_reference_date: '2026-10-15' }, new Date('2030-01-01T00:00:00Z'));
  assert.equal(ref.iso, '2026-10-15');
});

test('current date is computed in the business timezone, not UTC', () => {
  // 2026-10-16 03:00 UTC is still 2026-10-15 in Los Angeles.
  const ref = core.resolveReferenceDate({ business_timezone: 'America/Los_Angeles', test_reference_date: '' }, new Date('2026-10-16T03:00:00Z'));
  assert.equal(ref.iso, '2026-10-15');
});

test('impossible and malformed dates are rejected', () => {
  assert.equal(core.parseCalendarDate('2026-02-30').ok, false);
  assert.equal(core.parseCalendarDate('10/15/2026').ok, false);
  assert.equal(core.parseCalendarDate('').ok, false);
  assert.equal(core.parseCalendarDate('2028-02-29').ok, true);
});

test('only the current applicable stage is due; missed stages are not replayed', () => {
  const stages = core.parseStages('90,60,30,14,7,0');
  assert.equal(core.stageForDays(91, stages), '');
  assert.equal(core.stageForDays(90, stages), 'D90');
  assert.equal(core.stageForDays(45, stages), 'D60');
  assert.equal(core.stageForDays(20, stages), 'D30');
  assert.equal(core.stageForDays(3, stages), 'D7');
  assert.equal(core.stageForDays(0, stages), 'D0');
  assert.equal(core.stageForDays(-5, stages), 'OVERDUE');
});

test('endorsements without their own date inherit the CDL date and say so', () => {
  const { rows } = run();
  const casey = rows.find((r) => r.driver_id === 'D007' && r.document_type === 'TANKER_ENDORSEMENT');
  assert.equal(casey.expiration_date, '2026-10-15');
  assert.match(casey.expiration_source, /^inherited_from_cdl:/);
  const renee = rows.find((r) => r.driver_id === 'D004' && r.document_type === 'HAZMAT_ENDORSEMENT');
  assert.equal(renee.expiration_source, 'document');
});

test('archived versions are ignored in favor of the latest verified version', () => {
  const { rows } = run();
  const jordan = rows.find((r) => r.driver_id === 'D002' && r.document_type === 'MEDICAL_CERT');
  assert.equal(jordan.document_version, 2);
  assert.equal(jordan.days_remaining, 90);
});

test('not required is different from missing', () => {
  const { rows } = run();
  assert.equal(rows.find((r) => r.driver_id === 'D010' && r.document_type === 'HAZMAT_ENDORSEMENT').state, 'not_applicable');
  assert.equal(rows.find((r) => r.driver_id === 'D011' && r.document_type === 'TWIC').state, 'missing');
});

test('dedup keys follow driver_id|document_id|document_version|reminder_stage', () => {
  const rows = core.withDedupKeys(run().rows);
  const jordan = rows.find((r) => r.driver_id === 'D002' && r.document_type === 'MEDICAL_CERT');
  assert.match(jordan.dedup_key, /^D002\|DOC\d{4}\|2\|D90$/);
  assert.equal(rows.find((r) => r.state === 'current').dedup_key, '');
});
