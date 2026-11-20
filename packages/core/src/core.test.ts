import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from './store'
import { parseConfigMd, renderConfigMd } from './md/config'
import { parseShotlistMd, renderShotlistMd } from './md/shotlist'
import { upsertStyleAnchor, parseStyleAnchor } from './md/projectprompt'
import { Sequence, Project } from '@conti/domain'

const LEGACY_CONFIG = `# 고래별 — Config

project_code: GRB
project_title: 고래별
project_type: drama

## Episode Mapping
| Sequence | Episode |
|---|---|
| S41 | EP01 |
| S42 | EP01 |
| S01 | EP02 |
`

const LEGACY_SHOTLIST = `# 시퀀스 S42 — 군산 외곽 도로 (밤)

> 상태: ✅완료 / ⏳대기 / ❌스킵 / 🔄재생성중

| # | 샷사이즈 | 인물 | 묘사 | 상태 |
|---|---|---|---|---|
| 0010 | ECU | — | 군화 밑창이 쌀알을 밟으며 프레임인. | ⏳ |
| 0020 | WS | 히구라시, 일경들 | 도사견을 앞세운 히구라시가 전진. | ✅ |
`

describe('config.md', () => {
  it('parses legacy and round-trips', () => {
    const c = parseConfigMd(LEGACY_CONFIG)
    expect(c).toEqual({ code: 'GRB', title: '고래별', type: 'drama', episodeMap: { S41: 'EP01', S42: 'EP01', S01: 'EP02' } })
    expect(parseConfigMd(renderConfigMd(c))).toEqual(c)
  })
})

describe('shotlist md', () => {
  it('reads legacy 5-column tables by header name', () => {
    const { heading, rows } = parseShotlistMd(LEGACY_SHOTLIST)
    expect(heading).toBe('군산 외곽 도로 (밤)')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ no: '0020', size: 'WS', characters: ['히구라시', '일경들'], status: '✅' })
    expect(rows[0].characters).toEqual([])
  })
  it('renders 9 columns and reads them back', () => {
    const seq = Sequence.parse({
      seq: 'S41',
      ep: 'EP01',
      headingKo: '카페 - 낮',
      shots: [
        { id: 'a', no: '0010', sizeCode: 'EWS', location: '@loc_카페', actionKo: '빈 카페.' },
        {
          id: 'b',
          no: '0020',
          sizeCode: 'CU',
          characters: ['@해수'],
          props: ['@prop_권총'],
          tag: '대사',
          dialogue: [{ speaker: '해수', text: '여기서 멈춰.' }],
          stages: { conti: { status: 'approved' }, image: { status: 'stale' }, video: { status: 'none' } },
        },
      ],
    })
    const md = renderShotlistMd(seq)
    expect(md).toContain('| 0020 | CU | 해수 | — | 권총 | [대사] 해수: "여기서 멈춰." | ✅ | 🔁 | ⏳ |')
    const back = parseShotlistMd(md)
    expect(back.rows[1]).toMatchObject({ no: '0020', characters: ['해수'], props: ['권총'], status: '✅' })
    expect(back.rows[0].location).toBe('카페')
  })
})

describe('shotlist md cell escaping (QA)', () => {
  it('escapes | and newlines in every cell and the heading so columns do not shift', () => {
    const seq = Sequence.parse({
      seq: 'S41',
      ep: 'EP01',
      headingKo: '카페 | 골목\n둘째 줄',
      shots: [{ id: 'a', no: '0010', sizeCode: 'WS', characters: ['@의현|형사'], location: '@loc_카페|골목', props: ['@prop_칼|단검'], actionKo: '빈 카페 | 창가\n비' }],
    })
    const md = renderShotlistMd(seq)
    expect(md.split('\n')[0]).toBe('# 시퀀스 S41 — 카페 ｜ 골목 둘째 줄')
    const { rows } = parseShotlistMd(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ size: 'WS', characters: ['의현｜형사'], location: '카페｜골목', props: ['칼｜단검'], description: '빈 카페 ｜ 창가 비' })
  })
})

