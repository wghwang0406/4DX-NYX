// 계정 로그인 — 앱은 토큰을 다루지 않는다. 각 공식 CLI 의 login/logout 을 대신 띄우고 상태만 읽는다.
//   claude:     `claude auth login [--console] [--email x]` → 브라우저, 폴백으로 stdin 에 코드 붙여넣기 / `claude auth logout` / `claude auth status --json`
//   codex:      `codex login` → 브라우저(localhost:1455 콜백) / `codex logout` / `codex login status` (+ ~/.codex/auth.json 의 id_token 에서 이메일만 표시용으로 읽는다)
//   higgsfield: `higgsfield auth login` → 브라우저(localhost 콜백) / `higgsfield auth logout` / `higgsfield account status --json`
// 주의: codex·higgsfield 는 login 을 시작하는 순간 기존 자격 증명을 지운다 — 취소해도 로그아웃 상태가 된다. UI 가 경고한다.
import { shell, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import crossSpawn from 'cross-spawn'
import { enrichedPath, findBin, probe } from '@conti/agents'
import type { AccountStatus, AuthEvent, AuthTool, LoginOptions } from '../shared/auth-ipc'

const CMD: Record<AuthTool, { login: (o: LoginOptions) => string[]; logout: string[] }> = {
  claude: {
    login: (o) => ['auth', 'login', ...(o.claudeMode === 'console' ? ['--console'] : ['--claudeai']), ...(o.email ? ['--email', o.email] : [])],
    logout: ['auth', 'logout'],
  },
  codex: { login: () => ['login'], logout: ['logout'] },
  higgsfield: { login: () => ['auth', 'login', '--no-color'], logout: ['auth', 'logout', '--no-color'] },
}

const URL_RE = /https?:\/\/[^\s'"<>]+/g

/** JWT payload 에서 표시용 필드만 (검증 없음, 저장 없음). */
function jwtClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export class AuthManager {
  private procs = new Map<AuthTool, ChildProcess>()

  constructor(private getWindow: () => BrowserWindow | null) {}

  private emit(e: AuthEvent) {
    this.getWindow()?.webContents.send('auth:event', e)
  }

  async status(): Promise<AccountStatus[]> {
    const [claude, codex, higgsfield] = await Promise.all([this.claudeStatus(), this.codexStatus(), this.higgsfieldStatus()])
    return [claude, codex, higgsfield]
  }

  private async claudeStatus(): Promise<AccountStatus> {
    const path = await findBin('claude')
    if (!path) return { tool: 'claude', installed: false, loggedIn: false, busy: this.procs.has('claude') }
    const r = await probe('claude', ['auth', 'status', '--json'])
    try {
      const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
      return { tool: 'claude', installed: true, loggedIn: !!j.loggedIn, account: j.email, detail: [j.orgName, j.authMethod === 'console' ? 'Console API' : j.authMethod ? 'Claude 구독' : undefined].filter(Boolean).join(' · '), busy: this.procs.has('claude') }
    } catch {
      return { tool: 'claude', installed: true, loggedIn: false, detail: r.out.slice(0, 120), busy: this.procs.has('claude') }
    }
  }

  private async codexStatus(): Promise<AccountStatus> {
    const path = await findBin('codex')
    if (!path) return { tool: 'codex', installed: false, loggedIn: false, busy: this.procs.has('codex') }
    const r = await probe('codex', ['login', 'status'])
    const loggedIn = r.ok && /logged in/i.test(r.out) && !/not logged/i.test(r.out)
    let account: string | undefined
    let detail = loggedIn ? r.out.trim().split('\n')[0] : undefined
    if (loggedIn) {
      try {
        const auth = JSON.parse(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8'))
        const claims = auth?.tokens?.id_token ? jwtClaims(auth.tokens.id_token) : null
        account = (claims?.email as string | undefined) ?? undefined
        if (auth?.auth_mode === 'apikey' || (!auth?.tokens && auth?.OPENAI_API_KEY)) detail = 'API 키'
      } catch {
        /* 표시용 — 못 읽으면 생략 */
      }
    }
    return { tool: 'codex', installed: true, loggedIn, account, detail, busy: this.procs.has('codex') }
  }

  private async higgsfieldStatus(): Promise<AccountStatus> {
    const path = await findBin('higgsfield')
    if (!path) return { tool: 'higgsfield', installed: false, loggedIn: false, busy: this.procs.has('higgsfield') }
    const r = await probe('higgsfield', ['account', 'status', '--json', '--no-color'], 15000)
    if (!r.ok) return { tool: 'higgsfield', installed: true, loggedIn: false, detail: r.out.split('\n')[0]?.replace(/^Error:\s*/, '').slice(0, 120), busy: this.procs.has('higgsfield') }
    try {
      const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
      return { tool: 'higgsfield', installed: true, loggedIn: true, account: j.email, detail: j.subscription_plan_type ? `플랜 ${j.subscription_plan_type}` : undefined, busy: this.procs.has('higgsfield') }
    } catch {
      return { tool: 'higgsfield', installed: true, loggedIn: false, detail: r.out.slice(0, 120), busy: this.procs.has('higgsfield') }
    }
  }

  /** 로그인 시작 — 즉시 돌아오고 진행은 auth:event 로. 브라우저는 CLI 가 연다; URL 은 이벤트로도 보낸다. */
  async login(tool: AuthTool, opts: LoginOptions = {}): Promise<void> {
    if (this.procs.has(tool)) throw new Error('이미 로그인 진행 중입니다')
    const bin = await findBin(tool)
    if (!bin) throw new Error(`${tool} CLI 가 설치돼 있지 않습니다`)
    const args = CMD[tool].login(opts)
    const child = crossSpawn(bin, args, { env: { ...process.env, PATH: enrichedPath(), HIGGSFIELD_NO_UPDATE_CHECK: '1', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.procs.set(tool, child)
    this.emit({ t: 'started', tool })
    let urlSent = false
    let buf = ''
    const onData = (d: Buffer) => {
      const text = d.toString('utf8')
      buf = (buf + text).slice(-8000)
      // ANSI 제거 후 URL 추출
      const clean = buf.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      const urls = clean.match(URL_RE) ?? []
      const url = urls.find((u) => /oauth|authorize|login|auth/i.test(u) && !/localhost|127\.0\.0\.1/.test(u))
      if (url && !urlSent) {
        urlSent = true
        this.emit({ t: 'url', tool, url })
      }
      if (/paste code here/i.test(clean) && !/pasted/i.test(clean)) this.emit({ t: 'needs_code', tool })
      this.emit({ t: 'log', tool, text: text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (e) => {
      this.procs.delete(tool)
      this.emit({ t: 'error', tool, message: e.message })
    })
    child.on('close', async (code) => {
      this.procs.delete(tool)
      const st = (await this.status()).find((s) => s.tool === tool)!
      if (st.loggedIn) this.emit({ t: 'done', tool, status: st })
      else this.emit({ t: 'error', tool, message: code === 0 ? '로그인이 끝났지만 상태를 확인하지 못했습니다' : code === null ? '취소됨' : `로그인 실패 (exit ${code})`, status: st })
    })
    // 혹시 완료됐는데 프로세스가 안 끝나는 경우(브라우저 콜백 뒤 대기) — 5초마다 상태 확인, 로그인되면 종료
    const poll = setInterval(async () => {
      if (!this.procs.has(tool)) return clearInterval(poll)
      const st = (await this.status()).find((s) => s.tool === tool)!
      if (st.loggedIn) {
        clearInterval(poll)
        this.procs.get(tool)?.kill('SIGTERM')
      }
    }, 5000)
    child.on('close', () => clearInterval(poll))
  }

  /** Claude 폴백: 브라우저가 코드를 보여주면 사용자가 붙여넣는다 */
  pasteCode(tool: AuthTool, code: string) {
    const p = this.procs.get(tool)
    if (!p) throw new Error('진행 중인 로그인이 없습니다')
    p.stdin?.write(code.trim() + '\n')
  }

  cancel(tool: AuthTool) {
    const p = this.procs.get(tool)
    if (!p) return
    p.kill('SIGTERM')
    setTimeout(() => p.kill('SIGKILL'), 1500)
  }

  async logout(tool: AuthTool): Promise<AccountStatus> {
    this.cancel(tool)
    const r = await probe(tool, CMD[tool].logout, 15000)
    const st = (await this.status()).find((s) => s.tool === tool)!
    if (st.loggedIn) throw new Error(`로그아웃 실패: ${r.out.slice(0, 160)}`)
    this.emit({ t: 'logged_out', tool, status: st })
    return st
  }

  openUrl(url: string) {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }

  async stop() {
    for (const t of this.procs.keys()) this.cancel(t)
  }
}
