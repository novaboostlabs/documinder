# Data model

All tables are **n8n Data Tables** with the `documinder_` prefix. n8n adds `id`, `createdAt`, and `updatedAt` to every table automatically. Dates are stored as `YYYY-MM-DD` **strings** so a bad source value (for example `2026-02-30`) reaches the workflow and gets flagged instead of being rejected when it's stored.

| Table | Purpose | Key columns |
|---|---|---|
| `documinder_settings` | One row of run configuration | `business_timezone`, `test_reference_date`, `preview_only`, `test_recipient`, `reminder_from_name` |
| `documinder_drivers` | People being monitored | `driver_id`, `full_name`, `email`, `role`, `active`, `manager_email`, `created_at` |
| `documinder_requirements` | Which credentials each role needs | `requirement_id`, `document_type`, `applicable_role`, `required`, `reminder_stages`, `escalation_policy` |
| `documinder_documents` | Every version of every credential | `document_id`, `driver_id`, `document_type`, `version`, `issue_date`, `expiration_date`, `status` (`verified` / `archived`), `source_file_url`, `verified_at`, `verified_by` |
| `documinder_notifications` | Every reminder attempt (Phase 2+) | `notification_id`, `driver_id`, `document_id`, `document_version`, `reminder_stage`, `dedup_key`, `intended_recipient`, `provider_message_id`, `status`, `attempted_at`, `error_detail`, plus `audience`, `delivered_to`, `delivery_mode`, `subject`, `body`, `from_name`, `simulated_outcome` |
| `documinder_renewals` | Submitted renewals awaiting review (Phase 4) | `renewal_id`, `driver_id`, `document_type`, `submitted_expiration_date`, `submitted_file_url`, `status`, `submitted_at`, `reviewed_at`, `reviewed_by`, `rejection_reason` |
| `documinder_staff_review` | Staff-review queue (Phase 3) | `review_key` (stable, so each problem is queued once), `created_at`, `category` (`delivery_failed`, `delivery_uncertain`, `delivery_stuck_pending`, `missing_document`, `invalid_date`), `severity`, `status`, `driver_id`, `document_type`, `notification_id`, `dedup_key`, `detail`, `recommended_action` |
| `documinder_provider_simulations` | **Test-only**: force a provider `failure` or `timeout` for one driver + document. Ignored unless `preview_only` is true | `driver_id`, `document_type`, `outcome`, `note` |
| `documinder_testing_events` | Drug/alcohol testing **history**, stored separately and never used to classify expirations | `event_id`, `driver_id`, `test_type`, `event_date`, `outcome`, `recorded_by` |
| `documinder_test_expectations` | Expected Phase 1 result for every driver × credential | `driver_id`, `document_type`, `expected_state`, `expected_stage`, `primary_fixture` |

## Document types

`CDL`, `MEDICAL_CERT`, `TWIC`, `HAZMAT_ENDORSEMENT`, `TANKER_ENDORSEMENT`, `DOUBLES_TRIPLES_ENDORSEMENT`, `SAFETY_TRAINING`

## Roles

| Role | Required credentials |
|---|---|
| `fuel_tanker_driver` | CDL, Medical, TWIC, Hazmat, Tanker, Safety training |
| `linehaul_driver` | CDL, Medical, TWIC, Doubles/Triples, Safety training |
| `local_driver` | CDL, Medical, Safety training |

Every role also has rows with `required = false` for the other credential types. That is how the workflow tells **not applicable** apart from **missing**.

## Deduplication key

`dedup_key = driver_id | document_id | document_version | reminder_stage`, for example `D002|DOC0008|2|D90`.

A new reminder is created only when no notification with that key has status `previewed`, `sent`, or `uncertain`. A `failed` attempt doesn't block, so it can be retried.

## Notification statuses

| Status | Meaning | Blocks a new reminder? |
|---|---|---|
| `pending` | Recorded just before sending; replaced by the provider result. If it's still pending on a later run, the send was interrupted | yes, and goes to staff review |
| `previewed` | Composed without a provider (Phase 2 dry runs) | yes |
| `sent` | Provider accepted the message (message ID recorded) | yes |
| `uncertain` | Timeout or unknown provider response | yes, never auto-retried |
| `failed` | Provider definitely did not accept (SMTP 4xx/5xx, auth error, connection refused) | no, eligible for retry |
| `closed` | The document version was superseded by a renewal *(Phase 4)* | n/a |

A renewal creates a new `document_version`, which naturally starts a fresh reminder cycle.
