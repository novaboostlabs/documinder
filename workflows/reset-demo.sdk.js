import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Reset Demo Data (manual)', position: [0, 300] },
  output: [{}],
});

const loadSettings = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Load Settings',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_settings' },
      returnAll: true,
    },
    position: [240, 300],
  },
  output: [{ business_timezone: 'America/Los_Angeles', test_reference_date: '2026-10-15', preview_only: true, test_recipient: 'test@example.com', reminder_from_name: 'Documinder' }],
});

const isPreview = node({
  type: 'n8n-nodes-base.if',
  version: 2.3,
  config: {
    name: 'Preview Mode Only?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.preview_only }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      },
    },
    position: [480, 300],
  },
  output: [{ preview_only: true }],
});

const clearNotifications = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Clear Notification History',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_notifications' },
    },
    position: [720, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});

const clearReview = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Clear Staff Review Queue',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_staff_review' },
    },
    position: [960, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});

const clearSimulations = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Clear Provider Simulations',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_provider_simulations' },
    },
    position: [1200, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});

const clearRenewals = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Clear Renewals',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_renewals' },
    },
    position: [1440, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});

const clearDocuments = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Clear Documents',
    executeOnce: true,
    parameters: {
      resource: 'table',
      operation: 'clear',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
    },
    position: [1680, 300],
  },
  output: [{ deletedCount: 0, success: true }],
});

const fixtureDocs = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fixture Documents',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// The 61 fictional documents from data/fixtures/fixtures.json (embedded at build time).\nreturn [{\"document_id\":\"DOC0001\",\"driver_id\":\"D001\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-03-20\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0002\",\"driver_id\":\"D001\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0003\",\"driver_id\":\"D001\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0004\",\"driver_id\":\"D001\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0005\",\"driver_id\":\"D001\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0006\",\"driver_id\":\"D001\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D001/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0007\",\"driver_id\":\"D002\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0008\",\"driver_id\":\"D002\",\"document_type\":\"MEDICAL_CERT\",\"version\":2,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-01-13\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/medical_cert-v2.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0009\",\"driver_id\":\"D002\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0010\",\"driver_id\":\"D002\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0011\",\"driver_id\":\"D002\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0012\",\"driver_id\":\"D002\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D002/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0013\",\"driver_id\":\"D003\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D003/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0014\",\"driver_id\":\"D003\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D003/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0015\",\"driver_id\":\"D003\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-12-14\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D003/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0016\",\"driver_id\":\"D003\",\"document_type\":\"DOUBLES_TRIPLES_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D003/doubles_triples_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0017\",\"driver_id\":\"D003\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D003/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0018\",\"driver_id\":\"D004\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0019\",\"driver_id\":\"D004\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0020\",\"driver_id\":\"D004\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0021\",\"driver_id\":\"D004\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-11-14\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0022\",\"driver_id\":\"D004\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0023\",\"driver_id\":\"D004\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D004/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0024\",\"driver_id\":\"D005\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D005/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0025\",\"driver_id\":\"D005\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-10-29\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D005/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0026\",\"driver_id\":\"D005\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D005/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0027\",\"driver_id\":\"D006\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0028\",\"driver_id\":\"D006\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0029\",\"driver_id\":\"D006\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-10-22\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0030\",\"driver_id\":\"D006\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0031\",\"driver_id\":\"D006\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0032\",\"driver_id\":\"D006\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D006/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0033\",\"driver_id\":\"D007\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-10-15\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0034\",\"driver_id\":\"D007\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0035\",\"driver_id\":\"D007\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0036\",\"driver_id\":\"D007\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0037\",\"driver_id\":\"D007\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0038\",\"driver_id\":\"D007\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D007/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0039\",\"driver_id\":\"D008\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0040\",\"driver_id\":\"D008\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-10-10\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0041\",\"driver_id\":\"D008\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0042\",\"driver_id\":\"D008\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0043\",\"driver_id\":\"D008\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0044\",\"driver_id\":\"D008\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D008/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0045\",\"driver_id\":\"D009\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-10-15\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0046\",\"driver_id\":\"D009\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0047\",\"driver_id\":\"D009\",\"document_type\":\"TWIC\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2030-01-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/twic-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0048\",\"driver_id\":\"D009\",\"document_type\":\"HAZMAT_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/hazmat_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0049\",\"driver_id\":\"D009\",\"document_type\":\"TANKER_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/tanker_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0050\",\"driver_id\":\"D009\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D009/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0051\",\"driver_id\":\"D010\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D010/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0052\",\"driver_id\":\"D010\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D010/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0053\",\"driver_id\":\"D010\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D010/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0054\",\"driver_id\":\"D011\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D011/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0055\",\"driver_id\":\"D011\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2028-04-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D011/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0056\",\"driver_id\":\"D011\",\"document_type\":\"DOUBLES_TRIPLES_ENDORSEMENT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D011/doubles_triples_endorsement-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0057\",\"driver_id\":\"D011\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D011/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0058\",\"driver_id\":\"D012\",\"document_type\":\"CDL\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2029-06-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D012/cdl-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0059\",\"driver_id\":\"D012\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2026-02-30\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D012/medical_cert-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0060\",\"driver_id\":\"D012\",\"document_type\":\"SAFETY_TRAINING\",\"version\":1,\"issue_date\":\"2024-10-01\",\"expiration_date\":\"2027-08-31\",\"status\":\"verified\",\"source_file_url\":\"https://files.example.com/documinder/D012/safety_training-v1.pdf\",\"verified_at\":\"2026-09-02T09:30:00-07:00\",\"verified_by\":\"compliance.reviewer@example.com\"},{\"document_id\":\"DOC0061\",\"driver_id\":\"D002\",\"document_type\":\"MEDICAL_CERT\",\"version\":1,\"issue_date\":\"2022-01-13\",\"expiration_date\":\"2024-01-13\",\"status\":\"archived\",\"source_file_url\":\"https://files.example.com/documinder/D002/medical_cert-v1.pdf\",\"verified_at\":\"2022-01-14T10:00:00-08:00\",\"verified_by\":\"compliance.reviewer@example.com\"}].map((d) => ({ json: d }));\n",
    },
    position: [1920, 300],
  },
  output: [{"document_id":"DOC0001","driver_id":"D001","document_type":"CDL","version":1,"issue_date":"2024-10-01","expiration_date":"2027-03-20","status":"verified","source_file_url":"https://files.example.com/documinder/D001/cdl-v1.pdf","verified_at":"2026-09-02T09:30:00-07:00","verified_by":"compliance.reviewer@example.com"}],
});

