// Item 1: two user turns over ONE process via stream-json stdin.
import { launch, summarizeTypes, finalText, usageOf, initSummary } from './lib.mjs';

const h = launch({ sample: 'samples/multiturn.jsonl', args: ['--no-session-persistence'] });

h.send('Remember the number 7319. Reply with exactly: ok');
const init = await h.waitInit();
console.log('INIT:', JSON.stringify(initSummary(init), null, 1).slice(0, 1500));
const r1 = await h.waitResult();
console.log('TURN1 result:', finalText(r1), '| session_id:', r1.session_id, '| usage:', usageOf(r1));

const n1 = h.events.length;
h.send('What number did I ask you to remember? Reply with only the digits.');
const r2 = await h.waitFor((e) => e.type === 'result' && h.events.indexOf(e) >= n1);
console.log('TURN2 result:', finalText(r2), '| session_id:', r2.session_id, '| usage:', usageOf(r2));

h.close();
const d = await h.done;
console.log('exit', d.code, d.stderr ? 'stderr:' + d.stderr.slice(0, 300) : '');
console.log('EVENT TYPES:', summarizeTypes(h.events));
// where does session_id appear?
const withSid = {};
for (const e of h.events) if (e.session_id) withSid[e.type + (e.subtype ? '/' + e.subtype : '')] = true;
console.log('session_id present on:', Object.keys(withSid));
console.log('GO:', /7319/.test(finalText(r2)) ? 'YES' : 'NO');
