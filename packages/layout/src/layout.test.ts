import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Project, Sequence, annotationsSvg, estimateShotDuration } from '@conti/domain'
import { buildLayoutData, concatList, animaticArgs, listTemplates, loadTemplate, pageSizeMm, renderHtml, shotDuration, solidPng } from './index'

const here = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(here, '..', '..', '..', 'templates')

const project = Project.parse({ id: 'p', code: 'TST', title: '테스트 <프로젝트>', createdAt: 1, updatedAt: 1 })
function seqOf(n: number) {
  return Sequence.parse({
    seq: 'S41',
    ep: 'EP01',
    headingKo: '군산 외곽 도로 - 새벽',
    shots: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      no: String((i + 1) * 10).padStart(4, '0'),
      sizeCode: i % 2 ? 'CU' : 'WS',
      cameraMove: i === 0 ? 'PAN' : 'static',
      fovDeg: 47,
      characters: ['@해수'],
      actionKo: i % 2 ? '' : `지문 ${i} <b>굵게</b>`,
      dialogue: i % 2 ? [{ speaker: '해수', text: `대사 ${i}` }] : [],
      durationSec: i === 2 ? 4 : undefined,
      panels:
        i === 0
          ? [{ id: 'p0', index: 0, annotations: [{ id: 'a', type: 'pan', points: [[0.1, 0.8], [0.8, 0.8]], label: 'PAN →' }], versions: { conti: [{ id: 'v1', n: 1, stage: 'conti', file: 'EP01/Conti/S41/S41_0010_v1.png', source: 'generated', createdAt: 1 }, { id: 'v2', n: 2, stage: 'conti', file: 'EP01/Conti/S41/S41_0010_v2.png', source: 'edit', createdAt: 2 }], image: [] } }]
          : [],
      stages: i === 0 ? { conti: { status: 'review', currentVersionId: 'v1' } } : i === 3 ? { conti: { status: 'stale' } } : undefined,
    })),
  })
}

describe('templates', () => {
  it('loads the bundled placeholder and lists it (skipping _fonts)', async () => {
    const list = await listTemplates([{ dir: TEMPLATES, builtin: true }])
    expect(list.map((t) => t.id)).toEqual(['placeholder-a4-6up'])
    const t = await loadTemplate(list[0].dir)
    expect(t.meta).toMatchObject({ panelsPerPage: 6, paper: { size: 'A4', orientation: 'landscape' } })
    expect(Object.keys(t.partials)).toEqual(['panel'])
    expect(pageSizeMm(t.meta)).toEqual([297, 210])
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it('reports broken template folders instead of throwing, first root wins on id clash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tpl-'))
    await mkdir(join(root, 'broken'))
    await writeFile(join(root, 'broken', 'template.json'), '{"id":"broken"')
    await mkdir(join(root, 'dup'))
    await writeFile(join(root, 'dup', 'template.json'), JSON.stringify({ id: 'placeholder-a4-6up', name: 'dup' }))
    await writeFile(join(root, 'dup', 'page.hbs'), '<section class="page"></section>')
    const list = await listTemplates([{ dir: TEMPLATES, builtin: true }, { dir: root, builtin: false }])
    expect(list.find((t) => t.id === 'broken')?.error).toMatch(/형식 오류/)
    expect(list.filter((t) => t.id === 'placeholder-a4-6up')).toHaveLength(1)
    expect(list.find((t) => t.id === 'placeholder-a4-6up')?.builtin).toBe(true)
  })
})

describe('builder', () => {
  it('maps shots to panels, pages of 6 with empty fillers, current version, durations, chips', async () => {
    const t = await loadTemplate(join(TEMPLATES, 'placeholder-a4-6up'))
    const data = buildLayoutData(project, seqOf(8), [{ id: 'c', tag: '@해수', kind: 'char', nameKo: '해수', state: 'base', descriptionKo: '', anchorEn: '', views: {}, usedIn: [] }], {
      meta: t.meta,
      pageMm: [297, 210],
      imageUrl: (r) => `conti-file://project/${r}`,
      templateId: t.meta.id,
      templateName: t.meta.name,
      templateVersion: t.meta.version,
      versionLabel: 'v3',
      date: new Date(2026, 9, 10),
    })
    expect(data.pages).toHaveLength(2)
    expect(data.pages[1].panels.filter((p) => 'empty' in p && p.empty)).toHaveLength(4)
    const p0 = data.panels[0]
    expect(p0.image).toBe('conti-file://project/EP01/Conti/S41/S41_0010_v1.png') // currentVersionId 가 v1 → v2 가 있어도 v1
    expect(p0).toMatchObject({ version: 'v1', imageSource: '생성', characters: '해수', chips: ['WS', 'PAN', '47°', expect.stringMatching(/s$/)] })
    expect(p0.annotationsSvg).toContain('<svg class="annotations"')
    expect(data.panels[1]).toMatchObject({ hasDialogue: true, image: null, dialogue: [{ speaker: '해수', text: '대사 1', paren: '' }] })
    expect(data.panels[2].durationSec).toBe(4) // durationSec 우선
    expect(data.panels[3].stale).toBe(true)
    expect(data.sequence).toMatchObject({ place: '군산 외곽 도로', time: '새벽', shotCount: 8 })
    expect(data.meta.date).toBe('2026-10-10')
    expect(shotDuration(seqOf(2).shots[1])).toBe(estimateShotDuration('', ['대사 1']))
    // 기록엔 있는데 파일이 없으면 이미지 없이 "파일 없음" 표시
    const gone = buildLayoutData(project, seqOf(1), [], { meta: t.meta, pageMm: [297, 210], imageUrl: () => null, templateId: 'x', templateName: 'x', templateVersion: '1' })
    expect(gone.panels[0]).toMatchObject({ image: null, version: 'v1 파일 없음', imageSource: '' })
  })
})

