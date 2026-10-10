import { useEffect, useState } from 'react'
import { Film, Clapperboard, Video, AudioLines, Loader2, CheckCircle2, AlertTriangle, X, FolderOpen } from 'lucide-react'
import type { VideoImportOptions, VideoImportSummary, VideoKind, VideoProgress } from '../../../shared/video-ipc'
import { useProject } from '../state/project'

const KINDS: Array<{ kind: VideoKind; label: string; desc: string; icon: typeof Film }> = [
  { kind: 'animatic', label: '애니매틱', desc: '편집된 영상 한 편 — 컷을 찾아 샷으로 나눈다', icon: Clapperboard },
  { kind: 'clips', label: '샷별 클립', desc: '0010_v1.mp4 처럼 샷마다 파일 — 번호를 그대로 쓴다', icon: Film },
  { kind: 'longtake', label: '롱테이크', desc: '컷이 거의 없는 긴 장면 — 시야가 바뀌는 곳에서 패널을 나눈다', icon: Video },
  { kind: 'audio', label: '대사 음성', desc: '음성 파일 — 기존 시퀀스의 샷에 시간대로 대사를 붙인다', icon: AudioLines },
]

const STAGES: Array<{ id: string; label: string }> = [
  { id: 'prepare', label: '원본 확인' },
  { id: 'setup', label: '분석 도구 준비' },
  { id: 'proxy', label: '분석용 사본' },
  { id: 'measure', label: '컷·카메라 측정' },
  { id: 'asr', label: '대사 인식' },
  { id: 'keyframes', label: '원본 프레임' },
  { id: 'sheets', label: '시트' },
  { id: 'ai', label: 'AI 판단' },
  { id: 'ai2', label: 'AI 재확인' },
  { id: 'write', label: '저장' },
]

