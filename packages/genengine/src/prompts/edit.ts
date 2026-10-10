// 편집·다시 그리기 프롬프트 — Lira surgical-edit 템플릿 (최소 CHANGE, 상세 PRESERVE EXACTLY).
import { lintPrompt } from './lint'
import type { BuiltPrompt } from './conti'

const DEFAULT_PRESERVE = [
  'face, hair, wardrobe, props and body proportions of every subject',
  'every subject position, pose, gaze direction and scale',
  'camera angle, framing, crop and the background layout',
  'all existing shadows and the light direction',
  'Color grade, palette, contrast, grain, falloff',
]

export function surgicalEditPrompt(instructionEn: string, preserve: string[] = DEFAULT_PRESERVE): BuiltPrompt {
  const goal = instructionEn.trim().replace(/\.$/, '')
  const text = [`Edit the image: ${goal}.`, '', `CHANGE: ${goal}.`, '', 'PRESERVE EXACTLY:', ...preserve.map((p) => `- ${p}`), '', `ONLY CHANGE: ${goal}. 100% identical otherwise.`].join('\n')
  return { text, warnings: lintPrompt(text, { edit: true }) }
}

/** 영상 원본 프레임 → 콘티 그림체. 구도는 그대로, 렌더링만 바꾼다. */
export function restylePrompt(styleLine: string): BuiltPrompt {
  const style = styleLine.trim().replace(/\.$/, '')
  const text = [
    `Edit the image: redraw this frame as ${style}.`,
    '',
    `CHANGE: the rendering style only — ${style}.`,
    '',
    'PRESERVE EXACTLY:',
    '- composition, framing, camera angle and crop',
    "- every subject's position, pose, gaze direction and scale",
    '- the background layout and the light direction',
    '',
    'ONLY CHANGE: the drawing style. 100% identical composition otherwise.',
  ].join('\n')
  return { text, warnings: lintPrompt(text, { edit: true }) }
}
