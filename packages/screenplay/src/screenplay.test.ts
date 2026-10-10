import { describe, expect, it } from 'vitest'
import { isSceneHeading, matchHeading, splitScenes, textToLines, seqIdFromSceneNumber } from './split'
import { classifyLines } from './classify'

describe('scene headings', () => {
  it('recognizes common Korean formats', () => {
    expect(isSceneHeading('41. 군산 외곽 도로 -D')).toEqual({ number: '41', title: '군산 외곽 도로', timeOfDay: 'D' })
    expect(isSceneHeading('S#41 군산 외곽 도로 (밤)')).toEqual({ number: '41', title: '군산 외곽 도로', timeOfDay: 'N' })
    expect(isSceneHeading('씬 42-1  카페 안 / 낮')).toEqual({ number: '42-1', title: '카페 안', timeOfDay: 'D' })
    expect(isSceneHeading('S43. 창고')).toEqual({ number: '43', title: '창고', timeOfDay: null })
    expect(isSceneHeading('12')).toBeNull()
    expect(isSceneHeading('해수: 여기서 멈춰.')).toBeNull()
    expect(isSceneHeading('1926년 4월, 군산.')).toBeNull()
  })
  it('splits and maps seq ids', () => {
    const text = ['41. 도로 -D', '트럭이 달린다.', '', 'S#42 카페 (밤)', '해수: 여기서 멈춰.', '(잠시)', '의현: 왜.', 'END'].join('\n')
    const scenes = splitScenes(textToLines(text))
    expect(scenes.map((s) => s.number)).toEqual(['41', '42'])
    expect(scenes[0].lines.map((l) => l.text)).toEqual(['트럭이 달린다.', ''])
    expect(scenes[1].lineStart).toBe(4)
    expect(scenes[1].lineEnd).toBe(8)
    expect(seqIdFromSceneNumber('41', 0)).toBe('S41')
    expect(seqIdFromSceneNumber('42-1', 0)).toBe('S42_1')
    expect(seqIdFromSceneNumber(null, 2)).toBe('S03')
  })
})

describe('line classification', () => {
  it('inline speaker, speaker-only + indented dialogue, parens', () => {
    const text = [
      '트럭이 멈춘다.',
      '해수: (낮게) 여기서 멈춰.',
      '',
      '의현',
      '    왜 여기서?',
      '    (잠시)',
      '    아무도 없잖아.',
      '',
      'CUT TO',
      '해수는 문을 연다.',
    ].join('\n')
    const c = classifyLines(textToLines(text))
    expect(c[0].kind).toBe('action')
    expect(c[1]).toMatchObject({ kind: 'dialogue', speaker: '해수', paren: '낮게', text: '여기서 멈춰.' })
    expect(c[3]).toMatchObject({ kind: 'speaker', speaker: '의현' })
    expect(c[4]).toMatchObject({ kind: 'dialogue', speaker: '의현', text: '왜 여기서?' })
    expect(c[5]).toMatchObject({ kind: 'paren', paren: '잠시', speaker: '의현' })
    expect(c[6]).toMatchObject({ kind: 'dialogue', speaker: '의현' })
    expect(c[8].kind).toBe('transition')
    expect(c[9].kind).toBe('action')
  })
})

describe('heading forms from real screenplays (M0 spike)', () => {
  it('남벌 / 외부. 시간 tail, prefixes, AWAKE hierarchy', () => {
    expect(matchHeading('17. 대마도 노예 수용소 노역장 / 외부. 어두운 낮.')).toMatchObject({ number: '17', title: '대마도 노예 수용소 노역장', intExt: '외부', timeOfDay: 'D' })
    expect(matchHeading('65. 플래시백. 조선 내 왜군 진영 / 외부. 낮')).toMatchObject({ prefix: '플래시백', title: '조선 내 왜군 진영' })
    expect(matchHeading('11. (회상) 여동수집/ 마당 -D')).toMatchObject({ prefix: '회상', title: '여동수집/ 마당', timeOfDay: 'D' })
    expect(matchHeading('31. 경성역 인근 어딘가 (N or D)')).toMatchObject({ title: '경성역 인근 어딘가', timeOfDay: 'N' })
    expect(matchHeading('1. 바닷속 –N')).toMatchObject({ title: '바닷속', timeOfDay: 'N' })
    expect(matchHeading('Sequence 4. 바람의 세계 — 준 + 아리')).toMatchObject({ level: 'sequence', number: '4' })
    expect(matchHeading('Scene 2. 아리 등장')).toMatchObject({ level: 'scene', number: '2', strong: true })
    expect(matchHeading('1409년. 태종 9년')).toBeNull()
    expect(matchHeading('1. 2.')).toBeNull()
  })
  it('weak headings need font size or a tail when coordinates exist', () => {
    const lines = [
      { n: 1, text: '3. 어쩌구 저쩌구 열거', x: 85, fontH: 11 },
      { n: 2, text: '본문 줄', x: 85, fontH: 11 },
      { n: 3, text: '41. 군산 외곽 도로', x: 85, fontH: 12 },
      { n: 4, text: '본문 줄 2', x: 85, fontH: 11 },
      { n: 5, text: '42. 휴게소 -D', x: 85, fontH: 11 },
      { n: 6, text: '본문 줄 3', x: 85, fontH: 11 },
    ]
    const scenes = splitScenes(lines)
    expect(scenes.map((s) => s.number)).toEqual(['41', '42'])
  })
  it('AWAKE hierarchy yields seq ids like S04_02', () => {
    const text = ['1막 — 인트로', 'Sequence 4. 바람의 세계', 'Scene 1.', '지문.', 'Scene 2. 아리 등장', '지문2.'].join('\n')
    const scenes = splitScenes(textToLines(text))
    expect(scenes.map((s) => s.number)).toEqual(['4.1', '4.2'])
    expect(seqIdFromSceneNumber(scenes[1].number, 1)).toBe('S04_02')
  })
})
