// Item 4: HTTP MCP via --mcp-config (bearer auth), image content, slow_wait timeout probing.
// usage: node 04_mcp.mjs [waits...]   e.g. node 04_mcp.mjs 20 60 120
import { start, log } from './mcp-server.mjs';
import { launch, finalText, usageOf, initSummary } from './lib.mjs';

const waits = process.argv.slice(2).map(Number);
const { port, close } = await start({ port: 0, token: 'x' });
console.log('MCP server on', port);
const mcpConfig = JSON.stringify({ mcpServers: { conti: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer x' } } } });

const h = launch({
  sample: 'samples/mcp.jsonl',
  args: ['--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__conti__*', '--no-session-persistence'],
  env: process.env.MCP_TOOL_TIMEOUT ? { MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT } : {},
});

function dumpToolEvents(from) {
  const evs = h.events.slice(from);
  for (const e of evs) {
    if (e.type === 'assistant') for (const b of e.message.content) if (b.type === 'tool_use') console.log('  tool_use  :', JSON.stringify({ id: b.id, name: b.name, input: b.input }));
    if (e.type === 'user') for (const b of e.message?.content || []) if (b.type === 'tool_result') {
      const c = b.content;
      const brief = Array.isArray(c) ? c.map((x) => ({ type: x.type, ...(x.type === 'text' ? { text: x.text.slice(0, 120) } : { mimeType: x.source?.media_type ?? x.mimeType, bytes: (x.source?.data ?? x.data ?? '').length }) })) : String(c).slice(0, 120);
      console.log('  tool_result:', JSON.stringify({ tool_use_id: b.tool_use_id, is_error: b.is_error, content: brief, extra_keys: Object.keys(e).filter((k) => !['type', 'message', 'session_id', 'uuid'].includes(k)) }));
    }
    if (e.type === 'system' && e.subtype !== 'init') console.log('  system    :', JSON.stringify(e).slice(0, 300));
    if (e.type === 'result') console.log('  result    :', e.subtype, '| permission_denials:', JSON.stringify(e.permission_denials));
  }
}

let from = 0;
if (!waits.length || process.env.WITH_BASIC) {
  h.send('Call the shots_list tool, then call image_view for shot 0010. Reply in exactly this format: COUNT=<number of shots> COLOR=<dominant color of the image, one word>');
  const init = await h.waitInit();
  const s = initSummary(init);
  console.log('init mcp_servers:', JSON.stringify(s.mcp_servers));
  console.log('init tools (mcp):', s.tools.filter((t) => t.startsWith('mcp__')));
  console.log('init tools (all count):', s.tools.length, '| permissionMode:', s.permissionMode);
  const r = await h.waitResult();
  dumpToolEvents(from);
  console.log('RESULT:', finalText(r), '| usage:', usageOf(r));
  from = h.events.length;
}

for (const sec of waits) {
  const t0 = Date.now();
  h.send(`Call slow_wait with seconds=${sec}. Reply with exactly the text the tool returned, or if the tool errored reply with ERROR: followed by the error text.`);
  const r = await h.waitFor((e) => e.type === 'result' && h.events.indexOf(e) >= from, 600_000);
  console.log(`\n== slow_wait ${sec}s  (wall ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  dumpToolEvents(from);
  console.log('RESULT:', finalText(r), '| usage:', usageOf(r));
  from = h.events.length;
}

h.close();
await h.done;
close();
console.log('\nSERVER LOG:');
for (const l of log) console.log(' ', JSON.stringify(l));
