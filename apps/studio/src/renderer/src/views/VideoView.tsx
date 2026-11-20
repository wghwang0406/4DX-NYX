import { Clapperboard, Film } from 'lucide-react'
import type { Sequence } from '@conti/domain'
import { currentStageFile, fileUrl } from '../data/adapters'

const STATUS_LABEL: Record<string, string> = { none: '아직 없음', queued: '대기', running: '생성 중', review: '확인 필요', done: '완료', stale: '재생성 필요', failed: '실패' }

/**
 * 최종 VIDEO — 샷별 최종 이미지(없으면 콘티)를 영상으로 넘기는 마지막 단계. 지금은 화면 골격만:
 * 샷마다 시작 그림 · 키프레임 수 · 영상 상태 · 빈 영상 칸. 생성(Kling 3.0 기본 / Seedance, 승인 카드 경유)은 다음에 붙는다.
 */
export default function VideoView({ sequence, selectedShot, onSelect }: { sequence: Sequence; selectedShot: string | null; onSelect: (shotId: string) => void }) {
  const shots = sequence.shots.filter((s) => !s.deleted)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0" data-testid="video-view">
      <section className="flex items-center justify-between rounded-lg border border-line bg-panel p-4">
        <div>
          <div className="text-[14px] font-semibold">최종 영상 — {sequence.seq}</div>
          <div className="text-[12px] text-muted">샷마다 최종 이미지(없으면 콘티)를 시작 프레임으로 영상을 만듭니다. Kling 3.0 기본, 키프레임 3장 이상이면 Seedance. 생성은 승인 카드를 거칩니다.</div>
        </div>
        <button disabled className="flex shrink-0 items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white opacity-50" title="다음 단계에서 붙습니다">
          <Clapperboard size={14} /> 영상 생성 — 곧 지원
        </button>
      </section>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-panel">
        {!shots.length && <div className="flex h-full items-center justify-center text-[12px] text-muted">샷이 없습니다 — Shots 에서 샷 분해를 먼저 하세요</div>}
        {shots.map((s) => {
          const image = currentStageFile(s, 'image')
          const start = image ?? currentStageFile(s, 'conti')
          const keys = s.panels.length
          const status = s.stages.video.status
          return (
            <button
              key={s.id}
              data-video-shot={s.no}
              onClick={() => onSelect(s.id)}
              className={`flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left text-[12px] ${selectedShot === s.id ? 'bg-accent-soft' : 'hover:bg-panel-2'}`}
            >
              <span className="w-12 font-mono">{s.no}</span>
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded border border-line bg-black">
                {start && <img src={fileUrl(start)} alt="" className="h-full w-full object-cover" draggable={false} />}
                <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9.5px] text-white">{image ? '최종 이미지' : start ? '콘티' : '그림 없음'}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate">{s.actionKo || s.dialogue.map((d) => d.text).join(' / ') || '—'}</div>
                <div className="text-[11px] text-muted">
                  {[s.sizeCode, s.cameraMove, keys > 1 ? `키프레임 ${keys}장` : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="w-20 text-[11px] text-muted">{STATUS_LABEL[status] ?? status}</span>
              <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded border border-dashed border-line text-muted">
                <Film size={16} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
