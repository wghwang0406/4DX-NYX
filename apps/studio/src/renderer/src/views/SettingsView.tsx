import { useProject } from '../state/project'
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, LogIn, LogOut, RefreshCw, ExternalLink, Loader2, AlertTriangle, Stethoscope, Server } from 'lucide-react'
import type { AccountStatus, AuthEvent, AuthTool, LoginOptions } from '../../../shared/auth-ipc'
import DiagnosticsView from './DiagnosticsView'
import CodexLogin from '../components/CodexLogin'

const LABEL: Record<AuthTool, { name: string; desc: string }> = {
  claude: { name: 'Claude Code', desc: 'AI 어시스턴트 — Claude 구독(claude.ai) 또는 Anthropic Console API 계정' },
  codex: { name: 'Codex', desc: 'AI 어시스턴트 · GPT 이미지 생성 — ChatGPT 계정' },
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
  const [tab, setTab] = useState<'accounts' | 'server' | 'tools'>(() => (new URLSearchParams(window.location.search).get('settings') as 'server' | null) ?? 'accounts')

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
        <button onClick={() => setTab('server')} className={`flex items-center gap-1 rounded px-3 py-1 ${tab === 'server' ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
          <Server size={12} /> 게시 서버
        </button>
        <button onClick={() => setTab('tools')} className={`flex items-center gap-1 rounded px-3 py-1 ${tab === 'tools' ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
          <Stethoscope size={12} /> 도구 진단
        </button>
      </div>
      {tab === 'tools' ? (
        <DiagnosticsView />
      ) : tab === 'server' ? (
        <ServerSettings />
      ) : (
        <>
          <section className="flex items-center justify-between rounded-lg border border-line bg-panel p-4">
            <div>
              <div className="text-[14px] font-semibold">계정</div>
              <div className="text-[12px] text-muted">
                각 도구의 공식 로그인(브라우저)을 여기서 띄웁니다. 앱은 비밀번호·토큰을 저장하지 않고, 로그인 상태는 각 CLI 가 자기 자리에 보관합니다.
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => void window.conti.app.setSettings({ onboarded: false }).then(() => location.reload())} className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:bg-panel-2 hover:text-ink">
                처음 안내 다시 보기
              </button>
              <button onClick={() => void load()} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-panel-2">
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> 다시 확인
              </button>
            </div>
          </section>

          <EngineSettings codexReady={!!accounts?.find((x) => x.tool === 'codex')?.loggedIn} onLogin={() => void load()} />

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

/** 사내 뷰어 서버 — 주소 + 팀 게시 토큰 (토큰은 키체인으로 암호화해 이 맥에만) */
export function ServerSettings() {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [encrypted, setEncrypted] = useState(true)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.conti.publish.settings().then((s) => {
      setUrl(s.url)
      setHasToken(s.hasToken)
      setEncrypted(s.encrypted)
    })
  }, [])
  async function save() {
    setBusy(true)
    setResult(null)
    try {
      await window.conti.publish.saveSettings(url, token || undefined)
      setToken('')
      setHasToken(hasToken || !!token)
      setResult(await window.conti.publish.test())
    } catch (e) {
      setResult({ ok: false, message: clean(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-lg border border-line bg-panel p-4 text-[12.5px]">
      <div className="text-[14px] font-semibold">게시 서버</div>
      <div className="mt-0.5 text-[12px] text-muted">사내 뷰어 서버에 시트·PDF·영상을 올리고 링크로 공유합니다. 서버가 Dropbox 팀 폴더에 보관하므로 이 맥에는 Dropbox 설정이 필요 없습니다.</div>
      <div className="mt-3 grid max-w-xl grid-cols-[90px_1fr] items-center gap-2">
        <span className="text-muted">서버 주소</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://nyx.사내:8787" className="rounded border border-line bg-bg px-2 py-1 font-mono text-[12px] outline-none focus:border-accent" />
        <span className="text-muted">게시 토큰</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={hasToken ? '저장됨 — 바꿀 때만 입력' : '서버의 NYX_PUBLISH_TOKEN'} className="rounded border border-line bg-bg px-2 py-1 font-mono text-[12px] outline-none focus:border-accent" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button disabled={busy || !url} onClick={() => void save()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} 저장하고 연결 확인
        </button>
        {!encrypted && <span className="text-[11px] text-warn">이 기기에선 키체인 암호화를 쓸 수 없어 토큰이 평문으로 저장됩니다</span>}
      </div>
      {result && (
        <div className={`mt-3 flex items-center gap-1.5 text-[12px] ${result.ok ? 'text-emerald-400' : 'text-red-300'}`}>
          {result.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {result.message}
        </div>
      )}
    </section>
  )
}

/** 이 프로젝트의 이미지 생성 엔진 기본값 — 승인 카드에서 요청마다 바꿀 수 있다 */
function EngineSettings({ codexReady, onLogin }: { codexReady: boolean; onLogin: () => void }) {
  const { project, refresh } = useProject()
  if (!project) return null
  const cur = project.defaults.imageEngine ?? 'higgsfield'
  const set = (imageEngine: 'higgsfield' | 'codex') => void window.conti.api.project.setDefaults({ imageEngine }).then(() => refresh())
  return (
    <section className="rounded-lg border border-line bg-panel p-4" data-testid="engine-settings">
      <div className="text-[13.5px] font-semibold">이미지 생성 엔진 <span className="ml-1 text-[11.5px] font-normal text-muted">{project.title} 기본값</span></div>
      <div className="mt-1 text-[12px] text-muted">에셋 시트·콘티·다시 그리기·수정에 쓸 엔진. 생성할 때 승인 카드에서 요청마다 바꿀 수 있습니다.</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <button onClick={() => set('higgsfield')} className={`rounded-md border p-3 text-left ${cur === 'higgsfield' ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-2'}`}>
          <div className="font-medium">Higgsfield</div>
          <div className="mt-0.5 text-[11.5px] text-muted">인물 Soul · 장소 Soul Cinema · 소품 Nano · 콘티 GPT Image 2.5. Soul ID 로 얼굴 고정. 크레딧 사용</div>
        </button>
        <button
          onClick={() => set('codex')}
          disabled={!codexReady && cur !== 'codex'}
          className={`rounded-md border p-3 text-left disabled:opacity-50 ${cur === 'codex' ? 'border-accent bg-accent-soft' : 'border-line hover:bg-panel-2'}`}
        >
          <div className="font-medium">GPT · Codex</div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            로그인한 Codex(ChatGPT)의 이미지 생성. Higgsfield 크레딧을 쓰지 않고 시트를 레퍼런스로 붙입니다. 한 장 1–2분, Soul ID 없음
          </div>
        </button>
      </div>
      {!codexReady && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-warn">GPT · Codex 를 쓰려면 Codex(ChatGPT 계정) 로그인이 필요합니다</span>
          <CodexLogin onDone={onLogin} />
        </div>
      )}
    </section>
  )
}
