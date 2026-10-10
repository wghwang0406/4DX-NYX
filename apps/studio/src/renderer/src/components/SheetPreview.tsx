import type { Scene } from '../data/sampleScene'

interface Props {
  scene: Scene
  selectedShot: string | null
  onSelect: (no: string) => void
}

// placeholder-a4-6up 템플릿의 화면용 미리보기. 실제 출력은 템플릿 HTML을 숨은 창에서 렌더한다(M4).
// 선택한 컷이 6칸 밖이면 그 컷이 들어가는 페이지를 보여준다.
export default function SheetPreview({ scene, selectedShot, onSelect }: Props) {
  const PER_PAGE = 6
  const selIdx = Math.max(0, scene.shots.findIndex((s) => s.no === selectedShot))
  const page = Math.floor(selIdx / PER_PAGE)
  const panels = scene.shots.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const pages = Math.max(1, Math.ceil(scene.shots.length / PER_PAGE))

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 items-center justify-between px-3 text-[12.5px] font-medium">
        <span>콘티 시트 미리보기</span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {pages > 1 && (
            <span>
              {page + 1} / {pages}
            </span>
          )}
          <span className="rounded border border-line px-1.5 py-0.5">A4 가로</span>
        </span>
      </div>

      <div className="mx-3 mb-3 flex min-h-0 flex-1 items-center justify-center">
        <div className="aspect-[297/210] max-h-full w-full max-w-full rounded-sm bg-[#f4f2ec] p-[2.2%] text-[#1a1a1a] shadow-lg">
          <div className="flex items-baseline justify-between border-b border-[#1a1a1a] pb-[1%]">
            <div className="text-[1.15vw] font-bold">
              {scene.seq} <span className="ml-2 font-semibold">{scene.title.split(' - ')[0]}</span>
            </div>
            <div className="text-[0.7vw] text-[#555]">
              {scene.project} · {scene.ep} · {scene.title.split(' - ')[1] ?? ''}
            </div>
          </div>

          <div className="mt-[1.5%] grid h-[88%] grid-cols-3 grid-rows-2 gap-[1.5%]">
            {panels.map((p) => (
              <button
                key={p.no}
                onClick={() => onSelect(p.no)}
                className={`flex min-h-0 flex-col border bg-white text-left ${
                  selectedShot === p.no ? 'border-accent ring-2 ring-accent/40' : 'border-[#1a1a1a]'
                }`}
              >
                <div className="flex items-center justify-between px-[4%] pt-[2%] font-mono text-[0.65vw] font-bold">
                  <span>{p.no}</span>
                  {p.stale && <span className="rounded bg-warn px-1 text-[0.5vw] font-semibold text-black">재생성 필요</span>}
                  {!p.stale && (p.status === 'queued' || p.status === 'running') && <span className="text-[0.5vw] text-accent">생성 중…</span>}
                </div>
                <div className={`mx-[4%] my-[2%] min-h-0 flex-1 overflow-hidden border border-[#999] ${p.image ? 'bg-black' : 'sketch-paper'}`}>
                  {p.image && <img src={p.image} alt={p.no} className="h-full w-full object-contain" draggable={false} />}
                </div>
                <div className="truncate border-t border-[#1a1a1a] px-[4%] py-[2%] text-[0.62vw]">{p.caption}</div>
              </button>
            ))}
            {Array.from({ length: Math.max(0, PER_PAGE - panels.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="border border-dashed border-[#bbb]" />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
