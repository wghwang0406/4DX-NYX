// 씬 분리 — 한국 시나리오 헤딩 형식들. M0 스파이크(실제 대본 3편)에서 확인한 규칙 반영.

export interface SourceLine {
  n: number // 1-based
  text: string
  x?: number // 들여쓰기(PDF 좌표 또는 선행 공백 수)
  fontH?: number // PDF 폰트 높이 — 헤딩 확정에 쓴다
}

export interface SceneChunk {
  index: number // 0-based 순서
  number: string | null // 시나리오에 적힌 씬 번호 ("41", "41-1", AWAKE 계층은 "4.2")
  headingRaw: string
  title: string // 장소 등 헤딩 본문
  timeOfDay: 'D' | 'N' | null
  intExt?: '내부' | '외부'
  prefix?: string // (회상) / 플래시백 / 에필로그
  lineStart: number
  lineEnd: number // inclusive
  lines: SourceLine[]
}

export interface HeadingMatch {
  number: string
  title: string
  timeOfDay: 'D' | 'N' | null
  intExt?: '내부' | '외부'
  prefix?: string
  strong: boolean // 형식 자체가 헤딩임을 보장하는가 (S#, 씬, Scene …). 약하면 폰트/꼬리로 확정
  level?: 'act' | 'sequence' | 'scene'
}

