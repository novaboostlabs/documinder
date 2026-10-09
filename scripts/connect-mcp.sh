#!/bin/zsh
# Registers n8n's built-in MCP server with Claude Code (local scope: token stays in ~/.claude.json, never in the repo).
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example and add N8N_MCP_TOKEN)"; exit 1; }
N8N_MCP_TOKEN=$(grep -E '^N8N_MCP_TOKEN=' .env | cut -d= -f2-)
N8N_URL=$(grep -E '^N8N_URL=' .env | cut -d= -f2-)
N8N_URL=${N8N_URL:-http://localhost:5678}
[ -n "$N8N_MCP_TOKEN" ] || { echo "N8N_MCP_TOKEN is empty in .env"; exit 1; }
claude mcp remove n8n -s local >/dev/null 2>&1 || true
claude mcp add --transport http -s local n8n "$N8N_URL/mcp-server/http" --header "Authorization: Bearer $N8N_MCP_TOKEN" >/dev/null
echo "Registered n8n MCP at $N8N_URL/mcp-server/http (local scope)."
