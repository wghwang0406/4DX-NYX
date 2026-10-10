// 패널 주석 → SVG. 렌더러(주석 편집)와 레이아웃 템플릿이 같은 함수를 쓴다 — 화면과 PDF 가 똑같이 그려진다.
// 좌표는 0..1 (이미지 기준). viewBox 는 16:9(160×90) 고정, 이미지 위에 그대로 겹친다.
import type { z } from 'zod'
import type { Annotation as AnnotationSchema } from './schemas'

type Annotation = z.infer<typeof AnnotationSchema>
export type AnnotationData = Annotation
export type AnnotationType = Annotation['type']

export const ANNOTATION_TYPES: Array<{ type: AnnotationType; label: string; shape: 'arrow' | 'rect' | 'point' }> = [
  { type: 'move', label: '인물 이동', shape: 'arrow' },
  { type: 'camera', label: '카메라 이동', shape: 'arrow' },
  { type: 'pan', label: '팬', shape: 'arrow' },
  { type: 'tilt', label: '틸트', shape: 'arrow' },
  { type: 'zoom', label: '줌·돌리 (끝 프레임)', shape: 'rect' },
  { type: 'frame', label: '프레임 표시', shape: 'rect' },
  { type: 'note', label: '메모', shape: 'point' },
]

const COLOR: Record<AnnotationType, string> = {
  move: '#e0482f',
  camera: '#2f6fdf',
  pan: '#2f6fdf',
  tilt: '#2f6fdf',
  zoom: '#2f6fdf',
  frame: '#1f9d55',
  note: '#d97706',
}

const W = 160
const H = 90
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
const pt = (p: [number, number]) => [clamp(p[0]) * W, clamp(p[1]) * H] as const
const f = (n: number) => Math.round(n * 100) / 100

function arrowHead(x1: number, y1: number, x2: number, y2: number, color: string, size = 4): string {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const p1 = [x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45)]
  const p2 = [x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45)]
  return `<polygon points="${f(x2)},${f(y2)} ${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])}" fill="${color}"/>`
}

function label(text: string | undefined, x: number, y: number, color: string): string {
  if (!text) return ''
  const tx = Math.min(W - 2, Math.max(2, x))
  const ty = Math.min(H - 2, Math.max(6, y))
  const anchor = x > W * 0.7 ? 'end' : 'start'
  return `<text x="${f(tx)}" y="${f(ty)}" font-size="4.6" font-weight="700" letter-spacing="0.15" fill="${color}" stroke="#fff" stroke-width="0.55" stroke-linejoin="round" paint-order="stroke" text-anchor="${anchor}">${esc(text)}</text>`
}

/** 주석 하나 → SVG 조각 */
export function annotationSvg(a: Annotation): string {
  const color = COLOR[a.type] ?? '#2f6fdf'
  const pts = a.points.map((p) => pt(p as [number, number]))
  if (!pts.length) return ''
  if (a.type === 'note') {
    const [x, y] = pts[0]
    return `<g><circle cx="${f(x)}" cy="${f(y)}" r="2" fill="${color}"/>${label(a.label ?? '메모', x + 3, y - 2, color)}</g>`
  }
  if (a.type === 'frame' || a.type === 'zoom') {
    const [x1, y1] = pts[0]
    const [x2, y2] = pts[pts.length - 1]
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const w = Math.abs(x2 - x1)
    const h = Math.abs(y2 - y1)
    const dash = a.type === 'zoom' ? ' stroke-dasharray="3 2"' : ''
    let s = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${color}" stroke-width="1.2"${dash}/>`
    if (a.type === 'zoom') {
      // 화면 모서리 → 끝 프레임 모서리 (줌 인 방향)
      const corners: Array<[number, number, number, number]> = [
        [2, 2, x, y],
        [W - 2, 2, x + w, y],
        [2, H - 2, x, y + h],
        [W - 2, H - 2, x + w, y + h],
      ]
      for (const [ax, ay, bx, by] of corners) {
        s += `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}" stroke="${color}" stroke-width="0.8"/>` + arrowHead(ax, ay, bx, by, color, 3)
      }
    }
    return `<g>${s}${label(a.label, x + 1, y - 1.5, color)}</g>`
  }
  // 화살표 (move / camera / pan / tilt): 점들을 잇는 폴리라인 + 끝 화살촉
  if (pts.length === 1) return `<g><circle cx="${f(pts[0][0])}" cy="${f(pts[0][1])}" r="2" fill="${color}"/></g>`
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join(' ')
  const [x1, y1] = pts[pts.length - 2]
  const [x2, y2] = pts[pts.length - 1]
  const dash = a.type === 'camera' || a.type === 'pan' || a.type === 'tilt' ? ' stroke-dasharray="4 2"' : ''
  return `<g><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${dash}/>${arrowHead(x1, y1, x2, y2, color)}${label(a.label, x2 + 2, y2 - 2, color)}</g>`
}

/** 주석 전부 → 이미지 위에 겹칠 <svg> (없으면 빈 문자열) */
export function annotationsSvg(list: Annotation[] | undefined): string {
  if (!list?.length) return ''
  return `<svg class="annotations" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${list.map(annotationSvg).join('')}</svg>`
}

/** 텍스트 입력의 샷 길이 추정 — 대사 글자 수(한국어 ≈ 초당 4.5자) + 지문 길이. 사용자가 타임라인에서 고친다. */
export function estimateShotDuration(actionKo: string, dialogue: string[]): number {
  const DEFAULT = 2.5
  const chars = dialogue.join('').replace(/\s/g, '').length
  const fromDialogue = chars ? chars / 4.5 + 0.6 : 0
  const fromAction = actionKo ? Math.min(4, 1.5 + actionKo.length / 40) : 0
  return Math.max(DEFAULT * 0.6, Math.round((fromDialogue + fromAction || DEFAULT) * 10) / 10)
}
