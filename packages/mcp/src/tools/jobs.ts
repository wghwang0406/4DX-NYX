import { z } from 'zod'
import { EpId, SeqId, ShotNo, assetJobCount } from '@conti/domain'
import { defineTool, type Ctx } from '../context'
import type { SpendKind } from '../spend'
import { ToolError, ok } from '../util'
import { requireSequence } from './sequence'

/** 모든 유료 도구 공통 선택 인자 — 이미지 엔진. 생략하면 프로젝트 기본값. 사용자가 "GPT 로", "Codex 로" 라고 하면 'codex'. */
const ENGINE = z
  .enum(['higgsfield', 'codex'])
  .optional()
  .describe("이미지 엔진. 'codex' = 사용자가 로그인한 Codex(ChatGPT)의 GPT 이미지(Higgsfield 크레딧 안 씀, 모든 kind 에 쓸 수 있음). 생략하면 프로젝트 기본값. 사용자가 카드에서 바꿀 수도 있다.")

const NOTE = '승인 대기 — UI 승인 카드. 크레딧 이야기는 하지 말고, 카드에서 [승인]/[1장만 먼저]/[거절]을 고르라고 안내한다.'

/** 유료 도구 공통: 요청만 만들고 즉시 돌려준다 (블로킹 안 함). 실제 생성은 승인 뒤 JobService. */
function createSpend(ctx: Ctx, kind: SpendKind, count: number, args: unknown) {
  const req = ctx.spend.create(kind, count, args)
  ctx.hooks.onSpendRequest?.(req)
  return ok({ requestId: req.requestId, count: req.count, status: req.status }, [{ type: 'text', text: NOTE }])
}

export const uiTools = [
  defineTool({
    name: 'ui_focus',
    description: 'UI 를 해당 시퀀스(·샷)로 이동시킨다.',
    input: { seq: SeqId, shotNo: ShotNo.optional() },
    handler: ({ seq, shotNo }, ctx) => {
      ctx.hooks.onUiFocus?.(seq, shotNo)
      return ok({ ok: true })
    },
  }),
]

