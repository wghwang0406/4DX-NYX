import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SeqId, ShotNo, ShotSize, Shot, DialogueLine, insertShotNo, pad4, type Sequence } from '@conti/domain'
import { ShotDraft, validateBreakdown } from '../breakdown'
import { defineTool } from '../context'
import { loadSceneLines } from '../scene'
import { ToolError, ok, omit, project as pick } from '../util'
import { requireSequence } from './sequence'

const fields = z.array(z.string()).optional().describe('이 키만 돌려준다')

const ShotPatch = z
  .object({
    sizeCode: ShotSize,
    angle: z.string(),
    cameraMove: z.string(),
    fovDeg: z.number(),
    durationSec: z.number(),
    characters: z.array(z.string()),
    location: z.string(),
    props: z.array(z.string()),
    actionKo: z.string(),
    dialogue: z.array(DialogueLine),
    tag: z.enum(['대사', '반응']),
    promptSlots: z.record(z.string(), z.string()),
  })
  .partial()

function liveShots(s: Sequence) {
  return s.shots.filter((sh) => !sh.deleted)
}

function requireShot(s: Sequence, shotNo: string) {
  const sh = liveShots(s).find((x) => x.no === shotNo)
  if (!sh) throw new ToolError(`샷 없음: ${s.seq} ${shotNo}`)
  return sh
}

function sortByNo<T extends { no: string }>(shots: T[]): T[] {
  return [...shots].sort((a, b) => Number(a.no) - Number(b.no))
}

