# Documinder — Portfolio Automation Build Brief

## Product definition

Documinder is a document-expiration monitoring and renewal workflow for organizations that manage time-sensitive employee credentials. The portfolio demo begins with trucking because Alex has direct domain experience, but the product name and data model remain reusable for construction, healthcare, field service, legal operations, and other regulated businesses.

**Portfolio status:** Selected build; not yet a completed or deployed automation.

**One-line pitch:** Documinder checks required credentials every day, sends the right reminder at the right time, records every action, and routes renewals and delivery failures to a human for review.

## V1 outcome

Build one reliable n8n workflow that proves four things:

1. It identifies a document at the correct reminder stage and produces a safe test reminder.
2. Running it again does not create a duplicate reminder for the same driver, document version, and stage.
3. An approved renewal creates a new document version and closes reminders tied to the old version.
4. A failed or uncertain email delivery becomes visible for staff review instead of failing silently.

V1 uses only fictional people and documents. It does not determine whether anyone is legally qualified to drive or work.

## Initial trucking requirements

- Driver's license / CDL
- Medical Examiner's Certificate
- TWIC card
- Hazmat endorsement
- Tanker endorsement
- Doubles/triples endorsement
- Company-required defensive-driving or safety training
- Drug/alcohol testing event history, stored separately from expiring credentials

An endorsement may share the driver's-license expiration date. Do not invent a separate expiration date when the source record does not provide one. Requirements must be configurable by driver role; "not required" is different from "missing."

## Reminder policy

| Days remaining | State | Action |
|---|---|---|
| More than 90 | Current | No reminder |
| 90 | Approaching expiry | First reminder |
| 60 | Approaching expiry | Follow-up |
| 30 | Urgent | Reminder |
| 14 | Urgent | Reminder |
| 7 | Critical | Final pre-expiry reminder |
| 0 | Expires today | Driver notice and staff escalation |
| Below 0 | Overdue | Staff escalation; do not repeatedly email without policy |

The workflow must also identify missing documents, invalid dates, inactive drivers, and non-applicable requirements.

## Data model

**Drivers** — driver_id, full_name, email, role, active, manager_email, created_at

**Requirements** — requirement_id, document_type, applicable_role, required, reminder_stages, escalation_policy

**Documents** — document_id, driver_id, document_type, version, issue_date, expiration_date, status, source_file_url, verified_at, verified_by

**Notifications** — notification_id, driver_id, document_id, document_version, reminder_stage, intended_recipient, provider_message_id, status, attempted_at, error_detail

The unique deduplication key is `driver_id + document_id + document_version + reminder_stage`.

**Renewals** — renewal_id, driver_id, document_type, submitted_expiration_date, submitted_file_url, status, submitted_at, reviewed_at, reviewed_by, rejection_reason

**Settings** — business_timezone, test_reference_date, preview_only, test_recipient, reminder_from_name

## Workflow architecture

### Workflow A — Daily review

Manual Trigger for development, then Schedule Trigger after testing.

1. Load settings.
2. Load active drivers.
3. Load role-based requirements.
4. Match each driver to required document types.
5. Find the latest verified document version.
6. Validate the expiration date.
7. Calculate whole calendar days remaining in the configured business timezone.
8. Classify the record.
9. Determine whether a reminder stage is due.
10. Check Notification history using the deduplication key.
11. Create a preview/test reminder only when no matching successful or uncertain attempt exists.
12. Record the attempt and provider result.
13. Route failures and uncertain deliveries to a staff-review queue.
14. Produce a run summary.

### Workflow B — Renewal intake and review

1. Receive a fictional renewal submission.
2. Store it as pending_review; do not overwrite the verified document.
3. Let an authorized fictional reviewer approve or reject it.
4. On approval, archive the previous active version, create the new verified version, and close old-version reminders.
5. On rejection, preserve the existing verified document and record the reason.

## Deterministic rules

