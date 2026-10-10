import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Asset, AssetKind, EpId, SeqId } from '@conti/domain'
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
      return ok(fields?.length ? pick(items, fields) : items.map((a) => omit(a, ['views', 'masterProfileEn', 'voiceEn'])))
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
      '에셋을 만들거나 갱신한다. id(없으면 같은 tag)의 기존 에셋이 있으면 준 필드만 덮어쓰고, 없으면 새로 만든다. 저장 후 {ep}/character/Character.md 를 다시 쓴다. 외형(anchorEn 등)이 바뀌면 그 에셋이 나오는 콘티 샷이 stale 이 된다 (staleShots).',
    input: { ep: EpId, asset: AssetInput },
    handler: async ({ ep, asset }, { store }) => {
      const ea = await store.listAssets(ep)
      const existing = asset.id ? ea.assets.find((a) => a.id === asset.id) : ea.assets.find((a) => a.tag === asset.tag)
      const given = Object.fromEntries(Object.entries(asset).filter(([, v]) => v !== undefined))
      const merged = Asset.parse({ ...(existing ?? {}), ...given, id: existing?.id ?? asset.id ?? randomUUID() })
      const next = await store.upsertAsset(ep, merged)
      // 외형·뷰가 바뀌면 그 에셋이 나오는 콘티는 재생성 필요 (증분 재생성)
      const visual = ['anchorEn', 'cameraAnchorEn', 'descriptionKo', 'state', 'views'] as const
      const changed = !!existing && visual.some((k) => k in given && JSON.stringify(given[k]) !== JSON.stringify(existing[k]))
      const stale = changed ? await store.markStaleByAsset(merged.tag) : 0
      return ok({ ok: true, id: merged.id, tag: merged.tag, rev: next.rev, created: !existing, staleShots: stale })
    },
  }),
]
