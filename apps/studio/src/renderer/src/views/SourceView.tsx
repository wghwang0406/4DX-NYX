import { useState } from 'react'
import { FileText, Upload, Film } from 'lucide-react'
import VideoImport from '../components/VideoImport'
import type { ImportPick, ImportPreview } from '../../../shared/ipc'
import { useProject } from '../state/project'

export default function SourceView() {
  const { sequences, refresh, setNav, setSeq } = useProject()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [picks, setPicks] = useState<Record<number, { on: boolean; seq: string; ep: string }>>({})
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
      for (const s of p.scenes) init[s.index] = { on: true, seq: s.suggestedSeq, ep: 'EP01' }
      setPicks(init)
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!preview) return
    setBusy(true)
    try {
      // 체크 해제된 씬은 바로 앞의 체크된 씬에 합친다 (씬 경계 조정)
      const list: ImportPick[] = []
      for (const sc of preview.scenes) {
        const v = picks[sc.index]
        if (v?.on && /^S\d+/.test(v.seq) && /^EP\d+$/.test(v.ep)) list.push({ index: sc.index, seq: v.seq, ep: v.ep, mergeFollowing: [] })
        else if (list.length) list[list.length - 1].mergeFollowing!.push(sc.index)
      }
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
            <div className="text-[14px] font-semibold">소스</div>
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
            <button
              disabled={busy}
              onClick={() => void commit()}
              className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              선택한 씬 {Object.values(picks).filter((p) => p.on).length}개 만들기
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-panel text-muted">
                <tr className="text-left">
                  <th className="w-8 px-3 py-2" />
                  <th className="w-24 px-2 py-2">SEQ</th>
                  <th className="w-20 px-2 py-2">EP</th>
                  <th className="px-2 py-2">헤딩</th>
                  <th className="px-2 py-2">미리보기</th>
                  <th className="w-24 px-2 py-2 text-right">줄</th>
                </tr>
              </thead>
              <tbody>
                {preview.scenes.map((s) => {
                  const p = picks[s.index]
                  return (
                    <tr key={s.index} className="border-t border-line/60 hover:bg-panel-2">
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={p?.on ?? false} onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, on: e.target.checked } })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.seq ?? ''}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, seq: e.target.value.toUpperCase() } })}
                          className="w-20 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p?.ep ?? ''}
                          onChange={(e) => setPicks({ ...picks, [s.index]: { ...p, ep: e.target.value.toUpperCase() } })}
                          className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11.5px] outline-none focus:border-accent"
                        />
                      </td>
                      <td className={`px-2 py-1.5 ${p?.on ? '' : 'text-muted'}`}>
                        {!p?.on && <span className="mr-1 text-[10.5px]">↳ 앞 씬에 합침</span>}
                        <span className="font-medium">{s.headingRaw}</span>
                        {s.timeOfDay && <span className="ml-2 rounded bg-panel-2 px-1 text-[10.5px] text-muted">{s.timeOfDay === 'D' ? '낮' : '밤'}</span>}
                      </td>
                      <td className="max-w-[420px] truncate px-2 py-1.5 text-muted">{s.preview}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted">
                        {s.lineCount}줄
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
