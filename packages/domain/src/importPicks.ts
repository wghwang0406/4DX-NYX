// 시나리오 가져오기 표의 행 선택 → 커밋 목록.
// 체크 = 가져오기, 해제 = 제외(어디에도 붙지 않는다). 합치기는 별도 토글로만 한다.

export interface SceneRowPick {
  on: boolean
  /** 앞의 포함된 씬에 이 씬 본문을 합친다 (씬이 잘못 나뉜 경우) */
  merge?: boolean
  seq: string
  ep: string
}

export interface ImportPickOut {
  index: number
  seq: string
  ep: string
  mergeFollowing: number[]
}

const SEQ_RE = /^S\d+/
const EP_RE = /^EP\d+$/

/** 합치기 토글을 켤 수 있는가: 바로 앞 행이 포함(on)되었거나 그 자신도 합쳐지는 중이어야 한다. */
export function canMerge(order: number[], picks: Record<number, SceneRowPick>, index: number): boolean {
  const pos = order.indexOf(index)
  if (pos <= 0) return false
  for (let i = pos - 1; i >= 0; i--) {
    const p = picks[order[i]]
    if (!p) return false
    if (p.merge) continue
    return p.on
  }
  return false
}

/**
 * order: 씬 index 를 문서 순서대로. 반환은 만들 시퀀스 목록.
 * - on && !merge && 유효한 SEQ/EP → 새 시퀀스
 * - merge → 직전 시퀀스의 mergeFollowing (앞에 대상이 없으면 무시)
 * - 그 밖(해제·잘못된 SEQ) → 버린다. 합치지 않는다.
 */
export function buildImportPicks(order: number[], picks: Record<number, SceneRowPick>): ImportPickOut[] {
  const out: ImportPickOut[] = []
  // 합칠 대상은 "바로 앞 행이 만든 시퀀스" — 사이에 제외된 행이 있으면 끊긴다
  let target: ImportPickOut | null = null
  for (const index of order) {
    const p = picks[index]
    if (!p) {
      target = null
      continue
    }
    if (p.merge) {
      if (target) target.mergeFollowing.push(index)
      continue
    }
    if (p.on && SEQ_RE.test(p.seq) && EP_RE.test(p.ep)) {
      target = { index, seq: p.seq, ep: p.ep, mergeFollowing: [] }
      out.push(target)
    } else target = null
  }
  return out
}

/** 같은 SEQ 를 두 번 쓰면 뒤 것이 앞 것을 덮는다 — 커밋 전에 알려준다. */
export function duplicateSeqs(list: ImportPickOut[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const p of list) {
    const k = `${p.ep}/${p.seq}`
    if (seen.has(k)) dup.add(p.seq)
    seen.add(k)
  }
  return [...dup]
}
