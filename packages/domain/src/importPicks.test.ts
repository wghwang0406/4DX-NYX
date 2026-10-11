import { describe, expect, it } from 'vitest'
import { buildImportPicks, canMerge, duplicateSeqs, type SceneRowPick } from './importPicks'

const row = (seq: string, on = true, merge = false): SceneRowPick => ({ on, merge, seq, ep: 'EP01' })
const order = [0, 1, 2, 3, 4]

describe('import picks', () => {
  it('unchecked scenes are dropped, never merged', () => {
    const picks = { 0: row('S41'), 1: row('S42', false), 2: row('S43', false), 3: row('S44'), 4: row('S45', false) }
    const out = buildImportPicks(order, picks)
    expect(out.map((p) => p.seq)).toEqual(['S41', 'S44'])
    expect(out.every((p) => p.mergeFollowing.length === 0)).toBe(true)
  })

  it('merge toggle appends to the previous included scene, chains allowed', () => {
    const picks = { 0: row('S41'), 1: row('S42', true, true), 2: row('S43', true, true), 3: row('S44'), 4: row('S45') }
    const out = buildImportPicks(order, picks)
    expect(out).toEqual([
      { index: 0, seq: 'S41', ep: 'EP01', mergeFollowing: [1, 2] },
      { index: 3, seq: 'S44', ep: 'EP01', mergeFollowing: [] },
      { index: 4, seq: 'S45', ep: 'EP01', mergeFollowing: [] },
    ])
  })

  it('merge after an excluded row is not allowed and is ignored', () => {
    const picks = { 0: row('S41'), 1: row('S42', false), 2: row('S43', true, true), 3: row('S44'), 4: row('S45') }
    expect(canMerge(order, picks, 2)).toBe(false)
    expect(canMerge(order, picks, 0)).toBe(false)
    expect(canMerge(order, picks, 4)).toBe(true)
    expect(buildImportPicks(order, picks).find((p) => p.seq === 'S41')!.mergeFollowing).toEqual([])
    // 합쳐지는 행 뒤도 그 사슬을 따라 합칠 수 있다
    const chain = { 0: row('S41'), 1: row('S42', true, true), 2: row('S43'), 3: row('S44'), 4: row('S45') }
    expect(canMerge(order, chain, 2)).toBe(true)
  })

  it('all unchecked yields nothing; invalid seq is dropped', () => {
    const none = Object.fromEntries(order.map((i) => [i, row(`S4${i}`, false)]))
    expect(buildImportPicks(order, none)).toEqual([])
    expect(buildImportPicks([0, 1], { 0: row('bad'), 1: row('S42') }).map((p) => p.seq)).toEqual(['S42'])
  })

  it('reports duplicate seq ids', () => {
    expect(duplicateSeqs(buildImportPicks([0, 1], { 0: row('S41'), 1: row('S41') }))).toEqual(['S41'])
  })
})
