import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Asset, AssetKind, EpId, KO_PAIRS, SeqId } from '@conti/domain'
import { defineTool } from '../context'
import { ToolError, ok, omit, project as pick } from '../util'

const fields = z.array(z.string()).optional().describe('이 키만 돌려준다')

// 입력은 패치형 — 기본값을 채우지 않는다 (zod 4 의 .partial() 은 default 를 그대로 적용하므로 따로 쓴다).
const AssetInput = z.object({
  id: z.string().optional(),
  tag: z.string().regex(/^@/, '@로 시작'),
  kind: AssetKind,
  subkind: z.enum(['human', 'animal', 'creature']).optional(),
  state: z.string().optional(),
  nameKo: z.string(),
  descriptionKo: z.string().optional(),
  anchorEn: z.string().optional(),
  masterProfileEn: z.string().optional(),
  voiceEn: z.string().optional(),
  cameraAnchorEn: z.string().optional(),
  // 영문 프롬프트의 한글 (사람이 읽고 고치는 쪽) — AI 는 보통 쓰지 않는다. 영문과 함께 주면 한글은 버려지고 앱이 영문을 번역한다
  cameraAnchorKo: z.string().optional(),
  masterProfileKo: z.string().optional(),
  voiceKo: z.string().optional(),
  views: Asset.shape.views.optional(),
  soul: Asset.shape.soul,
  usedIn: z.array(SeqId).optional(),
})

export const assetTools = [
  defineTool({
    name: 'assets_list',
    description: '에피소드 에셋 목록 (.conti/episodes/{ep}/assets.json). kind 로 char/loc/prop 필터. 기본 응답은 views·masterProfileEn·voiceEn 을 뺀다.',
    input: { ep: EpId, kind: AssetKind.optional(), fields },
    handler: async ({ ep, kind, fields }, { store }) => {
      const ea = await store.listAssets(ep)
      const items = ea.assets.filter((a) => !kind || a.kind === kind)
      return ok(fields?.length ? pick(items, fields) : items.map((a) => omit(a, ['views', 'masterProfileEn', 'voiceEn', 'masterProfileKo', 'voiceKo', 'cameraAnchorKo', 'koSync'])))
    },
  }),
  defineTool({
    name: 'assets_get',
    description: '에셋 하나를 id 또는 @태그로 읽는다 (전체 필드).',
    input: { ep: EpId, idOrTag: z.string(), fields },
    handler: async ({ ep, idOrTag, fields }, { store }) => {
      const ea = await store.listAssets(ep)
      const a = ea.assets.find((x) => x.id === idOrTag || x.tag === idOrTag || x.tag === `@${idOrTag}`)
      if (!a) throw new ToolError(`에셋 없음: ${idOrTag} (assets_list 로 확인)`)
      return ok(pick(a, fields))
    },
  }),
  defineTool({
    name: 'assets_upsert',
    description:
      '에셋을 만들거나 갱신한다. id(없으면 같은 tag)의 기존 에셋이 있으면 준 필드만 덮어쓰고(usedIn 은 기존 씬과 합친다), 없으면 새로 만든다. 저장 후 {ep}/character/Character.md 를 다시 쓴다. 외형(anchorEn 등)이 바뀌면 그 에셋이 나오는 콘티 샷이 stale 이 된다 (staleShots). 외형·카메라·연기 프로필·Voice 는 영문 필드(anchorEn·cameraAnchorEn·masterProfileEn·voiceEn)만 쓴다 — 한글(descriptionKo 등)은 앱이 그 영문을 번역해 만든다. 영문과 함께 준 한글은 버려진다.',
    input: { ep: EpId, asset: AssetInput },
    handler: async ({ ep, asset }, { store }) => {
      const ea = await store.listAssets(ep)
      const existing = asset.id ? ea.assets.find((a) => a.id === asset.id) : ea.assets.find((a) => a.tag === asset.tag)
      // 한 칸의 내용은 한 곳에서만 — 영문을 준 칸의 한글은 버린다 (앱이 그 영문을 번역해 한글을 만든다).
      // 한글만 준 칸은 그대로 두면 앱이 한글대로 영문을 쓴다.
      for (const p of KO_PAIRS) if (asset[p.en]?.trim() && p.ko in asset) delete (asset as Record<string, unknown>)[p.ko]
      if (existing) {
        // 준 필드만 덮어쓰고, 외형·뷰가 바뀌면 그 에셋이 나오는 콘티는 재생성 필요 (UI 카드 수정과 같은 규칙)
        const { id: _id, ...patch } = asset
        // usedIn 은 합친다 — S41 추출이 S01 에서 뽑은 에셋을 다시 upsert 해도 S01 표시가 남게
        if (patch.usedIn) patch.usedIn = [...new Set([...existing.usedIn, ...patch.usedIn])].sort()
        const r = await store.patchAsset(ep, existing.id, patch, { by: 'ai' })
        return ok({ ok: true, id: r.asset.id, tag: r.asset.tag, rev: r.rev, created: false, staleShots: r.staleShots })
      }
      const given = Object.fromEntries(Object.entries(asset).filter(([, v]) => v !== undefined))
      const merged = Asset.parse({ ...given, id: asset.id ?? randomUUID() })
      const next = await store.upsertAsset(ep, merged, { by: 'ai' })
      return ok({ ok: true, id: merged.id, tag: merged.tag, rev: next.rev, created: true, staleShots: 0 })
    },
  }),
]
