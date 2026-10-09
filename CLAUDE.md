# Documinder: working notes for Claude Code

Read `docs/Documinder_Build_Brief.md` first. It is the source of truth.

## Rules
- Use **fictional data only** (`@example.com` addresses). Never add real people, documents, or inboxes to fixtures.
- Classification is deterministic JavaScript in `src/documinder-core.js`. Never use an LLM node for dates or classification.
- The n8n Code node "Classify credentials" embeds `src/documinder-core.js`. If one changes, update the other. Run `npm test` after any logic change.
- Keep workflows **unpublished** until that phase's exit check passes. Don't add a Schedule Trigger before Phase 3 passes.
- Don't add email, LLM, or renewal nodes before their phase. Phase 2 only records previews (status `previewed`); real sending is Phase 3.
- Secrets live in `.env` (gitignored) and the local-scope MCP config only. Never commit or echo tokens.

## Environment
- Local n8n 2.42.6 at http://localhost:5678, installed in `~/n8n-local` with a private Node 24 (n8n won't run on Node 26). Start it with `scripts/start-n8n.sh`.
- Claude Code talks to n8n through n8n's **built-in** MCP server (`/mcp-server/http`), registered by `scripts/connect-mcp.sh`.
- Data tables use the `documinder_` prefix. See `docs/data-model.md`. Reload fixtures with `node scripts/load-fixtures.mjs` (REST API) or the MCP `add_data_table_rows` tool.
- Workflow changes: edit `src/` or `scripts/build-workflow.mjs`, then run `node scripts/build-workflow.mjs && node scripts/sync-workflow.mjs MHC2jTQjXDrkaNW5 "<version name>"`. This validates the code, applies the diff through MCP `update_workflow` (same ID, version history kept), and re-exports `workflows/daily-review.json`. Run it with `node scripts/run-workflow.mjs MHC2jTQjXDrkaNW5 "Phase 1 Test Report" "Phase 2 Run Summary"`.
- Live workflow: "Documinder · A · Daily Review" (id MHC2jTQjXDrkaNW5), unpublished.
