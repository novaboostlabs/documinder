// Generates the fictional Documinder fixtures (CSV + JSON) and the expected
// Phase 1 classifications. Every person, email, and document is fictional.
//
//   node scripts/generate-fixtures.mjs
//
// The "primary" rows reproduce the fixture table in docs/Documinder_Build_Brief.md.
// Every other required credential is given a far-future "background" expiration
// so that each driver has a complete, realistic document set.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'fixtures');
mkdirSync(outDir, { recursive: true });

const CREATED_AT = '2026-09-01T08:00:00-07:00';
const VERIFIED_AT = '2026-09-02T09:30:00-07:00';
const VERIFIED_BY = 'compliance.reviewer@example.com';
const MANAGER = 'ops.manager@example.com';

const DOC_TYPES = [
  'CDL',
  'MEDICAL_CERT',
  'TWIC',
  'HAZMAT_ENDORSEMENT',
  'TANKER_ENDORSEMENT',
  'DOUBLES_TRIPLES_ENDORSEMENT',
  'SAFETY_TRAINING',
];
const ENDORSEMENTS = new Set(['HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'DOUBLES_TRIPLES_ENDORSEMENT']);

// Which credentials each role must hold. "false" rows are kept on purpose:
// "not required" (not_applicable) is different from "missing".
const ROLE_REQUIREMENTS = {
  fuel_tanker_driver: ['CDL', 'MEDICAL_CERT', 'TWIC', 'HAZMAT_ENDORSEMENT', 'TANKER_ENDORSEMENT', 'SAFETY_TRAINING'],
  linehaul_driver: ['CDL', 'MEDICAL_CERT', 'TWIC', 'DOUBLES_TRIPLES_ENDORSEMENT', 'SAFETY_TRAINING'],
  local_driver: ['CDL', 'MEDICAL_CERT', 'SAFETY_TRAINING'],
};

const drivers = [
  ['D001', 'Maya Torres', 'fuel_tanker_driver', true],
  ['D002', 'Jordan Lee', 'fuel_tanker_driver', true],
  ['D003', 'Chris Bennett', 'linehaul_driver', true],
  ['D004', 'Renee Patel', 'fuel_tanker_driver', true],
  ['D005', 'Luis Alvarez', 'local_driver', true],
  ['D006', 'Taylor Morgan', 'fuel_tanker_driver', true],
  ['D007', 'Casey Brooks', 'fuel_tanker_driver', true],
  ['D008', 'Morgan Reed', 'fuel_tanker_driver', true],
  ['D009', 'Jamie Kim', 'fuel_tanker_driver', false],
  ['D010', 'Avery Johnson', 'local_driver', true],
  ['D011', 'Sam Rivera', 'linehaul_driver', true], // extra fixture: missing required TWIC
  ['D012', 'Drew Collins', 'local_driver', true], // extra fixture: invalid medical-cert date
].map(([driver_id, full_name, role, active]) => ({
  driver_id,
  full_name,
  email: `${full_name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
  role,
  active,
  manager_email: MANAGER,
  created_at: CREATED_AT,
}));

const requirements = [];
let reqN = 1;
for (const role of Object.keys(ROLE_REQUIREMENTS)) {
  for (const document_type of DOC_TYPES) {
    requirements.push({
      requirement_id: `R${String(reqN++).padStart(3, '0')}`,
      document_type,
      applicable_role: role,
      required: ROLE_REQUIREMENTS[role].includes(document_type),
      reminder_stages: '90,60,30,14,7,0',
      escalation_policy: 'escalate_on_expiry_and_overdue',
    });
  }
}

// Primary fixtures from the build brief, plus the two extra edge cases.
// expiration_date: null means "not provided by the source record".
const PRIMARY = {
  'D001:CDL': { expiration_date: '2027-03-20', expect: ['current', ''] },
  'D002:MEDICAL_CERT': { expiration_date: '2027-01-13', expect: ['approaching_expiry', 'D90'] },
  'D003:TWIC': { expiration_date: '2026-12-14', expect: ['approaching_expiry', 'D60'] },
  'D004:HAZMAT_ENDORSEMENT': { expiration_date: '2026-11-14', expect: ['urgent', 'D30'] },
  'D005:MEDICAL_CERT': { expiration_date: '2026-10-29', expect: ['urgent', 'D14'] },
  'D006:TWIC': { expiration_date: '2026-10-22', expect: ['critical', 'D7'] },
  'D007:CDL': { expiration_date: '2026-10-15', expect: ['expires_today', 'D0'] },
  'D008:MEDICAL_CERT': { expiration_date: '2026-10-10', expect: ['overdue', 'OVERDUE'] },
  'D009:CDL': { expiration_date: '2026-10-15', expect: ['inactive_skipped', ''] },
  'D010:HAZMAT_ENDORSEMENT': { absent: true, expect: ['not_applicable', ''] },
  'D011:TWIC': { absent: true, expect: ['missing', ''] },
  'D012:MEDICAL_CERT': { expiration_date: '2026-02-30', expect: ['invalid_date', ''] },
};

// Far-future background dates (all > 90 days after 2026-10-15).
const BACKGROUND = {
  CDL: '2029-06-30',
  MEDICAL_CERT: '2028-04-30',
  TWIC: '2030-01-31',
  SAFETY_TRAINING: '2027-08-31',
};

const documents = [];
const expected = [];
let docN = 1;
const nextDocId = () => `DOC${String(docN++).padStart(4, '0')}`;

function addDoc(driver, document_type, expiration_date, extra = {}) {
  const doc = {
    document_id: nextDocId(),
    driver_id: driver.driver_id,
    document_type,
    version: 1,
    issue_date: '2024-10-01',
    expiration_date: expiration_date ?? '',
    status: 'verified',
    source_file_url: `https://files.example.com/documinder/${driver.driver_id}/${document_type.toLowerCase()}-v1.pdf`,
    verified_at: VERIFIED_AT,
    verified_by: VERIFIED_BY,
    ...extra,
  };
  documents.push(doc);
  return doc;
}

for (const driver of drivers) {
  const required = ROLE_REQUIREMENTS[driver.role];
  const cdlExp = PRIMARY[`${driver.driver_id}:CDL`]?.expiration_date ?? BACKGROUND.CDL;

  for (const document_type of DOC_TYPES) {
    const key = `${driver.driver_id}:${document_type}`;
    const primary = PRIMARY[key];
    const isRequired = required.includes(document_type);

    if (!isRequired) {
      expected.push({ driver_id: driver.driver_id, document_type, expected_state: driver.active ? 'not_applicable' : 'inactive_skipped', expected_stage: '', primary_fixture: Boolean(primary) });
      continue;
    }
    if (primary?.absent) {
      expected.push({ driver_id: driver.driver_id, document_type, expected_state: primary.expect[0], expected_stage: primary.expect[1], primary_fixture: true });
      continue;
    }

    // Endorsements default to "no separate expiration on the source record";
    // the workflow must inherit the CDL date rather than invent one.
    let exp = primary ? primary.expiration_date : ENDORSEMENTS.has(document_type) ? null : BACKGROUND[document_type];
    addDoc(driver, document_type, exp);

    let state;
    let stage = '';
    if (primary) {
      [state, stage] = primary.expect;
    } else if (!driver.active) {
      state = 'inactive_skipped';
    } else if (ENDORSEMENTS.has(document_type) && cdlExp === '2026-10-15') {
      // Casey Brooks: endorsements inherit a CDL date that expires today.
      [state, stage] = ['expires_today', 'D0'];
    } else {
      state = 'current';
    }
    expected.push({ driver_id: driver.driver_id, document_type, expected_state: state, expected_stage: stage, primary_fixture: Boolean(primary) });
  }
}

// History: Jordan Lee's medical certificate has an archived older version, so the
// workflow must pick the latest *verified* version, not the first row it finds.
const jordanMed = documents.find((d) => d.driver_id === 'D002' && d.document_type === 'MEDICAL_CERT');
jordanMed.version = 2;
jordanMed.source_file_url = jordanMed.source_file_url.replace('-v1.pdf', '-v2.pdf');
addDoc(drivers[1], 'MEDICAL_CERT', '2024-01-13', {
  issue_date: '2022-01-13',
  status: 'archived',
  version: 1,
  verified_at: '2022-01-14T10:00:00-08:00',
});

const settings = [
  {
    business_timezone: 'America/Los_Angeles',
    test_reference_date: '2026-10-15',
    preview_only: true,
    test_recipient: 'documinder.test@example.com',
    reminder_from_name: 'Documinder Compliance (Test)',
  },
];

// Drug/alcohol testing history is stored separately from expiring credentials
// and is never used for expiration classification.
const testingEvents = [
  { event_id: 'T001', driver_id: 'D001', test_type: 'pre_employment', event_date: '2024-09-20', outcome: 'completed', recorded_by: VERIFIED_BY },
  { event_id: 'T002', driver_id: 'D003', test_type: 'random', event_date: '2026-03-11', outcome: 'completed', recorded_by: VERIFIED_BY },
  { event_id: 'T003', driver_id: 'D007', test_type: 'random', event_date: '2026-06-02', outcome: 'completed', recorded_by: VERIFIED_BY },
];

const notificationsHeader = ['notification_id', 'driver_id', 'document_id', 'document_version', 'reminder_stage', 'intended_recipient', 'provider_message_id', 'status', 'attempted_at', 'error_detail'];
const renewalsHeader = ['renewal_id', 'driver_id', 'document_type', 'submitted_expiration_date', 'submitted_file_url', 'status', 'submitted_at', 'reviewed_at', 'reviewed_by', 'rejection_reason'];

function toCsv(rows, header = Object.keys(rows[0])) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
}

const files = {
  drivers,
  requirements,
  documents,
  settings,
  testing_events: testingEvents,
  expected_phase1: expected,
};
for (const [name, rows] of Object.entries(files)) {
  writeFileSync(join(outDir, `${name}.csv`), toCsv(rows));
}
writeFileSync(join(outDir, 'notifications.csv'), notificationsHeader.join(',') + '\n');
writeFileSync(join(outDir, 'renewals.csv'), renewalsHeader.join(',') + '\n');
writeFileSync(join(outDir, 'fixtures.json'), JSON.stringify(files, null, 2) + '\n');

console.log(`drivers=${drivers.length} requirements=${requirements.length} documents=${documents.length} expected=${expected.length}`);
