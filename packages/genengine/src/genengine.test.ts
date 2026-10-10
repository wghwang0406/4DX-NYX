import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectStore } from '@conti/core'
import { ASSET_VIEWS, assetJobCount, viewsForShotSize, type Asset } from '@conti/domain'
import { ModelTable } from './models'
import { RealHiggsfieldCli, classifyExit, paramsToArgv, parseCreateOutput, parseJsonOut, remoteState } from './cli'
import { imageDims } from './download'
import { lintPrompt } from './prompts/lint'
import { buildContiPrompt, parseTags } from './prompts/conti'
import { charSheetPrompt, locViewPrompt, propPrompt } from './prompts/assets'
import { surgicalEditPrompt, restylePrompt } from './prompts/edit'
import { pickShotRefs } from './refs'
import { expandNeighbors, planRequest } from './plan'
import { JobCapError, JobService, type JobEvent } from './jobs'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(here, '..', '..', '..', 'agent-bundle')
const FAKE = join(here, '..', 'test', 'fake-higgsfield.mjs')
// 1x1 PNG + 64 바이트 패딩(다운로더 최소 크기)
const PNG = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(64)])

let models: ModelTable
let http: Server
let httpUrl: string
let served = 0

beforeAll(async () => {
  models = await ModelTable.load(BUNDLE)
  await chmod(FAKE, 0o755)
  http = createServer((req, res) => {
    served++
    if (req.url?.startsWith('/result/')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  httpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()))
})

function fakeCli(fakeDir: string, extra: Record<string, string> = {}) {
  return new RealHiggsfieldCli({ bin: process.execPath, env: { ...process.env, FAKE_HF_DIR: fakeDir, FAKE_HF_URL: httpUrl, ...extra }, timeoutMs: 20_000 }) as RealHiggsfieldCli & { bin: string }
}

// execPath 로 node 를 띄우고 스크립트를 첫 인자로 — RealHiggsfieldCli 는 bin 하나만 받으므로 래퍼 스크립트를 만든다
async function fakeBin(dir: string): Promise<string> {
  const sh = join(dir, 'higgsfield')
  await writeFile(sh, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`)
  await chmod(sh, 0o755)
  return sh
}

async function makeProject(name: string) {
  const root = await mkdtemp(join(tmpdir(), `conti-gen-${name}-`))
  const store = await ProjectStore.create(root, { code: 'GEN', title: '생성 테스트' })
  await store.updateProject({ style: { anchorEn: 'clean 3D CG animated film look', contiSketchEn: '', contiCinematicEn: '', paletteEn: 'muted teal and amber, 60/30/10' } })
  await store.upsertSequence({
    seq: 'S41',
    ep: 'EP01',
    headingKo: '군산 외곽 도로 - 새벽',
    breakdown: { status: 'accepted' },
    shots: [
      { id: 'a', no: '0010', sizeCode: 'EWS', actionKo: '새벽 도로', characters: [], location: '@loc_도로_dawn', props: [], dialogue: [] },
      { id: 'b', no: '0020', sizeCode: 'WS', actionKo: '트럭이 멈춘다', characters: ['@해수'], location: '@loc_도로_dawn', props: ['@prop_권총'], dialogue: [] },
      { id: 'c', no: '0030', sizeCode: 'CU', actionKo: '', characters: ['@해수'], location: '@loc_도로_dawn', props: [], dialogue: [{ speaker: '해수', text: '여기서 멈춰.' }], promptSlots: { shotSizeEn: 'close-up', angleEn: 'eye level', actionStateEn: 'already turned toward the truck, mouth mid-sentence', expressionEn: 'jaw set, eyes narrowed with a slow blink', compositionEn: 'rule of thirds, subject on the right third facing screen left', countsEn: 'exactly one person in frame' } },
      { id: 'd', no: '0040', sizeCode: 'MS', actionKo: '주변을 살핀다', characters: ['@해수'], location: '@loc_도로_dawn', props: [], dialogue: [] },
    ] as never,
  })
  const ep = 'EP01'
  const mk = (a: Partial<Asset> & { id: string; tag: string; kind: Asset['kind']; nameKo: string }): Asset => ({ state: 'base', descriptionKo: '', anchorEn: '', views: {}, usedIn: [], ...a }) as Asset
  await store.upsertAsset(ep, mk({ id: 'c1', tag: '@해수', kind: 'char', subkind: 'human', nameKo: '해수', anchorEn: '28yo lean female detective, shoulder-length black hair tied back, worn navy field jacket. 100% matches the reference.' }))
  await store.upsertAsset(ep, mk({ id: 'l1', tag: '@loc_도로_dawn', kind: 'loc', state: 'dawn', nameKo: '도로', anchorEn: 'two-lane coastal road at dawn, wet asphalt, fog over the mudflats, cold blue light from screen left', cameraAnchorEn: 'wide establishing shot from the road shoulder at standing eye level' }))
  await store.upsertAsset(ep, mk({ id: 'p1', tag: '@prop_권총', kind: 'prop', nameKo: '권총', anchorEn: 'compact matte black service pistol, worn grip, plain unbranded slide' }))
  return { root, store }
}

async function addView(store: ProjectStore, ep: string, id: string, view: string, rel: string, n = 1) {
  const ea = await store.listAssets(ep)
  const a = ea.assets.find((x) => x.id === id)!
  await mkdir(dirname(join(store.root, rel)), { recursive: true })
  await writeFile(join(store.root, rel), PNG)
  await store.upsertAsset(ep, { ...a, views: { ...a.views, [view]: [...(a.views[view] ?? []), { id: `${id}-${view}-${n}`, n, stage: 'image', file: rel, source: 'generated', createdAt: 1 }] } })
}

describe('models.json', () => {
  it('resolves shorthand and canonical ids', () => {
    expect(models.resolve('gpt')).toBe('gpt_image_2_5')
    expect(models.resolve('nano')).toBe('nano_banana_2')
    expect(models.canonical('nano_banana_2')).toBe('nano_banana_pro')
    expect(models.resolve('unknown_x')).toBe('unknown_x')
  })
  it('builds per-model quality flags (models.py image_flags)', () => {
    expect(models.imageParams('gpt_image_2_5')).toEqual({ quality: 'high', resolution: '2k' })
    expect(models.imageParams('nano_banana_2')).toEqual({ resolution: '2k' })
    expect(models.imageParams('text2image_soul_v2', 'high')).toEqual({ quality: '2k' })
    expect(models.imageParams('seedream_v4_5', 'high')).toEqual({ quality: 'high' })
    expect(models.imageParams('gpt_image_2_5', 'xhigh', '4k')).toEqual({ quality: 'xhigh', resolution: '4k' })
  })
  it('clamps aspect and knows soul id / max refs', () => {
    expect(models.clampAspect('text2image_soul_v2', '21:9')).toBe('16:9')
    expect(models.clampAspect('soul_cinematic', '21:9')).toBe('21:9')
    expect(models.clampAspect('gpt_image_2', '21:9')).toBe('21:9') // M0 교정
    expect(models.acceptsSoulId('text2image_soul_v2')).toBe(true)
    expect(models.acceptsSoulId('gpt_image_2_5')).toBe(false)
    expect(models.maxImages('nano_banana_2')).toBe(14)
    expect(models.maxImages('kling3_0')).toBe(2)
  })
})

describe('cli helpers', () => {
  it('argv: arrays repeat the flag, undefined skipped', () => {
    expect(paramsToArgv({ aspect_ratio: '16:9', 'image-references': ['a', 'b'], quality: undefined })).toEqual(['--aspect_ratio', '16:9', '--image-references', 'a', '--image-references', 'b'])
  })
  it('parses JSON with progress noise before it', () => {
    expect(parseJsonOut('uploading...\n{"id":"x"}')).toEqual({ id: 'x' })
    expect(() => parseJsonOut('plain text')).toThrow()
  })
  it('finds the job id in unknown create output shapes', () => {
    const id = '940f26b7-5f27-4628-a2ad-5e51ea86db51'
    expect(parseCreateOutput(`{"id":"${id}","status":"queued"}`)).toMatchObject({ id, status: 'queued' })
    expect(parseCreateOutput(`[{"id":"${id}"}]`)).toMatchObject({ id })
    expect(parseCreateOutput(`{"data":{"job":{"job_id":"${id}","status":"pending"}}}`)).toMatchObject({ id, status: 'pending' })
    expect(parseCreateOutput(`{"jobs":[{"jobId":"${id}"}]}`)).toMatchObject({ id })
    expect(parseCreateOutput(`Created job ${id}\nwaiting`)).toMatchObject({ id, status: 'queued' })
    expect(parseCreateOutput('{"ok":true}')).toBeNull()
    expect(parseCreateOutput('')).toBeNull()
  })
  it('classifies exit codes without matching Korean messages', () => {
    expect(classifyExit(3, 'Error: 작업을 찾을 수 없어요')).toBe('client')
    expect(classifyExit(4, 'Error: Unknown params: bogus')).toBe('server')
    expect(classifyExit(1, 'dial tcp: no such host')).toBe('network')
    expect(remoteState('completed')).toBe('done')
    expect(remoteState('nsfw')).toBe('failed')
    expect(remoteState('whatever')).toBe('running')
  })
  it('runs the fake CLI: account / cost / create / get / exit codes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fakehf-'))
    const cli = new RealHiggsfieldCli({ bin: await fakeBin(dir), env: { ...process.env, FAKE_HF_DIR: dir } })
    expect((await cli.accountStatus()).credits).toBe(100)
    expect(await cli.cost('gpt_image_2_5', { quality: 'high' }, '테스트 프롬프트\n둘째 줄')).toEqual({ credits: 0.25 })
    const job = await cli.create('gpt_image_2_5', { aspect_ratio: '16:9' }, 'p')
    expect(job.id).toMatch(/[0-9a-f-]{36}/)
    expect((await cli.get(job.id)).status).toBe('running')
    await expect(cli.get('nope')).rejects.toMatchObject({ kind: 'client', code: 3 })
    await expect(cli.cost('no_such_model', {}, 'p')).rejects.toMatchObject({ kind: 'server', code: 4 })
    const log = await readFile(join(dir, 'calls.log'), 'utf8')
    expect(log).toContain('generate create gpt_image_2_5 --aspect_ratio 16:9')
    expect(log).not.toContain('--prompt') // stdin
  })
})

describe('image dims', () => {
  it('reads PNG / JPEG / WebP headers', () => {
    expect(imageDims(PNG)).toEqual({ w: 1, h: 1 })
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])
    expect(imageDims(jpg)).toEqual({ w: 512, h: 256 })
    expect(imageDims(Buffer.from('nope'))).toBeUndefined()
  })
})

describe('prompt lint', () => {
  it('flags emotion words, brands, transitions, platform params, Korean', () => {
    const w = lintPrompt('Pixar style, she is angry and starts to run, 16:9, near the door 한글')
    expect(w.join('\n')).toMatch(/감정어/)
    expect(w.join('\n')).toMatch(/브랜드/)
    expect(w.join('\n')).toMatch(/전환/)
    expect(w.join('\n')).toMatch(/플랫폼/)
    expect(w.join('\n')).toMatch(/측정 가능/)
    expect(w.join('\n')).toMatch(/한글/)
  })
  it('sheet exemption and edit mode', () => {
    expect(lintPrompt('rule of thirds', { sheet: true }).join()).toMatch(/시트/)
    expect(lintPrompt('no hat, no scarf, no gloves', { edit: true }).join()).not.toMatch(/부정문/)
    expect(lintPrompt('no hat, no scarf, no gloves').join()).toMatch(/부정문/)
    expect(lintPrompt('clean dry skin, monochrome')).toEqual([])
  })
})

describe('prompt assembly', () => {
  it('conti: slots + project style + reference numbering, Korean fallback flagged', async () => {
    const { store } = await makeProject('prompt')
    const project = store.getProject()
    const seq = store.getSequence('S41')!
    const assets = (await store.listAssets('EP01')).assets
    const shot = seq.shots.find((s) => s.no === '0030')!
    const refs = [{ tag: '@해수', kind: 'char' as const, view: 'face', file: 'EP01/character/char/x.png' }]
    const built = buildContiPrompt({ project, sequence: seq, shot, assets, style: 'sketch', refs })
    expect(built.text.startsWith('Rough storyboard sketch')).toBe(true)
    expect(built.text).toContain('Shot: close-up, eye level.')
    expect(built.text).toContain('the character from reference image 1 (100% matches the reference)')
    expect(built.text).toContain('Action: already turned toward the truck, mouth mid-sentence.')
    expect(built.text).toContain('Exactly one person in frame.')
    expect(built.text).not.toMatch(/16:9|2k/)
    expect(built.warnings).toEqual([])
    // 슬롯 없는 샷은 한국어 원문으로 폴백 + 경고
    const b2 = buildContiPrompt({ project, sequence: seq, shot: seq.shots[1], assets, style: 'cinematic', refs: [] })
    expect(b2.text).toContain('clean 3D CG animated film look')
    expect(b2.text).toContain('28yo lean female detective')
    expect(b2.text).toContain('muted teal and amber')
    expect(b2.warnings.join()).toMatch(/한글/)
    // 태그 없는 대사 컷은 화자 수로 인원을 센다 (빈 프레임이 되지 않게)
    const b3 = buildContiPrompt({ project, sequence: seq, shot: { ...seq.shots[2], characters: [] }, assets, style: 'sketch', refs: [] })
    expect(b3.text).toContain('Exactly one person in frame.')
    expect(parseTags('["@해수","@prop_권총"]')).toEqual(['@해수', '@prop_권총'])
    expect(parseTags('@a, @b')).toEqual(['@a', '@b'])
  })
  it('assets: sheet has no illustration triggers, loc view / prop / edit templates', async () => {
    const { store } = await makeProject('assets')
    const project = store.getProject()
    const assets = (await store.listAssets('EP01')).assets
    const sheet = charSheetPrompt(assets.find((a) => a.kind === 'char')!, project)
    expect(sheet.text).toContain('film character sheet')
    expect(sheet.text).toContain('the same real person in all three')
    expect(sheet.text).not.toMatch(/character reference sheet|painterly|rule of thirds/i)
    expect(sheet.warnings).toEqual([])
    const lv = locViewPrompt('top', assets.find((a) => a.kind === 'loc')!)
    expect(lv.text).toMatch(/^Edit the image/)
    expect(lv.text).toContain('PRESERVE EXACTLY')
    const pp = propPrompt('34', assets.find((a) => a.kind === 'prop')!, project)
    expect(pp.text).toContain('three-quarter overhead product shot')
    expect(surgicalEditPrompt('make the pistol holstered').text).toContain('ONLY CHANGE: make the pistol holstered. 100% identical otherwise.')
    expect(restylePrompt('black and white pencil line art').text).toContain('redraw this frame as black and white pencil line art')
  })
})

describe('refs & views', () => {
  it('view tables', () => {
    expect(ASSET_VIEWS.char).toEqual(['sheet', 'front', 'back', 'face'])
    expect(assetJobCount('loc')).toBe(4)
    expect(assetJobCount('prop', ['top'])).toBe(1)
    expect(viewsForShotSize('CU')).toEqual({ loc: 'detail', char: 'face', prop: 'detail' })
    expect(viewsForShotSize(undefined).loc).toBe('34')
  })
  it('picks latest view with fallback and never loc top', async () => {
    const { store } = await makeProject('refs')
    await addView(store, 'EP01', 'c1', 'sheet', 'EP01/character/char/해수_Character_sheet_v1.png')
    await addView(store, 'EP01', 'c1', 'sheet', 'EP01/character/char/해수_Character_sheet_v2.png', 2)
    await addView(store, 'EP01', 'l1', 'top', 'EP01/character/loc/도로_Location_top_v1.png')
    const assets = (await store.listAssets('EP01')).assets
    const shot = store.getSequence('S41')!.shots.find((s) => s.no === '0030')!
    const refs = pickShotRefs(shot, assets, 14)
    expect(refs).toEqual([{ tag: '@해수', kind: 'char', view: 'sheet', file: 'EP01/character/char/해수_Character_sheet_v2.png' }])
    expect(pickShotRefs(shot, assets, 0)).toEqual([])
  })
})

describe('planner', () => {
  it('conti: pilot splits rest, neighbors expand, refs attached, params from model table', async () => {
    const { store } = await makeProject('plan')
    await addView(store, 'EP01', 'c1', 'front', 'EP01/character/char/해수_Character_front_v1.png')
    const seq = store.getSequence('S41')!
    expect(expandNeighbors(seq, ['0030'])).toEqual(['0020', '0030', '0040'])
    expect(expandNeighbors(seq, ['0010', '0040'])).toEqual(['0010', '0020', '0030', '0040'])
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0020', '0030'], style: 'sketch' }, 'pilot', { includeNeighbors: true })
    expect(r.plans).toHaveLength(1)
    expect(r.plans[0].target).toMatchObject({ type: 'shot', shotNo: '0010' })
    expect(r.rest).toEqual({ args: { seq: 'S41', shots: ['0020', '0030', '0040'], style: 'sketch', pilot: false }, count: 3 })
    const full = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0020'], style: 'cinematic' }, 'approved')
    expect(full.plans[0]).toMatchObject({ model: 'gpt_image_2_5', params: { aspect_ratio: '16:9', quality: 'high', resolution: '2k' }, style: 'cinematic', source: 'generated' })
    expect(full.plans[0].refs).toEqual([{ file: 'EP01/character/char/해수_Character_front_v1.png', label: '@해수 front' }])
  })
  it('assets: char sheet + 3 plates chained, loc wide + 3 views, prop 3 independent; existing master reused', async () => {
    const { store } = await makeProject('plan-assets')
    const r = await planRequest({ store, models }, 'assets_generate', { ep: 'EP01', ids: ['@해수', 'l1', '@prop_권총'] }, 'approved')
    expect(r.plans).toHaveLength(4 + 4 + 3)
    const sheet = r.plans[0]
    expect(sheet).toMatchObject({ model: 'text2image_soul_v2', params: { aspect_ratio: '16:9', quality: '2k' }, target: { view: 'sheet' } })
    expect(r.plans[1]).toMatchObject({ model: 'nano_banana_2', dependsOn: 0, source: 'edit', target: { view: 'front' }, params: { aspect_ratio: '3:4', resolution: '2k' } })
    expect(r.plans[4]).toMatchObject({ model: 'soul_cinematic', target: { view: 'wide' } })
    expect(r.plans[5]).toMatchObject({ model: 'gpt_image_2_5', dependsOn: 4, target: { view: '34' } })
    expect(r.plans[8]).toMatchObject({ model: 'nano_banana_2', target: { view: 'top' }, params: { aspect_ratio: '1:1' } })
    expect(r.plans[8].dependsOn).toBeUndefined()
    // 정본이 이미 있으면 파생만 + 정본을 파일 레퍼런스로
    await addView(store, 'EP01', 'l1', 'wide', 'EP01/character/loc/도로_Location_wide_v1.png')
    const r2 = await planRequest({ store, models }, 'assets_generate', { ep: 'EP01', ids: ['l1'], views: ['detail'] }, 'approved')
    expect(r2.plans).toHaveLength(1)
    expect(r2.plans[0].refs[0].file).toBe('EP01/character/loc/도로_Location_wide_v1.png')
    expect(r2.plans[0].dependsOn).toBeUndefined()
    // 정본 없이 파생만 요청하면 정본을 끼워 넣는다
    const r3 = await planRequest({ store, models }, 'assets_generate', { ep: 'EP01', ids: ['@해수'], views: ['face'] }, 'approved')
    expect(r3.plans.map((p) => (p.target as { view: string }).view)).toEqual(['sheet', 'face'])
    expect(r3.notes[0]).toMatch(/정본/)
    // soul id 가 있으면 custom_reference_id
    const ea = await store.listAssets('EP01')
    await store.upsertAsset('EP01', { ...ea.assets.find((a) => a.id === 'c1')!, soul: { id: 'soul-1', model: 'text2image_soul_v2', status: 'ready' } })
    const r4 = await planRequest({ store, models }, 'assets_generate', { ep: 'EP01', ids: ['c1'], views: ['sheet'] }, 'approved')
    expect(r4.plans[0].params.custom_reference_id).toBe('soul-1')
  })
  it('edit / restyle need a current version', async () => {
    const { store } = await makeProject('plan-edit')
    await expect(planRequest({ store, models }, 'image_edit', { seq: 'S41', shotNo: '0020', instructionEn: 'holster the pistol' }, 'approved')).rejects.toThrow(/아직 없습니다/)
  })
})

describe('JobService (fake CLI, zero credits)', () => {
  async function setup(name: string, extraEnv: Record<string, string> = {}, opts: Partial<ConstructorParameters<typeof JobService>[0]> = {}) {
    const { root, store } = await makeProject(name)
    const fakeDir = await mkdtemp(join(tmpdir(), 'fakehf-'))
    const cli = new RealHiggsfieldCli({ bin: await fakeBin(fakeDir), env: { ...process.env, FAKE_HF_DIR: fakeDir, FAKE_HF_URL: httpUrl, ...extraEnv } })
    const events: JobEvent[] = []
    const svc = new JobService({ store, cli, pollMs: 30, concurrency: 3, onEvent: (e) => events.push(e), ...opts })
    await svc.init()
    return { root, store, cli, svc, events, fakeDir }
  }

  it('conti: approve → upload(cached) → create → poll → download → version + stage review + inputHash', async () => {
    const { root, store, svc, events, fakeDir } = await setup('jobs')
    await addView(store, 'EP01', 'c1', 'front', 'EP01/character/char/해수_Character_front_v1.png')
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0020', '0030'], style: 'sketch' }, 'approved')
    const jobs = await svc.submit('req-1', r.plans)
    expect(jobs).toHaveLength(2)
    expect(store.getSequence('S41')!.shots[1].stages.conti.status).toBe('queued')
    const w = await svc.waitRequest('req-1', 15_000)
    expect(w.pending).toBe(false)
    expect(w.jobs.map((j) => j.status)).toEqual(['done', 'done'])
    const files = await readdir(join(root, 'EP01', 'Conti', 'S41'))
    expect(files).toContain('S41_0020_v1.png')
    expect(files).toContain('S41_0030_v1.png')
    const shot = store.getSequence('S41')!.shots.find((s) => s.no === '0020')!
    expect(shot.stages.conti).toMatchObject({ status: 'review', lastJobId: jobs[0].id })
    expect(shot.stages.conti.inputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(shot.panels[0].versions.conti[0]).toMatchObject({ n: 1, file: 'EP01/Conti/S41/S41_0020_v1.png', source: 'generated', w: 1, h: 1, jobId: jobs[0].id })
    expect(shot.stages.conti.currentVersionId).toBe(shot.panels[0].versions.conti[0].id)
    // 같은 레퍼런스를 두 샷이 써도 업로드는 한 번
    const log = await readFile(join(fakeDir, 'calls.log'), 'utf8')
    expect(log.split('\n').filter((l) => l.startsWith('upload create'))).toHaveLength(1)
    expect(log).toMatch(/generate create gpt_image_2_5 --aspect_ratio 16:9 --quality high --resolution 2k --image-references [0-9a-f-]+/)
    expect(events.some((e) => e.t === 'request_done' && e.requestId === 'req-1' && e.done === 2)).toBe(true)
    // 두 번째 생성은 v2
    const r2 = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0020'], style: 'sketch' }, 'approved')
    await svc.submit('req-2', r2.plans)
    await svc.waitRequest('req-2', 15_000)
    const s2 = store.getSequence('S41')!.shots.find((s) => s.no === '0020')!
    expect(s2.panels[0].versions.conti.map((v) => v.n)).toEqual([1, 2])
    expect(s2.stages.conti.currentVersionId).toBe(s2.panels[0].versions.conti[1].id)
    // shotlist md 에 상태가 반영됐다
    const md = await readFile(join(root, 'EP01', 'Conti', 'S41', 'shotlist_S41.md'), 'utf8')
    expect(md).toContain('0020')
  })

  it('assets: chained plates wait for the sheet and use its output as reference', async () => {
    const { root, store, svc, fakeDir } = await setup('jobs-assets')
    const r = await planRequest({ store, models }, 'assets_generate', { ep: 'EP01', ids: ['@해수'] }, 'approved')
    await svc.submit('req-a', r.plans)
    const w = await svc.waitRequest('req-a', 20_000)
    expect(w.jobs.map((j) => j.status)).toEqual(['done', 'done', 'done', 'done'])
    const files = await readdir(join(root, 'EP01', 'character', 'char'))
    expect(files.sort()).toEqual(['해수_Character_back_v1.png', '해수_Character_face_v1.png', '해수_Character_front_v1.png', '해수_Character_sheet_v1.png'])
    const a = (await store.listAssets('EP01')).assets.find((x) => x.id === 'c1')!
    expect(Object.keys(a.views).sort()).toEqual(['back', 'face', 'front', 'sheet'])
    expect(a.views.front[0].source).toBe('edit')
    const log = await readFile(join(fakeDir, 'calls.log'), 'utf8')
    // 파생 3장은 시트 파일을 업로드해 레퍼런스로 썼다 (업로드 1회, 캐시)
    expect(log.split('\n').filter((l) => l.startsWith('upload create'))).toHaveLength(1)
    expect(log.split('\n').filter((l) => l.startsWith('generate create nano_banana_2') && l.includes('--image-references'))).toHaveLength(3)
    // Character.md 뷰가 다시 쓰였다
    const cm = await readFile(join(root, 'EP01', 'character', 'Character.md'), 'utf8')
    expect(cm).toContain('해수')
  })

  it('failure paths: server rejects create (exit 4) → failed, no retry; remote failed status; dependent skipped', async () => {
    const a = await setup('jobs-fail', { FAKE_HF_FAIL: 'create' })
    const r = await planRequest({ store: a.store, models }, 'assets_generate', { ep: 'EP01', ids: ['@해수'], views: ['sheet', 'front'] }, 'approved')
    await a.svc.submit('req-f', r.plans)
    const w = await a.svc.waitRequest('req-f', 10_000)
    expect(w.jobs[0].status).toBe('failed')
    expect(w.jobs[0].error).toMatch(/server exit 4/)
    expect(w.jobs[1].status).toBe('failed')
    expect(w.jobs[1].error).toMatch(/정본 작업 실패/)
    const log = await readFile(join(a.fakeDir, 'calls.log'), 'utf8')
    expect(log.split('\n').filter((l) => l.startsWith('generate create'))).toHaveLength(1) // 재시도 없음
    const b = await setup('jobs-fail2', { FAKE_HF_FAIL: 'status' })
    const r2 = await planRequest({ store: b.store, models }, 'conti_generate', { seq: 'S41', shots: ['0010'], style: 'sketch' }, 'approved')
    await b.svc.submit('req-g', r2.plans)
    const w2 = await b.svc.waitRequest('req-g', 10_000)
    expect(w2.jobs[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/서버에서 실패/) })
    expect(b.store.getSequence('S41')!.shots[0].stages.conti.status).toBe('failed')
  })

  it('daily cap blocks before spending', async () => {
    const { store, svc } = await setup('jobs-cap', {}, { dailyCap: 1 })
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0010', '0020'], style: 'sketch' }, 'approved')
    await expect(svc.submit('req-c', r.plans)).rejects.toThrow(JobCapError)
    expect(svc.list()).toHaveLength(0)
  })

  it('crash recovery: submitted job resumes polling; submitting job is reconciled by prompt; queued job re-runs', async () => {
    const { root, store, cli, svc, fakeDir } = await setup('jobs-recover')
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0010', '0020', '0030'], style: 'sketch' }, 'approved')
    // 1) 첫 작업은 정상 제출 → 'submitted' 상태에서 앱이 죽었다고 가정 (서비스를 버리고 파일만 남긴다)
    const svcA = new JobService({ store, cli, pollMs: 100_000, concurrency: 3 }) // 느린 폴링 → submitted 에 머문다
    await svcA.init()
    const jobs = await svcA.submit('req-r', r.plans.slice(0, 1))
    // 고정 대기 대신 폴링 — 부하가 걸린 머신에서도 제출 기록이 디스크에 생길 때까지 (최대 10초)
    const recPath = join(root, '.conti', 'jobs', `${jobs[0].id}.json`)
    let rec = ''
    for (let i = 0; i < 100 && !/"status": "(submitted|running)"/.test(rec); i++) {
      await new Promise((res) => setTimeout(res, 100))
      rec = await readFile(recPath, 'utf8')
    }
    expect(rec).toMatch(/"status": "(submitted|running)"/)
    await svcA.stop()
    // 2) 'submitting' 기록을 손으로 만든다 — create 는 서버에 들어갔지만 id 를 못 적은 상황
    const remote = await cli.create('gpt_image_2_5', { aspect_ratio: '16:9' }, r.plans[1].prompt)
    const ghost = { ...jobs[0], id: 'ghost-1', target: r.plans[1].target, prompt: r.plans[1].prompt, status: 'submitting', remote: undefined, createdAt: Date.now(), updatedAt: Date.now() }
    await writeFile(join(root, '.conti', 'jobs', 'ghost-1.json'), JSON.stringify(ghost))
    // 3) 'queued' 기록 (제출 전) — 다시 돌아야 한다
    const queued = { ...jobs[0], id: 'queued-1', target: r.plans[2].target, prompt: r.plans[2].prompt, status: 'queued', remote: undefined, createdAt: Date.now() + 1, updatedAt: Date.now() }
    await writeFile(join(root, '.conti', 'jobs', 'queued-1.json'), JSON.stringify(queued))
    // 재시작
    const svcB = new JobService({ store, cli, pollMs: 30, concurrency: 3 })
    await svcB.init()
    const w = await svcB.waitRequest('req-r', 20_000)
    expect(w.pending).toBe(false)
    const byId = Object.fromEntries(w.jobs.map((j) => [j.id, j]))
    expect(byId[jobs[0].id].status).toBe('done')
    expect(byId['ghost-1']).toMatchObject({ status: 'done', remote: { jobId: remote.id } })
    expect(byId['queued-1'].status).toBe('done')
    const files = await readdir(join(root, 'EP01', 'Conti', 'S41'))
    expect(files.filter((f) => f.endsWith('.png')).sort()).toEqual(['S41_0010_v1.png', 'S41_0020_v1.png', 'S41_0030_v1.png'])
    // 서버에는 create 가 딱 2번 (원래 1 + ghost 용 1) — queued 재실행이 1번 더 = 3
    const log = await readFile(join(fakeDir, 'calls.log'), 'utf8')
    expect(log.split('\n').filter((l) => l.startsWith('generate create'))).toHaveLength(3)
    await svc.stop()
  })

  it('asset change marks conti shots stale; reconcile miss → unknown with guidance', async () => {
    const { root, store, cli, svc } = await setup('jobs-stale')
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0020', '0030'], style: 'sketch' }, 'approved')
    await svc.submit('req-s', r.plans)
    await svc.waitRequest('req-s', 15_000)
    expect(await store.markStaleByAsset('@해수')).toBe(2) // 0020·0030 은 @해수, 0010 은 없음
    expect(store.getSequence('S41')!.shots.map((s) => s.stages.conti.status)).toEqual(['none', 'stale', 'stale', 'none'])
    expect(await store.markStaleByAsset('@해수')).toBe(0) // 이미 stale 이면 다시 세지 않는다
    // 제출 중 죽었는데 서버에 같은 프롬프트가 없으면 unknown + 안내
    const ghost = { ...svc.list('req-s')[0], id: 'ghost-miss', prompt: 'never submitted', status: 'submitting', remote: undefined, outFile: undefined, versionId: undefined }
    await writeFile(join(root, '.conti', 'jobs', 'ghost-miss.json'), JSON.stringify(ghost))
    const svc2 = new JobService({ store, cli, pollMs: 30 })
    await svc2.init()
    expect(svc2.get('ghost-miss')).toMatchObject({ status: 'unknown', error: expect.stringMatching(/크레딧이 쓰였는지/) })
    // 다시 제출하면 새 작업으로 돈다
    const again = await svc2.resubmit('ghost-miss')
    const w = await svc2.waitRequest('req-s', 15_000)
    expect(w.jobs.find((j) => j.id === again.id)?.status).toBe('done')
  })

  it('legacy files on disk are not clobbered: next version skips existing _v files', async () => {
    const { root, store, svc } = await setup('jobs-legacy')
    await mkdir(join(root, 'EP01', 'Conti', 'S41'), { recursive: true })
    await writeFile(join(root, 'EP01', 'Conti', 'S41', 'S41_0010_v1.png'), PNG)
    await writeFile(join(root, 'EP01', 'Conti', 'S41', 'S41_0010_v2.png'), PNG)
    const r = await planRequest({ store, models }, 'conti_generate', { seq: 'S41', shots: ['0010'], style: 'sketch' }, 'approved')
    await svc.submit('req-l', r.plans)
    const w = await svc.waitRequest('req-l', 10_000)
    expect(w.jobs[0].outFile).toBe('EP01/Conti/S41/S41_0010_v3.png')
    expect(store.getSequence('S41')!.shots[0].panels[0].versions.conti[0].n).toBe(3)
  })
})

afterAll(async () => {
  // 임시 폴더는 OS 가 정리한다 — 생성된 개수만 확인
  expect(served).toBeGreaterThan(0)
  await rm(join(tmpdir(), 'conti-gen-never'), { force: true, recursive: true })
})
