import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, RefreshCw, FolderOpen, ImageOff } from 'lucide-react'
import { ASSET_VIEWS, type Asset, type Version } from '@conti/domain'
import { fileUrl } from '../data/adapters'

const VIEW_LABEL: Record<string, string> = { sheet: '시트', front: '정면', back: '후면', face: '얼굴', wide: '와이드', '34': '3/4', top: '탑', detail: '디테일' }
const SOURCE_LABEL: Record<string, string> = { generated: '생성', edit: '수정', restyle: '다시 그리기', video_frame: '원본 프레임', upload: '올림' }

interface Props {
  asset: Asset
  view: string
  onClose: () => void
  /** 이 뷰(들)만 다시 생성 — 승인 카드가 뜬다 */
  onRegenerate: (views: string[]) => void
}

/** 에셋 이미지 크게 보기 — 뷰 전환(←/→), 버전 기록, 다시 생성·Finder. 생성은 여기서 바로 하지 않고 승인 카드를 거친다. */
export default function AssetViewer({ asset, view: initialView, onClose, onRegenerate }: Props) {
  const views = ASSET_VIEWS[asset.kind]
  const [view, setView] = useState(initialView)
  const versions: Version[] = [...(asset.views[view] ?? [])].sort((a, b) => b.n - a.n)
  const [verId, setVerId] = useState<string | null>(null)
  const ver = versions.find((v) => v.id === verId) ?? versions[0]
  const [actual, setActual] = useState(false)

  // 뷰가 바뀌면 최신 버전·맞춤 보기로
  useEffect(() => {
    setVerId(null)
    setActual(false)
  }, [view])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = views.indexOf(view)
        const next = views[(i + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length]
        setView(next)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (versions.length < 2) return
        e.preventDefault()
        const i = Math.max(0, versions.findIndex((v) => v.id === ver?.id))
        const j = Math.min(versions.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
        setVerId(versions[j].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, views, versions, ver, onClose])

  const step = (dir: 1 | -1) => setView(views[(views.indexOf(view) + dir + views.length) % views.length])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/[0.97] backdrop-blur-sm text-[12px]" data-testid="asset-viewer" onClick={onClose}>
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <span className="font-mono text-[13px] text-accent">{asset.tag}</span>
        <span className="text-white/80">{asset.nameKo}</span>
        <div className="ml-4 flex gap-1">
          {views.map((v) => {
            const latest = [...(asset.views[v] ?? [])].sort((a, b) => b.n - a.n)[0]
            return (
              <button
                key={v}
                data-view={v}
                onClick={() => setView(v)}
                className={`relative h-10 w-16 overflow-hidden rounded border ${v === view ? 'border-accent' : 'border-white/15 hover:border-white/40'}`}
                title={VIEW_LABEL[v] ?? v}
              >
                {latest ? <img src={fileUrl(latest.file)} alt="" className="h-full w-full object-cover" draggable={false} /> : <div className="h-full w-full bg-white/5" />}
                <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9.5px] text-white">{VIEW_LABEL[v] ?? v}</span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {ver && (
            <button onClick={() => void window.conti.layout.reveal(ver.file)} className="flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-white/80 hover:bg-white/10">
              <FolderOpen size={13} /> Finder에서 보기
            </button>
          )}
          <button
            data-testid="viewer-regenerate"
            onClick={() => onRegenerate([view])}
            title="이 뷰만 다시 생성 — 채팅에 승인 카드가 뜹니다"
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-white hover:brightness-110"
          >
            <RefreshCw size={13} /> {ver ? `${VIEW_LABEL[view] ?? view} 다시 생성` : `${VIEW_LABEL[view] ?? view} 생성`}
          </button>
          <button onClick={onClose} title="닫기 (Esc)" className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => step(-1)} className="flex w-12 shrink-0 items-center justify-center text-white/40 hover:text-white" title="이전 뷰 (←)">
          <ChevronLeft size={28} />
        </button>
        <div className={`flex min-h-0 min-w-0 flex-1 ${actual ? 'overflow-auto' : 'items-center justify-center'}`}>
          {ver ? (
            <img
              data-testid="viewer-image"
              src={fileUrl(ver.file)}
              alt={view}
              onClick={() => setActual((v) => !v)}
              title={actual ? '눌러서 화면에 맞추기' : '눌러서 실제 크기로'}
              className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
              draggable={false}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-white/50">
              <ImageOff size={32} />
              아직 {VIEW_LABEL[view] ?? view} 이미지가 없습니다
            </div>
          )}
        </div>
        <button onClick={() => step(1)} className="flex w-12 shrink-0 items-center justify-center text-white/40 hover:text-white" title="다음 뷰 (→)">
          <ChevronRight size={28} />
        </button>
        {versions.length > 0 && (
          <aside className="flex w-48 shrink-0 flex-col gap-1.5 overflow-y-auto border-l border-white/10 p-2" data-testid="viewer-versions">
            <div className="px-1 text-[11px] text-white/50">버전 {versions.length}개 · ↑/↓</div>
            {versions.map((v, i) => (
              <button key={v.id} onClick={() => setVerId(v.id)} className={`overflow-hidden rounded border text-left ${v.id === ver?.id ? 'border-accent' : 'border-white/10 hover:border-white/30'}`}>
                <img src={fileUrl(v.file)} alt="" className="aspect-video w-full bg-black object-contain" draggable={false} />
                <div className="flex items-center justify-between px-1.5 py-1 text-[10.5px] text-white/70">
                  <span>
                    v{v.n}
                    {i === 0 ? ' · 사용 중' : ''}
                  </span>
                  <span className="text-white/40">{SOURCE_LABEL[v.source] ?? v.source}</span>
                </div>
              </button>
            ))}
          </aside>
        )}
      </div>

      <div className="shrink-0 px-4 py-1.5 text-center text-[11px] text-white/40" onClick={(e) => e.stopPropagation()}>
        {ver ? `v${ver.n}${ver.w && ver.h ? ` · ${ver.w}×${ver.h}` : ''} · ${new Date(ver.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${ver.file.split('/').pop()}` : ''}
        <span className="ml-3">← → 뷰 · 이미지 클릭 실제 크기 · Esc 닫기</span>
      </div>
    </div>
  )
}
