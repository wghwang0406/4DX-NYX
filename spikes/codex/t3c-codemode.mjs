// Test 3c: read-only + --disable code_mode_host: does a blocked write surface as a command_execution item?
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import fs from 'node:fs';
const dir = new URL('./fixtures/sandbox-ro-nocodemode', import.meta.url).pathname;
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const r = await runCodex({
  name: 't3c-ro-nocodemode',
  prompt: 'Run exactly this shell command once: `printf hi > out.txt`. If it fails or is blocked, do NOT retry and do NOT try alternatives. Then reply with one line: "b: <ok|blocked> <first 30 chars of output or error>".',
  args: [...BASE_ARGS, '--ignore-user-config', '--disable', 'code_mode_host', '-s', 'read-only', '-C', dir],
});
console.log('out.txt exists:', fs.existsSync(`${dir}/out.txt`));
console.log('items:', JSON.stringify(r.events.filter(e=>e.type==='item.completed').map(e=>e.item), null, 1));
