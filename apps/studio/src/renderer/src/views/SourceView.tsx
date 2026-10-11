import { useMemo, useRef, useState } from 'react'
import { FileText, Upload, Film, CornerLeftUp } from 'lucide-react'
import { buildImportPicks, canMerge, duplicateSeqs, type SceneRowPick } from '@conti/domain'
import VideoImport from '../components/VideoImport'
import type { ImportPreview } from '../../../shared/ipc'
import { useProject } from '../state/project'

export default function SourceView() {
  const { sequences, refresh, setNav, setSeq } = useProject()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
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
      setPreview(p)
      const init: typeof picks = {}
      for (const s of p.scenes) init[s.index] = { on: true, merge: false, seq: s.suggestedSeq, ep: 'EP01' }
      lastClicked.current = null
      setPicks(init)
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const order = useMemo(() => preview?.scenes.map((s) => s.index) ?? [], [preview])
  // 체크 = 가져오기, 해제 = 제외. 합치기는 행의 "앞 씬에 합치기" 토글로만.
  const list = useMemo(() => buildImportPicks(order, picks), [order, picks])
  const mergedCount = list.reduce((n, p) => n + p.mergeFollowing.length, 0)
  const dups = duplicateSeqs(list)
  const checkable = order.filter((i) => !picks[i]?.merge)
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
      next[i] = p.merge ? p : { ...p, on: fn(p) }
    }
    setPicks(normalize(next))
  }

  function toggleRow(index: number, on: boolean, shift: boolean) {
    const next = { ...picks }
    const from = shift && lastClicked.current !== null ? order.indexOf(lastClicked.current) : -1
    const to = order.indexOf(index)
    const range = from >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [index]
    for (const i of range) if (!next[i].merge) next[i] = { ...next[i], on }
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
      const made = await window.conti.api.screenplay.commit(preview.sourceId, list)
      await refresh()
      setPreview(null)
      if (made[0]) {
        setSeq(made[0].seq)
        setNav('Shots')
      }
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
            </div>
          </div>
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
                  const merged = !!p?.merge
                  const included = !merged && !!p?.on
                  const mergeOk = merged || canMerge(order, picks, s.index)
                  return (
                    <tr key={s.index} data-row={s.index} className={`border-t border-line/60 hover:bg-panel-2 ${merged ? 'bg-accent/5' : ''}`}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          disabled={merged}
                          checked={included}
                          onChange={(e) => toggleRow(s.index, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.seq ?? ''}
                          disabled={merged}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, seq: e.target.value.toUpperCase() } })}
                          className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent disabled:opacity-30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.ep ?? ''}
                          disabled={merged}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, ep: e.target.value.toUpperCase() } })}
                          className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent disabled:opacity-30"
                        />
                      </td>
                      <td className={`px-2 py-1.5 ${included || merged ? '' : 'text-muted line-through decoration-muted/60'}`}>
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
