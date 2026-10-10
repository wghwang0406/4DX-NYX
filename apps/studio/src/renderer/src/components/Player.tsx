import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, PenLine, Undo2, Trash2, X } from 'lucide-react'
import { ANNOTATION_TYPES, annotationsSvg, type Annotation, type AnnotationType, type Sequence } from '@conti/domain'
import type { Scene } from '../data/sampleScene'
import { fmt } from '../lib/time'

interface Props {
  scene: Scene
  playhead: number
  onSeek: (t: number) => void
  playing?: boolean
  onPlayPause?: () => void
  onEnded?: () => void
  /** 실제 프로젝트일 때 — 주석 편집 대상 */
  sequence?: Sequence | null
  selectedShot?: string | null
}

/** 16:9 상자를 칸 안에 꽉 맞춘다 (주석 좌표 0..1 이 이 상자 기준) */
function useFit(ratio = 16 / 9) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      const w = Math.min(cw, ch * ratio)
      setSize({ w, h: w / ratio })
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [ratio])
  return { ref, size }
}

/**
 * 미리보기 플레이어. 텍스트 입력이면 콘티 이미지를 추정 길이대로 넘기는 자동 애니매틱(크레딧 0),
 * 영상 입력이면(M5) 원본 영상. 멈춘 상태에서 [주석]을 켜면 선택한 컷에 화살표·프레임·메모를 그린다.
 */
