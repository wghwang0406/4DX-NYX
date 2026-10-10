// 에셋 프롬프트 — Lira 템플릿(Character sheet 3-panel / Location / Prop sheet / Surgical edit) + GenSetup 5-A·B·C 규칙.
// 등장체·소품 시트는 무채색 배경 + soft directional 조명, 배경 에셋은 반대로 시네마틱.
import type { Asset, Project } from '@conti/domain'
import { lintPrompt } from './lint'
import type { BuiltPrompt } from './conti'

const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()
const sentence = (s: string) => (s ? (/[.!?]$/.test(s) ? s : `${s}.`) : '')

function subjectNoun(a: Asset): string {
  if (a.kind !== 'char') return 'subject'
  return a.subkind === 'animal' ? 'animal' : a.subkind === 'creature' ? 'creature' : 'person'
}

/** 프로젝트 룩 한 줄 — 포토리얼이든 CG든 앵커가 정한다. 비어 있으면 포토리얼 기본. */
function lookLine(p: Project): string {
  return clean(p.style.anchorEn) || 'photoreal, clean neutral cinematic look'
}

/** 5-A 등장체 3패널 시트 (Soul 2.0). 정체성은 Soul ID 가, 프로즈는 보강. */
export function charSheetPrompt(a: Asset, p: Project): BuiltPrompt {
  const noun = subjectNoun(a)
  const same = noun === 'person' ? 'the same real person' : `the same ${noun}`
  const text = [
    `Three studio photographs of the same ${noun} arranged side by side on a flat neutral mid-grey studio backdrop, a film character sheet: full-body front photo on the left, full-body back photo in the middle, close-up portrait photo on the right, ${same} in all three, consistent across panels. Soft directional cinematic studio lighting from one side, gentle natural shadow falloff, clean neutral cinematic look.`,
    '',
    `The ${noun}: ${sentence(clean(a.anchorEn) || a.nameKo)}`,
    'Wardrobe and signature items consistent in all panels.',
    '',
    `On the left panel the ${noun} stands straight facing the camera in a neutral pose, arms relaxed at the sides, full figure head to feet. In the middle panel the same standing pose is seen from behind. On the right panel a close-up head-and-shoulders portrait, relaxed jaw, eyes open with a steady gaze into the lens, natural catchlight.`,
    '',
    sentence([clean(p.style.paletteEn), lookLine(p)].filter(Boolean).join('. ')),
  ].join('\n')
  return { text, warnings: lintPrompt(text, { sheet: true }) }
}

/** 5-A 파생 플레이트 — 시트에서 패널 하나를 잘라내는 NBP 편집. */
export function charPlatePrompt(view: 'front' | 'back' | 'face'): BuiltPrompt {
  const panel = view === 'front' ? 'left full-body front' : view === 'back' ? 'middle full-body back' : 'right close-up portrait'
  const text = [
    `Edit the image: isolate the ${panel} panel as a standalone plate.`,
    '',
    `CHANGE: output only the ${panel} panel, filling the frame.`,
    '',
    'PRESERVE EXACTLY:',
    '- face, hair, wardrobe, props, body proportions, pose',
    '- the flat neutral mid-grey backdrop, the directional key light and its shadow falloff',
    '- Color grade, palette, contrast, grain, falloff',
    '',
    'ONLY CHANGE: the crop. 100% identical otherwise.',
  ].join('\n')
  return { text, warnings: lintPrompt(text, { edit: true, sheet: true }) }
}

/** 5-B 배경 정본 wide (Soul Cinema). 인물 없음, 옵틱/DOF 언어 없음, 그레인 단어 겹치지 않음. */
export function locMasterPrompt(a: Asset, p: Project): BuiltPrompt {
  const camera = clean(a.cameraAnchorEn) || 'wide establishing shot, camera at standing eye level looking straight into the space'
  const text = [
    sentence(camera),
    sentence(clean(a.anchorEn) || a.descriptionKo || a.nameKo),
    'The space is empty and still, the architecture itself is the subject.',
    sentence([clean(p.style.paletteEn), lookLine(p)].filter(Boolean).join('. ')),
  ]
    .filter(Boolean)
    .join(' ')
  return { text, warnings: lintPrompt(text, { sheet: true }) }
}

/** 5-B 뷰 변경 (GPT Image 2.5, wide 를 레퍼런스로). Lira: 장소 뷰 변경은 GPT 가 맞다. */
export function locViewPrompt(view: '34' | 'top' | 'detail', a: Asset): BuiltPrompt {
  const body =
    view === '34'
      ? `Edit the image: show the same location from a three-quarter angle.\n\nCHANGE: the camera moves 45 degrees to the right of the reference view and slightly higher, a high angle three-quarter wide shot looking diagonally into the space; every object keeps its real position relative to the others.`
      : view === 'top'
        ? `Edit the image: show the same location as a top-down plan view.\n\nCHANGE: the camera is directly above the space looking straight down, the whole floor layout visible like an architectural plan, flat even lighting for reference use; every object keeps its real position.`
        : `Edit the image: show a close detail of the same location.\n\nCHANGE: a close-up of the most distinctive surface or object of this space at arm's length, the same materials, wear and light direction as the reference.`
  const text = [body, '', 'PRESERVE EXACTLY:', '- architecture, materials, landmarks, light source direction and color temperature', '- Color grade, palette, contrast, grain, falloff', '', 'ONLY CHANGE: the camera position. 100% the same place otherwise.'].join('\n')
  return { text, warnings: lintPrompt(text, { edit: true, sheet: true }) }
}

/** 5-C 소품 3뷰 (NBP). 무기류는 중립적 재질·기능 서술 — 그건 AI 가 anchorEn 에서 지킨다. */
export function propPrompt(view: 'top' | '34' | 'detail', a: Asset, p: Project): BuiltPrompt {
  const angle = view === 'top' ? 'top-down' : view === '34' ? 'three-quarter overhead' : 'close-up macro detail'
  const text = [
    `Photorealistic ${angle} product shot of a single prop on a neutral grey concrete surface, soft directional lighting, isolated subject.`,
    `The prop: ${sentence(clean(a.anchorEn) || a.descriptionKo || a.nameKo)}`,
    'Plain unbranded surfaces, blank matte finish where there is no detail.',
    sentence(lookLine(p)),
  ]
    .filter(Boolean)
    .join(' ')
  return { text, warnings: lintPrompt(text, { sheet: true }) }
}
