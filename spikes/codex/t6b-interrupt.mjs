// Test 6b: capture process tree while `sleep 30` runs, then SIGINT codex (its Ctrl-C path),
// wait, and report whether sleep / codex descendants survive. Fallback: kill captured descendants.
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import { execSync, spawnSync } from 'node:child_process';
const here = new URL('.', import.meta.url).pathname;
const sh = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch (e) { return (e.stdout || '').trim(); } };
const tree = () => sh(`ps -axo pid,ppid,pgid,command | grep -E 'sleep 30|bin/codex exec|sandbox-exec|zsh -lc' | grep -v grep`);
const descendants = (root) => { const out = []; const walk = (p) => { for (const c of sh(`pgrep -P ${p}`).split('\n').filter(Boolean)) { out.push(Number(c)); walk(c); } }; walk(root); return out; };
let before = '', desc = [], rootPid = 0;
const r = await runCodex({
  name: 't6b-interrupt',
  prompt: 'Run the shell command `sleep 30` and then reply with exactly: ok',
  args: [...BASE_ARGS, '--ignore-user-config', '-s', 'read-only', '-C', here],
  killWhen: (ev) => {
    if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
      setTimeout(() => {
        before = tree();
        console.log('tree while sleep runs:\n' + before);
        rootPid = Number(sh(`pgrep -f 'bin/codex exec' | head -1`)) ; // native binary pid
        desc = descendants(rootPid);
        console.log('native codex pid', rootPid, 'descendants', desc);
        // Strategy A: SIGINT to the native binary (Codex Ctrl-C path)
        console.log('>> sending SIGINT to native codex', rootPid);
        try { process.kill(rootPid, 'SIGINT'); } catch (e) { console.log('sigint err', e.message); }
      }, 800);
      return true; // group SIGTERM follows at killDelayMs as fallback
    }
    return false;
  },
  killDelayMs: 1500,
});
// NOTE: runCodex sends SIGTERM to the group at killDelayMs; we snapshot the tree just before that via a race below.
console.log('exit:', r.code, r.signal, 'ms', r.ms);
await new Promise((r) => setTimeout(r, 1500));
console.log('tree 1.5s after exit:\n' + (tree() || '(none)'));
const alive = desc.filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } });
console.log('captured descendants still alive:', alive);
if (alive.length) { console.log('>> Strategy B: SIGKILL captured descendants'); for (const p of alive.reverse()) { try { process.kill(p, 'SIGKILL'); } catch {} } await new Promise((r) => setTimeout(r, 500)); console.log('tree after descendant kill:\n' + (tree() || '(none)')); }