const restoreDocs = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Restore Fixture Documents',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'documinder_documents' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          document_id: expr('{{ $json.document_id }}'),
          driver_id: expr('{{ $json.driver_id }}'),
          document_type: expr('{{ $json.document_type }}'),
          version: expr('{{ $json.version }}'),
          issue_date: expr('{{ $json.issue_date }}'),
          expiration_date: expr('{{ $json.expiration_date }}'),
          status: expr('{{ $json.status }}'),
          source_file_url: expr('{{ $json.source_file_url }}'),
          verified_at: expr('{{ $json.verified_at }}'),
          verified_by: expr('{{ $json.verified_by }}'),
        },
        schema: [
          { id: 'document_id', displayName: 'document_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'driver_id', displayName: 'driver_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'document_type', displayName: 'document_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'version', displayName: 'version', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true },
          { id: 'issue_date', displayName: 'issue_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'expiration_date', displayName: 'expiration_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source_file_url', displayName: 'source_file_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'verified_at', displayName: 'verified_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'verified_by', displayName: 'verified_by', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
    position: [2160, 300],
  },
  output: [{ id: 1 }],
});

const note = sticky(
  "## Dev · Reset demo data\nReturns the demo to the fixture baseline: clears notification history, the staff-review queue, provider simulations, and renewals, then restores the 61 fictional documents (undoing any approved renewals).\n\n**Guard:** does nothing unless documinder_settings.preview_only is true, so it can never wipe live history. Drivers, requirements, reviewers, and settings are not touched.",
  [],
  { color: 4, position: [-120, -40], width: 2460, height: 520 }
);

export default workflow('documinder-reset-demo', 'Documinder · Dev · Reset Demo Data')
  .add(start)
  .to(loadSettings)
  .to(isPreview.onTrue(clearNotifications.to(clearReview).to(clearSimulations).to(clearRenewals).to(clearDocuments).to(fixtureDocs).to(restoreDocs)))
  .add(note);
