import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Asset, AssetKind, EpId, KO_PAIRS, SeqId, withKoSync } from '@conti/domain'
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
  // 영문 프롬프트의 한글 (사람이 읽고 고치는 쪽). 영문과 같은 호출에 함께 주면 서로 맞춰진 것으로 기록된다
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
      '에셋을 만들거나 갱신한다. id(없으면 같은 tag)의 기존 에셋이 있으면 준 필드만 덮어쓰고, 없으면 새로 만든다. 저장 후 {ep}/character/Character.md 를 다시 쓴다. 외형(anchorEn 등)이 바뀌면 그 에셋이 나오는 콘티 샷이 stale 이 된다 (staleShots). 영문 필드를 바꿀 때는 그 한글(anchorEn↔descriptionKo, cameraAnchorEn↔cameraAnchorKo, masterProfileEn↔masterProfileKo, voiceEn↔voiceKo)도 같은 내용으로 함께 준다 — 팀은 한글을 읽는다.',
    input: { ep: EpId, asset: AssetInput },
    handler: async ({ ep, asset }, { store }) => {
      const ea = await store.listAssets(ep)
      const existing = asset.id ? ea.assets.find((a) => a.id === asset.id) : ea.assets.find((a) => a.tag === asset.tag)
      // 한·영을 같은 호출에 함께 준 칸 = 서로 맞춰진 것 (카드가 다시 번역하지 않는다)
      let koSync = existing?.koSync
      for (const p of KO_PAIRS) {
        const en = asset[p.en]?.trim()
        const ko = asset[p.ko]?.trim()
        if (en && ko) koSync = withKoSync({ koSync }, p.en, { en, ko })
      }
      if (existing) {
        // 준 필드만 덮어쓰고, 외형·뷰가 바뀌면 그 에셋이 나오는 콘티는 재생성 필요 (UI 카드 수정과 같은 규칙)
        const { id: _id, ...patch } = asset
        const r = await store.patchAsset(ep, existing.id, { ...patch, koSync })
        return ok({ ok: true, id: r.asset.id, tag: r.asset.tag, rev: r.rev, created: false, staleShots: r.staleShots })
      }
      const given = Object.fromEntries(Object.entries(asset).filter(([, v]) => v !== undefined))
      const merged = Asset.parse({ ...given, koSync, id: asset.id ?? randomUUID() })
      const next = await store.upsertAsset(ep, merged)
      return ok({ ok: true, id: merged.id, tag: merged.tag, rev: next.rev, created: true, staleShots: 0 })
    },
  }),
]
