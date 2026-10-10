import { Play, SkipForward, StepForward, Volume2, Maximize2 } from 'lucide-react'
import type { Scene } from '../data/sampleScene'
import { fmt } from '../lib/time'

interface Props {
  scene: Scene
  playhead: number
  onSeek: (t: number) => void
}

export default function Player({ scene, playhead, onSeek }: Props) {
  const cam = scene.camera.find((c) => playhead >= c.tIn && playhead < c.tOut)
  const shot = scene.shots.find((s) => playhead >= s.tIn && playhead < s.tOut)

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 items-center justify-between px-3 text-[12.5px] font-medium">
        <span>{scene.estimated ? '자동 애니매틱 (추정 길이)' : '원본 애니매틱'}</span>
        <span className="text-muted">{shot ? `${shot.no} · ${shot.size}` : ''}</span>
      </div>

      {/* 프레임 자리 — 실제 영상이 들어오면 <video> 로 바뀐다 */}
      <div className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-black">
        {shot?.image ? <img src={shot.image} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} /> : <div className="sketch absolute inset-0" />}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
        {cam && cam.move !== 'STATIC' && (
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 font-mono text-[22px] font-bold text-[#4f9dff] drop-shadow">
            {cam.move} {cam.dir ?? ''}
          </div>
        )}
        {shot && (
          <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/80">
            {shot.no}
          </div>
        )}
      </div>

      <div className="flex h-11 items-center gap-2 px-3">
        <Ctl icon={Play} />
        <Ctl icon={StepForward} />
        <Ctl icon={SkipForward} />
        <span className="ml-1 font-mono text-[11.5px] text-muted">
          {fmt(playhead)} / {fmt(scene.duration)}
        </span>
        <input
          type="range"
          min={0}
          max={scene.duration}
          step={0.1}
          value={playhead}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="mx-2 h-1 flex-1 accent-accent"
        />
        <Ctl icon={Volume2} />
        <Ctl icon={Maximize2} />
      </div>
    </section>
  )
}

function Ctl({ icon: Icon }: { icon: typeof Play }) {
  return (
    <button className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink">
      <Icon size={15} />
    </button>
  )
}
