// 콘티 프롬프트 조립 — AI 가 채운 슬롯(prompts_set) + 프로젝트 상수(style) + 코드가 아는 사실(인원수·레퍼런스 순서).
// 스타일 문장은 project.style 에서만 온다 (한 곳 고치면 전 컷 반영). 화면비·해상도는 본문에 넣지 않는다.
import type { Asset, Project, Sequence, Shot, ShotSize } from '@conti/domain'
import { lintPrompt } from './lint'

export const DEFAULT_SKETCH_STYLE = 'Rough storyboard sketch, black and white pencil line art, minimal shading, monochrome.'
export const DEFAULT_CINEMATIC_STYLE = 'Clean 3D CG animated film look, soft subsurface skin, rounded forms, cinematic still frame.'

const SIZE_EN: Record<ShotSize, string> = {
  EWS: 'extreme wide shot',
  WS: 'wide shot',
  MWS: 'medium wide shot',
  MS: 'medium shot',
  MCU: 'medium close-up',
  CU: 'close-up',
  ECU: 'extreme close-up',
  POV: 'point-of-view shot',
  INSERT: 'insert shot',
  OTS: 'over-the-shoulder shot',
}

export interface ContiRef {
  tag: string
  kind: Asset['kind']
  view: string
  file: string // 프로젝트 상대경로
}

export interface ContiPromptInput {
  project: Project
  sequence: Sequence
  shot: Shot
  assets: Asset[]
  style: 'sketch' | 'cinematic'
  /** 붙일 레퍼런스 순서대로 — 본문에서 "reference image N" 으로 가리킨다 */
  refs: ContiRef[]
}

export interface BuiltPrompt {
  text: string
  warnings: string[]
}

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()
const sentence = (s: string) => (s ? (/[.!?]$/.test(s) ? s : `${s}.`) : '')

export function styleLineFor(project: Project, style: 'sketch' | 'cinematic'): string {
  if (style === 'sketch') return clean(project.style.contiSketchEn) || DEFAULT_SKETCH_STYLE
  return clean(project.style.contiCinematicEn) || clean(project.style.anchorEn) || DEFAULT_CINEMATIC_STYLE
}

export function buildContiPrompt(i: ContiPromptInput): BuiltPrompt {
  const s = i.shot.promptSlots ?? {}
  const byTag = new Map(i.assets.map((a) => [a.tag, a]))
  const refIndex = new Map(i.refs.map((r, n) => [r.tag, n + 1]))
  const lines: string[] = []

  lines.push(sentence(styleLineFor(i.project, i.style)))

  const size = clean(s.shotSizeEn) || (i.shot.sizeCode ? SIZE_EN[i.shot.sizeCode] : 'medium shot')
  const angle = clean(s.angleEn) || clean(i.shot.angle) || 'eye level'
  const cam = clean(i.shot.cameraMove)
  const fov = i.shot.fovDeg ? `, ${i.shot.fovDeg} degree diagonal angle of view` : ''
  lines.push(`Shot: ${size}, ${angle}${cam && !/static/i.test(cam) ? `, framed for a ${cam.toLowerCase()} move` : ''}${fov}.`)

  // 장소: 에셋 앵커(영문) > 씬 헤딩(한글 폴백)
  const loc = i.shot.location ? byTag.get(i.shot.location) : undefined
  const locRef = i.shot.location ? refIndex.get(i.shot.location) : undefined
  // 본문엔 한글 이름을 넣지 않는다 — 레퍼런스 번호나 영문 앵커로만 가리킨다 (이름이 없으면 한글 폴백 + 린트 경고)
  const locText = loc ? (locRef ? `the location from reference image ${locRef}, same geography, materials and light direction` : clean(loc.anchorEn) || loc.nameKo) : clean(i.sequence.headingKo)
  if (locText) lines.push(`Scene: ${sentence(locText)}`)

  // 등장체·소품: 레퍼런스가 있으면 태그 + 번호만, 없으면 앵커 프로즈로 폴백
  const subjectTags = parseTags(s.subjectsTags) ?? [...i.shot.characters, ...i.shot.props]
  const subjects = subjectTags
    .filter((t) => t !== i.shot.location)
    .map((t) => {
      const a = byTag.get(t)
      const n = refIndex.get(t)
      const noun = a?.kind === 'prop' ? 'the prop' : a?.kind === 'loc' ? 'the location' : 'the character'
      if (n) return `${noun} from reference image ${n} (100% matches the reference)`
      return clean(a?.anchorEn) || a?.nameKo || t.replace(/^@(prop_|loc_)?/, '')
    })
  if (subjects.length) lines.push(`Subjects: ${subjects.join('; ')}.`)

  const action = clean(s.actionStateEn) || clean(i.shot.actionKo)
  if (action) lines.push(`Action: ${sentence(action)}`)
  const expr = clean(s.expressionEn)
  if (expr) lines.push(`Expression: ${sentence(expr)}`)

  const comp = clean(s.compositionEn) || 'rule of thirds, clear silhouette separation between subject and background'
  lines.push(`Composition: ${sentence(comp)}`)

  // 인원수: 태그가 없으면 대사 화자 수로 (대사 컷이 '빈 프레임'이 되지 않게)
  const speakers = new Set(i.shot.dialogue.map((d) => d.speaker).filter(Boolean)).size
  const people = i.shot.characters.length || speakers
  const counts = clean(s.countsEn) || (people ? `exactly ${people === 1 ? 'one person' : `${people} people`} in frame` : 'empty frame with the space itself as the subject')
  lines.push(sentence(counts.charAt(0).toUpperCase() + counts.slice(1)))

  if (i.style === 'cinematic') {
    const light = clean(s.lightingEn) || 'cinematic lighting with a named key direction and soft falloff'
    lines.push(sentence(light.charAt(0).toUpperCase() + light.slice(1)))
    const pal = clean(i.project.style.paletteEn)
    if (pal) lines.push(sentence(pal))
    lines.push('Clean plate with unmarked surfaces and blank margins.')
  } else {
    lines.push('Animated film storyboard pre-visualization, clear composition, rough and fast sketch style. Clean drawing with unmarked surfaces and blank margins.')
  }

  const text = lines.filter(Boolean).join('\n')
  return { text, warnings: lintPrompt(text) }
}

/** subjectsTags 슬롯은 JSON 배열 문자열 또는 쉼표/공백 구분 태그. */
export function parseTags(raw?: string): string[] | undefined {
  if (!raw) return undefined
  const t = raw.trim()
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t)
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean)
    } catch {
      /* fallthrough */
    }
  }
  return t.split(/[,\s]+/).filter((x) => x.startsWith('@'))
}
