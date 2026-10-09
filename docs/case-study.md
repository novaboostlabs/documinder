# Documinder: case study *(draft, finish in Phase 5)*

> Fill this in only with results that were actually demonstrated. Don't claim production customers or business savings unless they were measured.

## Problem
Fleets and other regulated teams track dozens of expiring credentials for each person: CDLs, medical certificates, TWIC cards, endorsements, and training. A missed date can take a driver off the road, and manual spreadsheet checks miss them.

## What I built
<!-- 2–3 sentences: n8n daily-review workflow + renewal workflow, deterministic classification, dedup, staff review. -->

## Architecture
<!-- Embed a screenshot of the n8n canvas and the flow diagram from the README. -->

## My role
<!-- Domain knowledge from trucking, requirements, data model, workflow build, test design. -->

## Tools
n8n (Data Tables, Code node, Schedule Trigger), JavaScript, Node test runner, Claude Code with the n8n MCP server, GitHub.

## Safeguards
- Plain date math, no LLM deciding dates
- A fixed reference date during testing
- Preview mode that sends only to a test inbox
- A dedup key, so a duplicate run sends nothing
- Timeouts are treated as uncertain and never auto-retried
- Renewals are versioned, so history is never destroyed

## Test cases
See [test-plan.md](test-plan.md). <!-- summarize pass counts per phase -->

## Demonstrated result
<!-- Link to the 3–5 minute demo video. List the four V1 proof cases with evidence. -->