describe('Projectprompt style anchor', () => {
  it('parses empty values without swallowing the next line', () => {
    const p0 = Project.parse({ id: 'x', code: 'GRB', title: 'T', createdAt: 1, updatedAt: 1 })
    const st = parseStyleAnchor(upsertStyleAnchor('', p0))
    expect(st).toEqual({ anchorEn: '', contiSketchEn: '', contiCinematicEn: '', paletteEn: '' })
  })
  const p = Project.parse({ id: 'x', code: 'GRB', title: '고래별', createdAt: 1, updatedAt: 1, style: { anchorEn: 'Kodak 500T, real grain' } })
  it('inserts into an existing user file without touching their sections', () => {
    const user = '# 고래별 — Master Projectprompt\n\n## Project Identity\n\n1926년 군산.\n'
    const out = upsertStyleAnchor(user, p)
    expect(out).toContain('## Project Identity')
    expect(out).toContain('- anchor_en: Kodak 500T, real grain')
    expect(parseStyleAnchor(out).anchorEn).toBe('Kodak 500T, real grain')
    // 두 번째 갱신은 절만 교체
    const p2 = { ...p, style: { ...p.style, anchorEn: 'changed' } }
    const out2 = upsertStyleAnchor(out, p2)
    expect(out2.match(/Style Anchor/g)).toHaveLength(1)
    expect(parseStyleAnchor(out2).anchorEn).toBe('changed')
    expect(out2).toContain('1926년 군산.')
  })
})

describe('ProjectStore', () => {
  it('creates a project and writes md views', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({
      seq: 'S41',
      ep: 'EP01',
      headingKo: '카페 - 낮',
      shots: [{ id: 's1', no: '0010', sizeCode: 'WS', actionKo: '카페 전경.' }],
    })
    const cfg = await readFile(join(root, 'config.md'), 'utf8')
    expect(cfg).toContain('project_code: TST')
    expect(cfg).toContain('| S41 | EP01 |')
    const sl = await readFile(join(root, 'EP01/Conti/S41/shotlist_S41.md'), 'utf8')
    expect(sl).toContain('| 0010 | WS |')
    // 다시 열면 같은 데이터
    const again = await ProjectStore.open(root)
    expect(again.getSequence('S41')?.shots[0].actionKo).toBe('카페 전경.')
    expect(again.getProject().code).toBe('TST')
  })

  it('opens a legacy config.md-only project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-legacy-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'config.md'), LEGACY_CONFIG)
    const store = await ProjectStore.open(root)
    expect(store.getProject().code).toBe('GRB')
    expect(store.getProject().episodeMap.S01).toBe('EP02')
  })
})

