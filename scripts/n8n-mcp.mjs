// Minimal MCP (streamable HTTP) client for n8n's built-in MCP server.
// Reads N8N_URL and N8N_MCP_TOKEN from .env. Usable as a CLI or imported as a module.
//
//   node scripts/n8n-mcp.mjs list
//   node scripts/n8n-mcp.mjs schema <tool>
//   node scripts/n8n-mcp.mjs call <tool> '{"json":"args"}'     (or @args.json)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readEnv() {
  return Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

export async function connect(env = readEnv()) {
  if (!env.N8N_MCP_TOKEN) throw new Error('N8N_MCP_TOKEN is missing from .env');
  const url = `${env.N8N_URL || 'http://localhost:5678'}/mcp-server/http`;
  let session;
  let id = 0;

  async function rpc(method, params, notify = false) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.N8N_MCP_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify(body),
    });
    session = res.headers.get('mcp-session-id') || session;
    const text = await res.text();
    if (notify) return null;
    if (!res.ok) throw new Error(`${res.status} ${text}`);
    const msg = (res.headers.get('content-type') || '').includes('text/event-stream')
      ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).find((d) => d.id === body.id)
      : JSON.parse(text);
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result;
  }

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'documinder', version: '0.1.0' } });
  await rpc('notifications/initialized', null, true);

  return {
    instructions: init.instructions,
    listTools: async () => (await rpc('tools/list', {})).tools,
    // Calls a tool and returns its text content parsed as JSON when possible.
    call: async (name, args = {}) => {
      const r = await rpc('tools/call', { name, arguments: args });
      const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (r.isError) throw new Error(`${name}: ${text}`);
      try { return JSON.parse(text); } catch { return text; }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, tool, argStr] = process.argv.slice(2);
  const mcp = await connect();
  if (cmd === 'list') {
    for (const t of await mcp.listTools()) console.log(`${t.name}: ${(t.description || '').split('\n')[0].slice(0, 140)}`);
  } else if (cmd === 'schema') {
    console.log(JSON.stringify((await mcp.listTools()).find((t) => t.name === tool), null, 1));
  } else if (cmd === 'call') {
    const args = argStr ? JSON.parse(argStr.startsWith('@') ? readFileSync(argStr.slice(1), 'utf8') : argStr) : {};
    const out = await mcp.call(tool, args);
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  } else {
    console.log('usage: node scripts/n8n-mcp.mjs list | schema <tool> | call <tool> <json|@file>');
  }
}
