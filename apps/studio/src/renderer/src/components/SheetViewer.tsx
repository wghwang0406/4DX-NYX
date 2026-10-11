import { useEffect } from 'react'
import { X } from 'lucide-react'
import LayoutView from '../views/LayoutView'

/**
 * 콘티 시트 크게 보기 — Conti 화면의 시트 미리보기에서 연다. 전 페이지를 크게 보고 괜찮으면 바로 저장(PDF·PNG·애니매틱 mp4).
 * 템플릿·상태 표기·출력 기록·Template Lab 은 예전 Conti Export 화면(LayoutView) 그대로.
 */
export default function SheetViewer({ seq, selectedShot, onSelect, onClose }: { seq: string; selectedShot: string | null; onSelect: (no: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" data-testid="sheet-viewer">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4 text-[13px]">
        <span className="font-semibold">
          콘티 시트 <span className="ml-1 font-mono text-accent">{seq}</span>
          <span className="ml-2 text-[11.5px] font-normal text-muted">전체 페이지를 확인하고 괜찮으면 PDF·PNG 로 저장 · 칸을 누르면 그 컷 선택 · Esc 닫기</span>
        </span>
        <button onClick={onClose} title="닫기 (Esc)" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-3">
        <LayoutView selectedShot={selectedShot} onSelect={onSelect} />
      </div>
    </div>
  )
}