describe('ProjectStore.patchAsset (에셋 카드 직접 수정)', () => {
  it('changes only the given fields, marks drawn shots stale on a visual change, rewrites Character.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-asset-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({
      seq: 'S41',
      ep: 'EP01',
      headingKo: '도로 - 밤',
      shots: [
        { id: 's1', no: '0010', characters: ['@의현'], stages: { conti: { status: 'review', currentVersionId: 'v1' } } },
        { id: 's2', no: '0020', characters: ['@의현'] }, // 아직 안 그린 컷 — stale 대상 아님
      ],
    })
    await store.upsertAsset('EP01', { id: 'a1', tag: '@의현', kind: 'char', nameKo: '의현', descriptionKo: '단정한 흑발', anchorEn: 'short neat black hair', state: 'base', views: {}, usedIn: ['S41'], voiceEn: 'calm' })

    // 이름·Voice 만 → stale 없음
    const r1 = await store.patchAsset('EP01', 'a1', { nameKo: '이의현', voiceEn: 'low and calm' })
    expect(r1.staleShots).toBe(0)
    expect(r1.asset).toMatchObject({ nameKo: '이의현', voiceEn: 'low and calm', anchorEn: 'short neat black hair', tag: '@의현' })

    // 같은 값을 다시 줘도 stale 없음
    expect((await store.patchAsset('EP01', 'a1', { anchorEn: 'short neat black hair' })).staleShots).toBe(0)

    // 한글 설명만 (영문 앵커가 있으면 생성엔 영문만 쓰임) → stale 없음
    expect((await store.patchAsset('EP01', 'a1', { descriptionKo: '단정한 흑발의 청년' })).staleShots).toBe(0)

    // 외형 → 콘티 있는 컷만 stale
    const r2 = await store.patchAsset('EP01', 'a1', { descriptionKo: '흐트러진 흑발, 오른팔 붕대', anchorEn: 'messy black hair, stained cloth bandage on the right forearm' })
    expect(r2.staleShots).toBe(1)
    const shots = store.getSequence('S41')!.shots
    expect(shots.find((x) => x.no === '0010')!.stages.conti.status).toBe('stale')
    expect(shots.find((x) => x.no === '0020')!.stages.conti.status).toBe('none')
    expect(await readFile(join(root, 'EP01/character/Character.md'), 'utf8')).toContain('stained cloth bandage')
    await expect(store.patchAsset('EP01', 'nope', { nameKo: 'x' })).rejects.toThrow('에셋 없음')
  })

  it('keeps an edit history (text + images) and restores text or an image version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-hist-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    const ver = (id: string, n: number) => ({ id, n, stage: 'conti' as const, file: `EP01/character/char/x_v${n}.png`, source: 'generated' as const, createdAt: n })
    await store.upsertAsset('EP01', { id: 'a1', tag: '@해수', kind: 'char', nameKo: '해수', descriptionKo: '단정한 단발', anchorEn: 'neat bob', state: 'base', views: {}, usedIn: ['S41'] }, { by: 'ai' })
    await store.patchAsset('EP01', 'a1', { descriptionKo: '흐트러진 단발', anchorEn: 'messy bob' })
    await store.patchAsset('EP01', 'a1', { descriptionKo: '흐트러진 단발' }) // 바뀐 게 없으면 기록 안 함
    await store.patchAsset('EP01', 'a1', { views: { sheet: [ver('v1', 1)] } }, { by: 'gen' })
    await store.patchAsset('EP01', 'a1', { views: { sheet: [ver('v1', 1), ver('v2', 2)] } }, { by: 'gen' })
    let h = await store.assetHistory('EP01', 'a1')
    expect(h.map((e) => `${e.by}:${e.action}`)).toEqual(['gen:image', 'gen:image', 'user:edit', 'ai:create'])
    expect(h[2].changes.map((c) => c.field).sort()).toEqual(['anchorEn', 'descriptionKo'])
    expect(h[2].changes.find((c) => c.field === 'anchorEn')).toMatchObject({ before: 'neat bob', after: 'messy bob' })
    expect(h[0].images).toEqual([{ view: 'sheet', versionId: 'v2', n: 2, file: 'EP01/character/char/x_v2.png' }])

    // 글을 처음 시점으로 — 한·영 짝은 맞춰진 것으로 기록 (다시 번역하지 않게)
    const r = await store.restoreAsset('EP01', 'a1', h[3].id)
    expect(r.asset).toMatchObject({ descriptionKo: '단정한 단발', anchorEn: 'neat bob', usedIn: ['S41'] })
    expect(r.asset.koSync?.anchorEn).toEqual({ en: 'neat bob', ko: '단정한 단발' })
    // 이미지 v1 을 다시 현재로 → 같은 파일, 새 번호
    const ri = await store.restoreAssetImage('EP01', 'a1', 'sheet', 'v1')
    const sheet = ri.asset.views.sheet
    expect(sheet.at(-1)).toMatchObject({ n: 3, file: 'EP01/character/char/x_v1.png', parentId: 'v1' })
    h = await store.assetHistory('EP01', 'a1')
    expect(h.slice(0, 2).map((e) => `${e.by}:${e.action}`)).toEqual(['restore:restore', 'restore:restore'])
  })

  it('concurrent view writes to one asset keep every version (mutateAsset is serialized)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-race-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertAsset('EP01', { id: 'a1', tag: '@해수', kind: 'char', nameKo: '해수', descriptionKo: '', anchorEn: '', state: 'base', views: {}, usedIn: [] })
    const ver = (id: string) => ({ id, n: 1, stage: 'conti' as const, file: `x_${id}.png`, source: 'generated' as const, createdAt: 1 })
    await Promise.all(['front', 'back', 'face'].map((v) => store.mutateAsset('EP01', 'a1', (a) => ({ ...a, views: { ...a.views, [v]: [ver(v)] } }), { by: 'gen' })))
    const a = (await store.listAssets('EP01')).assets[0]
    expect(Object.keys(a.views).sort()).toEqual(['back', 'face', 'front'])
    expect((await store.assetHistory('EP01', 'a1')).filter((e) => e.action === 'image')).toHaveLength(3)
  })

  it('links, unlinks and copies assets across scenes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conti-link-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({ seq: 'S01', ep: 'EP01', headingKo: '도로', shots: [{ id: 's1', no: '0010', props: ['@prop_경찰차'] }] })
    await store.upsertSequence({ seq: 'S04', ep: 'EP01', headingKo: '도로2', shots: [{ id: 's2', no: '0010', props: ['@prop_경찰차'], characters: ['@해수'] }] })
    await store.upsertAsset('EP01', { id: 'p1', tag: '@prop_경찰차', kind: 'prop', nameKo: '경찰차', descriptionKo: '흰 경찰차', anchorEn: 'white police car', state: 'base', views: {}, usedIn: ['S01'] })

    // 그대로 쓰기
    expect((await store.linkAsset('EP01', 'p1', 'S02')).usedIn).toEqual(['S01', 'S02'])
    // 샷이 쓰는 씬에서는 못 뺀다 / 안 쓰는 씬은 뺀다
    await expect(store.unlinkAsset('EP01', 'p1', 'S01')).rejects.toThrow('샷 1개')
    expect((await store.unlinkAsset('EP01', 'p1', 'S02')).usedIn).toEqual(['S01'])

    // S04 는 경찰차 B 로 — 샷 태그를 바꾸고 원래 에셋은 S04 에서 빠진다
    await store.linkAsset('EP01', 'p1', 'S04')
    const c = await store.copyAsset('EP01', 'p1', 'S04', { tag: '@prop_경찰차_B', nameKo: '경찰차 B', replaceInSeq: true })
    expect(c.retagged).toBe(1)
    expect(c.asset).toMatchObject({ tag: '@prop_경찰차_B', nameKo: '경찰차 B', anchorEn: 'white police car', usedIn: ['S04'] })
    expect(store.getSequence('S04')!.shots[0].props).toEqual(['@prop_경찰차_B'])
    expect(store.getSequence('S01')!.shots[0].props).toEqual(['@prop_경찰차'])
    const assets = (await store.listAssets('EP01')).assets
    expect(assets.find((a) => a.id === 'p1')!.usedIn).toEqual(['S01'])
    expect((await store.assetHistory('EP01', c.asset.id))[0]).toMatchObject({ action: 'copy', note: '@prop_경찰차 에서 복제' })
    await expect(store.copyAsset('EP01', 'p1', 'S04', { tag: '@prop_경찰차_B', nameKo: 'x' })).rejects.toThrow('이미 있는 태그')
  })
})

