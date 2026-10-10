import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SeqId, ShotNo, type Panel } from '@conti/domain'
import { defineTool, type Ctx } from '../context'
import { ToolError, ok } from '../util'
import { requireSequence } from './sequence'

const Point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
const AnnotationIn = z.object({
  type: z.enum(['move', 'camera', 'pan', 'tilt', 'zoom', 'frame', 'note']),
  points: z.array(Point).min(1).max(12),
  label: z.string().max(40).optional(),
})

/** 샷의 패널 배열 (없으면 0번을 만들어 돌려준다) + 대상 인덱스 검증 */
function panelsOf(ctx: Ctx, seq: string, shotNo: string, panelIndex: number) {
  const s = requireSequence(ctx, seq)
  const shot = s.shots.find((x) => !x.deleted && x.no === shotNo)
  if (!shot) throw new ToolError(`샷 없음: ${seq} ${shotNo}`)
  const panels: Panel[] = shot.panels.length ? shot.panels.map((p) => ({ ...p })) : [{ id: randomUUID(), index: 0, annotations: [], versions: { conti: [], image: [] } }]
  if (!panels[panelIndex]) throw new ToolError(`패널 없음: ${shotNo} 패널 ${panelIndex} (0..${panels.length - 1})`)
  return { shot, panels }
}

export const panelTools = [
  defineTool({
    name: 'panels_annotate',
    description:
      '콘티 패널에 주석을 그린다 (무료, 재생성 표시 없음 — 레이아웃이 이미지 위에 겹쳐 그린다). 좌표는 이미지 기준 0..1 [x,y]. ' +
      'move=인물 이동 화살표(빨강) / camera·pan·tilt=카메라 화살표(파랑 점선, 점 2개 이상) / zoom=끝 프레임 사각형(점 2개: 좌상·우하) / frame=프레임 표시 사각형 / note=메모 점(label). ' +
      '기본은 기존 주석 뒤에 덧붙이고, replace:true 면 교체한다.',
    input: { seq: SeqId, shotNo: ShotNo, panelIndex: z.number().int().min(0).default(0), annotations: z.array(AnnotationIn).min(1).max(12), replace: z.boolean().default(false) },
    handler: async ({ seq, shotNo, panelIndex, annotations, replace }, ctx) => {
      const { shot, panels } = panelsOf(ctx, seq, shotNo, panelIndex)
      for (const a of annotations) {
        if ((a.type === 'zoom' || a.type === 'frame') && a.points.length < 2) throw new ToolError(`${a.type} 는 점 2개(좌상·우하)가 필요합니다`)
        if ((a.type === 'move' || a.type === 'camera' || a.type === 'pan' || a.type === 'tilt') && a.points.length < 2) throw new ToolError(`${a.type} 화살표는 점이 2개 이상이어야 합니다`)
      }
      const added = annotations.map((a) => ({ id: randomUUID(), ...a }))
      const next = replace ? added : [...panels[panelIndex].annotations, ...added]
      panels[panelIndex] = { ...panels[panelIndex], annotations: next }
      await ctx.store.updateShot(seq, shot.id, { panels })
      return ok({ ok: true, shotNo, panelIndex, count: next.length, ids: added.map((a) => a.id) })
    },
  }),
  defineTool({
    name: 'panels_update',
    description: '패널 캡션(captionKo)을 바꾸거나 주석을 지운다 (무료). removeIds 로 특정 주석, clearAnnotations:true 로 전부.',
    input: {
      seq: SeqId,
      shotNo: ShotNo,
      panelIndex: z.number().int().min(0).default(0),
      captionKo: z.string().max(400).optional(),
      removeIds: z.array(z.string()).optional(),
      clearAnnotations: z.boolean().optional(),
    },
    handler: async ({ seq, shotNo, panelIndex, captionKo, removeIds, clearAnnotations }, ctx) => {
      const { shot, panels } = panelsOf(ctx, seq, shotNo, panelIndex)
      const p = panels[panelIndex]
      let annotations = p.annotations
      if (clearAnnotations) annotations = []
      else if (removeIds?.length) {
        const missing = removeIds.filter((id) => !annotations.some((a) => a.id === id))
        if (missing.length) throw new ToolError(`주석 없음: ${missing.join(', ')}`)
        annotations = annotations.filter((a) => !removeIds.includes(a.id))
      }
      panels[panelIndex] = { ...p, annotations, ...(captionKo !== undefined ? { captionKo } : {}) }
      await ctx.store.updateShot(seq, shot.id, { panels })
      return ok({ ok: true, shotNo, panelIndex, annotations: annotations.length, captionKo: panels[panelIndex].captionKo })
    },
  }),
]
