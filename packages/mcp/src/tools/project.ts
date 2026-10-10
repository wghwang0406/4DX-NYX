import { z } from 'zod'
import { defineTool } from '../context'
import { ok, project as pick } from '../util'

const fields = z.array(z.string()).optional().describe('이 키만 돌려준다')

export const projectTools = [
  defineTool({
    name: 'project_get',
    description: '프로젝트(제목·세계관·스타일 앵커·기본값·에피소드 매핑)를 JSON 으로 읽는다.',
    input: { fields },
    handler: ({ fields }, { store }) => ok(pick(store.getProject(), fields)),
  }),
  defineTool({
    name: 'project_update',
    description: '프로젝트의 title / world / style / defaults 만 부분 갱신한다 (깊은 병합은 안 함 — 객체는 통째로).',
    input: {
      patch: z.object({
        title: z.string().optional(),
        world: z.object({ eraKo: z.string(), settingKo: z.string(), toneKo: z.string() }).partial().optional(),
        style: z
          .object({ anchorEn: z.string(), contiSketchEn: z.string(), contiCinematicEn: z.string(), paletteEn: z.string() })
          .partial()
          .optional(),
        defaults: z
          .object({
            aspect: z.string(),
            contiStyle: z.enum(['sketch', 'cinematic']),
            quality: z.string(),
            autoApproveCount: z.number().int(),
            dailyCap: z.number().int(),
          })
          .partial()
          .optional(),
      }),
    },
    handler: async ({ patch }, { store }) => {
      const cur = store.getProject()
      const next = await store.updateProject({
        ...(patch.title != null ? { title: patch.title } : {}),
        ...(patch.world ? { world: { ...cur.world, ...patch.world } } : {}),
        ...(patch.style ? { style: { ...cur.style, ...patch.style } } : {}),
        ...(patch.defaults ? { defaults: { ...cur.defaults, ...patch.defaults } } : {}),
      })
      return ok({ ok: true, rev: next.rev })
    },
  }),
]
