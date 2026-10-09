# Test plan

Reference date **2026-10-15**, timezone **America/Los_Angeles**. Every person and document is fictional.

## Phase 1: classification (primary fixtures)

| Driver | Role | Document | Expiration | Days | Expected state | Expected stage |
|---|---|---|---|---|---|---|
| Maya Torres | fuel tanker | CDL | 2027-03-20 | 156 | `current` | — |
| Jordan Lee | fuel tanker | Medical cert (v2, v1 archived) | 2027-01-13 | 90 | `approaching_expiry` | `D90` |
| Chris Bennett | linehaul | TWIC | 2026-12-14 | 60 | `approaching_expiry` | `D60` |
| Renee Patel | fuel tanker | Hazmat endorsement | 2026-11-14 | 30 | `urgent` | `D30` |
| Luis Alvarez | local | Medical cert | 2026-10-29 | 14 | `urgent` | `D14` |
| Taylor Morgan | fuel tanker | TWIC | 2026-10-22 | 7 | `critical` | `D7` |
| Casey Brooks | fuel tanker | CDL | 2026-10-15 | 0 | `expires_today` | `D0` |
| Morgan Reed | fuel tanker | Medical cert | 2026-10-10 | −5 | `overdue` | `OVERDUE` |
| Jamie Kim | fuel tanker (inactive) | CDL | 2026-10-15 | — | `inactive_skipped` | — |
| Avery Johnson | local (non-hazmat) | Hazmat endorsement | — | — | `not_applicable` | — |
| **Sam Rivera** *(extra)* | linehaul | TWIC | *(no record)* | — | `missing` | — |
| **Drew Collins** *(extra)* | local | Medical cert | 2026-02-30 | — | `invalid_date` | — |

The full expectation set has **84 rows** (12 drivers × 7 credential types) in [`data/fixtures/expected_phase1.csv`](../data/fixtures/expected_phase1.csv). Besides the primary rows, it checks that:

- background credentials with far-future dates classify as `current`;
- Casey Brooks's hazmat and tanker endorsements, which have no date of their own, **inherit** the CDL date and also come out `expires_today`;
- every credential of the inactive driver comes out `inactive_skipped`;
- every `required = false` row comes out `not_applicable`.

**Exit check:** the n8n "Phase 1 Test Report" node shows `failed: 0`, and the result is the same on a second run. `npm test` checks the same logic outside n8n.

**Result (2026-10-09):** ✅ PASS. n8n executions #1, #2, and #3 each returned `checked: 84, passed: 84, failed: 0`. The output of execution #1 is saved in [`evidence/phase1-test-report.json`](evidence/phase1-test-report.json).

## Phase 2: preview + dedup

1. Start with an empty `documinder_notifications` table and run the workflow. Expect **9** previews: D90, D60, D30, D14, D7, three D0 (Casey Brooks's CDL plus two endorsements that inherit its date), and one OVERDUE. All of them go to `delivered_to = test_recipient`.
2. Run it again with no changes. Expect **0** created and **9** skipped as duplicates.
3. Unit tests ([`tests/reminders.test.mjs`](../tests/reminders.test.mjs)) also cover: `uncertain` blocks a resend, `failed` allows a retry, a new document version starts a fresh cycle, preview mode refuses to run without a test inbox, and each stage's audience (driver, driver + manager, or staff only).

**Result (2026-10-09):** ✅ PASS. Execution #4 created 9; executions #5 and #6 created 0 and skipped 9. The table ended with 9 rows and 9 unique dedup keys, all addressed to the test inbox. Phase 1 still passed 84/84 in the same runs. See [`evidence/phase2-dedup-report.json`](evidence/phase2-dedup-report.json).

To re-run from scratch, delete the rows in `documinder_notifications` in the n8n UI (Data tables → documinder_notifications).

## Phase 3: delivery outcomes + staff review

**Setup:** run *Documinder · Dev · Reset Demo Data*, which only works while `preview_only` is true. Then add two rows to `documinder_provider_simulations`:

| driver_id | document_type | outcome |
|---|---|---|
| D005 (Luis Alvarez) | MEDICAL_CERT | failure |
| D006 (Taylor Morgan) | TWIC | timeout |

| Check | Expected | Run 1 (exec #10) | Run 2 (exec #11) |
|---|---|---|---|
| Real sends to the test inbox | 7 `sent` with provider message IDs | ✅ 7 | ✅ 0 new (7 skipped) |
| Simulated failure | `failed`, staff review, retried next run | ✅ failed · medium | ✅ retried (`retried_after_failure: 1`) |
| Simulated timeout | `uncertain`, staff review, **not** retried | ✅ uncertain · high | ✅ held (`held_because_uncertain: 1`) |
| Data issues | missing + invalid queued once | ✅ 2 queued | ✅ 0 re-queued |
| Stuck `pending` rows | 0 | ✅ 0 | ✅ 0 |
| Phase 1 still passes | 84/84 | ✅ | ✅ |

Unit tests ([`tests/delivery.test.mjs`](../tests/delivery.test.mjs)) also cover real SMTP error shapes (`EAUTH` → failed, `ECONNRESET` / "connection closed" → uncertain, `ECONNREFUSED` → failed), unknown responses → uncertain, and stuck `pending` rows → staff review.

**Result (2026-10-09):** ✅ PASS. See [`evidence/phase3-delivery-report.json`](evidence/phase3-delivery-report.json).

**Bug found and fixed during testing:** "Interpret Provider Result" gets input from two branches (simulated and real), so n8n runs it once per branch. `$('Interpret Provider Result').all()` returns only the first run, so the summary first reported 0 sent even though Gmail had accepted all 7. That meant a real SMTP failure arriving on the second run could also have skipped the staff-review queue. Both nodes now read every run (`$(node).all(0, runIndex)`).

## Phase 4: renewal *(planned)*

- Approving a renewal for Morgan Reed's medical cert: v1 → `archived`, v2 is created as `verified`, and v1's notifications → `closed`.
- Rejecting a renewal: the verified expiration date is unchanged and `rejection_reason` is recorded.
