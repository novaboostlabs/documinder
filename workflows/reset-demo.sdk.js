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

const note = sticky(
  "## Dev · Reset demo data\nClears notification history, the staff-review queue, and provider simulations so the daily review can be demonstrated from a clean slate.\n\n**Guard:** does nothing unless documinder_settings.preview_only is true, so it can never wipe live history. Drivers, documents, and requirements are not touched.",
  [],
  { color: 4, position: [-120, -40], width: 1500, height: 520 }
);

export default workflow('documinder-reset-demo', 'Documinder · Dev · Reset Demo Data')
  .add(start)
  .to(loadSettings)
  .to(isPreview.onTrue(clearNotifications.to(clearReview).to(clearSimulations)))
  .add(note);