export const paidTools = [
  defineTool({
    name: 'conti_generate',
    description:
      '[유료] 콘티 이미지 생성 요청 (gpt_image_2_5, 프롬프트는 앱이 슬롯+프로젝트 스타일로 조립, 에셋 시트를 레퍼런스로 붙인다). 즉시 {requestId, count, status} 를 돌려주고 사용자 승인을 기다린다 → jobs_wait. 생성이 끝나면 샷의 stages.conti 가 review 가 되고 image_view{seq, shotNo} 로 볼 수 있다.',
    input: {
      seq: SeqId,
      shots: z.union([z.literal('all'), z.array(ShotNo).min(1)]),
      style: z.enum(['sketch', 'cinematic']),
      pilot: z.boolean().optional().describe('1장만 먼저'),
      engine: ENGINE,
    },
    handler: (args, ctx) => {
      const s = requireSequence(ctx, args.seq)
      const live = s.shots.filter((sh) => !sh.deleted)
      let nos: string[]
      if (args.shots === 'all') nos = live.map((sh) => sh.no)
      else {
        const set = new Set(live.map((sh) => sh.no))
        const missing = args.shots.filter((n) => !set.has(n))
        if (missing.length) throw new ToolError(`샷 없음: ${missing.join(', ')}`)
        nos = args.shots
      }
      if (!nos.length) throw new ToolError('생성할 샷이 없습니다')
      return createSpend(ctx, 'conti_generate', args.pilot ? 1 : nos.length, { ...args, shots: nos })
    },
  }),
  defineTool({
    name: 'image_generate',
    description:
      '[유료] 콘티 기반 최종 이미지 생성 요청. 샷의 현재 콘티 이미지를 구도 가이드(레퍼런스 1)로, 에셋 시트를 정체성 레퍼런스로 붙여 프로젝트 최종 룩(project.style.anchorEn)의 스틸을 만든다. 콘티가 없는 샷은 거절된다 — 먼저 conti_generate. 사용자가 콘티를 확인하고 요청할 때만 쓴다. 결과는 stages.image / {EP}/Image/{SEQ}/. 즉시 requestId 반환.',
    input: {
      seq: SeqId,
      shots: z.union([z.literal('all'), z.array(ShotNo).min(1)]),
      pilot: z.boolean().optional().describe('1장만 먼저'),
      engine: ENGINE,
    },
    handler: (args, ctx) => {
      const s = requireSequence(ctx, args.seq)
      const live = s.shots.filter((sh) => !sh.deleted)
      const hasConti = (no: string) => !!live.find((sh) => sh.no === no)?.stages.conti.currentVersionId
      let nos: string[]
      if (args.shots === 'all') nos = live.filter((sh) => sh.stages.conti.currentVersionId).map((sh) => sh.no)
      else {
        const set = new Set(live.map((sh) => sh.no))
        const missing = args.shots.filter((n) => !set.has(n))
        if (missing.length) throw new ToolError(`샷 없음: ${missing.join(', ')}`)
        const noConti = args.shots.filter((n) => !hasConti(n))
        if (noConti.length) throw new ToolError(`콘티 이미지가 없는 샷: ${noConti.join(', ')} — 먼저 conti_generate`)
        nos = args.shots
      }
      if (!nos.length) throw new ToolError('콘티가 있는 샷이 없습니다 — 먼저 conti_generate')
      return createSpend(ctx, 'image_generate', args.pilot ? 1 : nos.length, { ...args, shots: nos })
    },
  }),
  defineTool({
    name: 'assets_generate',
    description:
      '[유료] 에셋 시트/뷰 생성 요청. 기본 모델은 인물 soul / 장소 soulcine / 소품 nano 지만 engine=codex 면 전부 GPT(Codex) 로 만든다. char = 3패널 시트(sheet) + 파생 front/back/face, loc = wide 정본 + 34/top/detail 뷰 변경, prop = top/34/detail. views 로 일부만. 프롬프트는 앱이 에셋 필드 + Lira 템플릿으로 조립한다. 즉시 requestId 반환.',
    input: { ep: EpId, ids: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), views: z.array(z.string()).optional(), engine: ENGINE },
    handler: async (rawArgs, ctx) => {
      const ids = [...(rawArgs.ids ?? []), ...(rawArgs.tags ?? [])]
      if (!ids.length) throw new ToolError('ids 또는 tags 가 필요합니다')
      const args = { ...rawArgs, ids }
      const ea = await ctx.store.listAssets(args.ep)
      const found = ids.map((id) => ea.assets.find((a) => a.id === id || a.tag === id))
      const missing = ids.filter((_, i) => !found[i])
      if (missing.length) throw new ToolError(`에셋 없음: ${missing.join(', ')}`)
      const count = found.reduce((n, a) => n + assetJobCount(a!.kind, args.views), 0)
      return createSpend(ctx, 'assets_generate', count, args)
    },
  }),
  defineTool({
    name: 'image_edit',
    description: '[유료] 샷의 현재 콘티 이미지를 국소 편집한다 (기본 nano_banana_2, Lira surgical-edit 템플릿: 최소 CHANGE / 상세 PRESERVE). instructionEn 은 바꿀 한 가지만 영문으로. 새 버전이 생기고 이전 버전은 기록에 남는다. 즉시 requestId 반환.',
    input: { seq: SeqId, shotNo: ShotNo, instructionEn: z.string().min(1), model: z.string().optional(), engine: ENGINE },
    handler: (args, ctx) => {
      const s = requireSequence(ctx, args.seq)
      const sh = s.shots.find((x) => !x.deleted && x.no === args.shotNo)
      if (!sh) throw new ToolError(`샷 없음: ${args.seq} ${args.shotNo}`)
      if (!sh.stages.conti.currentVersionId) throw new ToolError(`${args.shotNo}: 편집할 콘티 이미지가 아직 없습니다 — 먼저 conti_generate`)
      return createSpend(ctx, 'image_edit', 1, args)
    },
  }),
  defineTool({
    name: 'panel_restyle',
    description: '[유료] 영상 원본 프레임 등 현재 콘티 이미지를 프로젝트 콘티 그림체로 다시 그린다 (구도 유지). 즉시 requestId 반환.',
    input: { seq: SeqId, shotNos: z.array(ShotNo).min(1), engine: ENGINE },
    handler: (args, ctx) => {
      const s = requireSequence(ctx, args.seq)
      const live = s.shots.filter((sh) => !sh.deleted)
      const set = new Set(live.map((sh) => sh.no))
      const missing = args.shotNos.filter((n) => !set.has(n))
      if (missing.length) throw new ToolError(`샷 없음: ${missing.join(', ')}`)
      const noImage = args.shotNos.filter((n) => !live.find((sh) => sh.no === n)!.stages.conti.currentVersionId)
      if (noImage.length) throw new ToolError(`이미지가 없는 샷: ${noImage.join(', ')}`)
      return createSpend(ctx, 'panel_restyle', args.shotNos.length, args)
    },
  }),
]

