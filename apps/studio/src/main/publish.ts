// PublishService — 사내 뷰어 서버로 게시(이어올리기) + 피드백 가져오기(60초 폴링) + 반영 상태 회신.
// 서버 토큰은 safeStorage(맥 키체인 / 윈도우 DPAPI)로 암호화해 앱 데이터 폴더에만 둔다.
import { app, safeStorage, type BrowserWindow } from 'electron'
import { open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { absPath, writeAtomic, type ProjectStore } from '@conti/core'
import { PROJECT_DIRS } from '@conti/domain'
import type { LayoutService } from './layout'
import type { FeedbackItem, FeedbackState, PublishProgress, PublishRecord, PublishSettingsView } from '../shared/publish-ipc'

interface Comment {
  id: string
  publicationId: string
  seq: string
  label: string
  kind: string
  shotNo?: string
  panelIndex?: number
  page?: number
  x?: number
  y?: number
  w?: number
  h?: number
  tMs?: number
  frame?: number
  body: string
  author: string
  verdict?: 'approve' | 'changes'
  status: 'open' | 'resolved' | 'declined'
  resolvedIn?: string
  resolvedNote?: string
  createdAt: number
  updatedAt: number
}

interface Inbox {
  cursor: number
  comments: Record<string, Comment & { local?: { state: FeedbackState; note?: string; versionId?: string; synced: boolean; at: number } }>
}

const CHUNK = 4 * 1024 * 1024

export class PublishService {
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private lastError: string | null = null

  constructor(
    private getStore: () => ProjectStore | null,
    private getWindow: () => BrowserWindow | null,
    private layout: LayoutService,
  ) {}

  // ── 설정 ───────────────────────────────────────────────────────────────
  private settingsPath() {
    return join(app.getPath('userData'), 'publish.json')
  }
  private async readSettings(): Promise<{ url: string; token: string } | null> {
    try {
      const j = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as { url: string; token: string; enc?: boolean }
      const token = j.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(j.token, 'base64')) : j.token
      return { url: j.url.replace(/\/+$/, ''), token }
    } catch {
      return null
    }
  }
  async settings(): Promise<PublishSettingsView> {
    const s = await this.readSettings()
    return { url: s?.url ?? '', hasToken: !!s?.token, encrypted: safeStorage.isEncryptionAvailable() }
  }
  async saveSettings(url: string, token?: string) {
    const cur = await this.readSettings()
    const t = token ?? cur?.token ?? ''
    const enc = safeStorage.isEncryptionAvailable()
    await writeAtomic(this.settingsPath(), JSON.stringify({ url: url.trim().replace(/\/+$/, ''), token: enc ? safeStorage.encryptString(t).toString('base64') : t, enc }))
    this.startPolling()
  }
  /** 다른 서비스(새 버전 확인)용 — 설정이 없으면 null */
  connection(): Promise<{ url: string; token: string } | null> {
    return this.readSettings()
  }

  async test(): Promise<{ ok: boolean; message: string; dropbox?: boolean }> {
    const s = await this.readSettings()
    if (!s?.url) return { ok: false, message: '서버 주소가 없습니다' }
    try {
      const h = (await (await fetch(`${s.url}/api/health`, { signal: AbortSignal.timeout(8000) })).json()) as { ok: boolean; version: string; dropbox: boolean }
      const auth = await fetch(`${s.url}/api/projects/_check/publications`, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(8000) })
      if (auth.status === 401) return { ok: false, message: '서버에는 닿았지만 게시 토큰이 맞지 않습니다' }
      return { ok: !!h.ok, message: `연결됨 · 서버 ${h.version}${h.dropbox ? ' · Dropbox 보관 켜짐' : ' · Dropbox 보관 꺼짐'}`, dropbox: h.dropbox }
    } catch (e) {
      return { ok: false, message: `연결 실패: ${(e as Error).message}` }
    }
  }

  private async conn() {
    const s = await this.readSettings()
    if (!s?.url || !s.token) throw new Error('게시 서버가 설정되지 않았습니다 — 설정 › 게시 서버')
    return s
  }
  private requireStore() {
    const st = this.getStore()
    if (!st) throw new Error('열린 프로젝트가 없습니다')
    return st
  }
  private emit(ch: string, payload: unknown) {
    this.getWindow()?.webContents.send(ch, payload)
  }

  // ── 게시 ───────────────────────────────────────────────────────────────
  private historyPath() {
    return join(this.requireStore().root, PROJECT_DIRS.state, 'publish.json')
  }
  async history(seq?: string): Promise<PublishRecord[]> {
    let list: PublishRecord[] = []
    try {
      list = JSON.parse(await readFile(this.historyPath(), 'utf8'))
    } catch {
      list = []
    }
    return (seq ? list.filter((r) => r.seq === seq) : list).sort((a, b) => b.at - a.at)
  }
  /** 서버 쪽 최신 상태(코멘트 수·보관·닫힘)로 기록을 갱신 */
  async refreshHistory(seq: string): Promise<PublishRecord[]> {
    const s = await this.conn()
    const store = this.requireStore()
    const res = await fetch(`${s.url}/api/projects/${store.getProject().id}/publications?seq=${seq}`, { headers: { authorization: `Bearer ${s.token}` } })
    if (!res.ok) throw new Error(`서버 HTTP ${res.status}`)
    const remote = (await res.json()) as Array<{ id: string; version: number; label: string; status: string; url: string; token: string; createdAt: number; revoked: boolean; archive: PublishRecord['archive']; comments: PublishRecord['comments'] }>
    const local = await this.history()
    const merged = local.filter((r) => r.seq !== seq)
    for (const r of remote) merged.push({ id: r.id, seq, version: r.version, label: r.label, status: r.status, url: r.url, at: r.createdAt, revoked: r.revoked, archive: r.archive, comments: r.comments, files: local.find((x) => x.id === r.id)?.files ?? 0, bytes: local.find((x) => x.id === r.id)?.bytes ?? 0, uploaded: local.find((x) => x.id === r.id)?.uploaded ?? 0 })
    await writeAtomic(this.historyPath(), JSON.stringify(merged, null, 2) + '\n')
    return merged.filter((r) => r.seq === seq).sort((a, b) => b.at - a.at)
  }

  private progress(p: PublishProgress) {
    this.emit('publish:progress', p)
  }

  async publish(seq: string, o: { status: string; templateId?: string }): Promise<PublishRecord> {
    const s = await this.conn()
    const store = this.requireStore()
    const project = store.getProject()
    const auth = { authorization: `Bearer ${s.token}` }
    // 다음 판 번호는 서버 기준 (같은 프로젝트를 여러 사람이 게시해도 겹치지 않게)
    this.progress({ stage: 'prepare' })
    const pre = await fetch(`${s.url}/api/projects/${project.id}/publications?seq=${seq}`, { headers: auth })
    if (pre.status === 401) throw new Error('게시 토큰이 맞지 않습니다 — 설정 › 게시 서버')
    if (!pre.ok) throw new Error(`서버 HTTP ${pre.status}`)
    const prev = (await pre.json()) as Array<{ version: number }>
    const label = `v${Math.max(0, ...prev.map((p) => p.version)) + 1}`
    this.progress({ stage: 'render', message: `${label} 시트·PDF 만드는 중` })
    const b = await this.layout.exportBundle(seq, { label, status: o.status, templateId: o.templateId })
    try {
      const total = b.files.reduce((n, f) => n + f.size, 0)
      let sent = 0
      let skipped = 0
      for (const [i, f] of b.files.entries()) {
        const head = await fetch(`${s.url}/api/blobs/${f.sha256}`, { method: 'HEAD', headers: auth })
        if (head.status === 200) {
          sent += f.size
          skipped += f.size
          this.progress({ stage: 'upload', done: sent, total, file: f.path, index: i + 1, count: b.files.length, skipped })
          continue
        }
        let offset = head.status === 206 ? Number(head.headers.get('x-received') ?? 0) : 0
        sent += offset
        const fh = await open(f.abs, 'r')
        try {
          while (offset < f.size) {
            const len = Math.min(CHUNK, f.size - offset)
            const buf = Buffer.alloc(len)
            await fh.read(buf, 0, len, offset)
            let res: Response | undefined
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                res = await fetch(`${s.url}/api/blobs/${f.sha256}?offset=${offset}&size=${f.size}&type=${encodeURIComponent(f.type)}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: new Blob([new Uint8Array(buf)]) })
                break
              } catch (e) {
                if (attempt === 2) throw e // 네트워크가 끊기면 다음 게시 때 이어서
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
              }
            }
            if (res!.status === 409) {
              const got = ((await res!.json()) as { received: number }).received
              sent += got - offset
              offset = got
              continue
            }
            if (!res!.ok) throw new Error(`업로드 실패 ${f.path}: ${((await res!.json().catch(() => ({}))) as { error?: string }).error ?? res!.status}`)
            offset += len
            sent += len
            this.progress({ stage: 'upload', done: sent, total, file: f.path, index: i + 1, count: b.files.length, skipped })
          }
        } finally {
          await fh.close()
        }
      }
      this.progress({ stage: 'create' })
      const manifest = {
        schema: 1 as const,
        project: { id: project.id, code: project.code, title: project.title },
        seq,
        ep: b.ep,
        heading: b.heading,
        label,
        status: o.status,
        createdAt: Date.now(),
        pages: b.pages,
        panels: b.panels,
        pdf: b.pdf,
        video: b.video,
        edl: b.edl,
        files: b.files.map(({ path, sha256, size, type }) => ({ path, sha256, size, type })),
      }
      const res = await fetch(`${s.url}/api/projects/${project.id}/publications`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) })
      const body = (await res.json()) as { id: string; version: number; label: string; url: string; createdAt: number; archive: PublishRecord['archive']; comments: PublishRecord['comments']; error?: string; missing?: string[] }
      if (!res.ok) throw new Error(body.error ? `${body.error}${body.missing ? `: ${body.missing.join(', ')}` : ''}` : `게시 실패 HTTP ${res.status}`)
      const rec: PublishRecord = { id: body.id, seq, version: body.version, label: body.label, status: o.status, url: body.url, at: body.createdAt, revoked: false, archive: body.archive, comments: body.comments, files: b.files.length, bytes: total, uploaded: total - skipped }
      const list = await this.history()
      await writeAtomic(this.historyPath(), JSON.stringify([...list, rec], null, 2) + '\n')
      // 이번 판에 반영된 코멘트에 "vN에서 반영됨" 회신
      await this.syncApplied(seq, rec.label).catch((e) => (this.lastError = (e as Error).message))
      this.progress({ stage: 'done', url: rec.url })
      return rec
    } finally {
      await rm(b.dir, { recursive: true, force: true })
    }
  }

  async revoke(id: string): Promise<void> {
    const s = await this.conn()
    const res = await fetch(`${s.url}/api/publications/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ revoked: true }) })
    if (!res.ok) throw new Error(`링크 닫기 실패 HTTP ${res.status}`)
  }

  // ── 피드백 ─────────────────────────────────────────────────────────────
  private inboxPath() {
    return absPath(this.requireStore().root, `${PROJECT_DIRS.state}/feedback/inbox.json`)
  }
  private async readInbox(): Promise<Inbox> {
    try {
      return JSON.parse(await readFile(this.inboxPath(), 'utf8')) as Inbox
    } catch {
      return { cursor: 0, comments: {} }
    }
  }
  private async writeInbox(i: Inbox) {
    await writeAtomic(this.inboxPath(), JSON.stringify(i, null, 2) + '\n')
  }

  startPolling() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.pull().catch(() => {}), 60_000)
    void this.pull().catch(() => {})
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 서버에서 바뀐 코멘트를 가져온다 (커서). 로컬 반영 표시는 서버가 resolved 로 바꿀 때까지 유지. */
  async pull(): Promise<{ added: number; total: number; error?: string }> {
    if (this.polling) return { added: 0, total: 0 }
    const store = this.getStore()
    const s = await this.readSettings()
    if (!store || !s?.url || !s.token) return { added: 0, total: 0 }
    this.polling = true
    try {
      const inbox = await this.readInbox()
      let added = 0
      for (let guard = 0; guard < 20; guard++) {
        const res = await fetch(`${s.url}/api/projects/${store.getProject().id}/changes?cursor=${inbox.cursor}`, { headers: { authorization: `Bearer ${s.token}` }, signal: AbortSignal.timeout(15000) })
        if (!res.ok) throw new Error(`피드백 가져오기 HTTP ${res.status}`)
        const ch = (await res.json()) as { cursor: number; comments: Comment[] }
        if (!ch.comments.length) break
        for (const c of ch.comments) {
          if (!inbox.comments[c.id]) added++
          const local = inbox.comments[c.id]?.local
          inbox.comments[c.id] = { ...c, local: local && !(c.status !== 'open' && local.synced) ? local : local }
        }
        inbox.cursor = ch.cursor
      }
      await this.writeInbox(inbox)
      this.lastError = null
      const items = Object.values(inbox.comments)
      if (added) this.emit('feedback:changed', { added, open: items.filter((c) => c.status === 'open' && c.kind !== 'verdict').length })
      return { added, total: items.length }
    } catch (e) {
      this.lastError = (e as Error).message
      return { added: 0, total: 0, error: this.lastError }
    } finally {
      this.polling = false
    }
  }

  private toItem(c: Inbox['comments'][string]): FeedbackItem {
    const state: FeedbackState = c.local?.state ?? (c.status === 'resolved' ? 'applied' : c.status === 'declined' ? 'declined' : 'open')
    return {
      commentId: c.id,
      seq: c.seq,
      label: c.label,
      kind: c.kind,
      shotNo: c.shotNo,
      panelIndex: c.panelIndex,
      region: c.kind === 'region' && c.x != null ? { page: c.page ?? 1, x: c.x, y: c.y ?? 0, w: c.w ?? 0, h: c.h ?? 0 } : undefined,
      tMs: c.tMs,
      frame: c.frame,
      text: c.body,
      author: c.author,
      verdict: c.verdict,
      state,
      serverStatus: c.status,
      resolvedIn: c.resolvedIn,
      note: c.local?.note ?? c.resolvedNote,
      pendingSync: !!c.local && !c.local.synced,
      createdAt: c.createdAt,
    }
  }

  async list(filter: { seq?: string; state?: FeedbackState | 'all' } = {}): Promise<FeedbackItem[]> {
    if (!this.getStore()) return []
    const inbox = await this.readInbox()
    return Object.values(inbox.comments)
      .map((c) => this.toItem(c))
      .filter((i) => (!filter.seq || i.seq === filter.seq) && (!filter.state || filter.state === 'all' || i.state === filter.state))
      .sort((a, b) => (a.shotNo ?? '9999').localeCompare(b.shotNo ?? '9999') || a.createdAt - b.createdAt)
  }

  /**
   * 반영 상태. applied = 다음 게시 때 "vN에서 반영됨"으로 서버에 회신(그 전까진 로컬 표시만),
   * declined = 바로 회신, open = 로컬 표시를 지운다.
   */
  async update(commentId: string, state: FeedbackState, o: { note?: string; versionId?: string } = {}): Promise<FeedbackItem> {
    const inbox = await this.readInbox()
    const c = inbox.comments[commentId]
    if (!c) throw new Error(`코멘트 없음: ${commentId}`)
    if (state === 'open') delete c.local
    else c.local = { state, note: o.note?.slice(0, 500), versionId: o.versionId, synced: false, at: Date.now() }
    await this.writeInbox(inbox)
    if (state === 'declined' || state === 'open') {
      const s = await this.readSettings()
      if (s?.url && s.token) {
        const res = await fetch(`${s.url}/api/comments/${commentId}`, { method: 'PATCH', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify(state === 'declined' ? { status: 'declined', note: o.note ?? null } : { status: 'open', resolvedIn: null, note: null }) }).catch(() => null)
        if (res?.ok && c.local) {
          c.local.synced = true
          await this.writeInbox(inbox)
        }
      }
    }
    this.emit('feedback:changed', { added: 0 })
    return this.toItem(inbox.comments[commentId])
  }

  /** 게시 직후: 이 시퀀스에서 applied(미회신) 인 코멘트를 resolved + resolvedIn=label 로 */
  private async syncApplied(seq: string, label: string) {
    const s = await this.conn()
    const inbox = await this.readInbox()
    for (const c of Object.values(inbox.comments)) {
      if (c.seq !== seq || c.local?.state !== 'applied' || c.local.synced) continue
      const res = await fetch(`${s.url}/api/comments/${c.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved', resolvedIn: label, note: c.local.note ?? null }) })
      if (res.ok) {
        const upd = (await res.json()) as Comment
        inbox.comments[c.id] = { ...upd, local: { ...c.local, synced: true } }
      }
    }
    await this.writeInbox(inbox)
    this.emit('feedback:changed', { added: 0 })
  }

  status() {
    return { lastError: this.lastError }
  }
}
