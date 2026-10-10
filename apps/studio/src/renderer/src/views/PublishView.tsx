import { useCallback, useEffect, useState } from 'react'
import { Send, Copy, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Sparkles, Ban, Check, Link2Off, Settings } from 'lucide-react'
import { useProject } from '../state/project'
import type { FeedbackItem, FeedbackState, PublishProgress, PublishRecord, PublishSettingsView } from '../../../shared/publish-ipc'

const STATUSES = ['컨펌용', '작업 중', '최종']
const STATE_LABEL: Record<FeedbackState, string> = { open: '열림', applied: '반영함', declined: '반영 안 함' }
const fmtTc = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

/** 게시 — 사내 뷰어 서버로 올리고(바뀐 파일만) 링크를 공유, 리뷰 코멘트를 가져와 반영한다. */
export default function PublishView({ onGoShot, onOpenSettings }: { onGoShot: (no: string) => void; onOpenSettings: () => void }) {
  const { seq, sequences } = useProject()
  const [settings, setSettings] = useState<PublishSettingsView | null>(null)
  const [status, setStatus] = useState(STATUSES[0])
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<PublishProgress | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null)
  const [history, setHistory] = useState<PublishRecord[]>([])
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [filter, setFilter] = useState<FeedbackState | 'all'>('open')
  const [pulling, setPulling] = useState(false)
  const seqObj = sequences.find((s) => s.seq === seq)

  const loadHistory = useCallback(async (refresh = false) => {
    if (seq) setHistory(await window.conti.publish.history(seq, refresh))
  }, [seq])
  const loadFeedback = useCallback(async () => {
    if (seq) setItems(await window.conti.publish.feedback({ seq, state: 'all' }))
  }, [seq])

  useEffect(() => {
    void window.conti.publish.settings().then(setSettings)
    void loadHistory(true)
    void loadFeedback()
    const off1 = window.conti.onPublishProgress(setProg)
    const off2 = window.conti.onFeedbackChange(() => {
      void loadFeedback()
      void loadHistory(true)
    })
    return () => {
      off1()
      off2()
    }
  }, [loadHistory, loadFeedback])

  async function publish() {
    if (!seq) return
    setBusy(true)
    setMsg(null)
    setProg(null)
    try {
      const r = await window.conti.publish.publish(seq, { status })
      setMsg({ ok: true, text: `${r.label} 게시 — 파일 ${r.files}개 중 ${(r.uploaded / 1e6).toFixed(1)}MB 새로 올림 (${((r.bytes - r.uploaded) / 1e6).toFixed(1)}MB 는 서버에 이미 있음)`, url: r.url })
      void navigator.clipboard?.writeText(r.url).catch(() => {})
      await loadHistory(true)
      await loadFeedback()
    } catch (e) {
      setMsg({ ok: false, text: clean(e) })
    } finally {
      setBusy(false)
    }
  }

  async function pull() {
    setPulling(true)
    try {
      const r = await window.conti.publish.pull()
      if (r.error) setMsg({ ok: false, text: r.error })
      await loadFeedback()
      await loadHistory(true)
    } finally {
      setPulling(false)
    }
  }

  async function setState(it: FeedbackItem, state: FeedbackState) {
    let note: string | undefined
    if (state === 'declined') {
      note = window.prompt('반영하지 않는 이유 (리뷰어에게 보입니다)') ?? undefined
      if (!note) return
    }
    try {
      await window.conti.publish.updateFeedback(it.commentId, state, note)
      await loadFeedback()
    } catch (e) {
      setMsg({ ok: false, text: clean(e) })
    }
  }

  const configured = !!settings?.url && settings.hasToken
  const shown = items.filter((i) => i.kind !== 'verdict' && (filter === 'all' || i.state === filter))
  const verdicts = items.filter((i) => i.kind === 'verdict')
  const openCount = items.filter((i) => i.kind !== 'verdict' && i.state === 'open').length
  const pct = prog?.total ? Math.round(((prog.done ?? 0) / prog.total) * 100) : null

  if (settings && !configured)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-dashed border-line p-8 text-center">
          <div className="text-[14px] font-medium">게시 서버가 설정되지 않았습니다</div>
          <div className="mt-1 text-[12px] text-muted">사내 뷰어 서버 주소와 팀 게시 토큰을 넣으면, 시트·PDF·영상을 올려 링크로 공유하고 리뷰 코멘트를 받아올 수 있습니다.</div>
          <button onClick={onOpenSettings} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white">
            <Settings size={13} /> 설정 › 게시 서버
          </button>
        </div>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3 pt-0">
      <div className="flex min-h-0 w-[420px] shrink-0 flex-col gap-3">
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="text-[14px] font-semibold">게시 — {seq ?? ''}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {seqObj?.headingKo} · 시트 PNG·PDF·컷 이미지{seqObj?.source.kind === 'video' ? '·원본 영상' : ''}을 사내 뷰어에 올립니다. 바뀌지 않은 파일은 다시 올리지 않습니다.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-line bg-bg px-2 py-1 text-[12.5px] outline-none">
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button disabled={busy || !seq} onClick={() => void publish()} className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 게시
            </button>
          </div>
          {busy && prog && (
            <div className="mt-3 text-[11.5px] text-muted">
              {prog.stage === 'render' ? prog.message : prog.stage === 'upload' ? `올리는 중 ${prog.index}/${prog.count} · ${prog.file}` : prog.stage === 'create' ? '링크 만드는 중' : '준비 중'}
              {pct != null && (
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-line">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
          {msg && (
            <div className={`mt-3 rounded-md border px-3 py-2 text-[12px] ${msg.ok ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200' : 'border-red-900/60 bg-red-950/40 text-red-300'}`}>
              <div className="flex items-start gap-1.5">
                {msg.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />} {msg.text}
              </div>
              {msg.url && (
                <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px]">
                  <span className="truncate">{msg.url}</span>
                  <span className="shrink-0 text-muted">복사됨</span>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
          <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[12.5px] font-medium">
            게시 기록
            <button onClick={() => void loadHistory(true)} className="rounded p-1 text-muted hover:text-ink" title="새로고침">
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-[12px]">
            {!history.length && <div className="text-muted">아직 게시하지 않았습니다.</div>}
            {history.map((h) => (
              <div key={h.id} className={`mb-1.5 rounded-md border border-line/70 p-2 ${h.revoked ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{h.label}</span>
                  <span className="text-muted">{h.status}</span>
                  {h.comments.open > 0 && <span className="rounded bg-warn px-1.5 text-[10.5px] font-semibold text-black">코멘트 {h.comments.open}</span>}
                  <span className="ml-auto text-[11px] text-muted">{new Date(h.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                  {h.revoked ? <span>링크 닫힘</span> : <span className="truncate font-mono">{h.url}</span>}
                  <span className="ml-auto shrink-0">{h.archive.status === 'done' ? 'Dropbox 보관됨' : h.archive.status === 'error' ? 'Dropbox 실패' : h.archive.status === 'skipped' ? '' : 'Dropbox 보관 중'}</span>
                </div>
                {!h.revoked && (
                  <div className="mt-1 flex gap-1">
                    <button onClick={() => void navigator.clipboard?.writeText(h.url)} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] hover:bg-panel-2">
                      <Copy size={11} /> 링크 복사
                    </button>
                    <a href={h.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] hover:bg-panel-2">
                      <ExternalLink size={11} /> 열기
                    </a>
                    <button onClick={() => window.confirm(`${h.label} 링크를 닫을까요? 받은 사람은 더 이상 볼 수 없습니다.`) && void window.conti.publish.revoke(h.id).then(() => loadHistory(true))} className="ml-auto flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink">
                      <Link2Off size={11} /> 닫기
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-panel">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-[12.5px]">
          <span className="font-medium">리뷰 코멘트</span>
          {openCount > 0 && <span className="rounded bg-warn px-1.5 text-[10.5px] font-semibold text-black">열림 {openCount}</span>}
          {verdicts.slice(-3).map((v) => (
            <span key={v.commentId} className={`rounded px-1.5 text-[10.5px] ${v.verdict === 'approve' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/40 text-amber-300'}`}>
              {v.label} {v.author} {v.verdict === 'approve' ? '승인' : '수정 요청'}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1 text-[11.5px]">
            {(['open', 'applied', 'declined', 'all'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded px-1.5 py-0.5 ${filter === f ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
                {f === 'all' ? '전체' : STATE_LABEL[f]}
              </button>
            ))}
            <button onClick={() => void pull()} className="ml-1 rounded p-1 text-muted hover:text-ink" title="지금 가져오기 (자동: 1분마다)">
              <RefreshCw size={12} className={pulling ? 'animate-spin' : ''} />
            </button>
            <button
              disabled={!openCount}
              onClick={() => seq && void window.conti.publish.applyWithAi(seq).catch((e) => setMsg({ ok: false, text: clean(e) }))}
              className="ml-1 flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-40"
              title="열린 코멘트를 AI 가 변경안으로 정리 → 확인 후 반영 (채팅 패널)"
            >
              <Sparkles size={12} /> AI로 반영
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!shown.length && <div className="text-[12px] text-muted">{filter === 'open' ? '열린 코멘트가 없습니다. 게시 링크를 보내면 리뷰어가 컷·영역·영상 시각에 코멘트를 남길 수 있습니다.' : '없습니다.'}</div>}
          {shown.map((it) => (
            <div key={it.commentId} className={`mb-2 rounded-md border p-2.5 text-[12.5px] ${it.state === 'open' ? 'border-line bg-panel-2/60' : 'border-line/50 opacity-70'}`}>
              <div className="flex items-center gap-2 text-[11.5px]">
                <button disabled={!it.shotNo} onClick={() => it.shotNo && onGoShot(it.shotNo)} className="font-mono font-semibold text-accent disabled:text-muted">
                  {it.shotNo ?? '전체'}
                </button>
                <span className="text-muted">{it.kind === 'region' ? `영역 (${it.region?.page}쪽)` : it.kind === 'time' && it.tMs != null ? `영상 ${fmtTc(it.tMs)}${it.frame != null ? ` · ${it.frame}f` : ''}` : it.kind === 'panel' ? '컷' : '전체'}</span>
                <span className="rounded border border-line px-1 text-[10.5px] text-muted">{it.label}</span>
                <span className="ml-auto text-muted">
                  {it.author} · {new Date(it.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="mt-1 whitespace-pre-wrap">{it.text}</div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <span className={it.state === 'applied' ? 'text-emerald-400' : it.state === 'declined' ? 'text-muted' : 'text-warn'}>
                  {it.resolvedIn ? `${it.resolvedIn}에서 반영됨` : STATE_LABEL[it.state]}
                  {it.state === 'applied' && it.pendingSync ? ' — 다음 게시 때 리뷰어에게 표시' : ''}
                  {it.note ? ` · ${it.note}` : ''}
                </span>
                <span className="ml-auto flex gap-1">
                  {it.state !== 'applied' && (
                    <button onClick={() => void setState(it, 'applied')} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 hover:bg-panel-2">
                      <Check size={11} /> 반영함
                    </button>
                  )}
                  {it.state !== 'declined' && (
                    <button onClick={() => void setState(it, 'declined')} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink">
                      <Ban size={11} /> 반영 안 함
                    </button>
                  )}
                  {it.state !== 'open' && !it.resolvedIn && (
                    <button onClick={() => void setState(it, 'open')} className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink">
                      되돌리기
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
