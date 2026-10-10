// Item 2: --session-id <uuid> in process A, exit, then --resume <uuid> in process B.
import { randomUUID } from 'node:crypto';
import { launch, finalText, usageOf, summarizeTypes } from './lib.mjs';

const sid = randomUUID();
console.log('session-id:', sid);

const a = launch({ sample: 'samples/resume_a.jsonl', args: ['--session-id', sid] });
a.send('Remember the number 4482. Reply with exactly: ok');
const ra = await a.waitResult();
console.log('A result:', finalText(ra), '| session_id:', ra.session_id, '| usage:', usageOf(ra));
a.close();
const da = await a.done;
console.log('A exit', da.code, da.stderr.slice(0, 200));

const b = launch({ sample: 'samples/resume_b.jsonl', args: ['--resume', sid] });
b.send('What number did I ask you to remember? Reply with only the digits.');
const initB = await b.waitInit();
console.log('B init session_id:', initB.session_id, '(same as A?', initB.session_id === sid, ')');
const rb = await b.waitResult();
console.log('B result:', finalText(rb), '| session_id:', rb.session_id, '| usage:', usageOf(rb));
b.close();
const db = await b.done;
console.log('B exit', db.code, db.stderr.slice(0, 200));
console.log('B event types:', summarizeTypes(b.events));
console.log('GO:', /4482/.test(finalText(rb)) ? 'YES' : 'NO');
