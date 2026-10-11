import { useEffect, useState } from 'react'
import { LogIn, Loader2, ExternalLink, X } from 'lucide-react'

/**
 * GPT(Codex) 엔진이 막힌 자리에서 바로 Codex(ChatGPT 계정) 로그인.
 * 설정 › 계정과 같은 흐름(main/auth.ts): `codex login` 이 브라우저를 열고, 로그인이 끝나면 done 이벤트.
 */
export default function CodexLogin({ onDone, label = 'Codex 로그인' }: { onDone?: () => void; label?: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(
    () =>
      window.conti.onAuthEvent((e) => {
        if (e.tool !== 'codex') return
        if (e.t === 'started') setState('running')
        else if (e.t === 'url') setUrl(e.url)
        else if (e.t === 'done') {
          setState('idle')
          setUrl(null)
          onDone?.()
        } else if (e.t === 'error') {
          setState('error')
          setMsg(e.message)
        }
      }),
    [onDone],
  )

  async function start() {
    setMsg(null)
    setUrl(null)
    setState('running')
    try {
      await window.conti.auth.login('codex')
    } catch (e) {
      setState('error')
      setMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  if (state === 'running')
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted" data-testid="codex-login-running">
        <Loader2 size={12} className="animate-spin" /> 브라우저에서 ChatGPT 로그인을 마치세요
        {url && (
          <button onClick={() => void window.conti.auth.openUrl(url)} className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-ink hover:underline">
            <ExternalLink size={11} /> 로그인 창 다시 열기
          </button>
        )}
        <button onClick={() => void window.conti.auth.cancel('codex')} title="취소" className="rounded p-0.5 hover:bg-panel-2 hover:text-ink">
          <X size={11} />
        </button>
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5">
      <button data-testid="codex-login" onClick={() => void start()} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-medium text-white hover:brightness-110">
        <LogIn size={11} /> {label}
      </button>
      {state === 'error' && msg && <span className="text-[11px] text-red-300">{msg}</span>}
    </span>
  )
}
