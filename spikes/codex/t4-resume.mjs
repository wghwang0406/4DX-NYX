// Test 4: resume from another cwd with --all (resume has no -C flag)
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import fs from 'node:fs';
const thread = process.argv[2] || fs.readFileSync(new URL('./samples/t2.thread', import.meta.url), 'utf8').trim();
const projB = new URL('./fixtures/projB', import.meta.url).pathname;
const r = await runCodex({
  name: 't4-resume',
  sub: ['resume', thread, '--all'],
  prompt: 'Two things: 1) repeat the codename you gave earlier. 2) run `pwd` and report its output verbatim. One line each.',
  args: [...BASE_ARGS], // NOTE: `exec resume` has no -s / -C flags
  cwd: projB,
});
console.log('thread.started id on resume:', r.thread, 'expected', thread);
process.exit(r.code ?? 1);
