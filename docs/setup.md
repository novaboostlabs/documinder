# Setup: local n8n and Claude Code MCP

## 1. Run n8n locally

n8n 2.x needs Node 24 (it doesn't install on Node 26). This project installs n8n into its own folder with a private Node 24 binary, so the system Node is left alone:

```bash
mkdir -p ~/n8n-local && cd ~/n8n-local && npm init -y
npm install node@24
PATH="$HOME/n8n-local/node_modules/node/bin:$PATH" npm install n8n@2.42.6
PATH="$HOME/n8n-local/node_modules/node/bin:$PATH" npm approve-scripts sqlite3 && npm rebuild sqlite3
```

Start it with [`scripts/start-n8n.sh`](../scripts/start-n8n.sh), which sets the business timezone to `America/Los_Angeles` and turns off telemetry:

```bash
./scripts/start-n8n.sh
```

The editor opens at <http://localhost:5678>. The first time, n8n asks you to create the owner account.

## 2. Turn on n8n's built-in MCP server

n8n 2.x has its own MCP server, so no third-party package is needed. Its tools include `search_workflows`, `create_workflow_from_code`, `update_workflow`, `validate_workflow_code`, `search_workflow_nodes`, `get_workflow_node_types`, `create_data_table`, `add_data_table_rows`, `get_data_table_rows`, `test_workflow`, `execute_workflow`, and `get_workflow_execution`.

1. In n8n, open **Settings → Instance-level MCP** and turn it on.
2. Copy the **MCP access token**.
3. Paste it into this repo's `.env` file as `N8N_MCP_TOKEN=...`. The file is gitignored, so the token is never committed or pasted into chat.

## 3. Connect Claude Code

From the repo folder, register the server at **local** scope. The token is stored only in your user config (`~/.claude.json`), not in the repo.

```bash
./scripts/connect-mcp.sh
```

Start a new Claude Code session and confirm `n8n` shows as connected:

```bash
claude mcp list
```

## 4. (Optional) Public REST API key

`scripts/load-fixtures.mjs` uses n8n's public REST API (`/api/v1/data-tables`) to load the fixture CSVs without MCP. Create a key under **Settings → n8n API** and save it in `.env` as `N8N_API_KEY=...`.

## 5. Load data and import the workflow (any n8n 2.x)

```bash
node scripts/load-fixtures.mjs
```

This creates the eight `documinder_*` data tables and loads the fictional fixtures. It uses MCP, or the REST API if `N8N_API_KEY` is set.

Then, in n8n, choose **Workflows → Import from file** and import [`daily-review.json`](../workflows/daily-review.json), [`renewals.json`](../workflows/renewals.json), and [`reset-demo.json`](../workflows/reset-demo.json). The Send Email node needs your own SMTP credential. The Data Table nodes find their tables **by name**, so there are no IDs to re-link. Click **Execute workflow**. The last node, **Phase 1 Test Report**, should show `exit_check: "PASS"`.

## How the workflow is built

[`scripts/build-workflow.mjs`](../scripts/build-workflow.mjs) embeds [`src/documinder-core.js`](../src/documinder-core.js) in the **Classify Credentials** Code node and writes n8n Workflow SDK code to [`workflows/daily-review.sdk.js`](../workflows/daily-review.sdk.js). Claude Code then runs, through the MCP server:

1. `validate_workflow`, to check the SDK code;
2. `create_workflow_from_code` (first time). After that, [`scripts/sync-workflow.mjs`](../scripts/sync-workflow.mjs) compiles the code into a temporary draft, diffs it against the live workflow, and applies the difference as one atomic `update_workflow` batch, so the workflow ID and version history are kept;
3. `execute_workflow` and `get_workflow_execution`, via [`scripts/run-workflow.mjs`](../scripts/run-workflow.mjs), to run it and read the report nodes;
4. `get_workflow_details`, to export the result to `workflows/daily-review.json`.

[`scripts/n8n-mcp.mjs`](../scripts/n8n-mcp.mjs) is a small dependency-free MCP client that runs the same calls from a terminal.

## Try the renewal forms

Open **Documinder · B · Renewal Intake & Review** in n8n, click **Execute workflow**, and choose a form trigger. n8n opens the test form in your browser:

1. **Submit Renewal Form:** pick a driver and a document type, then enter a future date and any `https://` link.
2. Note the renewal ID on the result page (for example `RN-42`). It also appears in `documinder_renewals`.
3. **Review Renewal Form:** enter that ID, `compliance.reviewer@example.com`, and approve or reject.
4. Check `documinder_documents`: on approval, the old version is `archived` and a new `verified` version exists.

Run **Documinder · Dev · Reset Demo Data** to put everything back.
