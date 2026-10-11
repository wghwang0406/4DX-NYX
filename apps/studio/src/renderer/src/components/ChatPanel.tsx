import CodexLogin from './CodexLogin'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Send, Sparkles, FileImage, Square, Wrench, Check, AlertTriangle } from 'lucide-react'
import type { Scene } from '../data/sampleScene'
import type { AgentAvailability, AgentKind, ChatMessage, JobView, SpendPreview, SpendRequestView, ThreadInfo, UsageView } from '../../../shared/agent-ipc'

interface Props {
  scene: Scene | null
  selectedShot?: string | null
  demo?: boolean
}

export default function ChatPanel({ scene, selectedShot, demo }: Props) {
  const api = window.conti?.agent
  const [avail, setAvail] = useState<AgentAvailability[]>([])
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [thread, setThread] = useState<ThreadInfo | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [spends, setSpends] = useState<SpendRequestView[]>([])
  const [usage, setUsage] = useState<UsageView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [includeNeighbors, setIncludeNeighbors] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // 로그인된 쪽을 기본으로 고른다
  useEffect(() => {
    if (!api || demo) return
    void api.availability().then((a) => {
      setAvail(a)
      const ok = a.filter((x) => x.installed && x.auth === 'ok')
      if (ok.length && !ok.some((x) => x.kind === agent)) setAgent(ok[0].kind)
    })
    void api.spendList().then(setSpends)
  }, [api, demo]) // eslint-disable-line react-hooks/exhaustive-deps

  // 설정에서 로그인/로그아웃하면 가용성을 다시 읽는다
  useEffect(() => {
    if (!window.conti?.onAuthEvent || demo || !api) return
    return window.conti.onAuthEvent((e) => {
      if (e.t === 'done' || e.t === 'logged_out') void api.availability().then(setAvail)
    })
  }, [api, demo])

  // 이벤트 구독
  useEffect(() => {
    if (!window.conti?.onAgentEvent || demo) return
    return window.conti.onAgentEvent((e) => {
      if (e.t === 'spend') {
        setSpends((s) => [...s.filter((x) => x.requestId !== e.request.requestId), e.request])
        return
      }
      if (e.t === 'focus' || e.t === 'job') return
      // 메인에서 연 스레드(작업 버튼·E2E)도 따라간다: 새 사용자 메시지가 온 스레드로 전환
      if ((!thread || e.threadId !== thread.id) && e.t === 'message' && e.message.role === 'user') {
        void api.threads().then((list) => {
          const t = list.find((x) => x.id === e.threadId)
          if (t) {
            setThread(t)
            setAgent(t.agent)
            setMessages([e.message])
            setBusy(true)
          }
        })
        return
      }
      if (!thread || e.threadId !== thread.id) return
      if (e.t === 'message') setMessages((m) => [...m, e.message])
      else if (e.t === 'delta') setMessages((m) => m.map((x) => (x.id === e.messageId ? { ...x, text: x.text + e.text, streaming: true } : x)))
      else if (e.t === 'tool')
        setMessages((m) => m.map((x) => (x.id === e.messageId ? { ...x, tool: { ...x.tool, ...e.tool, name: x.tool?.name || e.tool?.name || '' } } : x)))
      else if (e.t === 'usage') setUsage(e.usage)
      else if (e.t === 'turn_end') {
        setBusy(false)
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })))
      } else if (e.t === 'error') {
        setBusy(false)
        setError(e.message)
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })))
      }
    })
  }, [thread, demo, api])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, spends])

  const ensureThread = useCallback(async () => {
    if (thread && thread.agent === agent) return thread
    const t = await api.open({ agent, seq: scene?.seq ?? undefined })
    setThread(t)
    setMessages(await api.history(t.id))
    return t
  }, [api, agent, thread, scene])

  async function send() {
    const text = input.trim()
    if (!text || !api) return
    setError(null)
    setInput('')
    setBusy(true)
    try {
      const t = await ensureThread()
      await api.send(t.id, text, { seq: scene?.seq ?? undefined, shotNo: selectedShot ?? undefined })
    } catch (e) {
      setBusy(false)
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  const current = avail.find((a) => a.kind === agent)
  const shotCount = scene?.shots.length ?? 0
  // 거절한 것만 숨긴다. 진행·완료 카드는 최근 5개까지 (끝난 뒤에도 결과·실패를 볼 수 있게)
  const pending = [...spends].filter((s) => s.status !== 'rejected').sort((a, b) => a.createdAt - b.createdAt).slice(-5)

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="drag flex h-[52px] shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Sparkles size={15} className="text-accent" />
          AI 어시스턴트
        </div>
        <div className="no-drag flex rounded-md border border-line p-0.5 text-[11.5px]">
          {(['claude', 'codex'] as AgentKind[]).map((a) => {
            const av = avail.find((x) => x.kind === a)
            const disabled = !demo && av && !(av.installed && av.auth === 'ok')
            return (
              <button
                key={a}
                disabled={disabled}
                title={disabled ? `${a}: ${av?.installed ? '로그인 필요' : '설치 안 됨'}` : a}
                onClick={() => {
                  setAgent(a)
                  setThread(null)
                  setMessages([])
                }}
                className={`rounded px-2 py-0.5 capitalize ${agent === a ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'} disabled:opacity-30`}
              >
                {a === 'claude' ? 'Claude' : 'Codex'}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {demo && (
          <>
            <Bubble m={{ id: 'd1', role: 'user', text: '컷 기준으로 콘티를 만들어줘.', at: 0 }} />
            <Bubble m={{ id: 'd2', role: 'assistant', text: `${shotCount}개 컷을 확인했어요.`, at: 0 }} />
            <SpendCard req={{ requestId: 'demo', kind: 'conti_generate', count: shotCount, status: 'awaiting_approval', createdAt: 0 }} includeNeighbors={includeNeighbors} setIncludeNeighbors={setIncludeNeighbors} onDecide={() => {}} />
          </>
        )}
        {!demo && current && !(current.installed && current.auth === 'ok') && (
          <div className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[12px]">
            <AlertTriangle size={13} className="mr-1 inline text-warn" />
            {current.installed ? `${agent === 'claude' ? 'Claude' : 'Codex'} CLI 로그인이 필요합니다. 터미널에서 로그인한 뒤 진단에서 다시 확인하세요.` : `${agent} CLI 가 설치돼 있지 않습니다.`}
          </div>
        )}
        {!demo && messages.length === 0 && (
          <div className="mt-2 text-[12px] leading-relaxed text-muted">
            {scene ? `${scene.seq} ${scene.title}` : '시퀀스'}에 대해 물어보거나 수정을 요청하세요.
            <br />예: "0030 로우앵글로 바꿔줘", "이 씬 샷 분해해줘", "등장인물 정리해줘"
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {pending.map((r) => (
          <SpendCard key={r.requestId} req={r} includeNeighbors={includeNeighbors} setIncludeNeighbors={setIncludeNeighbors} onDecide={(d, engine) => void api.spendDecide(r.requestId, d, includeNeighbors, engine).then(() => api.spendList().then(setSpends))} />
        ))}
        {error && <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">{error}</div>}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        {usage && (
          <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted">
            <span>
              in {usage.inTok.toLocaleString()} · out {usage.outTok.toLocaleString()}
              {usage.cacheRead ? ` · cache ${usage.cacheRead.toLocaleString()}` : ''}
            </span>
            {usage.fiveHour != null && <span title="구독 5시간 창 사용률">사용량 {(usage.fiveHour * 100).toFixed(0)}%</span>}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-line bg-bg px-2 py-1.5">
          <button className="p-1 text-muted hover:text-ink" title="이미지 첨부 (준비 중)">
            <Paperclip size={15} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={busy ? '응답 중…' : '수정 요청 입력'}
            className="min-h-[40px] flex-1 resize-none bg-transparent py-1 text-[12.5px] outline-none placeholder:text-muted"
          />
          {busy ? (
            <button onClick={() => thread && void api.interrupt(thread.id).then(() => setBusy(false))} className="p-1 text-warn" title="중단">
              <Square size={15} />
            </button>
          ) : (
            <button onClick={() => void send()} className="p-1 text-accent hover:brightness-125" title="보내기">
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'tool') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line/70 bg-panel-2/60 px-2.5 py-1.5 text-[11.5px] text-muted">
        <Wrench size={12} className={m.tool?.pending ? 'animate-pulse text-accent' : m.tool?.ok === false ? 'text-red-400' : 'text-emerald-400'} />
        <span className="font-mono">{m.tool?.name?.replace(/^mcp__conti__/, '')}</span>
        {m.tool?.summary && <span className="truncate">· {m.tool.summary}</span>}
      </div>
    )
  }
  if (m.role === 'system') return <div className="text-center text-[11px] text-muted">{m.text}</div>
  return (
    <div className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
      {m.role === 'assistant' && (
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">AI</div>
      )}
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${m.role === 'user' ? 'bg-accent-soft' : 'bg-panel-2'}`}>
        {m.text}
        {m.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-muted align-middle" />}
      </div>
    </div>
  )
}

function SpendCard({
  req,
  includeNeighbors,
  setIncludeNeighbors,
  onDecide,
}: {
  req: SpendRequestView
  includeNeighbors: boolean
  setIncludeNeighbors: (v: boolean) => void
  onDecide: (d: 'approved' | 'rejected' | 'pilot', engine?: 'higgsfield' | 'codex') => void
}) {
  const label: Record<string, string> = {
    conti_generate: '콘티',
    assets_generate: '에셋',
    image_edit: '이미지 수정',
    panel_restyle: '다시 그리기',
  }
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<SpendPreview | null>(null)
  const [jobs, setJobs] = useState<JobView[]>([])
  const api = window.conti?.agent
  const waiting = req.status === 'awaiting_approval'
  const active = req.status === 'approved' || req.status === 'pilot'
  const regen = req.kind === 'conti_generate' && req.shots && req.shots.length > 0
  // 이미지 엔진: 고르기 전엔 요청/프로젝트 기본값(미리보기가 알려준다)
  const [engine, setEngine] = useState<'higgsfield' | 'codex' | undefined>()
  const [codexReady, setCodexReady] = useState<boolean | null>(null)
  const refreshCodex = useCallback(() => {
    if (!window.conti?.auth) return
    void window.conti.auth
      .status()
      .then((list) => setCodexReady(!!list.find((a) => a.tool === 'codex')?.loggedIn))
      .catch(() => setCodexReady(null))
  }, [])
  useEffect(() => {
    if (waiting) refreshCodex()
  }, [waiting, refreshCodex])

  // 계획 미리보기(무료) — 엔진 기본값을 알기 위해 항상, 체크박스·엔진이 바뀌면 다시
  useEffect(() => {
    if (!api || !waiting) return
    let live = true
    api.spendPreview(req.requestId, includeNeighbors, engine).then((p) => live && setPreview(p)).catch(() => live && setPreview(null))
    return () => {
      live = false
    }
  }, [includeNeighbors, req.requestId, api, waiting, engine])
  const curEngine = engine ?? preview?.engine ?? 'higgsfield'
  // 진행 중·끝난 요청은 작업 목록을 보여준다
  useEffect(() => {
    if (!api || waiting) return
    void api.jobs(req.requestId).then(setJobs)
  }, [api, req.requestId, req.progress?.done, req.progress?.failed, req.status, waiting])

  const title = `${label[req.kind] ?? req.kind} ${req.count}장 ${req.parentRequestId ? '추가 생성 (파일럿 뒤 나머지)' : '생성'}`
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'unknown')
  return (
    <div className={`rounded-lg border p-3 ${req.status === 'failed' ? 'border-red-900/60 bg-red-950/30' : 'border-line bg-panel-2'}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
          <FileImage size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{title}</div>
          {req.progress && (
            <div className="text-[11px] text-muted">
              {req.status === 'done' ? '완료' : req.status === 'failed' ? '실패' : '생성 중'} · {req.progress.done}/{req.progress.total}
              {req.progress.failed ? ` · 실패 ${req.progress.failed}` : ''}
            </div>
          )}
        </div>
        {active && req.progress && (
          <div className="h-1.5 w-16 overflow-hidden rounded bg-line">
            <div className="h-full bg-accent" style={{ width: `${(100 * (req.progress.done + req.progress.failed)) / Math.max(1, req.progress.total)}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        {req.shots?.length ? `대상: ${req.shots.slice(0, 6).join(', ')}${req.shots.length > 6 ? ` 외 ${req.shots.length - 6}` : ''}` : req.seq ? `${req.seq} 전체` : '에셋 시트·뷰'}
      </p>
      {req.error && <p className="mt-1 text-[11.5px] text-red-300">{req.error}</p>}
      {waiting && (
        <div className="mt-2 flex items-center gap-1 text-[11.5px]" data-testid="engine-switch">
          <span className="mr-1 text-muted">엔진</span>
          {(
            [
              ['higgsfield', 'Higgsfield'],
              ['codex', 'GPT · Codex'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              data-engine={k}
              disabled={k === 'codex' && codexReady === false && curEngine !== 'codex'}
              onClick={() => setEngine(k)}
              title={k === 'codex' ? (codexReady === false ? '설정 › 계정에서 Codex 에 로그인하면 쓸 수 있습니다' : '로그인한 Codex(ChatGPT)의 GPT 이미지 — Higgsfield 크레딧을 쓰지 않습니다') : 'Higgsfield 모델 (크레딧)'}
              className={`rounded-md border px-2 py-0.5 disabled:opacity-40 ${curEngine === k ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {waiting && codexReady === false && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]" data-testid="codex-login-row">
          <span className={curEngine === 'codex' ? 'text-warn' : 'text-muted'}>GPT 로 만들려면 Codex(ChatGPT 계정) 로그인이 필요합니다</span>
          <CodexLogin onDone={refreshCodex} />
        </div>
      )}
      {waiting && regen && (
        <label className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
          <input type="checkbox" checked={includeNeighbors} onChange={(e) => setIncludeNeighbors(e.target.checked)} /> 앞뒤 컷 포함
        </label>
      )}
      {waiting && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1.5 text-[11px] text-muted underline-offset-2 hover:underline">
          {open ? '접기' : '모델·프롬프트 보기'}
        </button>
      )}
      {waiting && open && preview && (
        <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded border border-line bg-bg p-2 text-[11px]">
          {preview.notes.map((n, i) => (
            <div key={i} className="text-warn">
              {n}
            </div>
          ))}
          {preview.items.map((it, i) => (
            <details key={i}>
              <summary className="cursor-pointer font-mono">
                {it.target} · {it.model}
                {it.refs.length ? ` · ref ${it.refs.length}` : ''}
                {it.lint.length ? <span className="ml-1 text-warn">⚠ {it.lint.length}</span> : null}
              </summary>
              <pre className="mt-1 whitespace-pre-wrap text-[10.5px] text-muted">{it.prompt}</pre>
              {it.refs.length > 0 && <div className="text-muted">레퍼런스: {it.refs.join(', ')}</div>}
              {it.lint.map((w, k) => (
                <div key={k} className="text-warn">
                  ⚠ {w}
                </div>
              ))}
            </details>
          ))}
        </div>
      )}
      {!waiting && jobs.length > 0 && (
        <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${j.status === 'done' ? 'bg-emerald-400' : j.status === 'failed' || j.status === 'unknown' ? 'bg-red-400' : 'animate-pulse bg-accent'}`} />
              <span className="font-mono">{j.target}</span>
              {j.model === 'codex_image' && <span className="shrink-0 rounded bg-accent-soft px-1 text-[9.5px] text-accent">GPT</span>}
              <span className="truncate text-muted">{j.status === 'done' ? j.outFile?.split('/').pop() : j.error ?? j.status}</span>
              {(j.status === 'failed' || j.status === 'unknown') && api && (
                <button onClick={() => void api.jobResubmit(j.id).then(() => api.jobs(req.requestId).then(setJobs))} className="ml-auto shrink-0 rounded border border-line px-1 text-[10px] text-muted hover:text-ink">
                  다시
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {waiting && (
        <div className="mt-3 flex gap-2">
          <button disabled={curEngine === 'codex' && codexReady === false} onClick={() => onDecide('approved', curEngine)} className="flex items-center gap-1 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110 disabled:opacity-40">
            <Check size={13} /> 승인
          </button>
          {req.count > 1 && (
            <button disabled={curEngine === 'codex' && codexReady === false} onClick={() => onDecide('pilot', curEngine)} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel">
              1장만 먼저
            </button>
          )}
          <button onClick={() => onDecide('rejected')} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted hover:bg-panel">
            거절
          </button>
        </div>
      )}
    </div>
  )
}
