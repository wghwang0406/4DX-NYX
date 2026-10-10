// Shared helper: spawn `claude -p` in stream-json mode, feed user turns over stdin,
// collect every stdout event (NDJSON) and persist raw samples.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const BASE_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-prompts', 'none',
];

export function userMsg(text) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
}

/**
 * Launch claude. Returns a handle with:
 *   send(text)       -> write a user turn
 *   waitResult()     -> resolves on next `result` event
 *   waitInit()       -> resolves on `system/init`
 *   close()          -> end stdin
 *   events[]         -> all parsed events
 *   done             -> promise resolving to {code, signal, stderr}
 */
export function launch({ args = [], extraArgs = [], sample, cwd, env = {} } = {}) {
  const fullArgs = [...BASE_ARGS, ...args, ...extraArgs];
  const child = spawn('claude', fullArgs, {
    cwd: cwd ?? process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events = [];
  let out = null;
  if (sample) {
    mkdirSync(dirname(sample), { recursive: true });
    out = createWriteStream(sample, { flags: 'a' });
    out.write(JSON.stringify({ type: '_spike_meta', ts: new Date().toISOString(), args: fullArgs }) + '\n');
  }
  const waiters = []; // {pred, resolve}
  let buf = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      out?.write(line + '\n');
      let ev;
      try { ev = JSON.parse(line); } catch { ev = { type: '_unparsed', raw: line }; }
      events.push(ev);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(ev)) { waiters[i].resolve(ev); waiters.splice(i, 1); }
      }
    }
  });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => { out?.end(); resolve({ code, signal, stderr }); });
  });
  const waitFor = (pred, ms = 180_000) => new Promise((resolve, reject) => {
    const hit = events.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
    waiters.push({ pred, resolve: (ev) => { clearTimeout(t); resolve(ev); } });
  });
  return {
    child, events, done, args: fullArgs,
    send: (text) => child.stdin.write(userMsg(text)),
    sendRaw: (obj) => child.stdin.write(JSON.stringify(obj) + '\n'),
    close: () => child.stdin.end(),
    kill: () => child.kill('SIGTERM'),
    waitInit: (ms) => waitFor((e) => e.type === 'system' && e.subtype === 'init', ms),
    waitResult: (ms) => waitFor((e) => e.type === 'result', ms),
    waitFor,
  };
}

export function summarizeTypes(events) {
  const counts = {};
  for (const e of events) {
    let k = e.type;
    if (e.type === 'system') k += '/' + e.subtype;
    if (e.type === 'stream_event') k += '/' + e.event?.type;
    if (e.type === 'result') k += '/' + e.subtype;
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

export function finalText(ev) {
  // assistant event -> concatenated text blocks
  if (ev?.type === 'result') return ev.result;
  return (ev?.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function usageOf(result) {
  const u = result?.usage || {};
  return {
    input: u.input_tokens, output: u.output_tokens,
    cache_read: u.cache_read_input_tokens, cache_create: u.cache_creation_input_tokens,
    cost_usd: result?.total_cost_usd, duration_ms: result?.duration_ms, api_ms: result?.duration_api_ms,
    num_turns: result?.num_turns,
  };
}

export function initSummary(init) {
  if (!init) return null;
  return {
    session_id: init.session_id,
    model: init.model,
    permissionMode: init.permissionMode,
    tools: init.tools,
    mcp_servers: init.mcp_servers,
    slash_commands: init.slash_commands,
    skills: init.skills,
    agents: init.agents,
    plugins: init.plugins,
    keys: Object.keys(init),
  };
}
