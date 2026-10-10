// Item 6: --json-schema structured output in non-stream -p mode (--output-format json).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const schema = JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'integer' } }, required: ['ok', 'n'], additionalProperties: false });
// GOTCHA: variadic flags (--tools, --allowedTools, --disallowedTools, --mcp-config) swallow a trailing
// positional prompt. Feed the prompt via stdin instead (that's how the app will do it anyway).
const args = ['-p', '--output-format', 'json', '--json-schema', schema, '--no-session-persistence', '--setting-sources', 'project', '--tools', ''];
const t0 = Date.now();
const r = await new Promise((resolve) => {
  const c = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (err += d));
  c.on('close', (code) => resolve({ code, out, err }));
  c.stdin.end('Return ok=true and n=42.\n');
});
mkdirSync('samples', { recursive: true });
writeFileSync('samples/schema.json', r.out);
console.log('exit', r.code, 'wall', Date.now() - t0, 'ms', r.err ? '| stderr: ' + r.err.slice(0, 300) : '');
let parsed;
try { parsed = JSON.parse(r.out); } catch { console.log('stdout not JSON:', r.out.slice(0, 500)); process.exit(1); }
console.log('top-level keys:', Object.keys(parsed));
console.log('subtype:', parsed.subtype, '| result (text):', JSON.stringify(parsed.result)?.slice(0, 200));
console.log('structured_output:', JSON.stringify(parsed.structured_output));
console.log('usage:', JSON.stringify(parsed.usage), '| cost:', parsed.total_cost_usd);
const so = parsed.structured_output;
console.log('GO:', so && so.ok === true && so.n === 42 ? 'YES' : 'NO');
