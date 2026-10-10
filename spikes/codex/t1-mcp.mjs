// Test 1: HTTP MCP server via -c overrides (bearer_token_env_var + http_headers)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCodex, BASE_ARGS } from './run-codex.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 47123;
const TOKEN = 'spike-token-' + Math.random().toString(36).slice(2);
const variant = process.argv[2] || 'bearer'; // bearer | headers

const srv = spawn('node', [path.join(HERE, 'mcp-server.mjs'), String(PORT)], {
  env: { ...process.env, CONTI_MCP_TOKEN: TOKEN }, stdio: ['ignore', 'inherit', 'pipe'],
});
import fs from 'node:fs';
const srvLog = fs.createWriteStream(path.join(HERE, 'samples', `t1-mcp-${variant}${process.argv[4] === 'ignore' ? '-ignore' : ''}.server.log`));
srv.stderr.on('data', (d) => { srvLog.write(d); process.stderr.write('  [mcp-srv] ' + d); });
await new Promise((r) => setTimeout(r, 600));

const authArgs = variant === 'headers'
  ? ['-c', `mcp_servers.conti.http_headers={Authorization="Bearer ${TOKEN}", X-Conti-Test="1"}`]
  : ['-c', 'mcp_servers.conti.bearer_token_env_var="CONTI_MCP_TOKEN"'];

const r = await runCodex({
  name: `t1-mcp-${variant}${process.argv[4] === 'ignore' ? '-ignore' : ''}`,
  prompt: 'Call the MCP tool shots_list (seq "S41"), then call image_view for shot "0010". Then reply with exactly: ok',
  env: { CONTI_MCP_TOKEN: TOKEN },
  args: [...BASE_ARGS, ...(process.argv[4] === 'ignore' ? ['--ignore-user-config'] : []), '-s', 'read-only', '-C', HERE,
    '-c', `mcp_servers.conti.url="http://127.0.0.1:${PORT}/mcp"`,
    ...authArgs,
    '-c', 'mcp_servers.conti.startup_timeout_sec=20',
    '-c', `mcp_servers.conti.default_tools_approval_mode="${process.argv[3] || 'approve'}"`,
  ],
});
const mcpItems = r.events.filter((e) => e.item?.type === 'mcp_tool_call');
console.log('\nMCP items:', JSON.stringify(mcpItems, null, 1).slice(0, 4000));
srv.kill();
process.exit(r.code ?? 1);
