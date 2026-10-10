import { z } from 'zod'
import { SeqId, EpId } from '@conti/domain'
import { defineTool, type Ctx } from '../context'
import { loadSceneLines } from '../scene'
import { ToolError, ok, omit, project as pick } from '../util'

const fields = z.array(z.string()).optional().describe('이 키만 돌려준다')

export function requireSequence(ctx: Ctx, seq: string) {
  const s = ctx.store.getSequence(seq)
  if (!s) throw new ToolError(`시퀀스 없음: ${seq} (sequence_list 로 확인)`)
  return s
}

export const sequenceTools = [
  defineTool({
    name: 'sequence_list',
    description: '시퀀스 목록. ep 를 주면 그 에피소드만. [{seq, ep, headingKo, shotCount, breakdown}]',
    input: { ep: EpId.optional() },
    handler: ({ ep }, { store }) =>
      ok(
        store
          .listSequences()
          .filter((s) => !ep || s.ep === ep)
          .map((s) => ({
            seq: s.seq,
            ep: s.ep,
            headingKo: s.headingKo,
            shotCount: s.shots.filter((sh) => !sh.deleted).length,
            breakdown: s.breakdown,
          })),
      ),
  }),
  defineTool({
    name: 'sequence_get',
    description: '시퀀스 하나. 기본 응답은 shots 를 뺀다 (샷은 shots_list). fields 로 키를 고를 수 있다.',
    input: { seq: SeqId, fields },
    handler: ({ seq, fields }, ctx) => {
      const s = requireSequence(ctx, seq)
      return ok(fields?.length ? pick(s, fields) : omit(s, ['shots']))
    },
  }),
  defineTool({
    name: 'sequence_update',
    description: '시퀀스 상수 갱신: locationMapEn / sceneStyleKo / lightingKo / soundKo / headingKo.',
    input: {
      seq: SeqId,
      patch: z
        .object({
          locationMapEn: z.string(),
          sceneStyleKo: z.string(),
          lightingKo: z.string(),
          soundKo: z.string(),
          headingKo: z.string(),
        })
        .partial(),
    },
    handler: async ({ seq, patch }, ctx) => {
      const s = requireSequence(ctx, seq)
      const next = await ctx.store.upsertSequence({ ...s, ...patch })
      return ok({ ok: true, rev: next.rev })
    },
  }),
  defineTool({
    name: 'scene_get',
    description:
      '시퀀스의 원문 씬 텍스트를 줄 단위로 분류해 돌려준다: [{n, kind(action|dialogue|speaker|paren|transition|caption), speaker?, text}]. n 은 원문 줄 번호 — 샷의 sourceLines / dialogue.lineN 에 그대로 쓴다.',
    input: { seq: SeqId },
    handler: async ({ seq }, ctx) => {
      const s = requireSequence(ctx, seq)
      const lines = await loadSceneLines(ctx.projectRoot, s)
      return ok({ seq, sourceTextHash: s.source.textHash, textHash: s.source.textHash, lines })
    },
  }),
]
