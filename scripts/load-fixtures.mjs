// Creates the Documinder data tables in n8n and loads the fictional fixtures,
// using n8n's public REST API (/api/v1/data-tables).
//
//   node scripts/load-fixtures.mjs            # create missing tables, reload fixture rows
//
// Reads N8N_URL and N8N_API_KEY from .env. Fixture tables are cleared and reloaded
// on every run, so it is safe to repeat. The Notifications and Renewals tables are
// created empty and never cleared here; they hold workflow history.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = `${env.N8N_URL || 'http://localhost:5678'}/api/v1`;
if (!env.N8N_API_KEY) throw new Error('N8N_API_KEY is missing from .env');

const fixtures = JSON.parse(readFileSync(join(root, 'data/fixtures/fixtures.json'), 'utf8'));

// Dates are stored as strings on purpose: the invalid-date fixture (2026-02-30)
// must reach the workflow so it can be flagged, not rejected at storage time.
const S = 'string', N = 'number', B = 'boolean';
export const TABLES = {
  documinder_settings: { rows: fixtures.settings, columns: { business_timezone: S, test_reference_date: S, preview_only: B, test_recipient: S, reminder_from_name: S } },
  documinder_drivers: { rows: fixtures.drivers, columns: { driver_id: S, full_name: S, email: S, role: S, active: B, manager_email: S, created_at: S } },
  documinder_requirements: { rows: fixtures.requirements, columns: { requirement_id: S, document_type: S, applicable_role: S, required: B, reminder_stages: S, escalation_policy: S } },
  documinder_documents: { rows: fixtures.documents, columns: { document_id: S, driver_id: S, document_type: S, version: N, issue_date: S, expiration_date: S, status: S, source_file_url: S, verified_at: S, verified_by: S } },
  documinder_notifications: { rows: null, columns: { notification_id: S, driver_id: S, document_id: S, document_version: N, reminder_stage: S, dedup_key: S, intended_recipient: S, provider_message_id: S, status: S, attempted_at: S, error_detail: S } },
  documinder_renewals: { rows: null, columns: { renewal_id: S, driver_id: S, document_type: S, submitted_expiration_date: S, submitted_file_url: S, status: S, submitted_at: S, reviewed_at: S, reviewed_by: S, rejection_reason: S } },
  documinder_testing_events: { rows: fixtures.testing_events, columns: { event_id: S, driver_id: S, test_type: S, event_date: S, outcome: S, recorded_by: S } },
  documinder_test_expectations: { rows: fixtures.expected_phase1, columns: { driver_id: S, document_type: S, expected_state: S, expected_stage: S, primary_fixture: B } },
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const existing = (await api('GET', '/data-tables?limit=250')).data;

for (const [name, def] of Object.entries(TABLES)) {
  let table = existing.find((t) => t.name === name);
  if (!table) {
    table = await api('POST', '/data-tables', {
      name,
      columns: Object.entries(def.columns).map(([n, type]) => ({ name: n, type })),
    });
    console.log(`created ${name} (${table.id})`);
  }
  if (def.rows) {
    await api('DELETE', `/data-tables/${table.id}/rows/clear`);
    const rows = def.rows.map((r) => Object.fromEntries(Object.keys(def.columns).map((c) => [c, r[c] ?? (def.columns[c] === S ? '' : null)])));
    await api('POST', `/data-tables/${table.id}/rows`, { data: rows, returnType: 'count' });
    console.log(`loaded ${rows.length} rows into ${name}`);
  }
}
