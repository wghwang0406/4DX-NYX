// Test 2: AGENTS.md pickup + skill file referenced by absolute path
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import fs from 'node:fs';
const projA = new URL('./fixtures/projA', import.meta.url).pathname;
const r = await runCodex({
  name: 't2-agents',
  prompt: 'Two questions. 1) What is the project codename? 2) Greet me. Answer each on its own line, nothing else.',
  args: [...BASE_ARGS, '-s', 'read-only', '-C', projA],
});
fs.writeFileSync(new URL('./samples/t2.thread', import.meta.url), r.thread ?? '');
console.log('files read (command_execution items):', r.events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>e.item.command));
process.exit(r.code ?? 1);