function statusOf(ctx: Ctx, requestId: string) {
  const req = ctx.spend.get(requestId)
  if (!req) throw new ToolError(`요청 없음: ${requestId}`)
  const jobs = ctx.hooks.jobsForRequest?.(requestId) ?? []
  const done = jobs.filter((j) => j.status === 'done').length
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'unknown' || j.status === 'cancelled').length
  const { args: _args, ...rest } = req
  return { ...rest, jobs, progress: jobs.length ? { total: jobs.length, done, failed, pending: jobs.length - done - failed } : undefined }
}

export const jobTools = [
  defineTool({
    name: 'jobs_status',
    description: '유료 요청의 상태 {requestId, kind, count, status(awaiting_approval|approved|pilot|rejected), error?, jobs[{id,status,target,model,outFile?,error?}], progress?}.',
    input: { requestId: z.string() },
    handler: ({ requestId }, ctx) => ok(statusOf(ctx, requestId)),
  }),
  defineTool({
    name: 'jobs_wait',
    description:
      '요청이 판정될 때까지, 판정이 승인/파일럿이면 작업이 전부 끝날 때까지 최대 timeoutSec(≤50) 롱폴. timedOut:true 면 다시 부른다. 끝나면 jobs[].outFile(프로젝트 상대경로)을 image_view 로 볼 수 있다.',
    input: { requestId: z.string(), timeoutSec: z.number().min(0).max(50).default(30) },
    handler: async ({ requestId, timeoutSec }, ctx) => {
      if (!ctx.spend.get(requestId)) throw new ToolError(`요청 없음: ${requestId}`)
      const deadline = Date.now() + timeoutSec * 1000
      const { request } = await ctx.spend.wait(requestId, timeoutSec * 1000)
      let timedOut = request.status === 'awaiting_approval'
      if (!timedOut && (request.status === 'approved' || request.status === 'pilot') && ctx.hooks.jobsForRequest) {
        // 작업이 생기고 전부 끝날 때까지 (제출 직후엔 목록이 비어 있을 수 있어 잠깐 기다린다)
        for (;;) {
          const jobs = ctx.hooks.jobsForRequest(requestId)
          const pending = !jobs.length || jobs.some((j) => !['done', 'failed', 'cancelled', 'unknown'].includes(j.status))
          if (!pending || request.error) break
          if (Date.now() >= deadline) {
            timedOut = true
            break
          }
          await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, deadline - Date.now()))))
        }
      }
      return ok({ ...statusOf(ctx, requestId), timedOut })
    },
  }),
]
