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