describe('MdWatcher', () => {
  it('detects an external shotlist edit, proposes a patch, accept applies it and md is regenerated', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { MdWatcher } = await import('./watcher')
    const root = await mkdtemp(join(tmpdir(), 'conti-watch-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({ seq: 'S41', ep: 'EP01', headingKo: '카페', shots: [{ id: 's1', no: '0010', sizeCode: 'WS', actionKo: '카페 전경.' }] })
    const rel = 'EP01/Conti/S41/shotlist_S41.md'
    const abs = join(root, rel)
    // 앱이 쓴 그대로면 대기 없음
    const w = new MdWatcher(store)
    await w.check(abs)
    expect(w.list()).toHaveLength(0)
    // 밖에서 샷사이즈를 바꾸고 새 샷을 추가
    const md = (await readFile(abs, 'utf8')).replace('| 0010 | WS |', '| 0010 | CU |') + '| 0020 | MS | 해수 | — | — | 문을 연다. | ⏳ | ⏳ | ⏳ |\n'
    await writeFile(abs, md)
    await w.check(abs)
    expect(w.list()).toHaveLength(1)
    expect(w.list()[0].summary.join(' ')).toContain('0010: sizeCode')
    expect(w.list()[0].summary.join(' ')).toContain('0020: 새 샷')
    await w.accept(rel)
    const seq = store.getSequence('S41')!
    expect(seq.shots.map((s) => [s.no, s.sizeCode])).toEqual([['0010', 'CU'], ['0020', 'MS']])
    expect(seq.shots[1].characters).toEqual(['@해수'])
    // 재생성된 md 는 다시 "앱이 쓴 그대로"
    await w.check(abs)
    expect(w.list()).toHaveLength(0)
  })

  it('normalizes NFD input and ignores an unknown size instead of throwing on accept', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { MdWatcher } = await import('./watcher')
    const root = await mkdtemp(join(tmpdir(), 'conti-watch2-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({ seq: 'S41', ep: 'EP01', headingKo: '카페', shots: [{ id: 's1', no: '0010', sizeCode: 'WS', actionKo: '카페 전경.', characters: ['@해수'] }] })
    const rel = 'EP01/Conti/S41/shotlist_S41.md'
    const abs = join(root, rel)
    const w = new MdWatcher(store)
    const md = (await readFile(abs, 'utf8')).replace('| 해수 |', `| ${'해수'.normalize('NFD')} |`).replace('| 0010 | WS |', '| 0010 | ms |') + '| 0020 | xx | — | — | — | 새 샷 | ⏳ | ⏳ | ⏳ |\n'
    await writeFile(abs, md)
    await w.check(abs)
    const [c] = w.list()
    expect(c.summary.join(' ')).toContain('0010: sizeCode')
    expect(c.summary.join(' ')).not.toContain('characters') // NFD ≠ NFC 로 오탐하지 않는다
    expect(c.summary.join(' ')).toContain("'xx'")
    await w.accept(rel)
    const seq = store.getSequence('S41')!
    expect(seq.shots.map((s) => [s.no, s.sizeCode])).toEqual([['0010', 'MS'], ['0020', undefined]])
    expect(seq.shots[0].characters).toEqual(['@해수'])
  })

  it('start(): chokidar (no glob support) still picks up a shotlist edit through the directory watch', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { MdWatcher } = await import('./watcher')
    const root = await mkdtemp(join(tmpdir(), 'conti-watch3-'))
    const store = await ProjectStore.create(root, { code: 'TST', title: '테스트' })
    await store.upsertSequence({ seq: 'S41', ep: 'EP01', headingKo: '카페', shots: [{ id: 's1', no: '0010', sizeCode: 'WS', actionKo: '카페 전경.' }] })
    const abs = join(root, 'EP01/Conti/S41/shotlist_S41.md')
    const w = new MdWatcher(store)
    const seen: number[] = []
    w.onPending((l) => seen.push(l.length))
    w.start()
    try {
      await new Promise((r) => setTimeout(r, 400))
      await writeFile(abs, (await readFile(abs, 'utf8')).replace('| 0010 | WS |', '| 0010 | CU |'))
      const t0 = Date.now()
      while (!seen.length && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50))
      expect(w.list().map((c) => c.rel)).toEqual(['EP01/Conti/S41/shotlist_S41.md'])
    } finally {
      await w.stop()
    }
  }, 10000)
})
