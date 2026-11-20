// 에셋 수정 히스토리 — 글(이름·외형·프로필·Voice …)과 이미지 버전이 언제, 누구 손으로 바뀌었는지.
// 저장은 ProjectStore 한 곳(.conti/episodes/{ep}/asset-history.ndjson, 한 줄 = 한 변경). 여기는 비교·스냅샷 순수 함수.
import type { Asset } from './schemas'

/** 히스토리에 남기는 글 필드 (koSync 같은 내부 기록은 뺀다) */
export const ASSET_HISTORY_FIELDS = [
  'nameKo',
  'descriptionKo',
  'anchorEn',
  'cameraAnchorEn',
  'cameraAnchorKo',
  'masterProfileEn',
  'masterProfileKo',
  'voiceEn',
  'voiceKo',
  'state',
  'subkind',
  'usedIn',
] as const
export type AssetHistoryField = (typeof ASSET_HISTORY_FIELDS)[number]

/** 누가 바꿨나: 사람(카드) / AI 채팅·추출 / 한·영 자동 맞춤 / 이미지 생성 / 되돌리기 */
export type AssetEditBy = 'user' | 'ai' | 'auto' | 'gen' | 'restore'
export type AssetHistoryAction = 'create' | 'edit' | 'image' | 'link' | 'unlink' | 'copy' | 'restore'

export interface AssetHistoryChange {
  field: AssetHistoryField
  before: unknown
  after: unknown
}
export interface AssetHistoryImage {
  view: string
  versionId: string
  n: number
  file: string
}
export interface AssetHistoryEntry {
  id: string
  at: number
  assetId: string
  tag: string
  by: AssetEditBy
  action: AssetHistoryAction
  note?: string
  changes: AssetHistoryChange[]
  /** 이 변경으로 새로 생긴 이미지 버전 */
  images: AssetHistoryImage[]
  /** 변경 뒤 글 필드 전체 — "이 시점으로 되돌리기"는 이걸 그대로 덮어쓴다 (없는 칸은 null) */
  snapshot: Partial<Record<AssetHistoryField, unknown>>
}

export interface AssetWriteMeta {
  by?: AssetEditBy
  action?: AssetHistoryAction
  note?: string
}

export function assetSnapshot(a: Asset): AssetHistoryEntry['snapshot'] {
  return Object.fromEntries(ASSET_HISTORY_FIELDS.map((f) => [f, a[f] ?? null]))
}

const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)

/** 이전(없으면 새로 만든 것)과 다음을 비교 — 바뀐 글 필드와 새로 생긴 이미지 버전 */
export function diffAsset(prev: Asset | undefined, next: Asset): { changes: AssetHistoryChange[]; images: AssetHistoryImage[] } {
  const changes = ASSET_HISTORY_FIELDS.filter((f) => !same(prev?.[f], next[f])).map((f) => ({ field: f, before: prev?.[f] ?? null, after: next[f] ?? null }))
  const images: AssetHistoryImage[] = []
  for (const [view, vers] of Object.entries(next.views)) {
    const had = new Set((prev?.views[view] ?? []).map((v) => v.id))
    for (const v of vers) if (!had.has(v.id)) images.push({ view, versionId: v.id, n: v.n, file: v.file })
  }
  return { changes, images }
}
