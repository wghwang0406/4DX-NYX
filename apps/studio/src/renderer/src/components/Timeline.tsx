import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Film, MessageSquare, Video, ZoomIn, ZoomOut, Maximize2, Play, Pause, SkipBack } from 'lucide-react'
import type { Scene } from '../data/sampleScene'
import { fmt } from '../lib/time'

interface Props {
  scene: Scene
  playhead: number
  onSeek: (t: number) => void
  selectedShot: string | null
  onSelect: (no: string) => void
  /** 텍스트 입력(추정 길이)일 때 컷 오른쪽 끝을 끌어 길이를 바꾼다 */
  onDurationChange?: (shotId: string, sec: number) => void
  /** 재생 (컷 길이대로 플레이헤드가 흐르고 화면이 컷마다 넘어간다) */
  playing?: boolean
  onPlayPause?: () => void
}

const LABEL_W = 112
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16]

/**
 * 씬 타임라인 — 컷 / 대사 / 카메라 트랙. 확대(버튼·⌘+휠)하면 가로로 스크롤되고 트랙 이름은 왼쪽에 고정된다.
 * 텍스트 입력이면 컷 오른쪽 끝을 끌어 길이를 바꾼다.
 */
export default function Timeline({ scene, playhead, onSeek, selectedShot, onSelect, onDurationChange, playing, onPlayPause }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [viewW, setViewW] = useState(800)
  // 끌고 있는 동안의 임시 길이 — 놓을 때 저장. 그동안 축척(scene.duration)은 고정해 흔들리지 않게
  const [drag, setDrag] = useState<{ id: string; sec: number; scale: number } | null>(null)
  const total = Math.max(0.1, drag ? drag.scale : scene.duration)
  const pct = (t: number) => `${(t / total) * 100}%`
  const resizable = !!onDurationChange && !!scene.estimated
  const trackPx = Math.max(1, (viewW - LABEL_W) * zoom) // 트랙 실제 폭(px)
  const pxOf = (sec: number) => (sec / total) * trackPx

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 씬이 바뀌면 맞춤으로
  useEffect(() => setZoom(1), [scene.seq])

  // 선택 컷·재생 위치가 화면 밖이면 따라간다
  const follow = (t: number) => {
    const el = scrollRef.current
    if (!el || zoom === 1) return
    const x = LABEL_W + pxOf(t)
    if (x < el.scrollLeft + LABEL_W + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - LABEL_W - el.clientWidth * 0.3)
  }
  useEffect(() => {
    const s = scene.shots.find((x) => x.no === selectedShot)
    if (s) follow(s.tIn)
  }, [selectedShot]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => follow(playhead), [Math.floor(playhead)]) // eslint-disable-line react-hooks/exhaustive-deps

  function setZoomAt(next: number, anchorClientX?: number) {
    const el = scrollRef.current
    const z = Math.min(16, Math.max(1, next))
    if (!el) return setZoom(z)
    // 커서(없으면 화면 가운데) 아래의 시각이 그대로 있게 스크롤을 맞춘다
    const rect = el.getBoundingClientRect()
    const ax = (anchorClientX ?? rect.left + rect.width / 2) - rect.left
    const tAt = ((el.scrollLeft + ax - LABEL_W) / trackPx) * total
    const newTrack = Math.max(1, (viewW - LABEL_W) * z)
    setZoom(z)
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, LABEL_W + (tAt / total) * newTrack - ax)
    })
  }
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 1e-6)
    const next = dir > 0 ? (ZOOMS[Math.min(ZOOMS.length - 1, (ZOOMS[i] > zoom ? i : i + 1))] ?? zoom) : (ZOOMS[Math.max(0, i - 1)] ?? 1)
    setZoomAt(next)
  }

  function startResize(e: React.MouseEvent, s: Scene['shots'][number]) {
    e.stopPropagation()
    e.preventDefault()
    const el = trackRef.current
    if (!el) return
    const width = el.getBoundingClientRect().width
    const x0 = e.clientX
    const d0 = s.tOut - s.tIn
    const scale = scene.duration
    let sec = d0
    const move = (ev: MouseEvent) => {
      sec = Math.max(0.5, Math.round((d0 + ((ev.clientX - x0) / width) * scale) * 10) / 10)
      setDrag({ id: s.id, sec, scale })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (Math.abs(sec - d0) >= 0.05) onDurationChange?.(s.id, sec)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 끄는 중이면 그 컷 뒤로 밀린 위치를 계산해서 보여준다
  let shift = 0
  const shots = scene.shots.map((s) => {
    const tIn = s.tIn + shift
    const dur = drag?.id === s.id ? drag.sec : s.tOut - s.tIn
    if (drag?.id === s.id) shift += drag.sec - (s.tOut - s.tIn)
    return { ...s, tIn, tOut: tIn + dur }
  })
  const reviewCount = scene.shots.filter((s) => s.review).length
  // 눈금: 대략 90px 마다
  const raw = (90 / trackPx) * total
  const tickStep = [0.5, 1, 2, 4, 5, 10, 15, 30, 60, 120].find((v) => v >= raw) ?? 300
  const ticks = Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, i) => i * tickStep)

  function seekAt(clientX: number) {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    onSeek((x / r.width) * total)
  }
  // 눈금 줄·플레이헤드 손잡이를 잡고 끌면 계속 따라간다 (포인터 캡처 — 창 밖으로 나가도 놓을 때까지)
  const scrubbing = useRef(false)
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      scrubbing.current = true
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* 합성 이벤트 등 캡처 불가 — 끌기는 그대로 */
      }
      if (playing) onPlayPause?.()
      seekAt(e.clientX)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (scrubbing.current) seekAt(e.clientX)
    },
    onPointerUp: (e: React.PointerEvent) => {
      scrubbing.current = false
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
      } catch {
        /* */
      }
    },
  }

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="flex items-center gap-2 text-[12.5px] font-medium">
          {onPlayPause && (
            <span className="flex items-center gap-0.5" data-testid="timeline-transport">
              <button onClick={() => onSeek(0)} title="처음으로" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink">
                <SkipBack size={13} />
              </button>
              <button data-testid="timeline-play" onClick={onPlayPause} title={playing ? '멈춤 (Space)' : '재생 (Space) — 컷 길이대로 넘어갑니다'} className="rounded bg-accent p-1 text-white hover:brightness-110">
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <span className="ml-1 w-[92px] font-mono text-[11px] font-normal text-muted" data-testid="timeline-time">
                {fmt(Math.min(playhead, scene.duration))} / {fmt(scene.duration)}
              </span>
            </span>
          )}
          {scene.seq} 타임라인 <span className="text-[11px] font-normal text-muted">{scene.shots.length}컷{onPlayPause ? '' : ` · ${fmt(scene.duration)}`}</span>
        </span>
        <div className="flex items-center gap-1 text-muted">
          <button onClick={() => step(-1)} disabled={zoom <= 1} title="축소" className="rounded p-1 hover:bg-panel-2 hover:text-ink disabled:opacity-30">
            <ZoomOut size={14} />
          </button>
          <span className="w-10 text-center font-mono text-[11px]">{Math.round(zoom * 100)}%</span>
          <button onClick={() => step(1)} disabled={zoom >= 16} title="확대 (⌘+휠)" className="rounded p-1 hover:bg-panel-2 hover:text-ink disabled:opacity-30">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoomAt(1)} disabled={zoom === 1} title="전체 맞춤" className="rounded p-1 hover:bg-panel-2 hover:text-ink disabled:opacity-30">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`relative min-h-0 flex-1 overflow-y-hidden ${zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
        onWheel={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          setZoomAt(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX)
        }}
      >
        <div className="relative flex h-full flex-col" style={{ width: LABEL_W + trackPx }}>
          {/* 눈금 */}
          <div className="flex h-7 shrink-0 border-b border-line">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-30 shrink-0 bg-panel" />
            <div ref={trackRef} {...scrubHandlers} data-testid="timeline-ruler" className="relative flex-1 cursor-ew-resize touch-none select-none" title="끌어서 이동">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line" style={{ left: pct(t) }}>
                  <span className="absolute top-1.5 left-1 font-mono text-[10px] text-muted">{fmt(t)}</span>
                </div>
              ))}
              <div className="pointer-events-none absolute -top-0.5 z-20 -translate-x-1/2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white shadow" style={{ left: pct(Math.min(playhead, total)) }}>
                {fmt(playhead)}
                <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-accent" />
              </div>
            </div>
          </div>

          {/* 트랙 */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Track icon={Film} label="컷" badge={reviewCount ? `확인 필요 ${reviewCount}` : undefined} grow>
              {shots.map((s) => {
                const w = pxOf(s.tOut - s.tIn)
                return (
                  <button
                    key={s.no}
                    data-shot={s.no}
                    onClick={() => onSelect(s.no)}
                    className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border-2 ${
                      selectedShot === s.no ? 'z-10 border-accent' : s.stale ? 'border-warn/70 hover:border-warn' : 'border-line hover:border-muted'
                    }`}
                    style={{ left: pct(s.tIn), width: `max(3px, calc(${pct(s.tOut - s.tIn)} - 3px))` }}
                    title={`${s.no}${s.size ? ` · ${s.size}` : ''} · ${(s.tOut - s.tIn).toFixed(1)}s${s.review ? ` · ${s.review.label}` : ''}${s.stale ? ' · 재생성 필요' : ''}\n${s.caption}`}
                  >
                    {s.image ? <img src={s.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} /> : <div className="sketch absolute inset-0" />}
                    {w >= 34 && <div className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">{s.no}</div>}
                    {s.review &&
                      (w >= 110 ? (
                        <div className="absolute right-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1 text-[10px] text-white">
                          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                          {s.review.label}
                        </div>
                      ) : (
                        <span className="absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full bg-warn ring-1 ring-black/60" />
                      ))}
                    {s.stale && <div className="absolute right-1.5 bottom-1 h-1.5 w-1.5 rounded-full bg-warn" />}
                    {drag?.id === s.id && <div className="absolute bottom-1 left-1.5 rounded bg-accent px-1 font-mono text-[10px] text-white">{drag.sec.toFixed(1)}s</div>}
                    {resizable && (
                      <span
                        role="separator"
                        title="끌어서 길이 조정"
                        onMouseDown={(e) => startResize(e, s)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-accent/60"
                      />
                    )}
                  </button>
                )
              })}
            </Track>

            <Track icon={MessageSquare} label="대사">
              {scene.dialogue.map((d) => (
                <div
                  key={d.id}
                  className="absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md bg-dialog/85 px-2 text-[12px] text-[#1b1530]"
                  style={{ left: pct(d.tIn), width: pct(d.tOut - d.tIn) }}
                  title={d.text}
                >
                  <span className="truncate">{d.text}</span>
                </div>
              ))}
            </Track>

            <Track icon={Video} label="카메라">
              {scene.camera.map((c, i) => (
                <div
                  key={i}
                  className="absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md border border-[#3b5fb0] bg-cam/70 px-2 font-mono text-[11.5px] font-semibold text-[#9db8ff]"
                  style={{ left: pct(c.tIn), width: `max(2px, calc(${pct(c.tOut - c.tIn)} - 3px))` }}
                  title={`${c.move} ${c.dir ?? ''}`}
                >
                  <span className="truncate">
                    {c.move} {c.dir ?? ''}
                  </span>
                </div>
              ))}
            </Track>

            {/* 플레이헤드 */}
            <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent" style={{ left: LABEL_W + pxOf(Math.min(playhead, total)) }} />
          </div>
        </div>
      </div>
    </section>
  )
}

function Track({ icon: Icon, label, badge, grow, children }: { icon: typeof Film; label: string; badge?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex border-b border-line last:border-b-0 ${grow ? 'min-h-[88px] flex-[2]' : 'min-h-[44px] flex-1'}`}>
      <div style={{ width: LABEL_W }} className="sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1 border-r border-line bg-panel px-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <Icon size={14} className="text-muted" />
          {label}
        </div>
        {badge && <span className="w-fit rounded bg-warn px-1.5 py-0.5 text-[10.5px] font-semibold text-black">{badge}</span>}
      </div>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  )
}
