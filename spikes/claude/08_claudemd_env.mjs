// Does CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 hide ~/.claude/CLAUDE.md while keeping plugin + MCP + OAuth?
import { start, log } from './mcp-server.mjs';
import { launch, finalText, usageOf, initSummary } from './lib.mjs';

const { port, close } = await start({ port: 0, token: 'x' });
const mcpConfig = JSON.stringify({ mcpServers: { conti: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer x' } } } });
const args = [
  '--setting-sources', 'project',
  '--plugin-dir', './plugin',
  '--mcp-config', mcpConfig, '--strict-mcp-config',
  '--tools', 'Read,Glob,Grep,Skill',
  '--allowedTools', 'Skill', 'mcp__conti__*',
  '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch',
  '--no-session-persistence',
];
const h = launch({ sample: 'samples/final_recommended_env.jsonl', args, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
h.send("Call the shots_list tool and reply COUNT=<number of shots>. Then: does your system prompt or any loaded instructions contain the exact phrase 'Higgsfield Skill Reference'? Append HIGGS=YES or HIGGS=NO. One line only.");
const init = await h.waitInit();
const s = initSummary(init);
console.log('tools   :', s.tools.join(','));
console.log('mcp     :', JSON.stringify(s.mcp_servers), '| plugins:', (s.plugins || []).map((p) => p.source).join(','));
console.log('skills  :', JSON.stringify(s.skills));
console.log('memory_paths:', JSON.stringify(init.memory_paths), '| apiKeySource:', init.apiKeySource);
const r = await h.waitResult();
console.log('RESULT  :', finalText(r), '| subtype:', r.subtype);
console.log('usage   :', JSON.stringify(usageOf(r)));
h.close(); await h.done; close();
console.log('SERVER LOG:', log.map((l) => l.http ?? l.tool).join(' '));
console.log('GO:', /COUNT=3/.test(finalText(r)) && /HIGGS=NO/.test(finalText(r)) ? 'YES' : 'NO');
