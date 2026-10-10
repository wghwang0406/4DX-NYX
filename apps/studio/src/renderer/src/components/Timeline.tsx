import { useRef } from 'react'
import { Film, MessageSquare, Video, ZoomIn, Maximize2 } from 'lucide-react'
import type { Scene } from '../data/sampleScene'
import { fmt } from '../lib/time'

interface Props {
  scene: Scene
  playhead: number
  onSeek: (t: number) => void
  selectedShot: string | null
  onSelect: (no: string) => void
}

const LABEL_W = 112

export default function Timeline({ scene, playhead, onSeek, selectedShot, onSelect }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = (t: number) => `${(t / scene.duration) * 100}%`
  const reviewCount = scene.shots.filter((s) => s.review).length
  const ticks = Array.from({ length: Math.floor(scene.duration / 8) + 1 }, (_, i) => i * 8)

  function seekFromEvent(e: React.MouseEvent) {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
    onSeek((x / r.width) * scene.duration)
  }

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-[12.5px] font-medium">{scene.seq} 타임라인</span>
        <div className="flex items-center gap-3 text-muted">
          <span className="text-[11px]">100%</span>
          <ZoomIn size={14} />
          <Maximize2 size={14} />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 눈금 */}
        <div className="flex h-7 shrink-0 border-b border-line">
          <div style={{ width: LABEL_W }} className="shrink-0" />
          <div ref={trackRef} onClick={seekFromEvent} className="relative flex-1 cursor-pointer">
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-line" style={{ left: pct(t) }}>
                <span className="absolute top-1.5 left-1 font-mono text-[10px] text-muted">{fmt(t)}</span>
              </div>
            ))}
            <div
              className="absolute -top-0.5 z-20 -translate-x-1/2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white"
              style={{ left: pct(playhead) }}
            >
              {fmt(playhead)}
            </div>
          </div>
        </div>

        {/* 트랙 */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Track icon={Film} label="컷" badge={reviewCount ? `확인 필요 ${reviewCount}` : undefined} grow>
            {scene.shots.map((s) => (
              <button
                key={s.no}
                onClick={() => onSelect(s.no)}
                className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border-2 ${
                  selectedShot === s.no ? 'border-accent' : s.stale ? 'border-warn/70 hover:border-warn' : 'border-line hover:border-muted'
                }`}
                style={{ left: pct(s.tIn), width: `calc(${pct(s.tOut - s.tIn)} - 4px)` }}
                title={s.stale ? `${s.no} 재생성 필요` : s.no}
              >
                {s.image ? <img src={s.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" draggable={false} /> : <div className="sketch absolute inset-0" />}
                {s.stale && <div className="absolute right-1.5 bottom-1 h-1.5 w-1.5 rounded-full bg-warn" />}
                <div className="absolute left-1.5 top-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">
                  {s.no}
                </div>
                {s.review && (
                  <div className="absolute right-1.5 top-1 flex items-center gap-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                    {s.review.label}
                  </div>
                )}
              </button>
            ))}
          </Track>

          <Track icon={MessageSquare} label="대사">
            {scene.dialogue.map((d) => (
              <div
                key={d.id}
                className="absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md bg-dialog/85 px-2 text-[12px] text-[#1b1530]"
                style={{ left: pct(d.tIn), width: pct(d.tOut - d.tIn) }}
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
                style={{ left: pct(c.tIn), width: `calc(${pct(c.tOut - c.tIn)} - 4px)` }}
              >
                <span className="truncate">
                  {c.move} {c.dir ?? ''}
                </span>
              </div>
            ))}
          </Track>

          {/* 플레이헤드 */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent"
            style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${playhead / scene.duration})` }}
          />
        </div>
      </div>
    </section>
  )
}

function Track({
  icon: Icon,
  label,
  badge,
  grow,
  children,
}: {
  icon: typeof Film
  label: string
  badge?: string
  grow?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`flex border-b border-line last:border-b-0 ${grow ? 'min-h-[88px] flex-[2]' : 'min-h-[44px] flex-1'}`}>
      <div style={{ width: LABEL_W }} className="flex shrink-0 flex-col justify-center gap-1 border-r border-line px-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <Icon size={14} className="text-muted" />
          {label}
        </div>
        {badge && (
          <span className="w-fit rounded bg-warn px-1.5 py-0.5 text-[10.5px] font-semibold text-black">{badge}</span>
        )}
      </div>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  )
}
