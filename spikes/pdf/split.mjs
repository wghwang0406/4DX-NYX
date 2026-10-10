// split.mjs — samples/<name>.lines.json 을 읽어
//   1) 씬 헤딩 감지 (정규식 + 폰트 크기/들여쓰기 보강)
//   2) 줄 분류: heading / speaker / dialogue / paren / action / meta
//   3) samples/<name>.scenes.json 저장 + 통계 출력
//
// usage: node split.mjs samples/<name>.lines.json [--sample 30] [--seed 7] [--regex-only]
import fs from 'node:fs';
import path from 'node:path';

// ───────────────────────── 헤딩 정규식 ─────────────────────────
// 실제 세 PDF 가 쓰는 형식:
//   고래별 : "41. 군산 외곽 도로 -D"            (번호. 장소 -D/-N, '–'(en dash) 혼용, "(N or D)" 도 있음)
//   남벌   : "17. 대마도 노예 수용소 노역장 / 외부. 어두운 낮."  (번호. 장소 / 외부|내부. 시간어)
//   AWAKE  : "1막 — 인트로" > "Sequence 4. 바람의 세계 — 준 + 아리" > "Scene 2. 아리 등장"  (3단 계층, Scene 번호는 Sequence 마다 1부터)
export const HEADING_PATTERNS = [
  // 번호. 제목 [-D|-N|/ 외부. 낮 ...]   ← 고래별·남벌 공통 (한국 드라마/영화 대본 표준)
  { name: 'num-dot',   re: /^\s*(\d{1,3})\s*\.\s*(?!\d)(.+?)\s*$/u, kind: 'scene' },
  // S#12 / S12 / 씬12 / #12   ← 세 PDF 에는 없지만 흔한 변형
  { name: 's-hash',    re: /^\s*S#?\s*(\d{1,3})\s*[.:]?\s*(.*)$/u, kind: 'scene' },
  { name: 'ssin',      re: /^\s*(?:씬|신|장면)\s*(\d{1,3})\s*[.:]?\s*(.*)$/u, kind: 'scene' },
  { name: 'hash',      re: /^\s*#\s*(\d{1,3})\s*[.:]?\s*(.*)$/u, kind: 'scene' },
  // AWAKE 식 영문 계층
  { name: 'scene-en',  re: /^\s*Scene\s*(\d{1,3})\s*\.?\s*(.*)$/iu, kind: 'scene' },
  { name: 'seq-en',    re: /^\s*Sequence\s*(\d{1,3})\s*\.?\s*(.*)$/iu, kind: 'sequence' },
  { name: 'act-ko',    re: /^\s*(\d{1,2})막\s*(?:[—–-]\s*(.*))?$/u, kind: 'act' },
];

// 헤딩 꼬리에서 장소/시간 분리
const TIME_TAIL = /\s*[-–—]\s*\(?\s*([DN])\s*(?:or\s*[DN])?\s*\)?\s*\.?$/u;      // "-D" "–N" "(N or D)"
const TIME_TAIL2 = /\s*\(\s*([DN])\s*or\s*([DN])\s*\)\s*$/u;                       // "(N or D)"
const INOUT_TAIL = /\s*\/\s*(외부|내부|실내|실외|EXT|INT)\s*[.,]?\s*(.*?)\s*\.?$/iu; // "/ 외부. 어두운 낮."
const TIME_WORDS = /(새벽|아침|오전|낮|오후|저녁|해질녘|밤|심야|비|D|N)/u;

export function parseHeading(rest) {
  let location = rest, time = null, inout = null, flashback = false;
  let m;
  if ((m = location.match(/^\s*\((회상|플래시백|FLASHBACK)\)\s*/u)) || (m = location.match(/^\s*(플래시백|회상|에필로그|프롤로그)\s*\.\s*/u))) {
    flashback = /회상|플래시백|FLASH/i.test(m[1]); location = location.slice(m[0].length);
    if (!flashback) location = m[1] + '. ' + location; // 에필로그/프롤로그는 장소에 남김
  }
  if ((m = location.match(TIME_TAIL2))) { time = `${m[1]} or ${m[2]}`; location = location.slice(0, m.index); }
  else if ((m = location.match(INOUT_TAIL))) { inout = m[1]; time = m[2] || null; location = location.slice(0, m.index); }
  else if ((m = location.match(TIME_TAIL))) { time = m[1]; location = location.slice(0, m.index); }
  return { location: location.trim().replace(/\s*\/\s*/g, '/ '), time, inout, flashback };
}

// ───────────────────────── 문서 통계 ─────────────────────────
function mode(arr, bin = 1) {
  const c = new Map();
  for (const v of arr) { const k = Math.round(v / bin) * bin; c.set(k, (c.get(k) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function analyze(doc, opts = {}) {
  const all = doc.pages.flatMap(p => p.lines);
  const bodyH = mode(all.map(l => l.h), 0.1);            // 본문 폰트 높이 (최빈값)
  const xAction = mode(all.filter(l => Math.abs(l.h - bodyH) < 0.6).map(l => l.x), 1); // 본문 왼쪽 여백
  const pageW = doc.pages[0].width;

  // 1) 페이지 가구(meta): 쪽번호, 반복 헤더/워터마크, 가운데 정렬 큰 글씨
  const repeat = new Map();
  for (const l of all) repeat.set(l.text, (repeat.get(l.text) || 0) + 1);
  const isMeta = (l) =>
    /^[-–—]\s*\d+\s*[-–—]$/.test(l.text) || /^\d+$/.test(l.text) ||                    // "- 3 -"
    (repeat.get(l.text) >= Math.max(3, doc.numPages * 0.5)) ||                           // 매 페이지 반복 (헤더/워터마크)
    (l.h > bodyH * 2.2);                                                                // 워터마크/표지 대제목

  // 2) 헤딩 감지 (regex) + 보강 신호(폰트 더 큼 OR 본문 x 와 같음 & 짧음)
  const regexHits = [];
  const lines = all.map((l, i) => {
    const o = { i, page: l.page, x: l.x, h: l.h, text: l.text, segs: l.segs, type: null };
    if (isMeta(l)) { o.type = 'meta'; return o; }
    for (const p of HEADING_PATTERNS) {
      const m = l.text.match(p.re);
      if (!m) continue;
      const num = +m[1], rest = (m[2] || '').trim();
      const bigger = l.h > bodyH + 0.5;
      const leftAligned = Math.abs(l.x - xAction) < 12;
      // '1409년. 태종 9년' 같은 자막, '3. 뭔가 목록' 같은 본문 열거 방지:
      //  - num-dot 은 (폰트가 더 크거나) (왼쪽 정렬 + 끝이 시간/장소 꼬리) 일 때만 확정
      let confirmed = true;
      if (p.name === 'num-dot') {
        const hasTail = TIME_TAIL.test(rest) || INOUT_TAIL.test(rest) || TIME_TAIL2.test(rest);
        confirmed = bigger || (leftAligned && hasTail);
      }
      regexHits.push({ pattern: p.name, confirmed, page: l.page, text: l.text });
      if (confirmed || opts.regexOnly) {
        o.type = 'heading'; o.kind = p.kind; o.num = num; o.pattern = p.name;
        Object.assign(o, p.kind === 'scene' ? parseHeading(rest) : { title: rest });
      }
      break;
    }
    return o;
  });

  // 3) 화자/대사: (a) "이름: 대사" (b) 같은 줄에 [짧은 이름 item] + [큰 간격] + [대사 item]
  // 이름(들): '임억' '수아NA' '여자1E' '임억,윤관' '임억.' '보경/소화' 까지 허용 — 쉼표/슬래시 연결, 끝 마침표 허용
  const SPEAKER_NAME = /^[가-힣A-Za-z0-9·]{1,10}(?:[,/&][가-힣A-Za-z0-9·]{1,10}){0,3}(?:\s?(?:NA|E|V\.?O\.?|O\.?S\.?|F|\(NA\)|\(E\)|\(V\.O\)|\(O\.S\)))?\.?$/u;
  const COLON = /^([가-힣A-Za-z0-9·]{1,8}(?:\s?\((?:NA|E|V\.?O\.?|O\.?S\.?)\))?)\s*[:：]\s*(.*)$/u;
  const dialogXs = [];
  const firstHeading = lines.findIndex(o => o.type === 'heading');
  const splitSpeaker = (o) => {
    // "이름: 대사" 는 첫 씬 헤딩 이후에만 (표지의 '장르:' '로그라인:' 오검출 방지)
    let m = o.i > firstHeading && o.text.match(COLON);
    if (m) return { speaker: m[1], dialogue: m[2], dx: null };
    const segs = (o.segs || []).filter(s => s.text.trim() !== '');
    if (segs.length >= 2 && SPEAKER_NAME.test(segs[0].text.trim())) {
      const gap = segs[1].x - (segs[0].x + segs[0].w);
      if (gap >= 8) return { speaker: segs[0].text.trim().replace(/\.$/, ''), dialogue: segs.slice(1).map(s => s.text).join(' ').trim(), dx: segs[1].x };
    }
    return null;
  };
  for (const o of lines) {
    if (o.type) continue;
    const sp = splitSpeaker(o);
    if (sp) { o.type = 'speaker'; o.speaker = sp.speaker; o.dialogueText = sp.dialogue; if (sp.dx) dialogXs.push(sp.dx); }
  }
  const xDialogue = dialogXs.length ? mode(dialogXs, 1) : null;   // 대사 열 x (고래별 165 / 남벌 125)
  const xSpeaker = mode(lines.filter(o => o.type === 'speaker' && o.segs?.length >= 2).map(o => o.x), 1); // 화자 열 x

  // 4) 나머지: 들여쓰기 클러스터로 대사 이어짐 / 지문 / 지시문
  let prev = null;
  for (const o of lines) {
    if (o.type === 'meta') continue;
    if (o.type) { prev = o; continue; }
    const t = o.text;
    const parenOnly = /^\([^()]*\)$/.test(t) || /^（[^（）]*）$/.test(t);   // 괄호 하나로만 된 줄 (지시문)
    const indentFromAction = o.x - xAction;
    const atDialogueX = xDialogue != null ? Math.abs(o.x - xDialogue) < 6 : indentFromAction > 12;
    const afterDialogue = prev && (prev.type === 'speaker' || prev.type === 'dialogue' || prev.type === 'paren');
    if (parenOnly) o.type = (atDialogueX || afterDialogue) ? 'paren' : 'action';
    else if (atDialogueX) o.type = 'dialogue';                        // 대사 열에 맞춰 들여쓴 줄
    else if (indentFromAction > 12 && afterDialogue) o.type = 'dialogue'; // AWAKE: 31.6 들여쓰기 이어짐
    else if (indentFromAction > 12 && Math.abs(o.x + (o.segs?.at(-1)?.x + o.segs?.at(-1)?.w - o.x) / 2 - pageW / 2) < 40) o.type = 'caption'; // 가운데 정렬 자막
    else o.type = 'action';
    prev = o;
  }

  // 5) 씬 묶기
  const scenes = [];
  let cur = null, seqCtx = null, actCtx = null;
  const preamble = [];
  for (const o of lines) {
    if (o.type === 'meta') continue;
    if (o.type === 'heading') {
      if (o.kind === 'act') { actCtx = { num: o.num, title: o.title }; continue; }
      if (o.kind === 'sequence') { seqCtx = { num: o.num, title: o.title }; continue; }
      cur = { id: seqCtx ? `${seqCtx.num}.${o.num}` : String(o.num), num: o.num, heading: o.text, page: o.page,
              location: o.location, time: o.time, inout: o.inout, flashback: o.flashback,
              act: actCtx, sequence: seqCtx, lines: [] };
      scenes.push(cur);
      continue;
    }
    const rec = { type: o.type, page: o.page, x: o.x, text: o.text };
    if (o.type === 'speaker') { rec.speaker = o.speaker; rec.text = o.dialogueText; }
    (cur ? cur.lines : preamble).push(rec);
  }
  return { file: doc.file, bodyH, xAction, xSpeaker, xDialogue, regexHits, lines, scenes, preamble };
}

// ───────────────────────── CLI ─────────────────────────
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find(a => a.endsWith('.json'));
  const sampleN = args.includes('--sample') ? +args[args.indexOf('--sample') + 1] : 0;
  const seed = args.includes('--seed') ? +args[args.indexOf('--seed') + 1] : 7;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = analyze(doc, { regexOnly: args.includes('--regex-only') });
  const out = file.replace(/\.lines\.json$/, '.scenes.json');
  fs.writeFileSync(out, JSON.stringify({ file: res.file, bodyH: res.bodyH, xAction: res.xAction, xSpeaker: res.xSpeaker, xDialogue: res.xDialogue, preamble: res.preamble, scenes: res.scenes }, null, 1));

  const counts = {};
  for (const o of res.lines) counts[o.type] = (counts[o.type] || 0) + 1;
  console.log(`\n=== ${res.file}`);
  console.log(`bodyH=${res.bodyH} xAction=${res.xAction} xSpeaker=${res.xSpeaker} xDialogue=${res.xDialogue}`);
  console.log(`line types:`, JSON.stringify(counts));
  console.log(`scenes: ${res.scenes.length}  (regex hits: ${res.regexHits.length}, unconfirmed: ${res.regexHits.filter(h => !h.confirmed).length})`);
  for (const h of res.regexHits.filter(h => !h.confirmed)) console.log(`  unconfirmed [${h.pattern}] p${h.page}: ${h.text}`);
  const byPat = {}; for (const h of res.regexHits.filter(h => h.confirmed)) byPat[h.pattern] = (byPat[h.pattern] || 0) + 1;
  console.log(`patterns:`, JSON.stringify(byPat));
  console.log(`examples:`);
  for (const s of [res.scenes[0], res.scenes[Math.floor(res.scenes.length / 2)], res.scenes.at(-1)]) if (s)
    console.log(`  id=${s.id} p${s.page} "${s.heading}" → loc="${s.location}" time=${s.time} inout=${s.inout} fb=${s.flashback} lines=${s.lines.length} speakers=${[...new Set(s.lines.filter(l => l.speaker).map(l => l.speaker))].join(',')}`);
  // 번호 연속성 검사 (누락/중복 = 헤딩 미검출/오검출 힌트)
  const nums = res.scenes.map(s => s.num);
  const gaps = []; for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1 && nums[i] !== 1) gaps.push(`${nums[i - 1]}→${nums[i]}`);
  console.log(`number gaps: ${gaps.length ? gaps.join(' ') : 'none'}`);
  const speakers = {}; for (const o of res.lines) if (o.speaker) speakers[o.speaker] = (speakers[o.speaker] || 0) + 1;
  console.log(`speakers (top 15):`, Object.entries(speakers).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log(`saved → ${out}`);

  if (sampleN) {
    const rnd = mulberry32(seed);
    const pool = res.lines.filter(o => o.type !== 'meta' && o.type !== 'heading');
    const picked = new Set(); while (picked.size < Math.min(sampleN, pool.length)) picked.add(Math.floor(rnd() * pool.length));
    console.log(`\n--- sample ${sampleN} (seed ${seed}) ---`);
    for (const i of [...picked].sort((a, b) => a - b)) {
      const o = pool[i];
      console.log(`p${o.page} x${o.x} [${o.type}${o.speaker ? ':' + o.speaker : ''}] ${o.speaker ? o.dialogueText : o.text}`);
    }
  }
}
