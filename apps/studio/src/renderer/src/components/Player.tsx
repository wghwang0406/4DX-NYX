import { useEffect, useRef } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import type { Annotation, Sequence } from '@conti/domain'
import AnnotatedFrame from './AnnotatedFrame'
import type { Scene } from '../data/sampleScene'
import { fmt } from '../lib/time'

interface Props {
  scene: Scene
  playhead: number
  onSeek: (t: number) => void
  playing?: boolean
  onPlayPause?: () => void
  onEnded?: () => void
  /** 실제 프로젝트일 때 — 현재 컷의 주석을 겹쳐 보여준다 (편집은 컷 상세에서) */
  sequence?: Sequence | null
  title?: string
}

/**
 * 재생 전용 플레이어. 텍스트 입력이면 콘티 이미지를 길이대로 넘기는 애니매틱(크레딧 0),
 * 영상 입력이면 원본 영상. Conti Export 의 애니매틱 미리보기와 Conti 의 "원본 영상" 탭이 쓴다.
 */
export default function Player({ scene, playhead, onSeek, playing, onPlayPause, onEnded, sequence, title }: Props) {
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
  const domainShot = sequence?.shots.find((s) => !s.deleted && s.no === shot?.no)
  const annotations: Annotation[] = domainShot?.panels[0]?.annotations ?? []

  function step(dir: 1 | -1) {
    const i = scene.shots.findIndex((s) => s.no === shot?.no)
    const next = scene.shots[Math.min(scene.shots.length - 1, Math.max(0, i + dir))]
    if (next) onSeek(next.tIn + 0.001)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[12.5px] font-medium">
        <span>{title ?? (scene.video ? '원본 영상' : scene.estimated ? '애니매틱 (추정 길이)' : '애니매틱')}</span>
        <span className="text-muted">{shot ? `${shot.no}${shot.size ? ` · ${shot.size}` : ''}` : ''}</span>
      </div>

      <AnnotatedFrame
        image={shot?.image}
        media={scene.video ? <video ref={videoRef} src={scene.video} className="absolute inset-0 h-full w-full object-contain" preload="auto" playsInline onEnded={onEnded} /> : undefined}
        annotations={annotations}
        editing={false}
      >
        {cam && cam.move !== 'STATIC' && !annotations.length && (
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 font-mono text-[22px] font-bold text-[#4f9dff] drop-shadow">
            {cam.move} {cam.dir ?? ''}
          </div>
        )}
        {shot && <div className="absolute left-3 top-3 rounded bg-black/50 px-2 py-0.5 font-mono text-[11px] text-white/80">{shot.no}</div>}
        {line && !scene.video && <div className="absolute inset-x-6 bottom-4 text-center text-[15px] font-semibold text-white [text-shadow:0_1px_3px_#000,0_0_8px_#000]">{line.text}</div>}
      </AnnotatedFrame>

      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Ctl icon={SkipBack} title="이전 컷" onClick={() => step(-1)} />
        <Ctl icon={playing ? Pause : Play} title={playing ? '멈춤 (Space)' : '재생 (Space)'} onClick={onPlayPause} />
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