- Date classification must use normal date logic, not an LLM.
- Tests use a fixed reference date before enabling the real current date.
- Do not replay every reminder stage that was missed. Send only the current applicable stage.
- A provider timeout or unknown response is uncertain, not automatically safe to retry.
- In preview mode, all messages go only to Alex's designated test inbox.
- Do not activate or publish the scheduled workflow until test cases pass.

## Fictional test fixtures

Use a fixed reference date of 2026-10-15 and the business timezone America/Los_Angeles.

| Driver | Role | Document | Expiration | Expected result |
|---|---|---|---|---|
| Maya Torres | Fuel Tanker Driver | CDL | 2027-03-20 | Current; no reminder |
| Jordan Lee | Fuel Tanker Driver | Medical Certificate | 2027-01-13 | 90-day reminder |
| Chris Bennett | Linehaul Driver | TWIC | 2026-12-14 | 60-day reminder |
| Renee Patel | Fuel Tanker Driver | Hazmat endorsement | 2026-11-14 | 30-day reminder |
| Luis Alvarez | Local Driver | Medical Certificate | 2026-10-29 | 14-day reminder |
| Taylor Morgan | Fuel Tanker Driver | TWIC | 2026-10-22 | 7-day reminder |
| Casey Brooks | Fuel Tanker Driver | CDL | 2026-10-15 | Expires-today escalation |
| Morgan Reed | Fuel Tanker Driver | Medical Certificate | 2026-10-10 | Overdue escalation |
| Jamie Kim | Inactive Driver | CDL | 2026-10-15 | Skipped as inactive |
| Avery Johnson | Non-hazmat Driver | Hazmat endorsement | — | Not applicable, not missing |

Add separate fixtures for a missing required document and an invalid date.

## Build phases

### Phase 1 — Classification engine
Create the data tables, load the fictional fixtures, calculate days remaining, and output the expected state for every test row. No email and no AI node yet.
**Exit check:** every fixture produces the expected classification on repeated runs.

### Phase 2 — Safe reminder preview
Generate reminder subject/body data and route every preview to one test inbox. Add notification-history persistence and deduplication.
**Exit check:** the first run records due reminders; the second identical run produces zero duplicate reminders.

### Phase 3 — Reliability
Capture success, failure, and uncertain provider outcomes. Add a staff-review output and a run summary with counts.
**Exit check:** a simulated provider failure and timeout are both visible and handled differently.

### Phase 4 — Renewal loop
Add renewal submission, pending review, approval/rejection, document versioning, and closure of reminders for superseded versions.
**Exit check:** approval creates a new verified version without destroying history; rejection changes no verified expiration date.

### Phase 5 — Portfolio evidence
Record a three-to-five-minute demo showing:
- a due reminder;
- a duplicate-prevention rerun;
- an approved renewal;
- a failed delivery surfaced for review;
- the n8n workflow canvas and history records.

Create a one-page case study describing the problem, architecture, Alex's role, tools, safeguards, test cases, and demonstrated result. Do not claim production customers or business savings unless measured later.

## First Codex / Claude Code instruction

> Build Phase 1 of Documinder in my connected n8n instance. First inspect the available n8n MCP capabilities, node schemas, and Data Table support; do not invent tool names or node properties. Keep the workflow unpublished and use only fictional data. Create the Drivers, Requirements, Documents, Notifications, Renewals, and Settings structures described in Documinder_Build_Brief.md. Use a Manual Trigger and the fixed reference date 2026-10-15 in America/Los_Angeles. Implement deterministic validation, days-remaining calculation, and classification only. Do not add email, an LLM node, renewal intake, or scheduling yet. Run every supplied fixture, report actual outputs against expected outputs, fix discrepancies, and stop only when Phase 1's exit check passes or when a specific access blocker requires my action.

## Definition of "portfolio-ready"

Documinder becomes a completed portfolio automation only when all four V1 proof cases run successfully, the workflow remains understandable to another person, its failure states are visible, and Alex can explain the logic and troubleshoot a changed date, missing record, duplicate run, and provider error with AI assistance.
