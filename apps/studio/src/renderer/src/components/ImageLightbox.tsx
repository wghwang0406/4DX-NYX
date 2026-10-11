import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/** 그림 하나를 전체 화면으로 — 클릭하면 실제 크기/맞춤 전환, Esc 로 닫기. (에셋은 뷰·버전까지 있는 AssetViewer) */
export default function ImageLightbox({ src, caption, onClose }: { src: string; caption?: string; onClose: () => void }) {
  const [actual, setActual] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/[0.97] text-[12px]" data-testid="image-lightbox" onClick={onClose}>
      <div className="flex shrink-0 items-center justify-between px-4 py-2 text-white/70">
        <span>{caption}</span>
        <button onClick={onClose} title="닫기 (Esc)" className="rounded p-1 hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>
      </div>
      <div className={`flex min-h-0 flex-1 ${actual ? 'overflow-auto' : 'items-center justify-center'} p-4`} onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt=""
          onClick={() => setActual((v) => !v)}
          title={actual ? '눌러서 화면에 맞추기' : '눌러서 실제 크기로'}
          className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
          draggable={false}
        />
      </div>
      <div className="shrink-0 pb-2 text-center text-[11px] text-white/40">이미지 클릭 실제 크기 · Esc 닫기</div>
    </div>
  )
}
