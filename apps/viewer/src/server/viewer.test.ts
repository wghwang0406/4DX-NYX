import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createViewerServer, mapToShot, type ViewerServer } from './app'
import { Dropbox } from './dropbox'
import type { Comment, Manifest, PublicationInfo, ReviewPayload } from '../shared/types'

const TOKEN = 'team-publish-token-0123456789'
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200, 7)])
const MP4 = Buffer.alloc(5000, 3)

let dir: string
let srv: ViewerServer
let base: string
let dbxServer: Server
const dbxCalls: Array<{ path: string; arg: Record<string, unknown> | null; size: number }> = []

const auth = { authorization: `Bearer ${TOKEN}` }
async function putBlob(buf: Buffer, chunk = 1 << 20) {
  const h = sha(buf)
  for (let off = 0; off < buf.length; off += chunk) {
    const part = buf.subarray(off, off + chunk)
    const r = await fetch(`${base}/api/blobs/${h}?offset=${off}&size=${buf.length}`, { method: 'PUT', headers: auth, body: new Uint8Array(part) })
    expect(r.status).toBe(200)
  }
  return h
}

function manifest(files: Manifest['files'], over: Partial<Manifest> = {}): Manifest {
  return {
    schema: 1,
    project: { id: 'proj-1', code: 'PRISM', title: '프리즘' },
    seq: 'S41',
    ep: 'EP01',
    heading: '도로 - 새벽',
    label: 'v1',
    status: '컨펌용',
    createdAt: Date.now(),
    pages: [{ n: 1, file: 'pages/p01.png', w: 2246, h: 1588, panels: [{ shotNo: '0010', panelIndex: 0, label: '0010', x: 0.05, y: 0.1, w: 0.3, h: 0.4 }, { shotNo: '0020', panelIndex: 0, label: '0020', x: 0.36, y: 0.1, w: 0.3, h: 0.4 }] }],
    panels: [{ shotNo: '0010', panelIndex: 0, label: '0010' }, { shotNo: '0020', panelIndex: 0, label: '0020' }, { shotNo: '0030', panelIndex: 0, label: '0030' }],
    video: { file: 'video/proxy.mp4', fps: 24, duration: 10 },
    edl: [{ shotNo: '0010', inMs: 0, outMs: 3000 }, { shotNo: '0020', inMs: 3000, outMs: 6000 }, { shotNo: '0030', inMs: 6000, outMs: 10000 }],
    files,
    ...over,
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nyx-viewer-'))
  // 가짜 Dropbox (api + content 같은 서버)
  dbxServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const arg = req.headers['dropbox-api-arg'] ? JSON.parse(String(req.headers['dropbox-api-arg'])) : null
    dbxCalls.push({ path: req.url ?? '', arg, size: Buffer.concat(chunks).length })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/2/files/upload_session/start') return res.end(JSON.stringify({ session_id: 'sess-1' }))
    if (req.url === '/2/files/get_temporary_link') return res.end(JSON.stringify({ link: 'https://dl.example/tmp/proxy.mp4' }))
    res.end('{}')
  })
  await new Promise<void>((r) => dbxServer.listen(0, '127.0.0.1', r))
  const dbxBase = `http://127.0.0.1:${(dbxServer.address() as AddressInfo).port}`
  srv = createViewerServer({ dataDir: dir, publishToken: TOKEN, dropbox: new Dropbox({ token: 'dbx', root: '/NYX', apiBase: dbxBase, contentBase: dbxBase, chunk: 2000 }), maxChunk: 1 << 20 })
  base = (await srv.start()).url
})
afterAll(async () => {
  await srv.stop()
  await new Promise<void>((r) => dbxServer.close(() => r()))
  await rm(dir, { recursive: true, force: true })
})

