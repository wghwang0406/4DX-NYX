import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, LogIn, LogOut, RefreshCw, ExternalLink, Loader2, AlertTriangle, Stethoscope } from 'lucide-react'
import type { AccountStatus, AuthEvent, AuthTool, LoginOptions } from '../../../shared/auth-ipc'
import DiagnosticsView from './DiagnosticsView'

const LABEL: Record<AuthTool, { name: string; desc: string }> = {
  claude: { name: 'Claude Code', desc: 'AI 어시스턴트 — Claude 구독(claude.ai) 또는 Anthropic Console API 계정' },
  codex: { name: 'Codex', desc: 'AI 어시스턴트 — ChatGPT 계정' },
  higgsfield: { name: 'Higgsfield', desc: '이미지 생성 — 크레딧이 있는 Higgsfield 계정' },
}

interface Flow {
  url?: string
  needsCode?: boolean
  log: string
  error?: string
}

/** 설정 — 계정 로그인. 앱은 토큰을 보관하지 않는다: 각 공식 CLI 의 로그인(브라우저)을 대신 띄우고 상태만 읽는다. */
export default function SettingsView() {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null)
  const [flows, setFlows] = useState<Partial<Record<AuthTool, Flow>>>({})
  const [claudeMode, setClaudeMode] = useState<LoginOptions['claudeMode']>('claudeai')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'accounts' | 'tools'>('accounts')

  async function load() {
    setBusy(true)
    try {
      setAccounts(await window.conti.auth.status())
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    return window.conti.onAuthEvent((e: AuthEvent) => {
      setFlows((f) => {
        const cur = f[e.tool] ?? { log: '' }
        switch (e.t) {
          case 'started':
            return { ...f, [e.tool]: { log: '' } }
          case 'url':
            return { ...f, [e.tool]: { ...cur, url: e.url } }
          case 'needs_code':
            return { ...f, [e.tool]: { ...cur, needsCode: true } }
          case 'log':
            return { ...f, [e.tool]: { ...cur, log: (cur.log + e.text).slice(-2000) } }
          case 'done':
          case 'logged_out': {
            const { [e.tool]: _done, ...rest } = f
            return rest
          }
          case 'error':
            return { ...f, [e.tool]: { ...cur, error: e.message } }
        }
      })
      if (e.t === 'done' || e.t === 'error' || e.t === 'logged_out') void load()
    })
  }, [])

  async function login(tool: AuthTool) {
    try {
      await window.conti.auth.login(tool, tool === 'claude' ? { claudeMode, email: email || undefined } : {})
    } catch (e) {
      setFlows((f) => ({ ...f, [tool]: { log: '', error: clean(e) } }))
    }
    void load()
  }
  async function logout(tool: AuthTool) {
    if (!window.confirm(`${LABEL[tool].name} 에서 로그아웃할까요? 다시 쓰려면 브라우저 로그인이 필요합니다.`)) return
    try {
      await window.conti.auth.logout(tool)
    } catch (e) {
      setFlows((f) => ({ ...f, [tool]: { log: '', error: clean(e) } }))
    }
    void load()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 pt-0">
      <div className="flex items-center gap-1 rounded-md border border-line bg-panel p-0.5 text-[12px] self-start">
        <button onClick={() => setTab('accounts')} className={`rounded px-3 py-1 ${tab === 'accounts' ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
          계정
        </button>
        <button onClick={() => setTab('tools')} className={`flex items-center gap-1 rounded px-3 py-1 ${tab === 'tools' ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
          <Stethoscope size={12} /> 도구 진단
        </button>
      </div>
      {tab === 'tools' ? (
        <DiagnosticsView />
      ) : (
        <>
          <section className="flex items-center justify-between rounded-lg border border-line bg-panel p-4">
            <div>
              <div className="text-[14px] font-semibold">계정</div>
              <div className="text-[12px] text-muted">
                각 도구의 공식 로그인(브라우저)을 여기서 띄웁니다. 앱은 비밀번호·토큰을 저장하지 않고, 로그인 상태는 각 CLI 가 자기 자리에 보관합니다.
              </div>
            </div>
            <button onClick={() => void load()} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-panel-2">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> 다시 확인
            </button>
          </section>

          {(accounts ?? (['claude', 'codex', 'higgsfield'] as AuthTool[]).map((tool): AccountStatus => ({ tool, installed: true, loggedIn: false, busy: false }))).map((a) => {
            const flow = flows[a.tool]
            const running = a.busy || (!!flow && !flow.error)
            return (
              <section key={a.tool} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                      {LABEL[a.tool].name}
                      {!accounts ? (
                        <span className="text-[11px] font-normal text-muted">확인 중…</span>
                      ) : !a.installed ? (
                        <span className="flex items-center gap-1 text-[11.5px] font-normal text-red-400">
                          <XCircle size={13} /> 설치 안 됨
                        </span>
                      ) : a.loggedIn ? (
                        <span className="flex items-center gap-1 text-[11.5px] font-normal text-emerald-400">
                          <CheckCircle2 size={13} /> 로그인됨
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11.5px] font-normal text-warn">
                          <AlertTriangle size={13} /> 로그인 필요
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">{LABEL[a.tool].desc}</div>
                    {a.loggedIn && (
                      <div className="mt-1.5 text-[12.5px]">
                        <span className="font-mono">{a.account ?? '(계정 표시 불가)'}</span>
                        {a.detail && <span className="ml-2 text-muted">{a.detail}</span>}
                      </div>
                    )}
                    {!a.loggedIn && a.installed && a.detail && !running && <div className="mt-1 text-[11.5px] text-muted">{a.detail}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.installed && !running && (
                      <button onClick={() => void login(a.tool)} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110">
                        <LogIn size={13} /> {a.loggedIn ? '다른 계정으로 로그인' : '로그인'}
                      </button>
                    )}
                    {a.installed && a.loggedIn && !running && (
                      <button onClick={() => void logout(a.tool)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-panel-2 hover:text-ink">
                        <LogOut size={13} /> 로그아웃
                      </button>
                    )}
                    {running && (
                      <button onClick={() => void window.conti.auth.cancel(a.tool).then(load)} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-panel-2">
                        취소
                      </button>
                    )}
                  </div>
                </div>

                {a.tool === 'claude' && !running && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={claudeMode === 'claudeai'} onChange={() => setClaudeMode('claudeai')} /> Claude 구독 (claude.ai)
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={claudeMode === 'console'} onChange={() => setClaudeMode('console')} /> Console API (사용량 과금)
                    </label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일 미리 채우기 (선택)" className="w-56 rounded border border-line bg-bg px-2 py-1 text-[12px] outline-none placeholder:text-muted" />
                  </div>
                )}
                {a.loggedIn && (a.tool === 'codex' || a.tool === 'higgsfield') && !running && (
                  <div className="mt-2 text-[11px] text-muted">다른 계정으로 바꾸면 로그인이 끝날 때까지 이 도구는 로그아웃 상태가 됩니다 (CLI 가 시작하자마자 기존 자격 증명을 지웁니다).</div>
                )}

                {running && (
                  <div className="mt-3 rounded-md border border-line bg-bg p-3 text-[12px]">
                    <div className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin text-accent" />
                      브라우저에서 로그인을 마치세요. 끝나면 여기 상태가 바뀝니다.
                    </div>
                    {flow?.url && (
                      <button onClick={() => void window.conti.auth.openUrl(flow.url!)} className="mt-2 flex items-center gap-1 text-accent hover:underline">
                        <ExternalLink size={12} /> 브라우저가 안 열렸으면 여기를 눌러 여세요
                      </button>
                    )}
                    {flow?.needsCode && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-muted">브라우저가 코드를 보여주면 붙여넣기:</span>
                        <input value={code} onChange={(e) => setCode(e.target.value)} className="w-64 rounded border border-line bg-panel px-2 py-1 font-mono text-[12px] outline-none" />
                        <button
                          onClick={() => void window.conti.auth.pasteCode(a.tool, code).then(() => setCode(''))}
                          disabled={!code.trim()}
                          className="rounded-md border border-line px-2 py-1 text-[12px] hover:bg-panel-2 disabled:opacity-40"
                        >
                          확인
                        </button>
                      </div>
                    )}
                    {flow?.log && <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[10.5px] text-muted">{flow.log.replace(/https?:\/\/\S+/g, '[URL]').trim()}</pre>}
                  </div>
                )}
                {flow?.error && !running && (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">
                    <AlertTriangle size={13} /> {flow.error}
                    <button onClick={() => setFlows((f) => ({ ...f, [a.tool]: undefined }))} className="ml-auto text-[11px] underline">
                      닫기
                    </button>
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
