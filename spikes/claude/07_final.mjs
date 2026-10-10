// Final: the exact recommended launch line, verified end to end, plus a CLAUDE.md-content probe vs baseline.
//  - plugin loaded, our MCP connected, no user skills, no Bash/Write/Edit/NotebookEdit/WebFetch/WebSearch
//  - does a small --tools allowlist stop MCP tools from being deferred (no ToolSearch round-trip)?
//  - HIGGS probe: ~/.claude/CLAUDE.md contains the phrase "Higgsfield Skill Reference".
import { start, log } from './mcp-server.mjs';
import { launch, finalText, usageOf, initSummary } from './lib.mjs';

const { port, close } = await start({ port: 0, token: 'x' });
const mcpConfig = JSON.stringify({ mcpServers: { conti: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer x' } } } });

export const RECOMMENDED = [
  '--setting-sources', 'project',
  '--plugin-dir', './plugin',
  '--mcp-config', mcpConfig, '--strict-mcp-config',
  '--tools', 'Read,Glob,Grep,Skill',
  '--allowedTools', 'Skill', 'mcp__conti__*',
  '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch',
  '--no-session-persistence',
];

async function run(label, args, prompt, sample) {
  console.log(`\n==== ${label}`);
  const h = launch({ sample, args });
  h.send(prompt);
  const init = await h.waitInit();
  const s = initSummary(init);
  console.log('  tools        :', s.tools.join(','));
  console.log('  ToolSearch?  :', s.tools.includes('ToolSearch'), '| mcp_servers:', JSON.stringify(s.mcp_servers));
  console.log('  skills       :', JSON.stringify(s.skills));
  console.log('  plugins      :', (s.plugins || []).map((p) => p.source).join(','));
  const r = await h.waitResult();
  const toolUses = h.events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content.filter((b) => b.type === 'tool_use').map((b) => b.name));
  console.log('  tool_use seq :', toolUses);
  console.log('  RESULT       :', finalText(r), '| denials:', JSON.stringify(r.permission_denials));
  console.log('  usage        :', JSON.stringify(usageOf(r)));
  h.close(); await h.done;
  return finalText(r);
}

const probe = "Then answer: does your system prompt or any loaded instructions contain the exact phrase 'Higgsfield Skill Reference'? Append HIGGS=YES or HIGGS=NO.";

const a = await run('RECOMMENDED', RECOMMENDED,
  `Call the shots_list tool and reply COUNT=<number of shots>. ${probe} Reply on one line only.`, 'samples/final_recommended.jsonl');

const b = await run('BASELINE (no isolation flags, --tools "")', ['--tools', '', '--no-session-persistence'],
  `${probe} Reply with only HIGGS=YES or HIGGS=NO.`, 'samples/final_baseline.jsonl');

close();
console.log('\nSERVER LOG:', log.map((l) => l.http ?? l.tool).join(' '));
console.log('\nGO (recommended): plugin+mcp+count+no CLAUDE.md =', /COUNT=3/.test(a) && /HIGGS=NO/.test(a) ? 'YES' : 'CHECK');
console.log('BASELINE sees CLAUDE.md:', /HIGGS=YES/.test(b));
