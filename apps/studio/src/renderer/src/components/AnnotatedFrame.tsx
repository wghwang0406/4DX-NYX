import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Undo2, Trash2 } from 'lucide-react'
import { ANNOTATION_TYPES, annotationsSvg, type Annotation, type AnnotationType } from '@conti/domain'

/** 16:9 상자를 칸 안에 꽉 맞춘다 (주석 좌표 0..1 이 이 상자 기준) */
export function useFit(ratio = 16 / 9) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      const w = Math.min(cw, ch * ratio)
      setSize({ w, h: w / ratio })
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [ratio])
  return { ref, size }
}

interface Props {
  /** 상자 안에 깔 그림 (이미지 URL). media 가 있으면 그것을 대신 쓴다 */
  image?: string
  media?: ReactNode
  annotations: Annotation[]
  /** 켜면 주석 도구 줄 + 그리기 층 */
  editing: boolean
  onChange?: (list: Annotation[]) => void
  /** 상자 위에 얹을 표시(샷 번호·자막 등) */
  children?: ReactNode
}

/** 16:9 그림 + SVG 주석 + (편집 중이면) 화살표·프레임·메모 그리기. 플레이어와 컷 상세가 같이 쓴다. */
export default function AnnotatedFrame({ image, media, annotations, editing, onChange, children }: Props) {
  const { ref, size } = useFit()
  const [type, setType] = useState<AnnotationType>('move')
  const [label, setLabel] = useState('')
  const [draft, setDraftState] = useState<Array<[number, number]> | null>(null)
  // 빠른 획(누름→뗌이 렌더 전에 끝남)도 잃지 않게 점은 ref 에 모으고, state 는 그리기용
  const draftRef = useRef<Array<[number, number]> | null>(null)
  const setDraft = (d: Array<[number, number]> | null) => {
    draftRef.current = d
    setDraftState(d)
  }
  const shape = ANNOTATION_TYPES.find((t) => t.type === type)!.shape

  const norm = (e: React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  function finish(points: Array<[number, number]>) {
    setDraft(null)
    if (shape !== 'point') {
      const [a, b] = [points[0], points[points.length - 1]]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) return // 너무 짧으면 무시
    }
    // 화살표는 지나온 점을 최대 6개로 줄여 곡선으로
    const thin = (p: Array<[number, number]>) => (p.length > 6 ? p.filter((_, i) => i % Math.ceil(p.length / 5) === 0).concat([p[p.length - 1]]) : p)
    const pts = shape === 'arrow' ? thin(points) : shape === 'rect' ? [points[0], points[points.length - 1]] : [points[0]]
    const ann: Annotation = { id: crypto.randomUUID(), type, points: pts, ...(label.trim() ? { label: label.trim() } : type === 'note' ? { label: '메모' } : {}) }
    onChange?.([...annotations, ann])
  }

  const preview: Annotation[] = draft ? [...annotations, { id: 'draft', type, points: shape === 'rect' ? [draft[0], draft[draft.length - 1]] : draft, label: label || undefined }] : annotations

  return (
    <>
      {editing && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          {ANNOTATION_TYPES.map((t) => (
            <button key={t.type} onClick={() => setType(t.type)} className={`rounded border px-1.5 py-0.5 ${type === t.type ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="라벨 (선택)" className="w-24 rounded border border-line bg-bg px-1.5 py-0.5 outline-none placeholder:text-muted" />
          <button disabled={!annotations.length} onClick={() => onChange?.(annotations.slice(0, -1))} title="마지막 주석 지우기" className="rounded border border-line p-1 text-muted hover:text-ink disabled:opacity-30">
            <Undo2 size={11} />
          </button>
          <button disabled={!annotations.length} onClick={() => window.confirm('이 컷의 주석을 모두 지울까요?') && onChange?.([])} title="모두 지우기" className="rounded border border-line p-1 text-muted hover:text-ink disabled:opacity-30">
            <Trash2 size={11} />
          </button>
        </div>
      )}

      <div ref={ref} className="relative mx-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
        <div className="relative" style={{ width: size.w, height: size.h }}>
          {media ?? (image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} /> : <div className="sketch absolute inset-0" />)}
          <div className="pointer-events-none absolute inset-0" dangerouslySetInnerHTML={{ __html: annotationsSvg(preview) }} />
          {children}
          {editing && (
            <div
              data-testid="annotate-layer"
              className="absolute inset-0 cursor-crosshair"
              onMouseDown={(e) => {
                const p = norm(e)
                if (shape === 'point') return finish([p])
                setDraft([p])
              }}
              onMouseMove={(e) => {
                const d = draftRef.current
                if (!d) return
                const p = norm(e)
                const last = d[d.length - 1]
                if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.015) setDraft([...d, p])
              }}
              onMouseUp={(e) => {
                const d = draftRef.current
                if (d) finish([...d, norm(e)])
              }}
              onMouseLeave={() => {
                const d = draftRef.current
                if (d) finish(d)
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}
