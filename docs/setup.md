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