describe('auth & blobs', () => {
  it('health is public, studio API needs the team token', async () => {
    expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(true)
    expect((await fetch(`${base}/api/projects/proj-1/publications`)).status).toBe(401)
    expect((await fetch(`${base}/api/projects/proj-1/publications`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
  })
  it('resumable upload: HEAD reports received, wrong offset → 409 with current, hash checked on completion', async () => {
    const buf = Buffer.alloc(3000, 9)
    const h = sha(buf)
    expect((await fetch(`${base}/api/blobs/${h}`, { method: 'HEAD', headers: auth })).status).toBe(404)
    expect((await fetch(`${base}/api/blobs/${h}?offset=0&size=3000`, { method: 'PUT', headers: auth, body: new Uint8Array(buf.subarray(0, 1000)) })).status).toBe(200)
    const head = await fetch(`${base}/api/blobs/${h}`, { method: 'HEAD', headers: auth })
    expect(head.status).toBe(206)
    expect(head.headers.get('x-received')).toBe('1000')
    const bad = await fetch(`${base}/api/blobs/${h}?offset=0&size=3000`, { method: 'PUT', headers: auth, body: new Uint8Array(buf.subarray(0, 10)) })
    expect(bad.status).toBe(409)
    expect((await bad.json()).received).toBe(1000)
    const done = await fetch(`${base}/api/blobs/${h}?offset=1000&size=3000`, { method: 'PUT', headers: auth, body: new Uint8Array(buf.subarray(1000)) })
    expect(await done.json()).toEqual({ received: 3000, complete: true })
    expect((await fetch(`${base}/api/blobs/${h}`, { method: 'HEAD', headers: auth })).status).toBe(200)
    // 해시가 안 맞으면 버린다
    const fake = 'a'.repeat(64)
    const r = await fetch(`${base}/api/blobs/${fake}?offset=0&size=4`, { method: 'PUT', headers: auth, body: 'abcd' })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/해시 불일치/)
    expect((await fetch(`${base}/api/blobs/${fake}`, { method: 'HEAD', headers: auth })).status).toBe(404)
  })
})

describe('publish → review → feedback loop', () => {
  let pub: PublicationInfo
  let files: Manifest['files']

  it('refuses a manifest with missing blobs, then publishes and archives to Dropbox', async () => {
    const png = PNG
    const mp4 = MP4
    files = [
      { path: 'pages/p01.png', sha256: sha(png), size: png.length, type: 'image/png' },
      { path: 'video/proxy.mp4', sha256: sha(mp4), size: mp4.length, type: 'video/mp4' },
    ]
    const missing = await fetch(`${base}/api/projects/proj-1/publications`, { method: 'POST', headers: auth, body: JSON.stringify({ manifest: manifest(files) }) })
    expect(missing.status).toBe(409)
    expect((await missing.json()).missing).toEqual(['pages/p01.png', 'video/proxy.mp4'])
    await putBlob(png)
    await putBlob(mp4, 2048)
    const evil = await fetch(`${base}/api/projects/proj-1/publications`, { method: 'POST', headers: auth, body: JSON.stringify({ manifest: manifest([{ ...files[0], path: '../../etc/passwd' }]) }) })
    expect(evil.status).toBe(400)
    const r = await fetch(`${base}/api/projects/proj-1/publications`, { method: 'POST', headers: auth, body: JSON.stringify({ manifest: manifest(files) }) })
    expect(r.status).toBe(201)
    pub = await r.json()
    expect(pub).toMatchObject({ version: 1, label: 'v1', seq: 'S41', archive: { status: 'pending' } })
    expect(pub.url).toMatch(/\/r\/[\w-]{24}$/)
    await srv.idle()
    const list: PublicationInfo[] = await (await fetch(`${base}/api/projects/proj-1/publications?seq=S41`, { headers: auth })).json()
    expect(list[0].archive).toMatchObject({ status: 'done', path: '/NYX/PRISM/S41/v1' })
    // 작은 파일은 upload, 큰 파일(5000 > chunk 2000)은 세션 start → append → finish
    expect(dbxCalls.find((c) => c.path === '/2/files/upload')?.arg).toMatchObject({ path: '/NYX/PRISM/S41/v1/pages/p01.png' })
    expect(dbxCalls.filter((c) => c.path.startsWith('/2/files/upload_session')).map((c) => c.path)).toEqual(['/2/files/upload_session/start', '/2/files/upload_session/append_v2', '/2/files/upload_session/finish'])
    expect(dbxCalls.find((c) => c.path === '/2/files/upload_session/finish')?.arg).toMatchObject({ cursor: { offset: 4000 }, commit: { path: '/NYX/PRISM/S41/v1/video/proxy.mp4' } })
  })

  it('reviewer link: payload without file hashes, files with Range, comments mapped to shots, verdict', async () => {
    const token = pub.token
    const p: ReviewPayload = await (await fetch(`${base}/api/r/${token}`)).json()
    expect(p.publication.label).toBe('v1')
    expect((p.manifest as unknown as { files?: unknown }).files).toBeUndefined()
    expect(p.versions).toHaveLength(1)
    const part = await fetch(`${base}/api/r/${token}/file/video/proxy.mp4`, { headers: { range: 'bytes=100-199' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/5000')
    expect((await part.arrayBuffer()).byteLength).toBe(100)
    expect((await fetch(`${base}/api/r/${token}/file/../../nyx.db`)).status).toBe(404)
    const post = (b: Record<string, unknown>) => fetch(`${base}/api/r/${token}/comments`, { method: 'POST', body: JSON.stringify({ author: '감독', ...b }) })
    const c1: Comment = await (await post({ kind: 'panel', shotNo: '0030', body: '너무 멀어요, 얼굴이 안 보임' })).json()
    expect(c1).toMatchObject({ kind: 'panel', shotNo: '0030', status: 'open', label: 'v1' })
    const c2: Comment = await (await post({ kind: 'region', page: 1, x: 0.4, y: 0.2, w: 0.1, h: 0.1, body: '여기 간판 지워주세요' })).json()
    expect(c2.shotNo).toBe('0020') // 영역 중심이 0020 칸 안
    const c3: Comment = await (await post({ kind: 'time', tMs: 7250, body: '여기서 컷 하나 더' })).json()
    expect(c3).toMatchObject({ shotNo: '0030', frame: 174 })
    expect((await post({ kind: 'panel', shotNo: '9999', body: 'x' }).then((r) => r.json())).shotNo).toBeUndefined()
    expect((await post({ kind: 'nope', body: 'x' })).status).toBe(400)
    expect((await post({ kind: 'general', body: '' })).status).toBe(400)
    const v = await fetch(`${base}/api/r/${token}/verdict`, { method: 'POST', body: JSON.stringify({ verdict: 'changes', author: '감독' }) })
    expect((await v.json()).body).toBe('수정 요청')
  })

  it('studio pulls changes by cursor, resolves "in v2", reviewer sees it; revoke closes the link', async () => {
    const ch1 = await (await fetch(`${base}/api/projects/proj-1/changes?cursor=0`, { headers: auth })).json()
    expect(ch1.comments.length).toBe(5)
    const target = ch1.comments.find((c: Comment) => c.shotNo === '0030' && c.kind === 'panel')
    const empty = await (await fetch(`${base}/api/projects/proj-1/changes?cursor=${ch1.cursor}`, { headers: auth })).json()
    expect(empty.comments).toEqual([])
    const upd = await fetch(`${base}/api/comments/${target.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'resolved', resolvedIn: 'v2', note: '0030 MS→MCU' }) })
    expect(await upd.json()).toMatchObject({ status: 'resolved', resolvedIn: 'v2', resolvedNote: '0030 MS→MCU' })
    const ch2 = await (await fetch(`${base}/api/projects/proj-1/changes?cursor=${ch1.cursor}`, { headers: auth })).json()
    expect(ch2.comments.map((c: Comment) => c.id)).toEqual([target.id])
    // v2 게시 → 뷰어(v2 링크)에서 v1 코멘트가 "v2에서 반영됨"
    const r2 = await fetch(`${base}/api/projects/proj-1/publications`, { method: 'POST', headers: auth, body: JSON.stringify({ manifest: manifest(files, { label: 'v2' }) }) })
    const pub2: PublicationInfo = await r2.json()
    expect(pub2.version).toBe(2)
    const view2: ReviewPayload = await (await fetch(`${base}/api/r/${pub2.token}`)).json()
    expect(view2.versions.map((v) => [v.label, v.current])).toEqual([['v2', true], ['v1', false]])
    expect(view2.comments.find((c) => c.id === target.id)).toMatchObject({ resolvedIn: 'v2', label: 'v1' })
    // 닫기
    await fetch(`${base}/api/publications/${pub.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ revoked: true }) })
    expect((await fetch(`${base}/api/r/${pub.token}`)).status).toBe(410)
    expect((await fetch(`${base}/api/r/${pub2.token}`)).status).toBe(200)
  })

  it('overview (server status page) needs the team token and lists publications with comment counts and closed links', async () => {
    expect((await fetch(`${base}/api/admin/overview`)).status).toBe(401)
    const o = await (await fetch(`${base}/api/admin/overview`, { headers: auth })).json()
    expect(o.server).toMatchObject({ name: 'nyx-viewer', dropbox: true })
    expect(o.server.blobCount).toBeGreaterThan(0)
    const proj = o.projects.find((p: { id: string }) => p.id === 'proj-1')
    const v1 = proj.publications.find((x: { version: number }) => x.version === 1)
    const v2 = proj.publications.find((x: { version: number }) => x.version === 2)
    expect(v1).toMatchObject({ closed: true, verdict: 'changes' })
    expect(v1.total).toBeGreaterThanOrEqual(5)
    expect(v2).toMatchObject({ closed: false, link: expect.stringMatching(/^\/r\//) })
    // 루트 주소는 현황 화면(웹) — 토큰 없이도 페이지 자체는 열린다
    expect((await fetch(`${base}/`)).status).toBe(200)
  })
})

describe('releases & backups', () => {
  it('hosts a release for the update notice and snapshots the DB (kept to 14, copied to Dropbox)', async () => {
    expect((await fetch(`${base}/api/app/latest?platform=darwin-arm64`)).status).toBe(404)
    const dmg = Buffer.alloc(3000, 1)
    expect((await fetch(`${base}/api/admin/releases/NYX-0.2.0-arm64.dmg`, { method: 'PUT', body: new Uint8Array(dmg) })).status).toBe(401)
    const up = await fetch(`${base}/api/admin/releases/NYX-0.2.0-arm64.dmg`, { method: 'PUT', headers: auth, body: new Uint8Array(dmg) })
    expect(await up.json()).toEqual({ file: 'NYX-0.2.0-arm64.dmg', size: 3000 })
    expect((await fetch(`${base}/api/admin/releases/latest`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'darwin-arm64', version: '0.2.0', file: 'nope.dmg' }) })).status).toBe(409)
    await fetch(`${base}/api/admin/releases/latest`, { method: 'POST', headers: auth, body: JSON.stringify({ platform: 'darwin-arm64', version: '0.2.0', file: 'NYX-0.2.0-arm64.dmg', notes: '영상 가져오기 개선' }) })
    expect(await (await fetch(`${base}/api/app/latest?platform=darwin-arm64`)).json()).toEqual({ version: '0.2.0', file: 'NYX-0.2.0-arm64.dmg', notes: '영상 가져오기 개선', size: 3000 })
    const dl = await fetch(`${base}/releases/NYX-0.2.0-arm64.dmg`)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toBe('application/x-apple-diskimage')
    expect((await dl.arrayBuffer()).byteLength).toBe(3000)
    expect((await fetch(`${base}/releases/latest.json`)).status).toBe(404)
    const b = await (await fetch(`${base}/api/admin/backup`, { method: 'POST', headers: auth })).json()
    expect(b.file).toMatch(/^nyx-\d{8}-\d{6}\.db$/)
    expect(b.size).toBeGreaterThan(1000)
    expect(await (await fetch(`${base}/api/admin/backups`, { headers: auth })).json()).toContain(b.file)
    await srv.idle()
    // 테스트 청크(2KB)보다 크면 세션 업로드 — 어느 쪽이든 _backups 경로로
    const dest = (c: (typeof dbxCalls)[number]) => String((c.arg as { path?: string; commit?: { path?: string } })?.path ?? (c.arg as { commit?: { path?: string } })?.commit?.path)
    expect(dbxCalls.some((c) => (c.path === '/2/files/upload' || c.path === '/2/files/upload_session/finish') && dest(c).startsWith('/NYX/_backups/nyx-'))).toBe(true)
    // 백업 파일은 열리는 SQLite 이고 게시 기록이 들어 있다
    const { DatabaseSync } = await import('node:sqlite')
    const snap = new DatabaseSync(join(dir, 'backups', b.file))
    expect((snap.prepare('SELECT COUNT(*) AS n FROM publications').get() as { n: number }).n).toBeGreaterThanOrEqual(2)
    snap.close()
  })
})

describe('mapping & dropbox helpers', () => {
  it('maps regions and times; escapes non-ASCII in Dropbox-API-Arg', () => {
    const m = manifest([])
    expect(mapToShot(m, { kind: 'region', page: 1, x: 0.1, y: 0.2, w: 0.05, h: 0.05 })).toEqual({ shotNo: '0010', panelIndex: 0 })
    expect(mapToShot(m, { kind: 'region', page: 1, x: 0.9, y: 0.9 })).toEqual({})
    expect(mapToShot(m, { kind: 'time', tMs: 10_000 })).toEqual({ shotNo: '0030' })
    expect(Dropbox.apiArg({ path: '/NYX/프리즘' })).toBe('{"path":"/NYX/\\ud504\\ub9ac\\uc998"}')
  })
})
