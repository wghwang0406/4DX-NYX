// Helper: spawn codex exec, feed prompt on stdin, save JSONL to samples/<name>.jsonl,
// print a compact summary. Exported for other scripts; also runnable:
//   node run-codex.mjs <name> "<prompt>" -- <extra codex args...>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES = path.join(HERE, 'samples');
fs.mkdirSync(SAMPLES, { recursive: true });

export const BASE_ARGS = ['--json', '--skip-git-repo-check'];

export function runCodex({ name, prompt, args = [], env = {}, cwd = HERE, sub = null, killAfterMs = 0, killWhen = null, killDelayMs = 2000 }) {
  return new Promise((resolve) => {
    const argv = sub ? ['exec', ...sub, ...args] : ['exec', ...args];
    if (prompt != null) argv.push('-'); // read prompt from stdin
    const t0 = Date.now();
    const child = spawn('codex', argv, {
      cwd, env: { ...process.env, ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = fs.createWriteStream(path.join(SAMPLES, `${name}.jsonl`));
    const errLog = fs.createWriteStream(path.join(SAMPLES, `${name}.stderr.txt`));
    const events = [];
    let killed = false;
    let buf = '';
    child.stdout.on('data', (d) => {
      out.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line); events.push(ev); printEvent(ev, t0);
          if (killWhen && !killed && killWhen(ev)) {
            killed = true;
            setTimeout(() => {
              console.log(`  >> event-triggered kill of process group -${child.pid} (+${killDelayMs}ms)`);
              try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { console.log('  kill err', e.message); }
            }, killDelayMs);
          }
        }
        catch { console.log('  [non-json]', line.slice(0, 200)); }
      }
    });
    child.stderr.on('data', (d) => { errLog.write(d); process.stderr.write('  [stderr] ' + d); });
    if (prompt != null) { child.stdin.end(prompt); } else { child.stdin.end(); }
    if (killAfterMs) {
      setTimeout(() => {
        killed = true;
        console.log(`  >> killing process group -${child.pid} after ${killAfterMs}ms`);
        try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { console.log('  kill err', e.message); }
      }, killAfterMs);
    }
    child.on('exit', (code, signal) => {
      out.end(); errLog.end();
      const ms = Date.now() - t0;
      const usage = events.filter((e) => e.type === 'turn.completed').map((e) => e.usage);
      const thread = events.find((e) => e.type === 'thread.started')?.thread_id;
      const last = [...events].reverse().find((e) => e.type === 'item.completed' && e.item?.type === 'agent_message')?.item?.text;
      console.log(`== ${name}: exit=${code} signal=${signal} ms=${ms} pid=${child.pid} thread=${thread}`);
      console.log(`   usage=${JSON.stringify(usage)}`);
      console.log(`   last_message=${JSON.stringify(last)}`);
      resolve({ code, signal, ms, pid: child.pid, events, usage, thread, last, killed, argv });
    });
  });
}

function printEvent(ev, t0) {
  const dt = ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
  const it = ev.item;
  if (it) {
    const extra = it.type === 'command_execution' ? ` cmd=${JSON.stringify(it.command)} status=${it.status} exit=${it.exit_code}`
      : it.type === 'agent_message' ? ` text=${JSON.stringify((it.text ?? '').slice(0, 120))}`
      : it.type === 'mcp_tool_call' ? ` server=${it.server} tool=${it.tool} status=${it.status}`
      : ` keys=${Object.keys(it).join(',')}`;
    console.log(`  ${dt}s ${ev.type} [${it.type}#${it.id}]${extra}`);
  } else {
    const { type, ...rest } = ev;
    console.log(`  ${dt}s ${type} ${JSON.stringify(rest).slice(0, 300)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, prompt, dashdash, ...rest] = process.argv.slice(2);
  const r = await runCodex({ name, prompt, args: [...BASE_ARGS, ...(dashdash === '--' ? rest : [])] });
  process.exit(r.code ?? 1);
}
