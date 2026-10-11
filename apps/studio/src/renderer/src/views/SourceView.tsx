import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Upload, Film, CornerLeftUp, CheckCircle2, X, Loader2 } from 'lucide-react'
import { buildImportPicks, canMerge, duplicateSeqs, type SceneRowPick } from '@conti/domain'
import VideoImport from '../components/VideoImport'
import type { ImportPreview, ImportSourceInfo } from '../../../shared/ipc'
import { useProject } from '../state/project'

export default function SourceView() {
  const { root, sequences, refresh, setNav, setSeq } = useProject()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [sources, setSources] = useState<ImportSourceInfo[]>([])
  const [madeNow, setMadeNow] = useState<string[]>([])
  const [opening, setOpening] = useState(false)
  // 마지막으로 펼친 시나리오는 프로젝트별로 기억해 Sources 로 돌아오면 그대로 연다 (실패해도 무관)
  const memKey = `nyx_source_${root ?? ''}`
  const remember = (rel: string | null) => {
    try {
      if (rel) sessionStorage.setItem(memKey, rel)
      else sessionStorage.removeItem(memKey)
    } catch {
      /* 저장 안 돼도 그만 */
    }
  }
  const [picks, setPicks] = useState<Record<number, SceneRowPick>>({})
  const lastClicked = useRef<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [videoOpen, setVideoOpen] = useState(() => new URLSearchParams(window.location.search).get('video') === '1')

  async function pick() {
    setErr(null)
    setBusy(true)
    try {
      const p = await window.conti.api.screenplay.importDialog()
      if (!p) return
      show(p)
      setMadeNow([])
      void loadSources()
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  /** 표를 펼친다. 이미 만든 씬은 고를 수 없다(다시 만들지 않음) */
  function show(p: ImportPreview, keep?: Record<number, SceneRowPick>) {
    setPreview(p)
    const init: Record<number, SceneRowPick> = {}
    // 처음 가져오면 전부 체크, 이미 만든 씬이 있는 파일을 다시 펼치면 아무것도 체크하지 않는다 (남은 씬을 골라 담기)
    const fresh = !p.scenes.some((x) => x.madeSeq)
    for (const s of p.scenes) {
      const prev = keep?.[s.index]
      init[s.index] = s.madeSeq ? { on: false, merge: false, seq: s.madeSeq, ep: prev?.ep ?? 'EP01' } : { on: prev ? prev.on : fresh, merge: false, seq: prev?.seq ?? s.suggestedSeq, ep: prev?.ep ?? 'EP01' }
    }
    lastClicked.current = null
    setPicks(init)
    remember(p.sourceRel)
  }

  async function loadSources() {
    try {
      setSources(await window.conti.api.screenplay.sources())
    } catch {
      setSources([])
    }
  }

  async function openSource(rel: string) {
    setErr(null)
    setOpening(true)
    try {
      show(await window.conti.api.screenplay.open(rel))
      setMadeNow([])
    } catch (e) {
      remember(null)
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setOpening(false)
    }
  }

  // 들어올 때: 가져온 시나리오 목록 + 마지막에 펼친 파일 다시 열기
  useEffect(() => {
    void loadSources()
    let rel: string | null = null
    try {
      rel = sessionStorage.getItem(memKey)
    } catch {
      rel = null
    }
    if (rel) void openSource(rel)
  }, [root]) // eslint-disable-line react-hooks/exhaustive-deps

  const made = (i: number) => !!preview?.scenes.find((x) => x.index === i)?.madeSeq
  const madeTotal = new Set(preview?.scenes.map((x) => x.madeSeq).filter(Boolean)).size
  const order = useMemo(() => preview?.scenes.map((s) => s.index) ?? [], [preview])
  // 체크 = 가져오기, 해제 = 제외. 합치기는 행의 "앞 씬에 합치기" 토글로만.
  const list = useMemo(() => buildImportPicks(order, picks), [order, picks])
  const mergedCount = list.reduce((n, p) => n + p.mergeFollowing.length, 0)
  const dups = duplicateSeqs(list)
  const checkable = order.filter((i) => !picks[i]?.merge && !made(i))
  const checkedCount = checkable.filter((i) => picks[i]?.on).length
  const allState = checkedCount === 0 ? 'none' : checkedCount === checkable.length ? 'all' : 'some'

  /** 합치기 토글이 더 이상 유효하지 않은 행(앞 씬이 제외됨)은 풀어 준다 */
  function normalize(next: Record<number, SceneRowPick>): Record<number, SceneRowPick> {
    const out = { ...next }
    for (const i of order) if (out[i]?.merge && !canMerge(order, out, i)) out[i] = { ...out[i], merge: false, on: false }
    return out
  }

  function setAll(fn: (p: SceneRowPick) => boolean) {
    const next: Record<number, SceneRowPick> = {}
    for (const i of order) {
      const p = picks[i]
      next[i] = p.merge || made(i) ? p : { ...p, on: fn(p) }
    }
    setPicks(normalize(next))
  }

  function toggleRow(index: number, on: boolean, shift: boolean) {
    const next = { ...picks }
    const from = shift && lastClicked.current !== null ? order.indexOf(lastClicked.current) : -1
    const to = order.indexOf(index)
    const range = from >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [index]
    for (const i of range) if (!next[i].merge && !made(i)) next[i] = { ...next[i], on }
    lastClicked.current = index
    setPicks(normalize(next))
  }

  function toggleMerge(index: number) {
    const p = picks[index]
    setPicks(normalize({ ...picks, [index]: { ...p, merge: !p.merge, on: p.merge ? true : p.on } }))
  }

  /** 합쳐질 대상 시퀀스 이름 (앞쪽으로 올라가며 첫 포함 행) */
  function mergeTarget(index: number): string | undefined {
    for (let k = order.indexOf(index) - 1; k >= 0; k--) {
      const p = picks[order[k]]
      if (!p?.merge) return p?.on ? p.seq : undefined
    }
  }

  async function commit() {
    if (!preview || !list.length) return
    setBusy(true)
    try {
      const created = await window.conti.api.screenplay.commit(preview.sourceId, list)
      await refresh()
      // 표는 닫지 않는다 — 같은 파일을 다시 읽어 방금 만든 씬을 표시하고 나머지는 그대로 고를 수 있게
      show(await window.conti.api.screenplay.open(preview.sourceRel), picks)
      setMadeNow(created.map((q) => q.seq))
      void loadSources()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0">
      <section className="rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold">Sources</div>
            <div className="text-[12px] text-muted">시나리오(PDF / .txt / .md)를 넣으면 씬을 나눠 시퀀스로 만듭니다. 영상 콘티(애니매틱·샷별 클립·롱테이크·대사 음성)는 컷과 대사를 찾아 원본 프레임으로 콘티를 채웁니다.</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              disabled={busy}
              onClick={() => setVideoOpen(true)}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2 disabled:opacity-50"
            >
              <Film size={14} /> 영상 가져오기
            </button>
            <button
              disabled={busy}
              onClick={() => void pick()}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              <Upload size={14} /> 시나리오 가져오기
            </button>
          </div>
        </div>
        {err && <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">{err}</div>}
      </section>

      {videoOpen && !preview && <VideoImport onClose={() => setVideoOpen(false)} />}

      {preview && (
        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              <FileText size={14} className="text-muted" />
              {preview.fileName} · {preview.lineCount}줄 · 씬 {preview.scenes.length}개
              {madeTotal > 0 && <span className="text-emerald-400" data-testid="made-total">· 만든 씬 {madeTotal}개</span>}
            </div>
            <div className="flex items-center gap-3">
              {dups.length > 0 && <span className="text-[11.5px] text-warn">SEQ 중복: {dups.join(', ')}</span>}
              <button
                data-testid="import-commit"
                disabled={busy || list.length === 0 || dups.length > 0}
                onClick={() => void commit()}
                className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
              >
                선택한 씬 {list.length}개 만들기{mergedCount > 0 ? ` (${mergedCount}개 합침)` : ''}
              </button>
              <button
                data-testid="import-close"
                onClick={() => {
                  setPreview(null)
                  setMadeNow([])
                  remember(null)
                }}
                title="표 닫기 (아래 '가져온 시나리오'에서 다시 열 수 있습니다)"
                className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {madeNow.length > 0 && (
            <div data-testid="made-banner" className="flex items-center gap-2 border-b border-emerald-900/50 bg-emerald-950/30 px-4 py-1.5 text-[12px] text-emerald-200">
              <CheckCircle2 size={13} />
              {madeNow[0]}
              {madeNow.length > 1 ? ` 외 ${madeNow.length - 1}개` : ''}를 만들었습니다. 남은 씬도 이어서 고를 수 있어요.
              <button
                onClick={() => {
                  setSeq(madeNow[0])
                  setNav('Shots')
                }}
                className="ml-auto rounded border border-emerald-800 px-2 py-0.5 hover:bg-emerald-900/40"
              >
                Shots 에서 보기
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-[11.5px]">
            <button data-testid="import-all" onClick={() => setAll(() => true)} className="rounded border border-line px-2 py-0.5 hover:bg-panel-2">
              전체 선택
            </button>
            <button data-testid="import-none" onClick={() => setAll(() => false)} className="rounded border border-line px-2 py-0.5 hover:bg-panel-2">
              전체 해제
            </button>
            <button data-testid="import-invert" onClick={() => setAll((p) => !p.on)} className="rounded border border-line px-2 py-0.5 hover:bg-panel-2">
              반전
            </button>
            <span className="ml-1 text-muted" data-testid="import-count">
              {checkedCount} / {checkable.length}개 선택
            </span>
            <span className="ml-auto text-muted">체크한 씬만 만듭니다 · Shift+클릭으로 범위 선택 · 씬이 잘못 나뉜 곳은 행의 ⤴ 로 앞 씬에 합치기</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-panel text-muted">
                <tr className="text-left">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={allState === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = allState === 'some'
                      }}
                      onChange={() => setAll(() => allState !== 'all')}
                    />
                  </th>
                  <th className="w-24 px-2 py-2">SEQ</th>
                  <th className="w-20 px-2 py-2">EP</th>
                  <th className="px-2 py-2">헤딩</th>
                  <th className="px-2 py-2">미리보기</th>
                  <th className="w-20 px-2 py-2 text-right">줄</th>
                  <th className="w-10 px-2 py-2" title="앞 씬에 합치기" />
                </tr>
              </thead>
              <tbody>
                {preview.scenes.map((s) => {
                  const p = picks[s.index]
                  const done = !!s.madeSeq
                  const merged = !done && !!p?.merge
                  const included = !merged && !done && !!p?.on
                  const mergeOk = !done && (merged || canMerge(order, picks, s.index))
                  return (
                    <tr key={s.index} data-row={s.index} data-made={done ? s.madeSeq : undefined} className={`border-t border-line/60 hover:bg-panel-2 ${merged ? 'bg-accent/5' : done ? 'bg-emerald-950/20' : ''}`}>
                      <td className="px-3 py-1.5">
                        {done ? (
                          <button
                            data-testid={`made-${s.index}`}
                            onClick={() => {
                              setSeq(s.madeSeq!)
                              setNav('Shots')
                            }}
                            title={`이미 ${s.madeSeq} 로 만들었습니다 — Shots 에서 열기`}
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        ) : (
                          <input
                            type="checkbox"
                            disabled={merged}
                            checked={included}
                            onChange={(e) => toggleRow(s.index, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.seq ?? ''}
                          disabled={merged || done}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, seq: e.target.value.toUpperCase() } })}
                          className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent disabled:opacity-30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.ep ?? ''}
                          disabled={merged || done}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, ep: e.target.value.toUpperCase() } })}
                          className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent disabled:opacity-30"
                        />
                      </td>
                      <td className={`px-2 py-1.5 ${included || merged || done ? '' : 'text-muted'}`}>
                        {done && <span className="mr-1 rounded bg-emerald-900/50 px-1 text-[10.5px] text-emerald-300">{s.madeSeq} 만들어짐</span>}
                        {merged && <span className="mr-1 text-[10.5px] text-accent">↳ {mergeTarget(s.index)}에 합침</span>}
                        <span className="font-medium">{s.headingRaw}</span>
                        {s.timeOfDay && <span className="ml-2 rounded bg-panel-2 px-1 text-[10.5px] text-muted no-underline">{s.timeOfDay === 'D' ? '낮' : '밤'}</span>}
                      </td>
                      <td className="max-w-[420px] truncate px-2 py-1.5 text-muted">{s.preview}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted">{s.lineCount}줄</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          data-testid={`merge-${s.index}`}
                          disabled={!mergeOk}
                          onClick={() => toggleMerge(s.index)}
                          title={merged ? '합치기 풀기' : mergeOk ? '앞 씬에 합치기 (씬이 잘못 나뉜 경우)' : '바로 앞 씬이 선택돼 있어야 합칠 수 있습니다'}
                          className={`rounded p-0.5 ${merged ? 'bg-accent text-white' : 'text-muted hover:bg-panel-2 hover:text-ink'} disabled:opacity-20`}
                        >
                          <CornerLeftUp size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!preview && opening && (
        <div className="flex items-center gap-2 px-1 text-[12px] text-muted">
          <Loader2 size={13} className="animate-spin" /> 시나리오를 다시 펼치는 중…
        </div>
      )}

      {!preview && !videoOpen && sources.length > 0 && (
        <section className="rounded-lg border border-line bg-panel p-4" data-testid="source-list">
          <div className="mb-2 text-[12.5px] font-medium">가져온 시나리오 {sources.length}개 <span className="ml-1 text-[11.5px] font-normal text-muted">누르면 씬 목록을 다시 펼쳐 남은 씬을 고를 수 있습니다</span></div>
          <ul className="space-y-0.5 text-[12px]">
            {sources.map((src) => (
              <li key={src.rel}>
                <button disabled={opening} onClick={() => void openSource(src.rel)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel-2 disabled:opacity-50">
                  <FileText size={13} className="shrink-0 text-muted" />
                  <span className="truncate">{src.fileName}</span>
                  <span className="ml-auto shrink-0 text-muted">
                    만든 씬 {src.madeCount}
                    {src.sceneCount != null ? ` / ${src.sceneCount}` : ''}개 · {new Date(src.importedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!preview && !videoOpen && (
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-2 text-[12.5px] font-medium">현재 시퀀스 {sequences.length}개</div>
          {sequences.length === 0 ? (
            <div className="text-[12px] text-muted">아직 없습니다. 위에서 시나리오를 가져오세요.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-1 text-[12px]">
              {sequences.map((s) => (
                <li key={s.seq} className="flex justify-between rounded px-2 py-1 hover:bg-panel-2">
                  <span>
                    <span className="font-mono text-accent">{s.seq}</span> <span className="ml-1">{s.headingKo}</span>
                  </span>
                  <span className="text-muted">
                    {s.ep} · 샷 {s.shots.length}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
