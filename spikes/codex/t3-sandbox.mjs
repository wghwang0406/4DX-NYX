// Test 3: sandbox behaviour. arg: read-only | workspace-write
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import fs from 'node:fs';
const mode = process.argv[2] || 'read-only';
const dir = new URL(`./fixtures/sandbox-${mode}`, import.meta.url).pathname;
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const r = await runCodex({
  name: `t3-sandbox-${mode}`,
  prompt: 'Run exactly these two shell commands, one at a time, in the current directory: (a) `curl -s https://example.com | head -c 50` (b) `printf hi > out.txt`. If a command fails or is blocked, do NOT retry and do NOT try any alternative. Finally reply with one line per command: "a: <ok|blocked> <first 20 chars of output or error>" and "b: <ok|blocked> ...".',
  args: [...BASE_ARGS, '-s', mode, '-C', dir],
});
console.log('out.txt exists:', fs.existsSync(`${dir}/out.txt`), fs.existsSync(`${dir}/out.txt`) ? JSON.stringify(fs.readFileSync(`${dir}/out.txt`,'utf8')) : '');
console.log('command items:', JSON.stringify(r.events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>e.item), null, 1));
process.exit(r.code ?? 1);