/** 영상 콘티 가져오기 — 측정은 로컬(토큰 0), AI 는 시트 몇 장만. 기본이 원본 프레임이라 크레딧은 들지 않는다. */
export default function VideoImport({ onClose }: { onClose: () => void }) {
  const { setSeq, setNav, refresh } = useProject()
  const [kind, setKind] = useState<VideoKind>('animatic')
  const [files, setFiles] = useState<string[]>([])
  const [seq, setSeqId] = useState('S01')
  const [ep, setEp] = useState('EP01')
  const [heading, setHeading] = useState('')
  const [asr, setAsr] = useState(true)
  const [lang, setLang] = useState('auto')
  const [ai, setAi] = useState<VideoImportOptions['ai']>('auto')
  const [overwrite, setOverwrite] = useState(false)
  const [running, setRunning] = useState(false)
  const [prog, setProg] = useState<Record<string, VideoProgress>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const [result, setResult] = useState<VideoImportSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void window.conti.video.suggest().then((s) => {
      setSeqId(s.seq)
      setEp(s.ep)
    })
    return window.conti.onVideoProgress((p) => {
      setCurrent(p.stage)
      setProg((m) => ({ ...m, [p.stage]: p }))
    })
  }, [])

  async function choose() {
    setErr(null)
    const f = await window.conti.video.pick(kind)
    if (f.length) {
      setFiles(f)
      if (!heading) setHeading(f[0].split('/').pop()!.replace(/\.[^.]+$/, ''))
    }
  }

  async function start() {
    setErr(null)
    setResult(null)
    setProg({})
    setRunning(true)
    try {
      const r = await window.conti.video.import({ kind, files, seq, ep, headingKo: heading, asr, asrLang: lang, ai, overwrite })
      setResult(r)
      await refresh()
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setRunning(false)
      setCurrent(null)
    }
  }

  const seqOk = /^S\d{2,}$/.test(seq) && /^EP\d{2,}$/.test(ep)
  const visibleStages = STAGES.filter((s) => (kind === 'audio' ? ['prepare', 'setup', 'asr', 'write'].includes(s.id) : (asr || s.id !== 'asr') && (ai !== 'none' || !['sheets', 'ai', 'ai2'].includes(s.id))))

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-[13px] font-semibold">영상 콘티 가져오기</div>
        <button disabled={running} onClick={onClose} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30">
          <X size={15} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-4 overflow-y-auto p-4 text-[12.5px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                disabled={running}
                onClick={() => {
                  setKind(k.kind)
                  setFiles([])
                }}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left ${kind === k.kind ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted'}`}
              >
                <k.icon size={18} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <div className="font-medium">{k.label}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{k.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <div>
            <button disabled={running} onClick={() => void choose()} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-panel-2 disabled:opacity-50">
              <FolderOpen size={14} /> {kind === 'clips' ? '클립 파일들 선택' : '파일 선택'}
            </button>
            {files.length > 0 && (
              <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto rounded border border-line bg-bg p-2 font-mono text-[11px] text-muted">
                {files.map((f) => (
                  <li key={f} className="truncate" title={f}>
                    {f.split('/').pop()}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-[11px] text-muted">원본은 복사하지 않고 위치만 기억합니다. 분석용 사본(960px)만 프로젝트 안에 만듭니다.</div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              시퀀스
              <input value={seq} onChange={(e) => setSeqId(e.target.value.toUpperCase())} className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 font-mono outline-none focus:border-accent" />
            </label>
            <label className="flex items-center gap-1.5">
              에피소드
              <input value={ep} onChange={(e) => setEp(e.target.value.toUpperCase())} className="w-16 rounded border border-line bg-bg px-1.5 py-0.5 font-mono outline-none focus:border-accent" />
            </label>
            {kind !== 'audio' && (
              <label className="flex min-w-[200px] flex-1 items-center gap-1.5">
                제목
                <input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="장소 - 시간" className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent" />
              </label>
            )}
          </div>

          {kind !== 'audio' && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={asr} onChange={(e) => setAsr(e.target.checked)} /> 대사 인식 (대사마다 독립 샷 · 처음 한 번 음성 모델 1.5GB 를 내려받습니다)
                </label>
                <select value={lang} disabled={!asr} onChange={(e) => setLang(e.target.value)} className="rounded border border-line bg-bg px-1.5 py-0.5 text-[12px] outline-none disabled:opacity-40" title="언어를 정하면 다른 언어 대사를 번역해 버리므로 보통은 자동">
                  <option value="auto">언어 자동</option>
                  <option value="ko">한국어</option>
                  <option value="ja">일본어</option>
                  <option value="en">영어</option>
                  <option value="zh">중국어</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                AI 판단 (샷사이즈·앵글·인물·지문·화자)
                {(['auto', 'claude', 'codex', 'none'] as const).map((a) => (
                  <label key={a} className="flex items-center gap-1">
                    <input type="radio" checked={ai === a} onChange={() => setAi(a)} />
                    {a === 'auto' ? '자동' : a === 'none' ? '끄기' : a === 'claude' ? 'Claude' : 'Codex'}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> 이 시퀀스에 샷이 있으면 덮어쓰기 (이전 프레임 파일은 남음)
              </label>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3 text-[12px]">
              <div className="flex items-center gap-1.5 font-medium text-emerald-200">
                <CheckCircle2 size={14} /> {result.seq} — 샷 {result.shots}개 · 패널 {result.panels}개{result.dialogue ? ` · 대사 ${result.dialogue}줄` : ''} · {(result.ms / 1000).toFixed(1)}초
              </div>
              {result.review > 0 && <div className="mt-1 text-warn">확인 필요 {result.review}컷 — 타임라인에 노란 표시</div>}
              {result.ai && !result.ai.error && (
                <div className="mt-1 text-muted">
                  AI({result.aiAgent}) 패널 {result.ai.panels}개 판단{result.ai.cached ? ` · 캐시 ${result.ai.cached}개` : ''}{result.ai.pass2 ? ` · 재확인 ${result.ai.pass2}개` : ''} · 입력 {result.ai.inTok.toLocaleString()} / 출력 {result.ai.outTok.toLocaleString()} 토큰
                </div>
              )}
              {result.warnings.map((w, i) => (
                <div key={i} className="mt-1 text-warn">
                  {w}
                </div>
              ))}
              <button
                onClick={() => {
                  setSeq(result.seq)
                  setNav('콘티')
                }}
                className="mt-2 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white"
              >
                콘티에서 보기
              </button>
            </div>
          )}

          <button
            disabled={running || !files.length || !seqOk}
            onClick={() => void start()}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />} {running ? '가져오는 중…' : '가져오기'}
          </button>
        </div>

        <aside className="rounded-lg border border-line bg-bg p-3">
          <div className="mb-2 text-[12px] font-medium text-muted">진행</div>
          <ol className="space-y-1.5">
            {visibleStages.map((s) => {
              const p = prog[s.id]
              const active = current === s.id
              const done = !!p && !active && (p.progress === undefined || p.progress >= 0.999 || STAGES.findIndex((x) => x.id === current) > STAGES.findIndex((x) => x.id === s.id) || !!result)
              return (
                <li key={s.id} className="flex items-center gap-2 text-[12px]">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${done ? 'bg-emerald-500 text-black' : active ? 'bg-accent text-white' : 'bg-line text-muted'}`}>
                    {done ? '✓' : active ? <Loader2 size={10} className="animate-spin" /> : ''}
                  </span>
                  <span className={active ? 'text-ink' : done ? 'text-muted' : 'text-muted/60'}>{s.label}</span>
                  {active && typeof p?.progress === 'number' && <span className="ml-auto font-mono text-[10.5px] text-muted">{Math.round(p.progress * 100)}%</span>}
                </li>
              )
            })}
          </ol>
          {current && prog[current]?.message && <div className="mt-2 truncate text-[11px] text-muted">{prog[current].message}</div>}
          <div className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            측정(컷·카메라·대사)은 이 맥에서만 합니다. AI 에는 라벨 붙은 썸네일 시트 몇 장과 짧은 표만 보냅니다. 같은 영상을 다시 넣으면 바뀐 부분만 다시 분석합니다.
          </div>
        </aside>
      </div>
    </section>
  )
}
