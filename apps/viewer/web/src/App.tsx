import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BundlePage, Comment, ReviewPayload } from '../../src/shared/types'
import { api, fmtTc, saveName, savedName, token } from './api'

type Tab = 'sheet' | 'cuts' | 'video'
interface Draft {
  kind: Comment['kind']
  shotNo?: string
  panelIndex?: number
  page?: number
  x?: number
  y?: number
  w?: number
  h?: number
  tMs?: number
  label: string
}

/** 리뷰어 화면 — 링크만 있으면 열린다(사내망). 패널 클릭·영역 끌기·영상 시각에 코멘트, 승인/수정 요청. */
export default function App() {
  const t = token()
  const [data, setData] = useState<ReviewPayload | null>(null)
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null)
  const [name, setName] = useState(savedName())
  const [tab, setTab] = useState<Tab>('sheet')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [focus, setFocus] = useState<string | null>(null) // 선택한 샷
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const load = useCallback(async () => {
    if (!t) return
    try {
      setData(await api.load(t))
    } catch (e) {
      setErr({ status: (e as { status?: number }).status, message: (e as Error).message })
    }
  }, [t])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000) // 다른 사람 코멘트·반영 표시
    return () => clearInterval(id)
  }, [load])

  if (!t) return <Center>링크 주소가 올바르지 않습니다.</Center>
  if (err) return <Center>{err.status === 410 ? '이 링크는 닫혔거나 기간이 끝났습니다. 게시자에게 새 링크를 받으세요.' : err.message}</Center>
  if (!data) return <Center>불러오는 중…</Center>
  if (!name) return <NameGate onDone={(n) => (saveName(n), setName(n))} />

  const m = data.manifest
  const latest = data.versions.find((v) => !v.current && v.createdAt > data.publication.createdAt)
  const comments = data.comments.filter((c) => c.kind !== 'verdict')
  const verdicts = data.comments.filter((c) => c.kind === 'verdict' && c.label === data.publication.label)
  const shown = comments.filter((c) => (filter === 'all' || c.status === 'open') && (!focus || c.shotNo === focus))
  const openBy = (shot: string) => comments.filter((c) => c.shotNo === shot && c.status === 'open').length

  async function submit(body: string) {
    if (!draft || !body.trim()) return
    const { label: _l, ...rest } = draft
    await api.comment(t!, { ...rest, body, author: name })
    setDraft(null)
    await load()
  }

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <b>{m.seq}</b> {m.heading}
          <span className="chip">{data.publication.label}</span>
          <span className="chip muted">{data.publication.status}</span>
        </div>
        <div className="meta">
          {m.project.title} · {m.ep} · {new Date(data.publication.createdAt).toLocaleString('ko-KR')}
        </div>
        <nav className="tabs">
          <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
            시트 {m.pages.length}쪽
          </button>
          <button className={tab === 'cuts' ? 'on' : ''} onClick={() => setTab('cuts')}>
            컷 {new Set(m.panels.map((p) => p.shotNo)).size}
          </button>
          {m.video && (
            <button className={tab === 'video' ? 'on' : ''} onClick={() => setTab('video')}>
              영상
            </button>
          )}
        </nav>
        <div className="actions">
          {m.pdf && (
            <a className="btn" href={api.file(t, m.pdf)} target="_blank" rel="noreferrer">
              PDF
            </a>
          )}
          <button className="btn" onClick={() => setDraft({ kind: 'general', label: '전체' })}>
            전체 코멘트
          </button>
          <button className="btn ok" onClick={() => void api.verdict(t, 'approve', name).then(load)}>
            승인
          </button>
          <button className="btn warn" onClick={() => void api.verdict(t, 'changes', name).then(load)}>
            수정 요청
          </button>
        </div>
      </header>
      {latest && (
        <div className="banner">
          더 새로운 게시본({data.versions.find((v) => v.createdAt === Math.max(...data.versions.map((x) => x.createdAt)))?.label})이 있습니다.{' '}
          <a href={`/r/${data.versions.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).token}`}>최신본 보기</a>
        </div>
      )}
      <div className="body">
        <main className="stage">
          {tab === 'sheet' && <SheetView t={t} pages={m.pages} comments={comments} label={data.publication.label} focus={focus} onPanel={(p, pg) => (setFocus(p.shotNo), setDraft({ kind: 'panel', shotNo: p.shotNo, panelIndex: p.panelIndex, page: pg, label: p.label }))} onRegion={(d) => setDraft(d)} />}
          {tab === 'cuts' && (
            <div className="cuts">
              {m.panels.map((p) => (
                <button key={`${p.shotNo}-${p.panelIndex}`} className={`cut ${focus === p.shotNo ? 'sel' : ''}`} onClick={() => (setFocus(p.shotNo), setDraft({ kind: 'panel', shotNo: p.shotNo, panelIndex: p.panelIndex, label: p.label }))}>
                  <div className="cut-img">{p.file ? <img src={api.file(t, p.file)} alt={p.label} loading="lazy" /> : <span>콘티 없음</span>}</div>
                  <div className="cut-row">
                    <b>{p.label}</b>
                    <span className="muted">{[p.size, p.cameraMove, p.duration].filter(Boolean).join(' · ')}</span>
                    {openBy(p.shotNo) > 0 && <span className="badge">{openBy(p.shotNo)}</span>}
                  </div>
                  <div className="cut-text">{p.dialogue?.length ? p.dialogue.map((d) => `${d.speaker ? `${d.speaker}: ` : ''}${d.text}`).join(' / ') : p.action}</div>
                </button>
              ))}
            </div>
          )}
          {tab === 'video' && m.video && <VideoView t={t} file={m.video.file} edl={m.edl ?? []} fps={m.video.fps} comments={comments} onComment={(tMs, shotNo) => (setFocus(shotNo ?? null), setDraft({ kind: 'time', tMs, label: `${fmtTc(tMs)}${shotNo ? ` · ${shotNo}` : ''}` }))} />}
        </main>
        <aside className="side">
          <div className="side-head">
            <b>코멘트</b>
            {focus && (
              <button className="link" onClick={() => setFocus(null)}>
                {focus} ✕
              </button>
            )}
            <span className="grow" />
            <button className={`link ${filter === 'open' ? 'on' : ''}`} onClick={() => setFilter('open')}>
              열림
            </button>
            <button className={`link ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
              전체
            </button>
          </div>
          {draft && <Composer draft={draft} onCancel={() => setDraft(null)} onSubmit={submit} />}
          {verdicts.length > 0 && (
            <div className="verdicts">
              {verdicts.map((v) => (
                <div key={v.id} className={`verdict ${v.verdict}`}>
                  {v.author} · {v.verdict === 'approve' ? '승인' : '수정 요청'}
                </div>
              ))}
            </div>
          )}
          <div className="list">
            {shown.length === 0 && <div className="muted pad">{filter === 'open' ? '열린 코멘트가 없습니다.' : '코멘트가 없습니다.'} 시트의 칸을 누르거나 끌어서 영역을 고르세요.</div>}
            {shown
              .slice()
              .sort((a, b) => (a.shotNo ?? '9999').localeCompare(b.shotNo ?? '9999') || a.createdAt - b.createdAt)
              .map((c) => (
                <div key={c.id} className={`c ${c.status}`} onClick={() => c.shotNo && setFocus(c.shotNo)}>
                  <div className="c-head">
                    <b>{c.shotNo ?? '전체'}</b>
                    <span className="muted">{c.kind === 'region' ? '영역' : c.kind === 'time' && c.tMs != null ? fmtTc(c.tMs) : c.kind === 'panel' ? '컷' : ''}</span>
                    {c.label !== data.publication.label && <span className="chip muted">{c.label}</span>}
                    <span className="grow" />
                    <span className="muted">{c.author}</span>
                  </div>
                  <div className="c-body">{c.body}</div>
                  <div className="c-foot">
                    {c.resolvedIn ? <span className="done">{c.resolvedIn}에서 반영됨{c.resolvedNote ? ` — ${c.resolvedNote}` : ''}</span> : c.status === 'declined' ? <span className="muted">반영 안 함{c.resolvedNote ? ` — ${c.resolvedNote}` : ''}</span> : <span className="muted">{new Date(c.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                    <span className="grow" />
                    <button
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation()
                        void api.setStatus(t, c.id, c.status === 'open' ? 'resolved' : 'open').then(load)
                      }}
                    >
                      {c.status === 'open' ? '해결' : '다시 열기'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function SheetView({ t, pages, comments, label, focus, onPanel, onRegion }: { t: string; pages: BundlePage[]; comments: Comment[]; label: string; focus: string | null; onPanel: (p: BundlePage['panels'][number], page: number) => void; onRegion: (d: Draft) => void }) {
  return (
    <div className="pages">
      {pages.map((pg) => (
        <SheetPage key={pg.n} t={t} pg={pg} comments={comments.filter((c) => c.page === pg.n && c.label === label)} focus={focus} onPanel={onPanel} onRegion={onRegion} />
      ))}
    </div>
  )
}

function SheetPage({ t, pg, comments, focus, onPanel, onRegion }: { t: string; pg: BundlePage; comments: Comment[]; focus: string | null; onPanel: (p: BundlePage['panels'][number], page: number) => void; onRegion: (d: Draft) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // 누른 위치는 ref 에 — 빠른 누름·뗌(렌더 전에 끝남)도 놓치지 않게. state 는 끄는 동안 그리기용
  const start = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  return (
    <div
      className="page"
      ref={ref}
      style={{ aspectRatio: `${pg.w} / ${pg.h}` }}
      onPointerDown={(e) => {
        const p = at(e)
        start.current = p
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
        try {
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
        } catch {
          /* 합성 이벤트 등 */
        }
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        const p = at(e)
        setDrag({ x0: s.x, y0: s.y, x1: p.x, y1: p.y })
      }}
      onPointerUp={(e) => {
        const s = start.current
        start.current = null
        setDrag(null)
        if (!s) return
        const p = at(e)
        const x = Math.min(s.x, p.x)
        const y = Math.min(s.y, p.y)
        const w = Math.abs(p.x - s.x)
        const h = Math.abs(p.y - s.y)
        if (w > 0.02 && h > 0.02) onRegion({ kind: 'region', page: pg.n, x, y, w, h, label: `${pg.n}쪽 영역` })
        else {
          const hit = pg.panels.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
          if (hit) onPanel(hit, pg.n)
        }
      }}
    >
      <img src={api.file(t, pg.file)} alt={`${pg.n}쪽`} draggable={false} />
      {pg.panels.map((r) => (
        <div key={`${r.shotNo}-${r.panelIndex}`} className={`hot ${focus === r.shotNo ? 'sel' : ''}`} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
      ))}
      {comments
        .filter((c) => c.kind === 'region' && c.x != null)
        .map((c) => (
          <div key={c.id} className={`region ${c.status}`} title={`${c.author}: ${c.body}`} style={{ left: `${c.x! * 100}%`, top: `${c.y! * 100}%`, width: `${(c.w ?? 0) * 100}%`, height: `${(c.h ?? 0) * 100}%` }} />
        ))}
      {drag && (Math.abs(drag.x1 - drag.x0) > 0.005 || Math.abs(drag.y1 - drag.y0) > 0.005) && <div className="region draft" style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }} />}
    </div>
  )
}

function VideoView({ t, file, edl, fps, comments, onComment }: { t: string; file: string; edl: Array<{ shotNo: string; inMs: number; outMs: number }>; fps: number; comments: Comment[]; onComment: (tMs: number, shotNo?: string) => void }) {
  const v = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const dur = edl.length ? edl[edl.length - 1].outMs : 1
  const shot = edl.find((e) => now >= e.inMs && now < e.outMs)
  const marks = useMemo(() => comments.filter((c) => c.tMs != null), [comments])
  return (
    <div className="video">
      <video ref={v} src={api.file(t, file)} controls playsInline onTimeUpdate={(e) => setNow(Math.round(e.currentTarget.currentTime * 1000))} />
      <div className="vbar">
        <span className="mono">
          {fmtTc(now)} · {Math.round((now / 1000) * fps)}f {shot ? `· ${shot.shotNo}` : ''}
        </span>
        <button
          className="btn"
          onClick={() => {
            v.current?.pause()
            onComment(now, shot?.shotNo)
          }}
        >
          이 시각에 코멘트
        </button>
      </div>
      <div className="strip">
        {edl.map((e) => (
          <button key={e.shotNo} className={`seg ${shot?.shotNo === e.shotNo ? 'on' : ''}`} style={{ left: `${(e.inMs / dur) * 100}%`, width: `${((e.outMs - e.inMs) / dur) * 100}%` }} onClick={() => v.current && (v.current.currentTime = e.inMs / 1000)} title={e.shotNo} />
        ))}
        {marks.map((c) => (
          <span key={c.id} className={`mark ${c.status}`} style={{ left: `${(c.tMs! / dur) * 100}%` }} title={`${c.author}: ${c.body}`} />
        ))}
      </div>
    </div>
  )
}

function Composer({ draft, onCancel, onSubmit }: { draft: Draft; onCancel: () => void; onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="composer">
      <div className="muted">{draft.label}에 코멘트</div>
      <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="무엇을 바꾸면 좋을지 적어 주세요" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void onSubmit(body)} />
      <div className="row">
        <button className="link" onClick={onCancel}>
          취소
        </button>
        <button className="btn ok" disabled={!body.trim() || busy} onClick={() => (setBusy(true), void onSubmit(body).finally(() => setBusy(false)))}>
          남기기
        </button>
      </div>
    </div>
  )
}

function NameGate({ onDone }: { onDone: (n: string) => void }) {
  const [n, setN] = useState('')
  return (
    <Center>
      <div className="gate">
        <b>NYX 리뷰</b>
        <p className="muted">코멘트에 표시할 이름을 적어 주세요.</p>
        <input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && n.trim() && onDone(n.trim())} placeholder="이름" maxLength={40} />
        <button className="btn ok" disabled={!n.trim()} onClick={() => onDone(n.trim())}>
          시작
        </button>
      </div>
    </Center>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="center">{children}</div>
}
