import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const del = require('../src/documinder-delivery.js');

test('accepted message with an id is sent', () => {
  const r = del.interpretProviderResult({ messageId: '<abc@gmail.com>', accepted: ['x@example.com'], rejected: [], response: '250 2.0.0 OK' });
  assert.equal(r.status, 'sent');
  assert.equal(r.provider_message_id, '<abc@gmail.com>');
});

test('simulated failure and timeout are handled differently (Phase 3 exit check)', () => {
  const failed = del.interpretProviderResult(del.simulatedResponse('failure'));
  const timeout = del.interpretProviderResult(del.simulatedResponse('timeout'));
  assert.equal(failed.status, 'failed');
  assert.equal(timeout.status, 'uncertain');
  assert.notEqual(failed.status, timeout.status);
});

test('real SMTP error shapes classify correctly', () => {
  assert.equal(del.interpretProviderResult({ error: { message: 'Invalid login: 535-5.7.8 Username and Password not accepted', code: 'EAUTH' } }).status, 'failed');
  assert.equal(del.interpretProviderResult({ error: { message: 'Connection closed unexpectedly' } }).status, 'uncertain');
  assert.equal(del.interpretProviderResult({ error: { message: 'socket hang up', code: 'ECONNRESET' } }).status, 'uncertain');
  assert.equal(del.interpretProviderResult({ error: { message: 'connect ECONNREFUSED 127.0.0.1:465', code: 'ECONNREFUSED' } }).status, 'failed');
});

test('anything unrecognized is uncertain, never assumed safe', () => {
  assert.equal(del.interpretProviderResult({ error: { message: 'something odd happened' } }).status, 'uncertain');
  assert.equal(del.interpretProviderResult({}).status, 'uncertain');
  assert.equal(del.interpretProviderResult({ messageId: '<x>', accepted: [], rejected: [] }).status, 'uncertain');
  assert.equal(del.interpretProviderResult({ messageId: '<x>', accepted: [], rejected: ['a@example.com'] }).status, 'failed');
});

test('staff review queues failures, uncertain sends, stuck pendings, and data issues once', () => {
  const deliveries = [
    { notification_id: 'N1', status: 'sent', driver_id: 'D002', dedup_key: 'k1' },
    { notification_id: 'N2', status: 'failed', driver_id: 'D005', dedup_key: 'k2', error_detail: 'failed: 550' },
    { notification_id: 'N3', status: 'uncertain', driver_id: 'D006', dedup_key: 'k3', error_detail: 'uncertain: timeout' },
  ];
  const history = [{ notification_id: 'N0', status: 'pending', driver_id: 'D003', dedup_key: 'k0', attempted_at: '2026-10-01T00:00:00Z' }];
  const rows = [
    { state: 'missing', driver_id: 'D011', document_type: 'TWIC', reason: 'no verified version' },
    { state: 'invalid_date', driver_id: 'D012', document_type: 'MEDICAL_CERT', document_id: 'DOC9', expiration_date: '2026-02-30', reason: 'impossible date' },
    { state: 'current', driver_id: 'D001', document_type: 'CDL' },
  ];
  const items = del.buildStaffReviewItems({ rows, deliveries, history, existingKeys: [], runStartedAt: '2026-10-15T00:00:00Z' });
  assert.deepEqual(items.map((i) => i.category).sort(), ['delivery_failed', 'delivery_stuck_pending', 'delivery_uncertain', 'invalid_date', 'missing_document']);
  assert.equal(items.find((i) => i.category === 'delivery_uncertain').severity, 'high');
  // Second day: the same open problems are not queued again.
  const again = del.buildStaffReviewItems({ rows, deliveries: [], history, existingKeys: items.map((i) => i.review_key), runStartedAt: '2026-10-16T00:00:00Z' });
  assert.equal(again.length, 0);
});
