// 에셋 프롬프트 한·영 맞추기 — 사람은 한글을 읽고 고치고, 생성에는 영문이 쓰인다.
// koToEn: 고친 한글대로 영문을 다시 쓴다 (필드별 원문 규격). enToKo: 영문을 읽기 쉬운 한글로 옮긴다 (여러 에셋을 한 번에).
// 형식 규칙 출처: conti-setup SKILL 필드 규칙 · CLAUDE.md 규칙 6·8·9 · Acting §6 · Lira 장소 카메라 앵커.
// 입력은 <<<INPUT … INPUT>>> 사이 JSON 한 덩어리 (모델이 읽기 쉽고, 검증용 가짜 응답도 이걸 읽는다).
import type { Asset, KoPairEn } from '@conti/domain'

export const KO_TO_EN_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string' }, en: { type: 'string' }, changesKo: { type: 'array', items: { type: 'string' } } },
        required: ['field', 'en', 'changesKo'],
      },
    },
  },
  required: ['fields'],
} as const

export const EN_TO_KO_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, field: { type: 'string' }, ko: { type: 'string' } }, required: ['id', 'field', 'ko'] },
    },
  },
  required: ['items'],
} as const

const ANCHOR_FORMAT: Record<Asset['kind'], string> = {
  char: 'ONE sentence in the CINEDANCE anchor formula: age + role/body type + current state + visual anchors (hair, face, wardrobe, wounds or marks) + props or body state the action needs, ending with "100% matches the reference." Example: "28yo lean female detective, shoulder-length black hair tied back in a low ponytail, worn navy field jacket, right hand bandaged. 100% matches the reference."',
  loc: 'ONE sentence: the place identity + its main elements (layout, materials, landmarks) + light direction and colour temperature. Places only — no people, no actions, no camera or lens words.',
  prop: 'ONE sentence: form, scale, material, wear, and how a hand holds or touches it. Where no logo should show, say so positively ("plain unbranded matte surface"). Weapons in neutral material and function terms.',
}

function fieldFormat(field: KoPairEn, kind: Asset['kind']): string {
  switch (field) {
    case 'anchorEn':
      return ANCHOR_FORMAT[kind]
    case 'cameraAnchorEn':
      return 'A camera anchor for the location in simple words (e.g. "high angle three-quarter wide shot, camera high above the room looking diagonally down at 45 degrees"). No CCTV or fisheye terms, no people, no optics or depth-of-field language.'
    case 'masterProfileEn':
      return 'An acting master profile: ONE English paragraph of 150–220 words in this fixed block order — "Character acting as NAME." → body and posture → psychological engine → vocal profile → tics with their triggers → walking style → a mandatory "However, when X, …" crack clause → optional softening target. Include eye life (saccades, blink quality, catchlight). No wardrobe, camera or colour.'
    case 'voiceEn':
      return 'A voice line: 1–2 sentences inside double quotes, e.g. "A 28-year-old Korean woman from a port city. Low dry alto; clipped, even pace; flattens further under pressure."'
  }
}

export interface KoToEnItem {
  field: KoPairEn
  /** 고친 한글 (기준) */
  ko: string
  /** 지금 영문 (비교·보존 기준) */
  en: string
}

/** 고친 한글대로 영문을 다시 쓴다 — 한 에셋, 여러 필드를 한 번에 */
export function koToEnPrompt(asset: Pick<Asset, 'tag' | 'kind' | 'subkind' | 'state' | 'nameKo'>, items: KoToEnItem[]): string {
  const what = asset.kind === 'char' ? `character (${asset.subkind ?? 'human'})` : asset.kind === 'loc' ? 'location' : 'prop'
  return [
    'You keep a film production asset dictionary consistent. The team reads and edits the Korean text; the English text is what is actually sent to the image and video models.',
    'For each field below, rewrite the English so it says exactly what the edited Korean says.',
    '',
    'Rules:',
    '- The Korean is the source of truth. Carry over every fact in it and invent nothing new.',
    '- Where the current English contradicts the Korean, the Korean wins. Where the Korean is silent, KEEP what the current English already says (ethnicity, role, era, identity details).',
    '- Change as little as possible: keep the current wording wherever it already agrees.',
    '- Positive phrasing, natural prose, no keyword stacks or quality words. No real person names, IP or brand names. Keep ages.',
    '- Each field keeps its own format:',
    ...items.map((it) => `  - ${it.field}: ${fieldFormat(it.field, asset.kind)}`),
    '',
    'Return one entry per field: field (as given), en (the new English), changesKo = short Korean lines naming only what you changed from the current English ("항목: 이전 → 이후", "… 추가", "… 삭제"); empty array if nothing needed changing.',
    '',
    `Asset: ${asset.tag} — ${what}${asset.state && asset.state !== 'base' ? `, state "${asset.state}"` : ''}, name (Korean) ${asset.nameKo}`,
    '<<<INPUT',
    JSON.stringify(items.map((it) => ({ field: it.field, koEdited: it.ko.trim(), enCurrent: it.en.trim() })), null, 1),
    'INPUT>>>',
  ].join('\n')
}

export interface EnToKoItem {
  /** 에셋 id */
  id: string
  tag: string
  field: KoPairEn
  en: string
}

/** 영문 프롬프트를 사람이 읽고 고칠 한글로 — 여러 에셋·필드를 한 번에 */
export function enToKoPrompt(items: EnToKoItem[]): string {
  return [
    'Translate each English film-production prompt below into natural Korean that the team will read and edit.',
    '- Faithful: the same facts in the same order, nothing added or dropped. Plain Korean production wording, not a word-for-word gloss.',
    '- Keep the structure: an acting master profile stays one paragraph in the same block order; a voice line keeps its double quotes.',
    '- The fixed tail "100% matches the reference." becomes "(레퍼런스와 100% 동일)".',
    '- Keep @tags and proper nouns as they are.',
    'Return one entry per input item with the same id and field.',
    '<<<INPUT',
    JSON.stringify(items.map((it) => ({ id: it.id, field: it.field, tag: it.tag, en: it.en.trim() })), null, 1),
    'INPUT>>>',
  ].join('\n')
}

/** <<<INPUT … INPUT>>> 의 JSON (검증용 가짜 응답이 쓴다) */
export function promptInput<T>(prompt: string): T | null {
  const m = /<<<INPUT\n([\s\S]*?)\nINPUT>>>/.exec(prompt)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as T
  } catch {
    return null
  }
}
