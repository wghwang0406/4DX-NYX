import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LayoutRenderResult } from '../../../shared/layout-ipc'

interface Props {
  seq: string | null
  selectedShot?: string | null
  onSelect?: (no: string) => void
  /** single: 선택 컷이 든 페이지 한 장을 칸에 맞춰 / all: 모든 페이지를 폭에 맞춰 세로 스크롤 */
  mode: 'single' | 'all'
  templateId?: string
  sample?: boolean
  /** 제목줄 오른쪽에 붙일 것 */
  extra?: React.ReactNode
  title?: string
  className?: string
}

const PX_PER_MM = 96 / 25.4
const GAP_MM = 8

/**
 * 실제 템플릿 렌더 미리보기 — main 이 Handlebars 로 만든 HTML 을 srcdoc iframe 에 넣는다.
 * PDF 출력과 같은 HTML·폰트라 화면에서 본 그대로 나온다. 패널 클릭 = 샷 선택.
 */
export default function LayoutPreview({ seq, selectedShot, onSelect, mode, templateId, sample, extra, title = '콘티 시트 미리보기', className = '' }: Props) {
  const [r, setR] = useState<LayoutRenderResult | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [page, setPage] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const load = useCallback(async () => {
    if (!window.conti?.layout) return
    setR(await window.conti.layout.render(seq, { templateId, sample }))
  }, [seq, templateId, sample])

  useEffect(() => {
    void load()
    const off1 = window.conti?.onStoreChange((c) => {
      if (c.type === 'project' || c.type === 'assets' || (c.type === 'sequence' && c.seq === seq)) void load()
    })
    const off2 = window.conti?.onLayoutChange(() => void load())
    return () => {
      off1?.()
      off2?.()
    }
  }, [load, seq])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const pw = (r?.pageMm[0] ?? 297) * PX_PER_MM
  const ph = (r?.pageMm[1] ?? 210) * PX_PER_MM
  const pages = r?.pages ?? 0
  const scale = mode === 'single' ? Math.max(0.05, Math.min(box.w / pw, box.h / ph)) : Math.max(0.05, (box.w - 4) / pw)
  const frameH = mode === 'single' ? ph : pages * (ph + GAP_MM * PX_PER_MM)

  // 선택 컷이 있는 페이지로
  useEffect(() => {
    if (mode !== 'single' || !selectedShot) return
    const doc = frame.current?.contentDocument
    const cell = doc?.querySelector(`[data-shot="${selectedShot}"]`)
    const pg = cell?.closest('.page')
    if (!doc || !pg) return
    const idx = Array.from(doc.querySelectorAll('.page')).indexOf(pg)
    if (idx >= 0) setPage(idx)
  }, [selectedShot, mode, r])

  const decorate = useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    let st = doc.getElementById('__nyx') as HTMLStyleElement | null
    if (!st) {
      st = doc.createElement('style')
      st.id = '__nyx'
      doc.head.appendChild(st)
      doc.addEventListener('click', (e) => {
        const cell = (e.target as Element).closest?.('[data-shot]')
        const no = cell?.getAttribute('data-shot')
        if (no) onSelectRef.current?.(no)
      })
    }
    const sel = selectedShot ? `.cell[data-shot="${selectedShot}"]{outline:1.1mm solid #5b7cfa;outline-offset:0.4mm}` : ''
    const single = mode === 'single' ? `body{background:transparent!important;overflow:hidden}.page{margin:0!important;box-shadow:none!important}` : `body{overflow:hidden}`
    st.textContent = `${single}.cell[data-shot]{cursor:pointer}.cell[data-shot]:hover{outline:0.6mm solid rgba(91,124,250,.5)}${sel}`
    if (mode === 'single') {
      const pg = doc.querySelectorAll('.page')[page] as HTMLElement | undefined
      frame.current?.contentWindow?.scrollTo(0, pg?.offsetTop ?? 0)
    }
  }, [selectedShot, mode, page])

  useEffect(() => decorate(), [decorate])

  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-line bg-panel ${className}`}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 text-[12.5px] font-medium">
        <span className="truncate">{title}</span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {mode === 'single' && pages > 1 && (
            <span className="flex items-center gap-1">
              <button disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded p-0.5 hover:bg-panel-2 disabled:opacity-30">
                <ChevronLeft size={13} />
              </button>
              {page + 1} / {pages}
              <button disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} className="rounded p-0.5 hover:bg-panel-2 disabled:opacity-30">
                <ChevronRight size={13} />
              </button>
            </span>
          )}
          {mode === 'all' && pages > 0 && <span>{pages}쪽</span>}
          {extra}
        </span>
      </div>
      <div ref={wrap} className={`relative mx-3 mb-3 min-h-0 flex-1 ${mode === 'all' ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'}`}>
        {r?.error && (
          <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-red-300">
            <AlertTriangle size={14} className="mr-1.5 shrink-0" /> {r.error}
          </div>
        )}
        {r && !r.error && box.w > 0 && (
          <div
            style={{
              width: pw * scale,
              height: frameH * scale,
              margin: mode === 'single' ? `${Math.max(0, (box.h - ph * scale) / 2)}px auto 0` : '0 auto',
            }}
          >
            <iframe
              ref={frame}
              title="layout"
              srcDoc={r.html}
              onLoad={decorate}
              scrolling="no"
              style={{ width: pw, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', display: 'block', background: 'transparent' }}
            />
          </div>
        )}
      </div>
    </section>
  )
}
