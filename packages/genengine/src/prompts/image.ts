// 이미지 단계(콘티 → 영상용 최종 이미지) 프롬프트 — GenConti2Img v1.4.0 "프롬프트 작성 규칙" 템플릿 그대로.
//   {스타일 앵커}.
//   {샷 사이즈}, {카메라 앵글} — {인물}, {표정: 근육의 일}.
//   Follow each character reference image exactly for all character appearance, clothing, and style.
//   Follow the background reference image for the environment, materials and lighting direction only.
//   Use the storyboard image for shot size, camera angle, and composition only — do NOT copy … do NOT inherit its color.
//   Rule of thirds. Exactly {N} people in frame{, exactly one 소품}.
//   Clean plate with no lettering: unmarked surfaces, no subtitles, no watermarks, no storyboard annotations.
// 쓰지 않는 것: 캐릭터 외형(시트가 담당), 위치·포즈·행동(콘티가 담당), 씬 설명·대사, 스타일 문장 직접(프로젝트 상수에서), 화면비.
import type { Asset, Project, Shot } from '@conti/domain'
import { DEFAULT_CINEMATIC_STYLE, type BuiltPrompt } from './conti'
import { lintPrompt } from './lint'

export type ImageRefRole = 'char' | 'loc' | 'background' | 'prop' | 'conti'
export interface ImageRef {
  role: ImageRefRole
  tag?: string
  view?: string
  file: string
  label: string
}

export type ImageAnalysis = NonNullable<Shot['imageAnalysis']>

const SIZE_EN: Record<string, string> = {
  EWS: 'extreme wide shot',
  WS: 'wide shot',
  LS: 'wide shot',
  MWS: 'medium wide shot',
  MLS: 'medium wide shot',
  MS: 'medium shot',
  MCU: 'medium close-up',
  CU: 'close-up',
  ECU: 'extreme close-up',
  BCU: 'extreme close-up',
  OTS: 'over-the-shoulder shot',
  POV: 'point-of-view shot',
  INSERT: 'insert close-up',
}

/** 스킬 고정 락 문장 — 국소 negative 가 의도된 줄이라 린트의 부정문 개수에서 뺀다 */
export const STORYBOARD_LINE =
  'Use the storyboard image for shot size, camera angle, and composition only — do NOT copy character appearance or art style from it, and do NOT inherit its color.'
export const CLEAN_PLATE_LINE = 'Clean plate with no lettering: unmarked surfaces, no subtitles, no watermarks, no storyboard annotations.'
export const CHAR_LINE = 'Follow each character reference image exactly for all character appearance, clothing, and style.'
export const BG_LINE = 'Follow the background reference image for the environment, materials and lighting direction only.'
export const PROP_LINE = "Follow the prop reference image for the prop's shape, scale and material only."

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()
const sentence = (s: string) => (s ? (/[.!?]$/.test(s) ? s : `${s}.`) : '')

/** 최종 이미지 룩 = 프로젝트 스타일 앵커(Projectprompt). 없으면 시네마틱 콘티 문구 → 기본값 (스킬: DETECTED_STYLE 폴백). */
export function finalStyleLine(project: Project): string {
  return clean(project.style.anchorEn) || clean(project.style.contiCinematicEn) || DEFAULT_CINEMATIC_STYLE
}

/** 이미지 단계 샷 사이즈 → 레퍼런스 뷰 (GenConti2Img 표). loc_top 은 붙이지 않는다. */
export function imageViewsForShotSize(size: string | undefined, charView?: 'front' | 'back'): { loc: string; char: string; prop: string } {
  const s = (size ?? '').toUpperCase()
  const base =
    s === 'EWS' || s === 'WS' || s === 'LS'
      ? { loc: 'wide', char: 'front', prop: '34' }
      : s === 'CU' || s === 'ECU' || s === 'BCU'
        ? { loc: 'detail', char: 'face', prop: 'detail' }
        : s === 'INSERT'
          ? { loc: 'detail', char: 'front', prop: 'detail' }
          : { loc: '34', char: 'front', prop: '34' } // MS / MWS / MLS / OTS / MCU / POV
  return charView === 'back' ? { ...base, char: 'back' } : base
}

export function buildShotImagePrompt(i: { project: Project; shot: Shot; assets: Asset[]; refs: ImageRef[]; analysis?: ImageAnalysis }): BuiltPrompt {
  const a = i.analysis
  const num = (r: ImageRef) => i.refs.indexOf(r) + 1
  const chars = i.refs.filter((r) => r.role === 'char')
  const props = i.refs.filter((r) => r.role === 'prop')
  const hasBg = i.refs.some((r) => r.role === 'loc' || r.role === 'background')
  const hasConti = i.refs.some((r) => r.role === 'conti')
  const lines: string[] = []

  lines.push(sentence(finalStyleLine(i.project)))

  const size = SIZE_EN[(a?.shotSize ?? i.shot.sizeCode ?? '').toUpperCase()] ?? 'medium shot'
  const angle = clean(a?.angleEn) || clean(i.shot.angle) || 'eye-level'
  // 인물은 이름 대신 레퍼런스 번호로 묶는다 (본문에 한글·외형을 넣지 않는다)
  const who = chars.map((r) => `the character from reference image ${num(r)}`)
  const missing = i.shot.characters.filter((t) => !chars.some((r) => r.tag === t)).length
  if (missing) who.push(missing === 1 ? 'one more character' : `${missing} more characters`)
  const expr = clean(a?.expressionEn)
  lines.push(who.length ? `${size}, ${angle} — ${who.join(' and ')}${expr ? `, ${expr.replace(/\.$/, '')}` : ''}.` : `${size}, ${angle}.`)

  if (chars.length) lines.push(CHAR_LINE)
  if (hasBg) lines.push(BG_LINE)
  if (props.length) lines.push(PROP_LINE)
  if (hasConti) lines.push(STORYBOARD_LINE)
  else if (clean(a?.compositionEn)) lines.push(`Composition: ${sentence(clean(a?.compositionEn))}`)

  const people = a?.people ?? i.shot.characters.length
  const propCount = i.shot.props.length
  const counts = people > 0 ? `Exactly ${people === 1 ? 'one person' : `${people} people`} in frame` : 'Empty frame with the location itself as the subject'
  const propText = props.length ? props.map((r) => `exactly one prop from reference image ${num(r)}`).join(', ') : propCount ? `exactly ${propCount === 1 ? 'one prop' : `${propCount} props`}` : ''
  lines.push(`Rule of thirds. ${counts}${propText ? `, ${propText}` : ''}.`)
  lines.push(CLEAN_PLATE_LINE)

  const text = lines.filter(Boolean).join('\n')
  // 스킬의 고정 락 문장은 의도된 국소 negative — 그 줄을 뺀 나머지만 린트
  const lintable = text.replace(STORYBOARD_LINE, '').replace(CLEAN_PLATE_LINE, '')
  return { text, warnings: lintPrompt(lintable) }
}
