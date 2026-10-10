// Item 5: which flag set hides the user's ~/.claude customizations while keeping plugin + our MCP.
// usage: node 05_isolation.mjs A B C D   (configs; see below)
import { start, log } from './mcp-server.mjs';
import { launch, finalText, usageOf, initSummary } from './lib.mjs';

const { port, close } = await start({ port: 0, token: 'x' });
const mcpConfig = JSON.stringify({ mcpServers: { conti: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer x' } } } });
const common = ['--plugin-dir', './plugin', '--mcp-config', mcpConfig, '--strict-mcp-config', '--no-session-persistence'];
const deny = ['--disallowedTools', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch'];

const CONFIGS = {
  A: { label: 'safe-mode', args: ['--safe-mode', ...common, ...deny, '--allowedTools', 'Skill', 'mcp__conti__*'], prompt: '/conti:ping' },
  B: { label: 'setting-sources project', args: ['--setting-sources', 'project', ...common, ...deny, '--allowedTools', 'Skill', 'mcp__conti__*'], prompt: '/conti:ping' },
  C: { label: 'setting-sources "" (empty)', args: ['--setting-sources', '', ...common, ...deny, '--allowedTools', 'Skill', 'mcp__conti__*'], prompt: '/conti:ping' },
  D: { label: 'bare (expected: auth fails on OAuth -> free check)', args: ['--bare', ...common, ...deny], prompt: 'reply with exactly: ok' },
  E: { label: 'restricted + setting-sources project', args: ['--restricted', '--setting-sources', 'project', ...common, '--allowedTools', 'Skill', 'mcp__conti__*'], prompt: '/conti:ping' },
};

const userSkillNames = ['GenSetup', 'GenVideo', 'Lira', 'Cinedance', 'Acting', 'GenT2I'];

for (const key of process.argv.slice(2)) {
  const cfg = CONFIGS[key];
  if (!cfg) { console.log('unknown config', key); continue; }
  console.log(`\n==== [${key}] ${cfg.label}\n     flags: ${cfg.args.filter((a) => !a.startsWith('{')).join(' ')}`);
  const h = launch({ sample: `samples/isolation_${key}.jsonl`, args: cfg.args });
  h.send(cfg.prompt);
  let init;
  try { init = await h.waitInit(60_000); } catch (e) { console.log('  no init event:', e.message); }
  let r;
  try { r = await h.waitResult(120_000); } catch (e) { console.log('  no result:', e.message); }
  h.close();
  const d = await h.done;
  if (init) {
    const s = initSummary(init);
    const userSkillsLoaded = (s.slash_commands || []).filter((c) => userSkillNames.includes(c));
    const contiCmds = (s.slash_commands || []).filter((c) => /conti/i.test(c));
    console.log('  tools         :', s.tools.join(','));
    console.log('  has Bash/Write/Edit/WebFetch/WebSearch:', ['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch'].filter((t) => s.tools.includes(t)));
    console.log('  mcp_servers   :', JSON.stringify(s.mcp_servers));
    console.log('  plugins       :', JSON.stringify(s.plugins));
    console.log('  user Gen* skills loaded:', userSkillsLoaded, '| total slash_commands:', (s.slash_commands || []).length);
    console.log('  conti commands:', contiCmds);
    console.log('  skills field  :', JSON.stringify(s.skills));
  }
  if (r) {
    const text = finalText(r);
    console.log('  RESULT        :', String(text).slice(0, 300), '| subtype:', r.subtype);
    console.log('  usage         :', JSON.stringify(usageOf(r)));
    // CLAUDE.md evidence: cache_create size is a rough proxy; also check for the system prompt? not exposed.
    const toolUses = h.events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content.filter((b) => b.type === 'tool_use').map((b) => b.name + ':' + JSON.stringify(b.input).slice(0, 80)));
    console.log('  tool_uses     :', toolUses);
    console.log('  PONG?         :', /PONG-FROM-PLUGIN/.test(text));
  }
  console.log('  exit', d.code, d.stderr ? '| stderr: ' + d.stderr.slice(0, 400).replace(/\n/g, ' ') : '');
  const errs = h.events.filter((e) => e.type === 'result' && e.subtype !== 'success');
  if (errs.length) console.log('  result errors:', JSON.stringify(errs).slice(0, 400));
}
close();
console.log('\nSERVER LOG:', log.map((l) => l.http ?? l.tool).join(' '));
