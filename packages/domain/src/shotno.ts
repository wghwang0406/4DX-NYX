// 샷 번호: 0010, 0020 … 10 단위. 사이에 끼울 땐 중간 번호(0035)를 쓰고 기존 번호는 밀지 않는다.

export function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export function nextShotNo(existing: string[]): string {
  const max = existing.reduce((m, s) => Math.max(m, Number(s)), 0)
  return pad4(Math.floor(max / 10) * 10 + 10)
}

/**
 * after 와 그 다음 번호 사이의 중간 번호. 자리가 없으면 null (그땐 사용자에게 재번호 제안).
 * after 가 마지막이면 +10.
 */
export function insertShotNo(existing: string[], after: string): string | null {
  const nums = [...new Set(existing.map(Number))].sort((a, b) => a - b)
  const a = Number(after)
  const idx = nums.indexOf(a)
  if (idx === -1) return null
  const b = nums[idx + 1]
  if (b == null) return pad4(a + 10)
  if (b - a < 2) return null
  // 5 단위를 선호하고, 안 되면 중앙값
  const mid5 = a + 5
  if (mid5 < b && mid5 % 5 === 0 && !nums.includes(mid5)) return pad4(mid5)
  return pad4(Math.floor((a + b) / 2))
}

/** 분할 자식 번호: 0010 → 0011, 0012 … (기존 split_shot_cuts 규칙). 9개 초과면 null. */
export function childShotNos(parent: string, count: number): string[] | null {
  if (count > 9) return null
  const base = Number(parent)
  return Array.from({ length: count }, (_, i) => pad4(base + i + 1))
}

/** 전체 재번호: 순서대로 0010, 0020 … 반환은 old→new 맵. */
export function renumber(ordered: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  ordered.forEach((no, i) => (map[no] = pad4((i + 1) * 10)))
  return map
}
