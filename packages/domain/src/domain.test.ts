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

describe('asset Korean/English pairs (koState)', () => {
  it('tells which side is newer', async () => {
    const { KO_PAIRS, koState, withKoSync } = await import('./assetKo')
    const anchor = KO_PAIRS[0]
    const voice = KO_PAIRS.find((p) => p.en === 'voiceEn')!
    const a = { anchorEn: 'neat hair', descriptionKo: '단정한 머리', voiceEn: '"Low voice."', koSync: undefined as undefined | Record<string, { en: string; ko: string }> }
    expect(koState(a, anchor)).toBe('unknown') // 예전 에셋: 둘 다 있는데 기록 없음
    expect(koState(a, voice)).toBe('enNewer') // 한글 없음 → 옮기면 된다
    expect(koState({ ...a, voiceEn: '' }, voice)).toBe('empty')
    expect(koState({ ...a, anchorEn: '' }, anchor)).toBe('koNewer') // 한글만 있음 → 영문을 쓴다
    a.koSync = withKoSync(a, 'anchorEn', { en: 'neat hair', ko: '단정한 머리' })
    expect(koState(a, anchor)).toBe('synced')
    expect(koState({ ...a, anchorEn: 'messy hair' }, anchor)).toBe('enNewer')
    expect(koState({ ...a, descriptionKo: '흐트러진 머리' }, anchor)).toBe('koNewer')
    expect(koState({ ...a, anchorEn: 'neat  hair ' }, anchor)).toBe('synced') // 공백 차이는 무시
    // 예전 비교 기록(diffKo)이 남아 있으면 unknown 으로 보고 다시 합쳐 맞춘다
    const d = { ...a, koSync: { anchorEn: { en: 'neat hair', ko: '단정한 머리', diffKo: ['영문엔 붕대가 없음'] } } }
    expect(koState(d, anchor)).toBe('unknown')
  })
})

describe('asset scenes (assetSeqs)', () => {
  it('joins usedIn with the tags shots reference', async () => {
    const { assetSeqs } = await import('./assetSeqs')
    const shot = (o: { characters?: string[]; location?: string; props?: string[] }) => ({ characters: [], props: [], ...o })
    const seqs = [
      { seq: 'S01', ep: 'EP01', shots: [] },
      { seq: 'S41', ep: 'EP01', shots: [shot({ characters: ['@해수'], location: '@loc_산길', props: ['@prop_권총'] })] },
      { seq: 'S42', ep: 'EP01', shots: [shot({ characters: ['@의현'] })] },
    ]
    expect(assetSeqs({ tag: '@여인', usedIn: ['S01'] }, seqs)).toEqual(['S01']) // 추출 기록만
    expect(assetSeqs({ tag: '@해수', usedIn: [] }, seqs)).toEqual(['S41']) // 샷 태그만
    expect(assetSeqs({ tag: '@loc_산길', usedIn: ['S01'] }, seqs)).toEqual(['S01', 'S41']) // 둘 다 → 겹치는 에셋
    expect(assetSeqs({ tag: '@prop_권총', usedIn: [] }, seqs)).toEqual(['S41'])
    expect(assetSeqs({ tag: '@없음', usedIn: [] }, seqs)).toEqual([]) // 씬 미지정
  })
})

describe('asset variants (nextVariant)', () => {
  it('picks the next free letter', async () => {
    const { nextVariant } = await import('./assetSeqs')
    expect(nextVariant('@prop_경찰차', '경찰차', ['@prop_경찰차'])).toEqual({ tag: '@prop_경찰차_B', nameKo: '경찰차 B' })
    expect(nextVariant('@prop_경찰차', '경찰차', ['@prop_경찰차', '@prop_경찰차_B'])).toEqual({ tag: '@prop_경찰차_C', nameKo: '경찰차 C' })
    expect(nextVariant('@prop_경찰차_B', '경찰차 B', ['@prop_경찰차', '@prop_경찰차_B'])).toEqual({ tag: '@prop_경찰차_C', nameKo: '경찰차 C' })
  })
})
