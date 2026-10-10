import type { AssetKind, ShotSize } from './schemas'

/**
 * 에셋 종류별 뷰 (GenSetup 5-A/5-B/5-C).
 * char: 3패널 시트(sheet)가 정본, front/back/face 는 시트에서 파생.
 * loc: wide 가 정본, 34/top/detail 은 wide 를 레퍼런스로 뷰 변경. top 은 LOCATION MAP 근거용(레퍼런스로 안 물린다).
 * prop: top/34/detail 각각 독립 생성.
 */
export const ASSET_VIEWS: Record<AssetKind, readonly string[]> = {
  char: ['sheet', 'front', 'back', 'face'],
  loc: ['wide', '34', 'top', 'detail'],
  prop: ['top', '34', 'detail'],
}

/** 정본 뷰 — 파생 뷰는 이 뷰의 결과를 레퍼런스로 쓴다 (prop 은 정본이 없다). */
export const MASTER_VIEW: Record<AssetKind, string | null> = { char: 'sheet', loc: 'wide', prop: null }

/** 승인 카드의 장수 = 종류별 뷰 수 (views 를 지정하면 그 수). */
export function assetJobCount(kind: AssetKind, views?: readonly string[]): number {
  return views?.length ? views.length : ASSET_VIEWS[kind].length
}

export interface ShotRefViews {
  loc: string
  char: string
  prop: string
}

/** 샷 사이즈 → 레퍼런스로 붙일 뷰 (runner.py views_for_shot_size 이식 + 소품). */
export function viewsForShotSize(size?: ShotSize): ShotRefViews {
  switch (size) {
    case 'EWS':
    case 'WS':
    case 'MWS':
      return { loc: 'wide', char: 'front', prop: '34' }
    case 'CU':
    case 'ECU':
      return { loc: 'detail', char: 'face', prop: 'detail' }
    case 'INSERT':
      return { loc: 'detail', char: 'front', prop: 'detail' }
    case 'MS':
    case 'MCU':
    case 'OTS':
    case 'POV':
    default:
      return { loc: '34', char: 'front', prop: '34' }
  }
}

/** 뷰가 없을 때 대신 쓰는 순서 (runner.py ASSET_KINDS 의 대체 뷰). */
export const VIEW_FALLBACK: Record<AssetKind, readonly string[]> = {
  char: ['front', 'sheet', 'face'],
  loc: ['wide', '34'],
  prop: ['34', 'top', 'detail'],
}
