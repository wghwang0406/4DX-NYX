// Test 6: kill process tree after 3s while codex runs `sleep 30`; check for orphans
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import { execSync } from 'node:child_process';
const here = new URL('.', import.meta.url).pathname;
const r = await runCodex({
  name: 't6-interrupt',
  prompt: 'Run the shell command `sleep 30` and then reply with exactly: ok',
  args: [...BASE_ARGS, '-s', 'read-only', '-C', here],
  killWhen: (ev) => ev.type === 'item.started' && ev.item?.type === 'command_execution',
  killDelayMs: 2000,
});
await new Promise((r) => setTimeout(r, 1500));
const pg = (pat) => { try { return execSync(`pgrep -fl '${pat}'`, { encoding: 'utf8' }).trim(); } catch { return '(none)'; } };
console.log('after kill: `codex exec` procs:\n' + pg('codex exec'));
console.log('after kill: our pid alive?', (() => { try { process.kill(r.pid, 0); return 'YES (orphan!)'; } catch { return 'no'; } })());
console.log('after kill: sleep 30 procs:\n' + pg('sleep 30'));
