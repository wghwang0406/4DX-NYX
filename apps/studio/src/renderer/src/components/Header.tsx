import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Scene } from '../data/sampleScene'

interface Props {
  scene: Scene | null
  scenes: Scene[]
  onSwitch: (seq: string) => void
  projectTitle: string
}

export default function Header({ scene, scenes, onSwitch, projectTitle }: Props) {
  const idx = scene ? scenes.findIndex((s) => s.seq === scene.seq) : -1
  const prev = idx > 0 ? scenes[idx - 1] : undefined
  const next = idx >= 0 ? scenes[idx + 1] : undefined
  const window = [prev, scene, next].filter(Boolean) as Scene[]

  return (
    <header className="drag flex h-[52px] shrink-0 items-center justify-between px-3">
      <div className="min-w-0">
        <div className="text-[11px] text-muted">
          {projectTitle}
          {scene ? ` / ${scene.ep} / ${scene.seq}` : ''}
        </div>
        <h1 className="truncate text-[17px] font-semibold leading-tight">
          {scene?.title ?? '시퀀스 없음'}
          {scene?.estimated && <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 align-middle text-[10.5px] font-normal text-muted">길이 추정</span>}
        </h1>
      </div>

      {scene && (
        <div className="no-drag flex items-center rounded-lg border border-line bg-panel p-1">
          <button disabled={!prev} onClick={() => prev && onSwitch(prev.seq)} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          {window.map((s) => (
            <button
              key={s.seq}
              onClick={() => onSwitch(s.seq)}
              className={`mx-0.5 rounded-md px-3 py-1 text-[12.5px] ${s.seq === scene.seq ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
            >
              {s.seq}
            </button>
          ))}
          <button disabled={!next} onClick={() => next && onSwitch(next.seq)} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </header>
  )
}
