// Dropbox 보관 — 서버에 서비스 계정 토큰 하나만 둔다(팀원 PC 설정 불필요). 게시본을 팀 폴더에 불변 사본으로 올린다.
// 150MB 이하는 /files/upload, 그보다 크면 upload_session(start → append_v2 → finish).
// 토큰: 장기 액세스 토큰(DROPBOX_TOKEN) 또는 리프레시 토큰 + 앱 키/시크릿(DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET).
import { open } from 'node:fs/promises'

export interface DropboxConfig {
  token?: string
  refreshToken?: string
  appKey?: string
  appSecret?: string
  root: string // 예: /NYX
  apiBase?: string // 테스트용
  contentBase?: string
  chunk?: number
}

export class Dropbox {
  private access?: { token: string; exp: number }
  private api: string
  private content: string
  private chunk: number

  constructor(private c: DropboxConfig) {
    this.api = c.apiBase ?? 'https://api.dropboxapi.com'
    this.content = c.contentBase ?? 'https://content.dropboxapi.com'
    this.chunk = c.chunk ?? 140 * 1024 * 1024
  }

  static fromEnv(env: NodeJS.ProcessEnv): Dropbox | null {
    if (!env.DROPBOX_TOKEN && !(env.DROPBOX_REFRESH_TOKEN && env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET)) return null
    return new Dropbox({
      token: env.DROPBOX_TOKEN,
      refreshToken: env.DROPBOX_REFRESH_TOKEN,
      appKey: env.DROPBOX_APP_KEY,
      appSecret: env.DROPBOX_APP_SECRET,
      root: env.DROPBOX_ROOT ?? '/NYX',
      apiBase: env.DROPBOX_API_BASE,
      contentBase: env.DROPBOX_CONTENT_BASE,
    })
  }

  get root() {
    return this.c.root.replace(/\/+$/, '')
  }

  private async bearer(): Promise<string> {
    if (this.c.token) return this.c.token
    if (this.access && this.access.exp > Date.now() + 60_000) return this.access.token
    const res = await fetch(`${this.api}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${this.c.appKey}:${this.c.appSecret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.c.refreshToken! }),
    })
    if (!res.ok) throw new Error(`Dropbox 토큰 갱신 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    this.access = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }

  /** Dropbox-API-Arg 헤더는 ASCII 만 받는다 — 한글 경로는 \uXXXX 로 */
  static apiArg(o: unknown): string {
    return JSON.stringify(o).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
  }

  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.api}/2${path}`, { method: 'POST', headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(`Dropbox ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as T
  }

  private async contentCall<T>(path: string, arg: unknown, data: Buffer): Promise<T> {
    const res = await fetch(`${this.content}/2${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/octet-stream', 'dropbox-api-arg': Dropbox.apiArg(arg) },
      body: new Blob([new Uint8Array(data)]),
    })
    if (!res.ok) throw new Error(`Dropbox ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  /** 로컬 파일 → Dropbox 경로 (이미 있으면 그대로 두지 않고 autorename 없이 실패 → 같은 게시본 재시도는 덮어쓰기 대신 건너뜀) */
  async upload(localPath: string, dropboxPath: string, size: number): Promise<void> {
    const fh = await open(localPath, 'r')
    try {
      if (size <= this.chunk) {
        const buf = Buffer.alloc(size)
        await fh.read(buf, 0, size, 0)
        await this.contentCall('/files/upload', { path: dropboxPath, mode: 'overwrite', mute: true, strict_conflict: false }, buf)
        return
      }
      let offset = 0
      const first = Buffer.alloc(Math.min(this.chunk, size))
      await fh.read(first, 0, first.length, 0)
      const { session_id } = await this.contentCall<{ session_id: string }>('/files/upload_session/start', { close: false }, first)
      offset = first.length
      while (size - offset > this.chunk) {
        const buf = Buffer.alloc(this.chunk)
        await fh.read(buf, 0, buf.length, offset)
        await this.contentCall('/files/upload_session/append_v2', { cursor: { session_id, offset }, close: false }, buf)
        offset += buf.length
      }
      const last = Buffer.alloc(size - offset)
      await fh.read(last, 0, last.length, offset)
      await this.contentCall('/files/upload_session/finish', { cursor: { session_id, offset }, commit: { path: dropboxPath, mode: 'overwrite', mute: true } }, last)
    } finally {
      await fh.close()
    }
  }

  /** 큰 영상을 서버가 안 들고 있을 때 재생용 임시 링크 (4시간) */
  async temporaryLink(dropboxPath: string): Promise<string> {
    const r = await this.rpc<{ link: string }>('/files/get_temporary_link', { path: dropboxPath })
    return r.link
  }

  async check(): Promise<{ ok: boolean; account?: string; error?: string }> {
    try {
      const r = await this.rpc<{ email?: string; name?: { display_name?: string } }>('/users/get_current_account', null)
      return { ok: true, account: r.email ?? r.name?.display_name }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}
