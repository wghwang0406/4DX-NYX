// 레퍼런스 선택 — 샷 사이즈별 뷰 + 최신 버전. 레퍼런스 계층: 정체성(시트) / 장소(지리·재질·조명, 구도 상속 금지) / 소품.
import { VIEW_FALLBACK, viewsForShotSize, type Asset, type Shot, type Version } from '@conti/domain'
import type { ContiRef } from './prompts/conti'

/** 뷰의 최신 버전 (n 최대). */
export function latestView(asset: Asset, view: string): Version | undefined {
  const list = asset.views[view]
  if (!list?.length) return undefined
  return [...list].sort((a, b) => b.n - a.n)[0]
}

/** 원하는 뷰가 없으면 대체 뷰 순서대로. loc 의 top 은 레퍼런스로 쓰지 않는다 (LOCATION MAP 근거용). */
export function pickView(asset: Asset, want: string): { view: string; version: Version } | undefined {
  const order = [want, ...VIEW_FALLBACK[asset.kind]].filter((v, i, arr) => arr.indexOf(v) === i && !(asset.kind === 'loc' && v === 'top'))
  for (const v of order) {
    const ver = latestView(asset, v)
    if (ver) return { view: v, version: ver }
  }
  return undefined
}

/** 샷에 붙일 레퍼런스: 등장체 → 장소 → 소품 순서, max 장수 안에서. */
export function pickShotRefs(shot: Shot, assets: Asset[], max: number): ContiRef[] {
  const byTag = new Map(assets.map((a) => [a.tag, a]))
  const views = viewsForShotSize(shot.sizeCode)
  const out: ContiRef[] = []
  const push = (tag: string, want: string) => {
    const a = byTag.get(tag)
    if (!a) return
    const p = pickView(a, want)
    if (p) out.push({ tag, kind: a.kind, view: p.view, file: p.version.file })
  }
  for (const c of shot.characters) push(c, views.char)
  if (shot.location) push(shot.location, views.loc)
  for (const p of shot.props) push(p, views.prop)
  return out.slice(0, Math.max(0, max))
}

/** 샷의 현재 콘티 버전 (패널 0). */
export function currentContiVersion(shot: Shot): Version | undefined {
  const id = shot.stages.conti.currentVersionId
  const all = shot.panels.flatMap((p) => p.versions.conti)
  if (id) return all.find((v) => v.id === id)
  return [...all].sort((a, b) => b.n - a.n)[0]
}
