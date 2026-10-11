// NYX 뷰어 서버 — node:http 만으로 (의존성 없음). 스튜디오 API(팀 게시 토큰) + 리뷰어 링크(/r/{token}) + 정적 웹.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, sep } from 'node:path'
import { BlobStore, SHA_RE } from './blobs'
import { Db, type PubRow } from './db'
import { Dropbox } from './dropbox'
import type { ChangesResponse, Comment, CommentKind, Manifest, PublicationInfo, ReviewPayload } from '../shared/types'

export interface ViewerConfig {
  dataDir: string
  /** 스튜디오가 게시·피드백 API 를 부를 때 쓰는 팀 토큰 */
  publishToken: string
  /** 링크에 쓸 바깥 주소 (예: http://nyx.intra:8787). 없으면 요청 Host 로 */
  publicUrl?: string
  host?: string
  port?: number
  webDir?: string // 빌드된 뷰어 웹 (dist/web)
  dropbox?: Dropbox | null
  maxChunk?: number
  version?: string
  /** 현황 화면(/api/admin/overview)을 토큰 없이 연다 — 사내망 전용 서버일 때. 게시·피드백 API 는 여전히 토큰 필요 */
  overviewPublic?: boolean
}

export interface ViewerServer {
  start(): Promise<{ url: string; port: number }>
  stop(): Promise<void>
  db: Db
  /** SQLite 스냅샷 (VACUUM INTO) — 14개 보관, Dropbox 가 있으면 _backups 에도 */
  backupNow(): Promise<string>
  /** 테스트: 보관 작업이 끝날 때까지 */
  idle(): Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(data)
}

async function readJson<T>(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) {
    n += (c as Buffer).length
    if (n > limit) throw new HttpError(413, '본문이 너무 큽니다')
    chunks.push(c as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
  } catch {
    throw new HttpError(400, 'JSON 형식 오류')
  }
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined)

/** 영역 코멘트 → 그 중심이 들어간 패널, 시각 코멘트 → EDL 의 샷 */
export function mapToShot(m: Manifest, c: { kind: CommentKind; page?: number; x?: number; y?: number; w?: number; h?: number; tMs?: number }): { shotNo?: string; panelIndex?: number } {
  if (c.kind === 'region' && c.page != null && c.x != null && c.y != null) {
    const pg = m.pages.find((p) => p.n === c.page)
    const cx = c.x + (c.w ?? 0) / 2
    const cy = c.y + (c.h ?? 0) / 2
    const hit = pg?.panels.find((p) => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h)
    if (hit) return { shotNo: hit.shotNo, panelIndex: hit.panelIndex }
  }
  if (c.kind === 'time' && c.tMs != null && m.edl?.length) {
    const hit = m.edl.find((e) => c.tMs! >= e.inMs && c.tMs! < e.outMs) ?? (c.tMs! >= m.edl[m.edl.length - 1].outMs ? m.edl[m.edl.length - 1] : undefined)
    if (hit) return { shotNo: hit.shotNo }
  }
  return {}
}

