import type { Project } from '@conti/domain'

// Projectprompt.md — 스타일 앵커의 고정된 자리(버그 f). 앱은 "## Style Anchor" 절만 소유하고
// 나머지 절(Project Identity, 공간 설명 등)은 사용자가 자유롭게 쓴다.

export const STYLE_ANCHOR_HEADING = '## Style Anchor (앱 관리 — 아래 네 줄은 앱이 갱신)'

/** 앵커 값은 한 줄 항목이라 줄바꿈을 공백으로 편다 (파서가 줄 단위라 다음 줄이 잘리지 않게). */
export const mdLine = (s: string) => s.replace(/\s*\r?\n+\s*/g, ' ').trim()

export function renderStyleAnchorSection(p: Project): string {
  return [
    STYLE_ANCHOR_HEADING,
    `- anchor_en: ${mdLine(p.style.anchorEn)}`,
    `- conti_sketch_en: ${mdLine(p.style.contiSketchEn)}`,
    `- conti_cinematic_en: ${mdLine(p.style.contiCinematicEn)}`,
    `- palette_en: ${mdLine(p.style.paletteEn)}`,
    '',
  ].join('\n')
}

/** 기존 Projectprompt.md 에 앵커 절이 없으면 맨 위에 넣고, 있으면 그 절만 교체한다. */
export function upsertStyleAnchor(existing: string, p: Project): string {
  const section = renderStyleAnchorSection(p)
  const idx = existing.indexOf(STYLE_ANCHOR_HEADING)
  if (idx === -1) {
    const title = existing.startsWith('# ') ? '' : `# ${mdLine(p.title)} — Master Projectprompt\n\n`
    return existing.trim() ? `${title}${existing.trimEnd()}\n\n---\n\n${section}` : `${title}${section}`
  }
  // 절의 끝 = 다음 '## ' 또는 '---' 또는 EOF
  const rest = existing.slice(idx + STYLE_ANCHOR_HEADING.length)
  const m = /\n(?=## |---)/.exec(rest)
  const end = m ? idx + STYLE_ANCHOR_HEADING.length + m.index + 1 : existing.length
  return existing.slice(0, idx) + section + existing.slice(end)
}

export function parseStyleAnchor(text: string): Partial<Project['style']> {
  const idx = text.indexOf(STYLE_ANCHOR_HEADING)
  if (idx === -1) return {}
  const block = text.slice(idx)
  // `\s*` 는 줄바꿈까지 먹어서 값이 비면 다음 줄(`- conti_cinematic_en: …`)을 값으로 읽었다 — 같은 줄 공백만
  const pick = (k: string) => new RegExp(`^- ${k}:[ \\t]*(.*)$`, 'm').exec(block)?.[1]?.trim()
  return {
    anchorEn: pick('anchor_en'),
    contiSketchEn: pick('conti_sketch_en'),
    contiCinematicEn: pick('conti_cinematic_en'),
    paletteEn: pick('palette_en'),
  }
}
