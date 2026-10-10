import { describe, expect, it } from 'vitest'
import { safeName, shotFileName, parseShotFileName, assetFileName } from './naming'
import { insertShotNo, nextShotNo, childShotNos, renumber } from './shotno'
import { Sequence, Project } from './schemas'

describe('naming', () => {
  it('normalizes NFC and strips illegal chars', () => {
    const nfd = '해수'.normalize('NFD')
    expect(safeName(nfd)).toBe('해수')
    expect(safeName('a<b>:c"d/e\\f|g?h*i')).toBe('abcdefghi')
    expect(safeName('trailing. ')).toBe('trailing')
    expect(safeName('CON')).toBe('_CON')
    expect(safeName('   ')).toBe('untitled')
  })
  it('round-trips shot file names', () => {
    expect(shotFileName({ seq: 'S41', shot: '0010', v: 1, ext: 'png' })).toBe('S41_0010_v1.png')
    expect(shotFileName({ seq: 'S41', shot: '0020', key: 2, v: 3, ext: 'png' })).toBe('S41_0020-2_v3.png')
    expect(parseShotFileName('S41_0020-2_v3.PNG')).toEqual({ seq: 'S41', shot: '0020', key: 2, v: 3, ext: 'png' })
    expect(parseShotFileName('0010_v1.png')).toBeNull()
  })
  it('asset names', () => {
    expect(assetFileName('char', '해수', 'sheet', 1)).toBe('해수_Character_sheet_v1.png')
    expect(assetFileName('loc', '카페', 'wide', 2)).toBe('카페_Location_wide_v2.png')
  })
})

describe('shot numbers', () => {
  it('next / insert / children / renumber', () => {
    expect(nextShotNo(['0010', '0020'])).toBe('0030')
    expect(nextShotNo([])).toBe('0010')
    expect(insertShotNo(['0010', '0020', '0030'], '0020')).toBe('0025')
    expect(insertShotNo(['0010', '0020', '0030'], '0030')).toBe('0040')
    expect(insertShotNo(['0010', '0011'], '0010')).toBeNull()
    expect(insertShotNo(['0010', '0015', '0020'], '0010')).toBe('0012')
    expect(childShotNos('0010', 3)).toEqual(['0011', '0012', '0013'])
    expect(childShotNos('0010', 10)).toBeNull()
    expect(renumber(['0010', '0025', '0030'])).toEqual({ '0010': '0010', '0025': '0020', '0030': '0030' })
  })
})

describe('schemas', () => {
  it('fills defaults', () => {
    const s = Sequence.parse({ seq: 'S41', ep: 'EP01', shots: [{ id: 'a', no: '0010' }] })
    expect(s.shots[0].stages.conti.status).toBe('none')
    expect(s.breakdown.status).toBe('none')
    const p = Project.parse({ id: 'x', code: 'GRB', title: '고래별', createdAt: 1, updatedAt: 1 })
    expect(p.defaults.contiStyle).toBe('sketch')
    expect(() => Project.parse({ ...p, code: 'bad code' })).toThrow()
  })
})
