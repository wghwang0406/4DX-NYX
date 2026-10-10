// Item 3: --plugin-dir ./plugin ; ask for conti:ping skill with --allowedTools Skill.
// ("/conti:ping" as raw message text is exercised in 05_isolation.mjs config B to save a call.)
import { launch, finalText, usageOf, initSummary } from './lib.mjs';

const h = launch({
  sample: 'samples/plugin.jsonl',
  args: ['--plugin-dir', './plugin', '--allowedTools', 'Skill', '--no-session-persistence'],
});
h.send('Use the conti:ping skill now and reply only with what it says.');
const init = await h.waitInit();
const s = initSummary(init);
console.log('init keys:', s.keys);
console.log('plugins:', JSON.stringify(init.plugins));
console.log('skills:', JSON.stringify(init.skills));
console.log('slash_commands containing conti:', (s.slash_commands || []).filter((c) => /conti/i.test(c)));
const r = await h.waitResult();
const toolUses = h.events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content.filter((b) => b.type === 'tool_use'));
console.log('tool_use blocks:', JSON.stringify(toolUses));
const toolResults = h.events.filter((e) => e.type === 'user').flatMap((e) => (e.message?.content || []).filter((b) => b.type === 'tool_result'));
console.log('tool_result blocks:', JSON.stringify(toolResults).slice(0, 800));
console.log('RESULT:', finalText(r), '| usage:', usageOf(r));
h.close();
await h.done;
console.log('GO:', /PONG-FROM-PLUGIN/.test(finalText(r)) ? 'YES' : 'NO');