describe('render', () => {
  it('renders every page with escaped text, raw svg, fonts and page size', async () => {
    const t = await loadTemplate(join(TEMPLATES, 'placeholder-a4-6up'))
    const opts = { meta: t.meta, pageMm: [297, 210] as [number, number], imageUrl: (r: string) => `conti-file://project/${r}`, templateId: t.meta.id, templateName: t.meta.name, templateVersion: t.meta.version, date: new Date(2026, 9, 10) }
    const data = buildLayoutData(project, seqOf(8), [], opts)
    const r = renderHtml(t, data, { fontBase: 'conti-file://font/', screen: true })
    expect(r.pages).toBe(2)
    expect((r.html.match(/<section class="page">/g) ?? []).length).toBe(2)
    expect(r.html).toContain('@page{size:297mm 210mm;margin:0}')
    expect(r.html).toContain("src:url('conti-file://font/Pretendard-Regular.woff2')")
    expect(r.html).toContain('지문 0 &lt;b&gt;굵게&lt;/b&gt;') // 사용자 텍스트는 이스케이프
    expect(r.html).toContain('테스트 &lt;프로젝트&gt;')
    expect(r.html).toContain('<svg class="annotations"') // 주석은 그대로
    expect(r.html).toContain('data-shot="0010"')
    expect(r.html).toContain('콘티 없음')
    // 같은 데이터·템플릿이면 같은 키 (날짜만 달라도 같다)
    const r2 = renderHtml(t, buildLayoutData(project, seqOf(8), [], { ...opts, date: new Date(2027, 0, 1) }))
    expect(r2.key).toBe(r.key)
    const r3 = renderHtml(t, buildLayoutData(project, seqOf(9), [], opts))
    expect(r3.key).not.toBe(r.key)
  })
  it('renders the template sample.json (Template Lab)', async () => {
    const t = await loadTemplate(join(TEMPLATES, 'placeholder-a4-6up'))
    const r = renderHtml(t, t.sample as never)
    expect((r.html.match(/<section class="page">/g) ?? []).length).toBe(2)
    expect(r.html).toContain('PAN →')
  })
})

describe('annotations svg', () => {
  it('draws arrows, rects, zoom corners and notes; clamps coordinates; escapes labels', () => {
    const svg = annotationsSvg([
      { id: '1', type: 'move', points: [[0, 0], [0.5, 0.5]], label: '<run>' },
      { id: '2', type: 'frame', points: [[0.2, 0.2], [0.6, 0.7]] },
      { id: '3', type: 'zoom', points: [[0.3, 0.3], [0.7, 0.7]] },
      { id: '4', type: 'note', points: [[2, -1]], label: '메모' },
    ])
    expect(svg).toContain('&lt;run&gt;')
    expect(svg).toContain('<rect')
    expect((svg.match(/<line /g) ?? []).length).toBe(4)
    expect(svg).toContain('cx="160" cy="0"') // 범위 밖 좌표는 잘린다
    expect(annotationsSvg([])).toBe('')
  })
})

describe('animatic + png', () => {
  it('builds a concat list (last frame repeated) and ffmpeg args', () => {
    const list = concatList([
      { absImage: "/a/it's.png", durationSec: 2.5 },
      { absImage: '/a/b.png', durationSec: 0.02 },
    ])
    expect(list.split('\n')).toEqual(['ffconcat version 1.0', "file '/a/it'\\''s.png'", 'duration 2.5', "file '/a/b.png'", 'duration 0.1', "file '/a/b.png'", ''])
    const args = animaticArgs({ listFile: '/t/l.txt', outFile: '/t/o.mp4' })
    expect(args.slice(-1)[0]).toBe('/t/o.mp4')
    expect(args).toContain('libx264')
    expect(args.join(' ')).toContain('pad=1920:1080')
    expect(animaticArgs({ listFile: 'l', outFile: 'o', totalSec: 15.44 }).join(' ')).toContain('-t 15.44')
  })
  it('encodes a valid PNG', () => {
    const png = solidPng(64, 36)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(64)
    expect(png.readUInt32BE(20)).toBe(36)
  })
})