export function createViewerServer(cfg: ViewerConfig): ViewerServer {
  const db = new Db(join(cfg.dataDir, 'nyx.db'))
  const startedAt = Date.now()
  const blobs = new BlobStore(join(cfg.dataDir, 'blobs'))
  const maxChunk = cfg.maxChunk ?? 16 * 1024 * 1024
  let http: Server | null = null
  let archiving = Promise.resolve()
  let backupTimer: NodeJS.Timeout | null = null
  const releasesDir = join(cfg.dataDir, 'releases')
  const backupsDir = join(cfg.dataDir, 'backups')

  async function backupNow(): Promise<string> {
    await mkdir(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
    const file = join(backupsDir, `nyx-${stamp}.db`)
    db.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    const all = (await readdir(backupsDir)).filter((f) => /^nyx-\d{8}-\d{6}\.db$/.test(f)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 14))) await rm(join(backupsDir, old), { force: true })
    if (cfg.dropbox) {
      const size = (await stat(file)).size
      await cfg.dropbox.upload(file, `${cfg.dropbox.root}/_backups/${file.split(sep).pop()}`, size).catch((e) => console.error('Dropbox 백업 실패', e))
    }
    return file
  }

  const baseUrl = (req: IncomingMessage) => cfg.publicUrl?.replace(/\/+$/, '') ?? `http://${req.headers.host ?? 'localhost'}`

  function requireStudio(req: IncomingMessage) {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ') || !safeEq(auth.slice(7), cfg.publishToken)) throw new HttpError(401, '게시 토큰이 맞지 않습니다')
  }

  function livePub(token: string): PubRow {
    const p = db.pubByToken(token)
    if (!p) throw new HttpError(404, '링크를 찾을 수 없습니다')
    if (p.revoked) throw new HttpError(410, '게시자가 이 링크를 닫았습니다')
    if (p.expires_at && p.expires_at < Date.now()) throw new HttpError(410, '링크 기간이 끝났습니다')
    return p
  }

  function pubInfo(req: IncomingMessage, p: PubRow): PublicationInfo {
    return {
      id: p.id,
      projectId: p.project_id,
      seq: p.seq,
      version: p.version,
      label: p.label,
      status: p.status,
      token: p.token,
      url: `${baseUrl(req)}/r/${p.token}`,
      createdAt: p.created_at,
      revoked: !!p.revoked,
      expiresAt: p.expires_at ?? undefined,
      archive: { status: p.archive_status as PublicationInfo['archive']['status'], error: p.archive_error ?? undefined, path: p.archive_path ?? undefined },
      comments: db.commentCounts(p.id),
    }
  }

  /** 게시본을 Dropbox 팀 폴더로 (백그라운드, 순서대로). 실패해도 뷰어는 서버 사본으로 계속 동작한다. */
  function archive(pubId: string) {
    const dbx = cfg.dropbox
    if (!dbx) return
    archiving = archiving.then(async () => {
      const p = db.pubById(pubId)
      if (!p) return
      const m = JSON.parse(p.manifest) as Manifest
      const folder = `${dbx.root}/${m.project.code}/${m.seq}/${p.label}`
      db.updatePub(pubId, { archiveStatus: 'running' })
      try {
        for (const f of m.files) await dbx.upload(blobs.path(f.sha256), `${folder}/${f.path}`, f.size)
        db.updatePub(pubId, { archiveStatus: 'done', archiveError: null, archivePath: folder })
      } catch (e) {
        db.updatePub(pubId, { archiveStatus: 'error', archiveError: (e as Error).message.slice(0, 500) })
      }
    })
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, abs: string, type: string, cache = 'public, max-age=31536000, immutable') {
    let size: number
    try {
      size = (await stat(abs)).size
    } catch {
      throw new HttpError(404, '파일 없음')
    }
    const range = req.headers.range
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2] || 0)
      let end = m[1] && m[2] ? Number(m[2]) : size - 1
      start = Math.max(0, start)
      end = Math.min(end, size - 1)
      if (start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        return res.end()
      }
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': cache })
      if (req.method === 'HEAD') return res.end()
      createReadStream(abs, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': cache })
    if (req.method === 'HEAD') return res.end()
    createReadStream(abs).pipe(res)
  }

  async function serveWeb(res: ServerResponse, rel: string) {
    if (!cfg.webDir) return send(res, 200, 'NYX viewer — 웹 빌드가 없습니다 (apps/viewer: pnpm build)')
    const clean = normalize(rel).replace(/^([/\\])+/, '')
    const abs = join(cfg.webDir, clean)
    if (!abs.startsWith(cfg.webDir + sep) && abs !== cfg.webDir) throw new HttpError(403, 'forbidden')
    try {
      const st = await stat(abs)
      if (st.isFile()) {
        res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream', 'cache-control': clean.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
        return createReadStream(abs).pipe(res)
      }
    } catch {
      /* SPA 폴백 */
    }
    const html = await readFile(join(cfg.webDir, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(html)
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? 'GET'
    let m: RegExpExecArray | null

    // ── 공통 ──
    if (path === '/api/health') {
      return send(res, 200, { ok: true, name: 'nyx-viewer', version: cfg.version ?? '0.0.1', dropbox: !!cfg.dropbox })
    }

    // ── 스튜디오 API ──
    if ((m = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(path))) {
      requireStudio(req)
      const sha = m[1]
      if (method === 'HEAD' || method === 'GET') {
        const done = db.blobComplete(sha) && (await blobs.has(sha))
        const received = done ? (db.blobComplete(sha)?.size ?? 0) : await blobs.received(sha)
        res.writeHead(done ? 200 : received ? 206 : 404, { 'x-received': String(received), 'x-complete': done ? '1' : '0' })
        return res.end()
      }
      if (method === 'PUT') {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const size = Number(url.searchParams.get('size') ?? -1)
        if (!(size >= 0) || !(offset >= 0)) throw new HttpError(400, 'offset·size 가 필요합니다')
        const type = str(url.searchParams.get('type'), 80) || null
        try {
          const r = await blobs.append(sha, offset, size, req, maxChunk)
          if (r.mismatch !== undefined) return send(res, 409, { error: '오프셋 불일치', received: r.mismatch })
          if (r.complete) db.addBlob(sha, size, type)
          return send(res, 200, { received: r.received, complete: r.complete })
        } catch (e) {
          throw new HttpError(400, (e as Error).message)
        }
      }
    }
    if ((m = /^\/api\/projects\/([\w-]{1,64})\/publications$/.exec(path))) {
      requireStudio(req)
      const projectId = m[1]
      if (method === 'GET') return send(res, 200, db.pubsOf(projectId, url.searchParams.get('seq') ?? undefined).map((p) => pubInfo(req, p)))
      if (method === 'POST') {
        const b = await readJson<{ manifest: Manifest; expiresAt?: number }>(req, 8 * 1024 * 1024)
        const mf = b.manifest
        if (!mf || mf.schema !== 1 || !Array.isArray(mf.files) || !/^S\d{2,}$/.test(mf.seq)) throw new HttpError(400, 'manifest 형식 오류')
        if (mf.project?.id !== projectId) throw new HttpError(400, 'manifest 의 프로젝트가 경로와 다릅니다')
        const missing: string[] = []
        for (const f of mf.files) {
          if (!SHA_RE.test(f.sha256) || /(^|\/)\.\.(\/|$)/.test(f.path) || f.path.startsWith('/')) throw new HttpError(400, `잘못된 파일 항목: ${f.path}`)
          if (!db.blobComplete(f.sha256) || !(await blobs.has(f.sha256))) missing.push(f.path)
        }
        if (missing.length) return send(res, 409, { error: '아직 올라오지 않은 파일이 있습니다', missing })
        db.upsertProject(mf.project)
        const id = randomUUID()
        const version = db.nextVersion(projectId, mf.seq)
        const token = randomBytes(18).toString('base64url')
        db.insertPublication({ id, projectId, seq: mf.seq, version, label: str(mf.label, 20) || `v${version}`, status: str(mf.status, 20) || '컨펌용', token, manifest: mf, expiresAt: b.expiresAt, archive: cfg.dropbox ? 'pending' : 'skipped' })
        archive(id)
        return send(res, 201, pubInfo(req, db.pubById(id)!))
      }
    }
    if ((m = /^\/api\/publications\/([\w-]{36})$/.exec(path)) && method === 'PATCH') {
      requireStudio(req)
      const b = await readJson<{ revoked?: boolean; expiresAt?: number | null }>(req)
      if (!db.pubById(m[1])) throw new HttpError(404, '게시본 없음')
      db.updatePub(m[1], { revoked: b.revoked, expiresAt: b.expiresAt })
      return send(res, 200, pubInfo(req, db.pubById(m[1])!))
    }
    if ((m = /^\/api\/projects\/([\w-]{1,64})\/changes$/.exec(path)) && method === 'GET') {
      requireStudio(req)
      const r: ChangesResponse = db.changes(m[1], Number(url.searchParams.get('cursor') ?? 0))
      return send(res, 200, r)
    }
    if ((m = /^\/api\/comments\/([\w-]{36})$/.exec(path)) && method === 'PATCH') {
      requireStudio(req)
      const b = await readJson<{ status?: Comment['status']; resolvedIn?: string | null; note?: string | null }>(req)
      if (b.status && !['open', 'resolved', 'declined'].includes(b.status)) throw new HttpError(400, 'status 는 open|resolved|declined')
      const c = db.updateComment(m[1], { status: b.status, resolvedIn: b.resolvedIn === undefined ? undefined : b.resolvedIn ? str(b.resolvedIn, 20) : null, resolvedNote: b.note === undefined ? undefined : b.note ? str(b.note, 500) : null })
      if (!c) throw new HttpError(404, '코멘트 없음')
      return send(res, 200, c)
    }

    // ── 앱 배포 (서명 없는 사내 배포 — 새 버전 알림 + 내려받기) ──
    // 현황 (서버 PC 주소로 열어 보는 관리 화면) — 리뷰 링크가 보이므로 게시 토큰 필요
    if (path === '/api/admin/overview' && method === 'GET') {
      if (!cfg.overviewPublic) requireStudio(req)
      const o = db.overview()
      const now = Date.now()
      return send(res, 200, {
        server: { name: 'nyx-viewer', version: cfg.version ?? '0.0.1', dropbox: !!cfg.dropbox, startedAt, publicUrl: cfg.publicUrl ?? null, blobBytes: o.blobBytes, blobCount: o.blobCount },
        projects: o.projects.map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          publications: p.pubs.map((x) => ({
            id: x.id,
            seq: x.seq,
            version: x.version,
            label: x.label,
            status: x.status,
            createdAt: x.created_at,
            link: `/r/${x.token}`,
            closed: !!x.revoked || (x.expires_at != null && x.expires_at < now),
            open: x.open,
            total: x.total,
            verdict: x.verdict,
            archive: x.archive_status,
          })),
        })),
      })
    }

    if (path === '/api/app/latest' && method === 'GET') {
      let latest: Record<string, { version: string; file: string; notes?: string; size?: number }> = {}
      try {
        latest = JSON.parse(await readFile(join(releasesDir, 'latest.json'), 'utf8'))
      } catch {
        /* 없음 */
      }
      const r = latest[url.searchParams.get('platform') ?? ''] ?? null
      return r ? send(res, 200, r) : send(res, 404, { error: '배포된 버전 없음' })
    }
    if ((m = /^\/releases\/([\w.\-%]+)$/.exec(path)) && (method === 'GET' || method === 'HEAD')) {
      const name = decodeURIComponent(m[1])
      if (!/^[\w.\-]+$/.test(name) || name === 'latest.json') throw new HttpError(404, '없음')
      return serveFile(req, res, join(releasesDir, name), name.endsWith('.dmg') ? 'application/x-apple-diskimage' : name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', 'public, max-age=3600')
    }
    if ((m = /^\/api\/admin\/releases\/([\w.\-]+)$/.exec(path)) && method === 'PUT') {
      requireStudio(req)
      const name = m[1]
      if (name === 'latest.json') throw new HttpError(400, '예약된 이름')
      await mkdir(releasesDir, { recursive: true })
      const tmp = join(releasesDir, `.${name}.part`)
      let n = 0
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(tmp)
        req.on('data', (c: Buffer) => {
          n += c.length
          if (n > 2 * 1024 ** 3) {
            req.destroy()
            ws.destroy()
            reject(new HttpError(413, '2GB 초과'))
          }
        })
        req.pipe(ws)
        ws.on('finish', () => resolve())
        ws.on('error', reject)
        req.on('error', reject)
      })
      await rename(tmp, join(releasesDir, name))
      return send(res, 200, { file: name, size: n })
    }
    if (path === '/api/admin/releases/latest' && method === 'POST') {
      requireStudio(req)
      const b = await readJson<{ platform: string; version: string; file: string; notes?: string }>(req)
      if (!/^[\w-]+$/.test(b.platform ?? '') || !/^\d+\.\d+\.\d+/.test(b.version ?? '') || !/^[\w.\-]+$/.test(b.file ?? '')) throw new HttpError(400, 'platform·version·file 형식 오류')
      const size = (await stat(join(releasesDir, b.file)).catch(() => null))?.size
      if (size == null) throw new HttpError(409, '먼저 파일을 올리세요')
      let latest: Record<string, unknown> = {}
      try {
        latest = JSON.parse(await readFile(join(releasesDir, 'latest.json'), 'utf8'))
      } catch {
        /* 처음 */
      }
      latest[b.platform] = { version: b.version, file: b.file, notes: str(b.notes, 300) || undefined, size }
      await writeFile(join(releasesDir, 'latest.json'), JSON.stringify(latest, null, 2))
      return send(res, 200, latest[b.platform])
    }
    if (path === '/api/admin/backup' && method === 'POST') {
      requireStudio(req)
      const file = await backupNow()
      return send(res, 200, { file: file.split(sep).pop(), size: (await stat(file)).size })
    }
    if (path === '/api/admin/backups' && method === 'GET') {
      requireStudio(req)
      const files = (await readdir(backupsDir).catch(() => [] as string[])).filter((f) => f.endsWith('.db')).sort().reverse()
      return send(res, 200, files)
    }

    // ── 리뷰어 API (/api/r/{token}…) ──
    if ((m = /^\/api\/r\/([\w-]{16,64})(\/.*)?$/.exec(path))) {
      const pub = livePub(m[1])
      const rest = m[2] ?? ''
      const mf = JSON.parse(pub.manifest) as Manifest
      if (rest === '' && method === 'GET') {
        const { files: _f, ...manifest } = mf
        const versions = db.pubsOf(pub.project_id, pub.seq).filter((p) => !p.revoked).map((p) => ({ label: p.label, token: p.token, createdAt: p.created_at, current: p.id === pub.id }))
        const payload: ReviewPayload = { manifest, publication: { id: pub.id, label: pub.label, status: pub.status, createdAt: pub.created_at, version: pub.version }, versions, comments: db.commentsOfSeq(pub.project_id, pub.seq) }
        return send(res, 200, payload)
      }
      if (rest.startsWith('/file/') && (method === 'GET' || method === 'HEAD')) {
        const rel = decodeURIComponent(rest.slice(6))
        const f = mf.files.find((x) => x.path === rel)
        if (!f) throw new HttpError(404, '번들에 없는 파일')
        if (!(await blobs.has(f.sha256)) && cfg.dropbox && pub.archive_path) {
          // 서버 사본이 정리됐으면 Dropbox 임시 링크로
          res.writeHead(302, { location: await cfg.dropbox.temporaryLink(`${pub.archive_path}/${f.path}`) })
          return res.end()
        }
        return serveFile(req, res, blobs.path(f.sha256), f.type || MIME[extname(rel)] || 'application/octet-stream')
      }
      if (rest === '/comments' && method === 'POST') {
        const b = await readJson<Record<string, unknown>>(req, 64 * 1024)
        const kind = (['panel', 'region', 'time', 'general'] as const).find((k) => k === b.kind)
        const body = str(b.body, 4000)
        const author = str(b.author, 40)
        if (!kind || !body || !author) throw new HttpError(400, 'kind·body·author 가 필요합니다')
        const c: Omit<Comment, 'updatedAt'> = {
          id: randomUUID(),
          publicationId: pub.id,
          projectId: pub.project_id,
          seq: pub.seq,
          label: pub.label,
          kind,
          shotNo: /^\d{4}$/.test(String(b.shotNo ?? '')) ? String(b.shotNo) : undefined,
          panelIndex: Number.isInteger(b.panelIndex) ? (b.panelIndex as number) : undefined,
          page: Number.isInteger(b.page) ? (b.page as number) : undefined,
          x: num01(b.x),
          y: num01(b.y),
          w: num01(b.w),
          h: num01(b.h),
          tMs: typeof b.tMs === 'number' && b.tMs >= 0 ? Math.round(b.tMs) : undefined,
          body,
          author,
          status: 'open',
          createdAt: Date.now(),
        }
        if (c.tMs != null && mf.video?.fps) c.frame = Math.round((c.tMs / 1000) * mf.video.fps)
        if (!c.shotNo) Object.assign(c, mapToShot(mf, c))
        if (c.shotNo && !mf.panels.some((p) => p.shotNo === c.shotNo)) c.shotNo = undefined
        db.insertComment(c)
        return send(res, 201, db.comment(c.id))
      }
      if (rest === '/verdict' && method === 'POST') {
        const b = await readJson<Record<string, unknown>>(req, 16 * 1024)
        const verdict = b.verdict === 'approve' || b.verdict === 'changes' ? b.verdict : null
        const author = str(b.author, 40)
        if (!verdict || !author) throw new HttpError(400, 'verdict(approve|changes)·author 가 필요합니다')
        const c: Omit<Comment, 'updatedAt'> = { id: randomUUID(), publicationId: pub.id, projectId: pub.project_id, seq: pub.seq, label: pub.label, kind: 'verdict', verdict, body: str(b.body, 2000) || (verdict === 'approve' ? '승인' : '수정 요청'), author, status: verdict === 'approve' ? 'resolved' : 'open', createdAt: Date.now() }
        db.insertComment(c)
        return send(res, 201, db.comment(c.id))
      }
      if ((m = /^\/comments\/([\w-]{36})$/.exec(rest)) && method === 'PATCH') {
        const b = await readJson<{ status?: string }>(req)
        const cur = db.comment(m[1])
        if (!cur || cur.projectId !== pub.project_id || cur.seq !== pub.seq) throw new HttpError(404, '코멘트 없음')
        if (b.status !== 'open' && b.status !== 'resolved') throw new HttpError(400, 'status 는 open|resolved')
        return send(res, 200, db.updateComment(m[1], { status: b.status }))
      }
      throw new HttpError(404, 'not found')
    }

    // ── 웹 ──
    if (method === 'GET' && (path === '/' || path.startsWith('/r/') || path.startsWith('/assets/') || path === '/favicon.svg')) {
      return serveWeb(res, path.startsWith('/r/') || path === '/' ? 'index.html' : path)
    }
    throw new HttpError(404, 'not found')
  }

  return {
    db,
    backupNow,
    idle: () => archiving,
    async start() {
      http = createServer((req, res) => {
        handle(req, res).catch((e) => {
          const status = e instanceof HttpError ? e.status : 500
          if (status === 500) console.error(e)
          if (!res.headersSent) send(res, status, { error: (e as Error).message }, status >= 400 ? { connection: 'close' } : {})
          else res.end()
        })
      })
      const srv = http
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject)
        srv.listen(cfg.port ?? 0, cfg.host ?? '127.0.0.1', () => resolve())
      })
      const port = (srv.address() as AddressInfo).port
      // 하루 한 번 백업 (첫 백업은 1분 뒤)
      setTimeout(() => void backupNow().catch((e) => console.error('백업 실패', e)), 60_000).unref()
      backupTimer = setInterval(() => void backupNow().catch((e) => console.error('백업 실패', e)), 24 * 3600_000)
      backupTimer.unref()
      return { url: `http://${cfg.host && cfg.host !== '0.0.0.0' ? cfg.host : '127.0.0.1'}:${port}`, port }
    },
    async stop() {
      if (backupTimer) clearInterval(backupTimer)
      await archiving.catch(() => {})
      await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
      http = null
      db.close()
    },
  }
}