// 강한 형식: S#41 / S41. / 씬 41 / 신 41 / 장면 41 / #41 / Scene 41 / Sequence 4 / 1막
const STRONG: Array<{ re: RegExp; level?: HeadingMatch['level'] }> = [
  { re: /^\s*S\s*#?\s*(\d{1,3}(?:-\d+)?)\s*[.:)]?\s+(.*?)\s*$/ },
  { re: /^\s*(?:씬|신|장면)\s*#?\s*(\d{1,3}(?:-\d+)?)\s*[.:)]?\s*(.*?)\s*$/ },
  { re: /^\s*#\s*(\d{1,3}(?:-\d+)?)\s*[.:)]?\s+(.*?)\s*$/ },
  { re: /^\s*Scene\s*(\d{1,3})\s*\.?\s*(.*?)\s*$/i, level: 'scene' },
  { re: /^\s*Sequence\s*(\d{1,3})\s*\.?\s*(.*?)\s*$/i, level: 'sequence' },
  { re: /^\s*(\d{1,2})막\s*(?:[—–-]\s*(.*))?$/, level: 'act' },
]
// 약한 형식: "41. 군산 외곽 도로 -D" — 본문 열거("3. 어쩌구")와 겹치므로 확정 조건이 필요하다
const WEAK = /^\s*(\d{1,3}(?:-\d+)?)\s*[.)]\s*(?![\d\s])(.+?)\s*$/

const TAIL_DN = /\s*[-–—]\s*\(?\s*([DN])\s*(?:or\s*[DN])?\s*\)?\s*\.?$/
const TAIL_PAREN_DN = /\s*\(\s*([DN])\s*(?:or\s*[DN])?\s*\)\s*\.?$/
const TAIL_INTEXT = /\s*\/\s*(외부|내부|실내|실외|EXT|INT)\s*[.,]?\s*(.*?)\s*\.?$/i
const TAIL_KO_TIME = /[\s/(\-–—]+(낮|밤|새벽|저녁|아침|DAY|NIGHT)\s*\)?\s*\.?$/i
const PREFIX = /^\s*(?:\((회상|플래시백)\)|(플래시백|회상|에필로그|프롤로그)\s*\.)\s*/

export function matchHeading(text: string): HeadingMatch | null {
  const t = text.normalize('NFC').trim()
  if (!t || t.length > 90 || /^\d+$/.test(t)) return null
  for (const { re, level } of STRONG) {
    const m = re.exec(t)
    if (m) return { ...parseTitle(m[2] ?? ''), number: m[1], strong: true, level }
  }
  const m = WEAK.exec(t)
  if (!m) return null
  if (/["“]/.test(m[2]) && m[2].length > 30) return null
  return { ...parseTitle(m[2]), number: m[1], strong: false }
}

function parseTitle(raw: string): Omit<HeadingMatch, 'number' | 'strong' | 'level'> {
  let title = raw.trim()
  let prefix: string | undefined
  const pm = PREFIX.exec(title)
  if (pm) {
    prefix = pm[1] ?? pm[2]
    title = title.slice(pm[0].length)
  }
  let timeOfDay: 'D' | 'N' | null = null
  let intExt: '내부' | '외부' | undefined
  const ie = TAIL_INTEXT.exec(title)
  if (ie) {
    intExt = /^(내부|실내|INT)$/i.test(ie[1]) ? '내부' : '외부'
    const time = ie[2]
    timeOfDay = /밤|저녁|NIGHT/i.test(time) ? 'N' : time ? 'D' : null
    title = title.slice(0, ie.index).trim()
  }
  for (const re of [TAIL_DN, TAIL_PAREN_DN]) {
    const dm = re.exec(title)
    if (dm) {
      timeOfDay = dm[1].toUpperCase() === 'N' ? 'N' : 'D'
      title = title.slice(0, dm.index).trim()
      break
    }
  }
  if (timeOfDay == null) {
    const km = TAIL_KO_TIME.exec(title)
    if (km) {
      timeOfDay = /밤|저녁|NIGHT/i.test(km[1]) ? 'N' : 'D'
      title = title.slice(0, km.index).trim()
    }
  }
  title = title.replace(/[\s/(\-–—]+$/, '').trim()
  return { title, timeOfDay, intExt, prefix }
}

/** 하위호환: 예전 호출부용 */
export function isSceneHeading(text: string): { number: string; title: string; timeOfDay: 'D' | 'N' | null } | null {
  const m = matchHeading(text)
  return m ? { number: m.number, title: m.title, timeOfDay: m.timeOfDay } : null
}

interface DocStats {
  bodyFontH: number | null
  bodyX: number | null
}

function docStats(lines: SourceLine[]): DocStats {
  const fh = lines.filter((l) => l.fontH != null && l.text.trim()).map((l) => l.fontH as number)
  const bodyFontH = modeOf(fh)
  const xs = lines.filter((l) => l.x != null && l.text.trim() && (bodyFontH == null || l.fontH === bodyFontH)).map((l) => l.x as number)
  return { bodyFontH, bodyX: modeOf(xs) }
}

/** 약한 형식(번호.)은 폰트가 본문보다 크거나, 왼쪽 여백에 붙어 있고 시간/장소 꼬리가 있을 때만 헤딩이다. */
function confirm(m: HeadingMatch, line: SourceLine, st: DocStats): boolean {
  if (m.strong) return true
  const hasTail = m.timeOfDay != null || m.intExt != null
  if (st.bodyFontH != null && line.fontH != null) {
    if (line.fontH > st.bodyFontH + 0.5) return true
    if (st.bodyX != null && line.x != null) return Math.abs(line.x - st.bodyX) < 12 && hasTail
    return hasTail
  }
  // 텍스트 입력(좌표 없음): 꼬리가 있거나, 들여쓰기 없는 짧은 줄이면 인정
  if (hasTail) return true
  return (line.x ?? 0) === 0 && m.title.length <= 40
}

export function splitScenes(lines: SourceLine[]): SceneChunk[] {
  const st = docStats(lines)
  const scenes: SceneChunk[] = []
  let cur: SceneChunk | null = null
  let seqNo: string | null = null // AWAKE 식 계층: Sequence 번호
  let seqTitle = '' // 제목 없는 Scene 은 Sequence 제목을 물려받는다
  for (const line of lines) {
    const h = matchHeading(line.text)
    if (h && confirm(h, line, st)) {
      if (h.level === 'act') continue // 막 제목은 씬이 아니다
      if (h.level === 'sequence') {
        seqNo = h.number
        seqTitle = h.title
        continue
      }
      if (cur) {
        cur.lineEnd = line.n - 1
        scenes.push(cur)
      }
      cur = {
        index: scenes.length,
        number: h.level === 'scene' && seqNo ? `${seqNo}.${h.number}` : h.number,
        headingRaw: line.text.trim(),
        title: h.title || (h.level === 'scene' ? seqTitle : ''),
        timeOfDay: h.timeOfDay,
        intExt: h.intExt,
        prefix: h.prefix,
        lineStart: line.n,
        lineEnd: line.n,
        lines: [],
      }
      continue
    }
    if (/^\s*(FADE OUT|THE END|END|끝)\s*\.?\s*$/i.test(line.text) && cur) {
      cur.lineEnd = line.n
      scenes.push(cur)
      cur = null
      continue
    }
    if (cur) cur.lines.push(line)
  }
  if (cur) {
    cur.lineEnd = lines.length ? lines[lines.length - 1].n : cur.lineStart
    scenes.push(cur)
  }
  return scenes
}

export function textToLines(text: string): SourceLine[] {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, i) => ({ n: i + 1, text: raw.normalize('NFC'), x: raw.length - raw.trimStart().length }))
}

/** 씬 번호 → SEQ ID. "41" → S41, "41-1" → S41_1, "4.2"(Sequence 4 Scene 2) → S04_02 */
export function seqIdFromSceneNumber(num: string | null, fallbackIndex: number): string {
  if (!num) return `S${String(fallbackIndex + 1).padStart(2, '0')}`
  if (num.includes('.')) {
    const [a, b] = num.split('.')
    return `S${a.padStart(2, '0')}_${b.padStart(2, '0')}`
  }
  const [main, sub] = num.split('-')
  return `S${main.padStart(2, '0')}${sub ? `_${sub}` : ''}`
}

function modeOf(nums: number[]): number | null {
  if (!nums.length) return null
  const c = new Map<number, number>()
  for (const v of nums) c.set(v, (c.get(v) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
