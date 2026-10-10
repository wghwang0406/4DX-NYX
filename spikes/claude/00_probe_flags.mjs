// Zero-API-call flag probe: start stream-json mode, close stdin at once.
// Unknown flags fail at commander parse time ("error: unknown option").
// Known flags boot, emit nothing or a system/init, then exit on EOF.
import { spawn } from 'node:child_process';

const probes = [
  ['--append-system-prompt-file', '/dev/null'],
  ['--system-prompt-file', '/dev/null'],
  ['--append-system-prompt', 'x'],
  ['--multi_shots'],
  ['--safe-mode'],
  ['--restricted'],
  ['--setting-sources', 'project'],
  ['--setting-sources', ''],
  ['--no-session-persistence'],
  ['--permission-prompts', 'none'],
  ['--disable-slash-commands'],
];

for (const p of probes) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...p];
  const r = await new Promise((resolve) => {
    const c = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 15000);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    c.stdin.end();
  });
  const unknown = /unknown option/i.test(r.err) || /unknown option/i.test(r.out);
  const line = (r.err.trim().split('\n')[0] || r.out.trim().split('\n')[0] || '').slice(0, 120);
  console.log(`${unknown ? 'UNKNOWN' : 'ok     '}  exit=${r.code}  ${p.join(' ').padEnd(38)} | ${line}`);
}
