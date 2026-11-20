// 에셋 카드 [한글대로 영문 맞추기] — 한글 설명(기준)을 보고 외형 앵커(anchorEn, 생성에 실제로 들어가는 문장)를 다시 쓴다.
// 형식은 conti-setup SKILL 의 필드 규칙 + CLAUDE.md 규칙 6·8·9(긍정문 · 키워드 나열 금지 · 실존 인물/브랜드 금지 · 나이는 쓴다).
import type { Asset } from '@conti/domain'

export const ANCHOR_ALIGN_SCHEMA = {
  type: 'object',
  properties: {
    anchorEn: { type: 'string' },
    changesKo: { type: 'array', items: { type: 'string' } },
  },
  required: ['anchorEn', 'changesKo'],
} as const

export interface AnchorAlignDraft {
  nameKo: string
  descriptionKo: string
  /** 지금 칸에 있는 영문 (비교 기준) */
  anchorEn: string
}

const FORMAT: Record<Asset['kind'], string> = {
  char: 'ONE sentence in the CINEDANCE anchor formula: age + role/body type + current state + visual anchors (hair, face, wardrobe, wounds or marks) + props or body state the action needs, then end with "100% matches the reference." Example: "28yo lean female detective, shoulder-length black hair tied back in a low ponytail, worn navy field jacket, right hand bandaged. 100% matches the reference."',
  loc: 'ONE sentence: the place identity + its main elements (layout, materials, landmarks) + light direction and colour temperature. Places only — no people, no actions, no camera or lens words.',
  prop: 'ONE sentence: form, scale, material, wear, and how a hand holds or touches it. Where no logo should show, say so positively ("plain unbranded matte surface"). Weapons in neutral material and function terms.',
}

/** 지시문 — 한글이 기준. 더하지도 빼지도 않는다. */
export function anchorAlignPrompt(asset: Pick<Asset, 'tag' | 'kind' | 'subkind' | 'state'>, draft: AnchorAlignDraft): string {
  const what = asset.kind === 'char' ? `character (${asset.subkind ?? 'human'})` : asset.kind === 'loc' ? 'location' : 'prop'
  return [
    'You keep a film production asset dictionary consistent. The Korean description is the source of truth that the team reads and edits;',
    'the English appearance anchor is what is actually sent to the image models. Rewrite the English anchor so it says exactly what the Korean description says.',
    '',
    'Rules:',
    '- Carry over every visual fact in the Korean — hair state, build, wardrobe, colours, wounds, bandages, dirt, props in hand, materials, light. Invent nothing new.',
    '- Where the current English contradicts the Korean, the Korean wins. Where the Korean is silent, KEEP what the current English already says (ethnicity, role, era, identity details) — the Korean is a short reading summary, not a deletion list.',
    '- Change as little as possible: keep the current wording wherever it already agrees.',
    `- Format: ${FORMAT[asset.kind]}`,
    '- Positive phrasing (write what is there, not what is absent). Natural prose, no keyword stacks, no quality words (4k, masterpiece, trending).',
    '- No real person names, IP or brand names. Keep the age when the Korean gives one (an approximate age like "mid-20s" becomes "25yo" style).',
    '- Appearance only: no camera, lens, framing, mood or acting direction.',
    '',
    'Also return changesKo: short Korean lines naming only what you changed from the CURRENT English, as "항목: 이전 → 이후" or "… 추가" / "… 삭제". Empty array if nothing needed changing.',
    '',
    `Asset: ${asset.tag} — ${what}${asset.state && asset.state !== 'base' ? `, state "${asset.state}"` : ''}`,
    `Name (Korean): ${draft.nameKo}`,
    `Korean description (source of truth):\n${draft.descriptionKo.trim()}`,
    `Current English anchor:\n${draft.anchorEn.trim() || '(empty)'}`,
  ].join('\n')
}
