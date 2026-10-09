// Creates the Documinder data tables in n8n and loads the fictional fixtures.
//
//   node scripts/load-fixtures.mjs
//
// Two transports, picked from .env:
//   - N8N_API_KEY set   -> public REST API (/api/v1/data-tables). Fixture tables are
//                          cleared and reloaded on every run.
//   - otherwise         -> n8n's built-in MCP server (N8N_MCP_TOKEN). Missing tables are
//                          created; fixture rows are loaded only into empty tables
//                          (the MCP server has no clear-rows tool).
// The Notifications and Renewals tables are created empty and never cleared here;
// they hold workflow history.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, readEnv } from './n8n-mcp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readEnv();
const BASE = `${env.N8N_URL || 'http://localhost:5678'}/api/v1`;

const fixtures = JSON.parse(readFileSync(join(root, 'data/fixtures/fixtures.json'), 'utf8'));

// Dates are stored as strings on purpose: the invalid-date fixture (2026-02-30)
// must reach the workflow so it can be flagged, not rejected at storage time.
const S = 'string', N = 'number', B = 'boolean';
const TABLES = {
  documinder_settings: { rows: fixtures.settings, columns: { business_timezone: S, test_reference_date: S, preview_only: B, test_recipient: S, reminder_from_name: S } },
  documinder_drivers: { rows: fixtures.drivers, columns: { driver_id: S, full_name: S, email: S, role: S, active: B, manager_email: S, created_at: S } },
  documinder_requirements: { rows: fixtures.requirements, columns: { requirement_id: S, document_type: S, applicable_role: S, required: B, reminder_stages: S, escalation_policy: S } },
  documinder_documents: { rows: fixtures.documents, columns: { document_id: S, driver_id: S, document_type: S, version: N, issue_date: S, expiration_date: S, status: S, source_file_url: S, verified_at: S, verified_by: S } },
  documinder_notifications: { rows: null, columns: { notification_id: S, driver_id: S, document_id: S, document_version: N, reminder_stage: S, dedup_key: S, intended_recipient: S, provider_message_id: S, status: S, attempted_at: S, error_detail: S, audience: S, delivered_to: S, delivery_mode: S, subject: S, body: S, from_name: S, simulated_outcome: S, closed_at: S, closed_reason: S } },
  documinder_renewals: { rows: null, columns: { renewal_id: S, driver_id: S, document_type: S, submitted_expiration_date: S, submitted_file_url: S, status: S, submitted_at: S, reviewed_at: S, reviewed_by: S, rejection_reason: S, previous_document_id: S, previous_version: N, previous_expiration_date: S, new_document_id: S, new_version: N } },
  documinder_staff_review: { rows: null, columns: { review_key: S, created_at: S, category: S, severity: S, status: S, driver_id: S, document_type: S, notification_id: S, dedup_key: S, detail: S, recommended_action: S, resolved_at: S, resolution: S } },
  documinder_reviewers: { rows: fixtures.reviewers, columns: { reviewer_email: S, full_name: S, active: B } },
  // Test-only: forces a provider outcome for one driver + document. Honored only while preview_only is on.
  documinder_provider_simulations: { rows: null, columns: { driver_id: S, document_type: S, outcome: S, note: S } },
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

const rowsFor = (def) =>
  def.rows.map((r) => Object.fromEntries(Object.keys(def.columns).map((c) => [c, r[c] ?? (def.columns[c] === S ? '' : null)])));
const columnsFor = (def) => Object.entries(def.columns).map(([n, type]) => ({ name: n, type }));

if (env.N8N_API_KEY) {
  const existing = (await api('GET', '/data-tables?limit=250')).data;
  for (const [name, def] of Object.entries(TABLES)) {
    let table = existing.find((t) => t.name === name);
    if (!table) {
      table = await api('POST', '/data-tables', { name, columns: columnsFor(def) });
      console.log(`created ${name} (${table.id})`);
    }
    if (def.rows) {
      await api('DELETE', `/data-tables/${table.id}/rows/clear`);
      await api('POST', `/data-tables/${table.id}/rows`, { data: rowsFor(def), returnType: 'count' });
      console.log(`loaded ${def.rows.length} rows into ${name}`);
    }
  }
} else {
  const mcp = await connect(env);
  const projectId = (await mcp.call('search_projects', { type: 'personal' })).data[0].id;
  const existing = (await mcp.call('search_data_tables', {})).data;
  for (const [name, def] of Object.entries(TABLES)) {
    let table = existing.find((t) => t.name === name);
    if (!table) {
      table = await mcp.call('create_data_table', { projectId, name, columns: columnsFor(def) });
      console.log(`created ${name} (${table.id})`);
    }
    if (!def.rows) continue;
    const current = await mcp.call('get_data_table_rows', { dataTableId: table.id, projectId, limit: 1 });
    const hasRows = (current.data || current.rows || []).length > 0;
    if (hasRows) {
      console.log(`skipped ${name}: already has rows (set N8N_API_KEY to clear and reload)`);
      continue;
    }
    await mcp.call('add_data_table_rows', { dataTableId: table.id, projectId, rows: rowsFor(def) });
    console.log(`loaded ${def.rows.length} rows into ${name}`);
  }
}
