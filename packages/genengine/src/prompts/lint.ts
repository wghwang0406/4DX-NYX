// 프롬프트 린트 — 규칙 10개(CLAUDE.md) + Lira anti-fail 에서 기계적으로 잡을 수 있는 것만. 경고이지 차단이 아니다.

export interface LintOptions {
  /** 시트 프롬프트는 rule of thirds 예외 (Lira). */
  sheet?: boolean
  /** 편집·영상은 국소 negative 허용. 생성 프롬프트는 긍정 우선. */
  edit?: boolean
}

const EMOTION = /\b(angry|furious|sad|happy|joyful|scared|terrified|nervous|anxious|excited|depressed|cheerful|worried|afraid|shocked)\b/gi
const BRAND = /\b(pixar|disney|dreamworks|ghibli|marvel|netflix|nintendo|sony|apple|nike|coca[- ]cola)\b/gi
const TRANSITION = /\b(starts? to|begins? to|turns? (to|around)|picks? up|pulls? out|reaches? for|walks? over|stands? up|sits? down)\b/gi
const PLATFORM = /\b(16:9|21:9|9:16|4:3|1:1|[1248]k resolution|resolution|aspect ratio)\b/gi
const STACK = /\b(masterpiece|trending on artstation|best quality|8k|ultra detailed|highly detailed)\b/gi
const ILLUSTRATION = /\b(character reference sheet|painterly)\b/gi
const VAGUE = /\b(near|beside|around|nearby|next to)\b/gi
const NEGATIVE = /\b(no|without|not)\b/gi
const LENS = /\b(\d{2,3}\s?mm|f\/\d(\.\d)?|iso\s?\d{3,5}|cooke|arri|zeiss|leica)\b/gi

function hits(text: string, re: RegExp): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(re)) out.add(m[0].toLowerCase())
  return [...out]
}

export function lintPrompt(text: string, o: LintOptions = {}): string[] {
  const warn: string[] = []
  const emo = hits(text, EMOTION)
  if (emo.length) warn.push(`감정어 대신 근육의 일로: ${emo.join(', ')}`)
  const brand = hits(text, BRAND)
  if (brand.length) warn.push(`브랜드·IP 이름 금지: ${brand.join(', ')}`)
  const tr = hits(text, TRANSITION)
  if (tr.length && !o.edit) warn.push(`전환이 아니라 상태로 (already/mid-/holding): ${tr.join(', ')}`)
  const pf = hits(text, PLATFORM)
  if (pf.length) warn.push(`화면비·해상도는 플랫폼 파라미터 — 본문에서 뺀다: ${pf.join(', ')}`)
  const st = hits(text, STACK)
  if (st.length) warn.push(`키워드 스택 금지: ${st.join(', ')}`)
  const il = hits(text, ILLUSTRATION)
  if (il.length) warn.push(`일러스트 드리프트 트리거: ${il.join(', ')} (film character sheet / studio photographs 로)`)
  if (o.sheet && /rule of thirds/i.test(text)) warn.push('시트에는 rule of thirds 를 쓰지 않는다')
  const vg = hits(text, VAGUE)
  if (vg.length) warn.push(`측정 가능한 블로킹으로 (within 1 meter, hand on the handle): ${vg.join(', ')}`)
  if (!o.edit) {
    const neg = [...text.matchAll(NEGATIVE)].length
    if (neg >= 3) warn.push(`부정문이 많다(${neg}) — 원하는 상태를 긍정으로 (monochrome, empty deserted street)`)
  }
  const lens = hits(text, LENS)
  if (lens.length && !o.sheet) warn.push(`렌즈·장비 수치는 주요 제어로 쓰지 않는다 (대각 화각 + 관찰 결과): ${lens.join(', ')}`)
  if (text.length > 2000) warn.push(`길다 (${text.length}자 > 2000) — 정밀함이 장황함을 이긴다`)
  if (/[가-힣]/.test(text)) warn.push('한글이 섞여 있다 — 영문 슬롯이 비어 한국어 원문으로 대체됨')
  return warn
}