export default function Player({ scene, playhead, onSeek, playing, onPlayPause, onEnded, sequence, selectedShot }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const seekRef = useRef(onSeek)
  seekRef.current = onSeek
  // 영상 입력: <video> 가 시계. 재생 중엔 currentTime → 플레이헤드, 멈췄을 땐 플레이헤드 → currentTime
  useEffect(() => {
    const v = videoRef.current
    if (!v || !scene.video) return
    if (playing) {
      void v.play().catch(() => {})
      let raf = 0
      const tick = () => {
        seekRef.current(v.currentTime)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelAnimationFrame(raf)
        v.pause()
      }
    }
    v.pause()
  }, [playing, scene.video])
  useEffect(() => {
    const v = videoRef.current
    if (!v || !scene.video || playing) return
    if (Math.abs(v.currentTime - playhead) > 0.05) v.currentTime = playhead
  }, [playhead, playing, scene.video])

  const cam = scene.camera.find((c) => playhead >= c.tIn && playhead < c.tOut)
  const shot = scene.shots.find((s) => playhead >= s.tIn && playhead < s.tOut) ?? scene.shots[scene.shots.length - 1]
  const line = scene.dialogue.find((d) => playhead >= d.tIn && playhead < d.tOut)
  const { ref, size } = useFit()
  const [edit, setEdit] = useState(false)
  const [type, setType] = useState<AnnotationType>('move')
  const [label, setLabel] = useState('')
  const [draft, setDraftState] = useState<Array<[number, number]> | null>(null)
  // 빠른 획(누름→뗌이 렌더 전에 끝남)도 잃지 않게 점은 ref 에 모으고, state 는 그리기용
  const draftRef = useRef<Array<[number, number]> | null>(null)
  const setDraft = (d: Array<[number, number]> | null) => {
    draftRef.current = d
    setDraftState(d)
  }

  const domainShot = sequence?.shots.find((s) => !s.deleted && s.no === (edit ? selectedShot : shot?.no))
  const annotations: Annotation[] = domainShot?.panels[0]?.annotations ?? []
  const editable = !!sequence && !!selectedShot && !playing
  const shape = ANNOTATION_TYPES.find((t) => t.type === type)!.shape

  function step(dir: 1 | -1) {
    const i = scene.shots.findIndex((s) => s.no === shot?.no)
    const next = scene.shots[Math.min(scene.shots.length - 1, Math.max(0, i + dir))]
    if (next) onSeek(next.tIn + 0.001)
  }

  const norm = (e: React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  async function save(list: Annotation[]) {
    if (!sequence || !domainShot) return
    await window.conti.api.sequence.setAnnotations(sequence.seq, domainShot.id, 0, list)
  }

  function finish(points: Array<[number, number]>) {
    setDraft(null)
    if (shape !== 'point') {
      const [a, b] = [points[0], points[points.length - 1]]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) return // 너무 짧으면 무시
    }
    // 화살표는 지나온 점을 최대 6개로 줄여 곡선으로
    const thin = (p: Array<[number, number]>) => (p.length > 6 ? p.filter((_, i) => i % Math.ceil(p.length / 5) === 0).concat([p[p.length - 1]]) : p)
    const pts = shape === 'arrow' ? thin(points) : shape === 'rect' ? [points[0], points[points.length - 1]] : [points[0]]
    const ann: Annotation = { id: crypto.randomUUID(), type, points: pts, ...(label.trim() ? { label: label.trim() } : type === 'note' ? { label: '메모' } : {}) }
    void save([...annotations, ann])
  }

  const preview: Annotation[] = draft ? [...annotations, { id: 'draft', type, points: shape === 'rect' ? [draft[0], draft[draft.length - 1]] : draft, label: label || undefined }] : annotations
  const image = edit ? scene.shots.find((s) => s.no === selectedShot)?.image : shot?.image

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[12.5px] font-medium">
        <span>{edit ? `주석 — ${selectedShot}` : scene.video ? '원본 영상' : scene.estimated ? '자동 애니매틱 (추정 길이)' : '원본 애니매틱'}</span>
        <span className="flex items-center gap-2 text-muted">
          {!edit && shot ? `${shot.no}${shot.size ? ` · ${shot.size}` : ''}` : ''}
          {sequence && (
            <button
              disabled={!editable && !edit}
              onClick={() => setEdit((v) => !v)}
              title={editable || edit ? '선택한 컷에 화살표·프레임·메모 그리기' : '컷을 선택하고 멈춘 상태에서'}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40 ${edit ? 'border-accent bg-accent-soft text-ink' : 'border-line hover:text-ink'}`}
            >
              {edit ? <X size={11} /> : <PenLine size={11} />} {edit ? '닫기' : '주석'}
            </button>
          )}
        </span>
      </div>

      {edit && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          {ANNOTATION_TYPES.map((t) => (
            <button key={t.type} onClick={() => setType(t.type)} className={`rounded border px-1.5 py-0.5 ${type === t.type ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="라벨 (선택)" className="w-24 rounded border border-line bg-bg px-1.5 py-0.5 outline-none placeholder:text-muted" />
          <button disabled={!annotations.length} onClick={() => void save(annotations.slice(0, -1))} title="마지막 주석 지우기" className="rounded border border-line p-1 text-muted hover:text-ink disabled:opacity-30">
            <Undo2 size={11} />
          </button>
          <button disabled={!annotations.length} onClick={() => window.confirm('이 컷의 주석을 모두 지울까요?') && void save([])} title="모두 지우기" className="rounded border border-line p-1 text-muted hover:text-ink disabled:opacity-30">
            <Trash2 size={11} />
          </button>
        </div>
      )}

      <div ref={ref} className="relative mx-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
        <div className="relative" style={{ width: size.w, height: size.h }}>
          {scene.video && !edit ? (
            <video ref={videoRef} src={scene.video} className="absolute inset-0 h-full w-full object-contain" preload="auto" playsInline onEnded={onEnded} />
          ) : image ? (
            <img src={image} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          ) : (
            <div className="sketch absolute inset-0" />
          )}
          <div className="pointer-events-none absolute inset-0" dangerouslySetInnerHTML={{ __html: annotationsSvg(preview) }} />
          {!edit && cam && cam.move !== 'STATIC' && !annotations.length && (
            <div className="absolute left-1/2 top-1/3 -translate-x-1/2 font-mono text-[22px] font-bold text-[#4f9dff] drop-shadow">
              {cam.move} {cam.dir ?? ''}
            </div>
          )}
          {!edit && shot && <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/80">{shot.no}</div>}
          {!edit && line && !scene.video && <div className="absolute inset-x-6 bottom-4 text-center text-[15px] font-semibold text-white [text-shadow:0_1px_3px_#000,0_0_8px_#000]">{line.text}</div>}
          {edit && (
            <div
              className="absolute inset-0 cursor-crosshair"
              onMouseDown={(e) => {
                const p = norm(e)
                if (shape === 'point') return finish([p])
                setDraft([p])
              }}
              onMouseMove={(e) => {
                const d = draftRef.current
                if (!d) return
                const p = norm(e)
                const last = d[d.length - 1]
                if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.015) setDraft([...d, p])
              }}
              onMouseUp={(e) => {
                const d = draftRef.current
                if (d) finish([...d, norm(e)])
              }}
              onMouseLeave={() => {
                const d = draftRef.current
                if (d) finish(d)
              }}
            />
          )}
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Ctl icon={SkipBack} title="이전 컷" onClick={() => step(-1)} />
        <Ctl icon={playing ? Pause : Play} title={playing ? '멈춤 (Space)' : '재생 (Space)'} onClick={onPlayPause} disabled={edit} />
        <Ctl icon={SkipForward} title="다음 컷" onClick={() => step(1)} />
        <span data-testid="player-time" className="ml-1 font-mono text-[11.5px] text-muted">
          {fmt(playhead)} / {fmt(scene.duration)}
        </span>
        <input type="range" min={0} max={scene.duration} step={0.05} value={playhead} onChange={(e) => onSeek(Number(e.target.value))} className="mx-2 h-1 flex-1 accent-accent" />
      </div>
    </section>
  )
}

function Ctl({ icon: Icon, onClick, title, disabled }: { icon: typeof Play; onClick?: () => void; title?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30">
      <Icon size={15} />
    </button>
  )
}