export const shotTools = [
  defineTool({
    name: 'shots_list',
    description: '시퀀스의 샷 목록 (삭제된 샷 제외). range "0010-0090" 로 구간, fields 로 키를 고른다. 기본 응답은 panels 를 뺀다.',
    input: { seq: SeqId, range: z.string().regex(/^\d{4}-\d{4}$/).optional(), fields },
    handler: ({ seq, range, fields }, ctx) => {
      const s = requireSequence(ctx, seq)
      let shots = sortByNo(liveShots(s))
      if (range) {
        const [a, b] = range.split('-').map(Number)
        shots = shots.filter((sh) => Number(sh.no) >= a && Number(sh.no) <= b)
      }
      return ok(fields?.length ? pick(shots, fields) : shots.map((sh) => omit(sh, ['panels'])))
    },
  }),
  defineTool({
    name: 'shots_update',
    description: '[stale 규칙: 이미 콘티 이미지가 있는 샷의 사이즈·앵글·카메라·인물·장소·소품·지문·대사가 바뀌면 재생성 필요(stale)로 표시된다. 아직 이미지가 없으면 표시 없음] 샷 하나의 필드를 부분 갱신한다 (sizeCode, angle, cameraMove, fovDeg, durationSec, characters, location, props, actionKo, dialogue, tag).',
    input: { seq: SeqId, shotNo: ShotNo, patch: ShotPatch },
    handler: async ({ seq, shotNo, patch }, ctx) => {
      const s = requireSequence(ctx, seq)
      const sh = requireShot(s, shotNo)
      // 그림에 영향 주는 필드가 바뀌었고 이미 콘티 버전이 있으면 재생성 필요(stale)
      const visual = ['sizeCode', 'angle', 'cameraMove', 'fovDeg', 'characters', 'location', 'props', 'actionKo', 'dialogue', 'promptSlots'] as const
      const changed = visual.some((k) => k in patch && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((sh as Record<string, unknown>)[k]))
      const stale = changed && !!sh.stages.conti.currentVersionId
      const stages = stale ? { ...sh.stages, conti: { ...sh.stages.conti, status: 'stale' as const } } : sh.stages
      const next = await ctx.store.updateShot(seq, sh.id, { ...patch, stages })
      return ok({ ok: true, rev: next.rev, shotNo, stale })
    },
  }),
  defineTool({
    name: 'shots_insert',
    description: 'after 번호 다음에 샷을 끼워 넣는다 (0010 과 0020 사이면 0015). 자리가 없으면 isError — 재번호가 필요하다.',
    input: { seq: SeqId, after: ShotNo, shot: ShotPatch },
    handler: async ({ seq, after, shot }, ctx) => {
      const s = requireSequence(ctx, seq)
      requireShot(s, after)
      const no = insertShotNo(
        liveShots(s).map((x) => x.no),
        after,
      )
      if (!no) throw new ToolError(`${after} 다음에 끼울 번호가 없습니다 — 시퀀스 재번호(renumber) 후 다시 시도하세요`)
      const created = Shot.parse({ id: randomUUID(), no, ...shot })
      const next = await ctx.store.upsertSequence({ ...s, shots: sortByNo([...s.shots, created]) })
      return ok({ ok: true, rev: next.rev, shotNo: no })
    },
  }),
  defineTool({
    name: 'prompts_set',
    description:
      '콘티 프롬프트 슬롯 저장 (무료). slots: shotSizeEn, angleEn, subjectsTags, actionStateEn, expressionEn, compositionEn, countsEn, lightingEn?. 스타일 문장은 project.style 에서 코드가 붙인다. 슬롯이 바뀌면 그 샷은 재생성 필요(stale)로 표시된다.',
    input: {
      target: z.object({ seq: SeqId, shotNo: ShotNo }),
      stage: z.enum(['conti', 'image']).default('conti'),
      slots: z.record(z.string(), z.string()),
    },
    handler: async ({ target, stage, slots }, ctx) => {
      const s = requireSequence(ctx, target.seq)
      const sh = requireShot(s, target.shotNo)
      const merged = { ...(sh.promptSlots ?? {}), ...slots }
      const changed = JSON.stringify(merged) !== JSON.stringify(sh.promptSlots ?? {})
      const stageState = sh.stages[stage]
      const stages = changed && stageState.currentVersionId ? { ...sh.stages, [stage]: { ...stageState, status: 'stale' as const } } : sh.stages
      await ctx.store.updateShot(target.seq, sh.id, { promptSlots: merged, stages })
      return ok({ ok: true, shotNo: target.shotNo, slots: Object.keys(merged), stale: changed && !!stageState.currentVersionId })
    },
  }),
  defineTool({
    name: 'shots_delete',
    description: '샷들을 삭제 표시한다 (soft delete — 파일·버전은 남는다).',
    input: { seq: SeqId, shotNos: z.array(ShotNo).min(1) },
    handler: async ({ seq, shotNos }, ctx) => {
      const s = requireSequence(ctx, seq)
      const live = new Set(liveShots(s).map((x) => x.no))
      const missing = shotNos.filter((n) => !live.has(n))
      if (missing.length) throw new ToolError(`샷 없음: ${missing.join(', ')}`)
      const set = new Set(shotNos)
      const next = await ctx.store.upsertSequence({
        ...s,
        shots: s.shots.map((sh) => (set.has(sh.no) && !sh.deleted ? { ...sh, deleted: true } : sh)),
      })
      return ok({ ok: true, rev: next.rev, deleted: shotNos })
    },
  }),
  defineTool({
    name: 'shots_propose_breakdown',
    description:
      '씬 분해 초안을 제출한다. 코드가 결정적으로 검증한다: sourceTextHash 가 현재 원문과 같을 것, 원문 대사 줄마다 정확히 한 샷(lineN 또는 텍스트로 매칭), 샷당 대사 1줄 이하, sizeCode 유효. 통과하면 샷을 0010 부터 10 단위로 쓰고 breakdown.status=draft. 실패하면 isError + 보고서 — 고쳐서 다시 제출.',
    input: {
      seq: SeqId,
      sourceTextHash: z.string(),
      shots: z.array(ShotDraft),
      force: z.boolean().optional().describe('이미 수락(accepted)된 분해도 교체한다'),
    },
    handler: async ({ seq, sourceTextHash, shots: drafts, force }, ctx) => {
      const s = requireSequence(ctx, seq)
      if (!s.source.textHash) throw new ToolError(`시퀀스 ${seq} 에 원문 해시가 없습니다 — 소스를 먼저 연결하세요`)
      if (s.source.textHash !== sourceTextHash) throw new ToolError('원문이 바뀜 — scene_get 으로 다시 읽고 textHash 를 맞추세요', { textHash: s.source.textHash })
      if (s.breakdown.status === 'accepted' && !force) {
        throw new ToolError('이미 수락된 분해입니다 — shots_update/insert 로 고치거나 force:true 로 교체하세요')
      }
      const scene = await loadSceneLines(ctx.projectRoot, s)
      const report = validateBreakdown(scene, drafts)
      if (!report.ok) {
        const { matched: _m, ...rest } = report
        throw new ToolError('분해 검증 실패 — 보고서를 보고 고쳐서 다시 제출', rest)
      }
      const warnings = [...report.warnings]
      const prev = liveShots(s).length
      if (prev) warnings.push(`기존 샷 ${prev}개를 교체함`)
      const shots = drafts.map((d, i) =>
        Shot.parse({
          id: randomUUID(),
          no: pad4((i + 1) * 10),
          ...d,
          dialogue: d.dialogue.map((dl) => ({ ...dl, lineN: dl.lineN ?? report.matched[i] })),
        }),
      )
      const next = await ctx.store.upsertSequence({ ...s, shots, breakdown: { status: 'draft' } })
      return ok({ ok: true, shotCount: shots.length, rev: next.rev, warnings })
    },
  }),
]
