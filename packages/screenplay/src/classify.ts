import type { SourceLine } from './split'

export type LineKind = 'action' | 'speaker' | 'dialogue' | 'paren' | 'transition' | 'caption' | 'blank'
export type SpeechMode = 'NA' | 'E' | 'VO' | 'OS' | 'F'

export interface ClassifiedLine extends SourceLine {
  kind: LineKind
  speaker?: string // dialogue 줄이면 화자
  mode?: SpeechMode // NA(내레이션) / E(효과·화면 밖) / VO / OS
  paren?: string // "(잠시)" 같은 괄호 지문
  items?: Array<{ str: string; x: number; w: number }>
}

const TRANSITION = /^\s*(CUT TO|FADE IN|FADE OUT|DISSOLVE TO|INS\b|INSERT|몽타주|MONTAGE|자막|\/INS)/i
// "해수: 여기서 멈춰." / "해수 (E) 여기서…" / "해수(V.O.)"
const INLINE_SPEAKER = /^\s*([가-힣A-Za-z0-9·]{1,12}(?:\s?\((?:NA|E|V\.?O\.?|O\.?S\.?)\))?)\s*[:：]\s*(.+)$/
// 화자 단독(또는 PDF 첫 item): 이름(+공동 화자)(+NA/E 꼬리)(+마침표 오타)
const SPEAKER_TOKEN = /^([가-힣A-Za-z0-9·]{1,10}(?:[,/&][가-힣A-Za-z0-9·]{1,10}){0,3}?)\s?(NA|E|V\.?O\.?|O\.?S\.?|F|\(NA\)|\(E\))?\.?$/
const PAREN_ONLY = /^\s*[(（]([^()（）]{1,40})[)）]\s*$/
const LEADING_PAREN = /^[(（]([^()（）]{1,40})[)）]\s*(.*)$/

/**
 * 줄 분류.
 * - PDF 줄(items 있음): 첫 item 이 화자 패턴이고 다음 item 과 간격이 넓으면 "화자 + 대사" 한 줄로 본다 (스파이크 §4).
 * - 들여쓰기(x)가 있으면 "대사 이어짐은 대사 x 에 정렬" 규칙.
 * - 텍스트 입력: `이름:` 패턴과 화자 단독 줄 → 다음 줄 대사.
 */
export function classifyLines(lines: Array<SourceLine & { items?: ClassifiedLine['items'] }>): ClassifiedLine[] {
  const xs = lines.filter((l) => l.text.trim() && l.x != null).map((l) => l.x as number)
  const bodyX = mode(xs)
  const out: ClassifiedLine[] = []
  let pendingSpeaker: string | null = null
  let pendingMode: SpeechMode | undefined
  let dialogueX: number | null = null // PDF 에서 대사 item 이 시작하는 x (고래별 165, 남벌 125)

  for (const l of lines) {
    const t = l.text.trim()
    if (!t) {
      pendingSpeaker = null
      out.push({ ...l, kind: 'blank' })
      continue
    }
    if (TRANSITION.test(t)) {
      pendingSpeaker = null
      out.push({ ...l, kind: 'transition' })
      continue
    }
    const pm = PAREN_ONLY.exec(t)
    if (pm) {
      out.push({ ...l, kind: 'paren', paren: pm[1].trim(), speaker: pendingSpeaker ?? undefined })
      continue
    }

    // 1) PDF item 경계: [화자][넓은 간격][대사…]
    const items = l.items?.filter((i) => i.str.trim())
    if (items && items.length >= 2) {
      const first = items[0].str.trim()
      const sp = parseSpeaker(first)
      const gap = items[1].x - (items[0].x + items[0].w)
      if (sp && gap >= 6) {
        const rest = items.slice(1).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
        const { paren, text } = splitLeadingParen(rest)
        pendingSpeaker = sp.name
        pendingMode = sp.mode
        if (dialogueX == null) dialogueX = Math.round(items[1].x)
        out.push({ ...l, text, kind: 'dialogue', speaker: sp.name, mode: sp.mode, paren })
        continue
      }
    }

    // 2) "이름: 대사"
    const im = INLINE_SPEAKER.exec(t)
    if (im) {
      const sp = parseSpeaker(im[1].replace(/\s?\((NA|E|V\.?O\.?|O\.?S\.?)\)/, ' $1'))
      const { paren, text } = splitLeadingParen(im[2].trim())
      pendingSpeaker = sp?.name ?? im[1].trim()
      pendingMode = sp?.mode
      out.push({ ...l, text, kind: 'dialogue', speaker: pendingSpeaker, mode: pendingMode, paren })
      continue
    }

    // 3) 화자 단독 줄
    const sp = parseSpeaker(t)
    if (sp && isLikelyName(sp.name) && (!items || items.length === 1)) {
      pendingSpeaker = sp.name
      pendingMode = sp.mode
      out.push({ ...l, kind: 'speaker', speaker: sp.name, mode: sp.mode })
      continue
    }

    // 4) 대사 이어짐: 대사 x 에 정렬(PDF) 또는 지문보다 들여쓴 줄(텍스트)
    const x = l.x
    const alignedToDialogue = dialogueX != null && x != null && Math.abs(x - dialogueX) < 6
    const indented = bodyX != null && x != null && x >= bodyX + (l.fontH ? 12 : 2)
    if (pendingSpeaker && (alignedToDialogue || indented)) {
      out.push({ ...l, text: t, kind: 'dialogue', speaker: pendingSpeaker, mode: pendingMode })
      continue
    }

    // 5) 자막(가운데 정렬·들여쓴 짧은 줄) — PDF 에서만
    if (l.fontH && bodyX != null && x != null && x > bodyX + 60 && t.length <= 40 && !pendingSpeaker) {
      out.push({ ...l, kind: 'caption' })
      continue
    }

    pendingSpeaker = null
    pendingMode = undefined
    out.push({ ...l, kind: 'action' })
  }
  return out
}

export function parseSpeaker(s: string): { name: string; mode?: SpeechMode } | null {
  const m = SPEAKER_TOKEN.exec(s.trim())
  if (!m) return null
  let name = m[1].trim()
  let tail = m[2]
  if (!tail) {
    const tm = /^(.{1,8}?)(NA|E)$/.exec(name)
    if (tm && !/^[A-Z]+$/.test(tm[1])) {
      name = tm[1]
      tail = tm[2]
    }
  }
  if (!isLikelyName(name)) return null
  const raw = tail?.replace(/[().]/g, '').toUpperCase()
  const mode = raw === 'NA' ? 'NA' : raw === 'E' ? 'E' : raw === 'VO' ? 'VO' : raw === 'OS' ? 'OS' : raw === 'F' ? 'F' : undefined
  return { name, mode }
}

function splitLeadingParen(text: string): { paren?: string; text: string } {
  const pp = LEADING_PAREN.exec(text)
  return pp ? { paren: pp[1].trim(), text: pp[2].trim() } : { text }
}

function isLikelyName(s: string): boolean {
  // 1~10글자 이름(공동 화자 포함). 조사·문장형·숫자만 제외
  if (!/^[가-힣A-Za-z0-9·,/&]{1,30}$/.test(s)) return false
  if (/^\d+$/.test(s)) return false
  const parts = s.split(/[,/&]/)
  return parts.every((p) => p.length >= 1 && p.length <= 10 && !/(은|는|이|가|을|를|에서|으로|한다|했다)$/.test(p))
}

function mode(nums: number[]): number | null {
  if (!nums.length) return null
  const count = new Map<number, number>()
  for (const n of nums) count.set(n, (count.get(n) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
