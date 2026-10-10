import { useCallback, useEffect, useState } from 'react'
import { FileDown, Images, Film, FlaskConical, FolderOpen, Copy, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import LayoutPreview from '../components/LayoutPreview'
import { useProject } from '../state/project'
import type { ExportKind, ExportRecord, TemplateInfo } from '../../../shared/layout-ipc'

const KIND_LABEL: Record<ExportKind, string> = { pdf: 'PDF', png: 'PNG', animatic: '애니매틱 mp4' }
const STATUSES = ['작업 중', '컨펌용', '최종']

/** 레이아웃 — 실제 템플릿으로 시퀀스 전체 시트를 보고 PDF/PNG/애니매틱을 뽑는다. Template Lab 에서 템플릿을 고치면 바로 다시 그린다. */
export default function LayoutView({ selectedShot, onSelect }: { selectedShot: string | null; onSelect: (no: string) => void }) {
  const { seq, project } = useProject()
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [lab, setLab] = useState(() => new URLSearchParams(window.location.search).get('lab') === '1')
  const [labTemplate, setLabTemplate] = useState<string | undefined>()
  const [sample, setSample] = useState(false)
  const [status, setStatus] = useState(STATUSES[0])
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; file?: string } | null>(null)
  const [history, setHistory] = useState<ExportRecord[]>([])

  const loadTemplates = useCallback(async () => setTemplates(await window.conti.layout.templates()), [])
  const loadHistory = useCallback(async () => {
    if (seq) setHistory(await window.conti.layout.history(seq))
  }, [seq])
  useEffect(() => {
    void loadTemplates()
    return window.conti.onLayoutChange(() => void loadTemplates())
  }, [loadTemplates])
  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const current = templates.find((t) => t.current) ?? templates.find((t) => t.id === project?.layoutTemplateId)
  const previewId = lab ? (labTemplate ?? current?.id) : current?.id
  const labT = templates.find((t) => t.id === previewId)

  async function doExport(kind: ExportKind) {
    if (!seq) return
    setBusy(kind)
    setMsg(null)
    try {
      const r = await window.conti.layout.export(seq, kind, { status, templateId: lab ? previewId : undefined })
      const name = r.files[0]?.split('/').pop() ?? ''
      setMsg({ ok: true, text: `${KIND_LABEL[kind]} ${r.reused ? '변경 없음 — 이전 출력 재사용' : `v${r.version} 저장`} · ${name}${r.files.length > 1 ? ` 외 ${r.files.length - 1}개` : ''} · ${(r.ms / 1000).toFixed(1)}초`, file: r.files[0] })
      void loadHistory()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') })
    } finally {
      setBusy(null)
    }
  }

  async function duplicate() {
    if (!previewId) return
    const name = window.prompt('새 템플릿 이름', `${labT?.name ?? previewId} 수정본`)
    if (!name) return
    try {
      const t = await window.conti.layout.duplicate(previewId, name)
      await loadTemplates()
      setLabTemplate(t.id)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3 pt-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            템플릿
            <select
              value={current?.id ?? ''}
              onChange={(e) => void window.conti.layout.setTemplate(e.target.value).then(loadTemplates)}
              className="rounded border border-line bg-bg px-1.5 py-1 text-[12px] text-ink outline-none"
            >
              {templates
                .filter((t) => !t.error)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.builtin ? '' : ' (사용자)'}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            상태 표기
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-line bg-bg px-1.5 py-1 text-[12px] text-ink outline-none">
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            {(['pdf', 'png', 'animatic'] as ExportKind[]).map((k) => (
              <button
                key={k}
                disabled={!seq || !!busy}
                onClick={() => void doExport(k)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] disabled:opacity-50 ${k === 'pdf' ? 'bg-accent font-medium text-white hover:brightness-110' : 'border border-line hover:bg-panel-2'}`}
              >
                {busy === k ? <Loader2 size={13} className="animate-spin" /> : k === 'pdf' ? <FileDown size={13} /> : k === 'png' ? <Images size={13} /> : <Film size={13} />}
                {KIND_LABEL[k]}
              </button>
            ))}
            <button
              onClick={() => setLab((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] ${lab ? 'border-accent bg-accent-soft text-ink' : 'border-line hover:bg-panel-2'}`}
              title="템플릿 폴더를 고치며 실시간으로 확인"
            >
              <FlaskConical size={13} /> Template Lab
            </button>
          </div>
        </section>
        {msg && (
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] ${msg.ok ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200' : 'border-red-900/60 bg-red-950/40 text-red-300'}`}>
            {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {msg.text}
            {msg.file && (
              <button onClick={() => void window.conti.layout.reveal(msg.file!)} className="ml-auto flex items-center gap-1 underline-offset-2 hover:underline">
                <ExternalLink size={12} /> Finder에서 보기
              </button>
            )}
          </div>
        )}
        <LayoutPreview seq={sample ? null : seq} sample={lab && sample} templateId={previewId} mode="all" selectedShot={selectedShot} onSelect={onSelect} title={lab ? `Template Lab — ${labT?.name ?? ''}` : '시트 전체'} className="flex-1" />
      </div>

      <aside className="flex w-[280px] shrink-0 flex-col gap-3">
        {lab && labT && (
          <section className="rounded-lg border border-accent/50 bg-panel p-3 text-[12px]">
            <div className="flex items-center gap-1.5 font-semibold">
              <FlaskConical size={13} className="text-accent" /> Template Lab
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-muted">
              미리볼 템플릿
              <select value={previewId} onChange={(e) => setLabTemplate(e.target.value)} className="min-w-0 flex-1 rounded border border-line bg-bg px-1.5 py-0.5 text-ink outline-none">
                {templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={!!t.error}>
                    {t.name}
                    {t.error ? ' (오류)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex gap-3 text-muted">
              <label className="flex items-center gap-1">
                <input type="radio" checked={!sample} onChange={() => setSample(false)} /> 현재 씬
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={sample} onChange={() => setSample(true)} /> 샘플 데이터
              </label>
            </div>
            <div className="mt-2 break-all font-mono text-[10.5px] text-muted">{labT.dir}</div>
            <div className="mt-2 text-[11px] leading-relaxed text-muted">
              {labT.builtin ? '기본 템플릿은 앱과 함께 배포됩니다. 고치려면 복제해서 사용자 템플릿으로 만드세요.' : '이 폴더의 page.hbs · style.css 를 저장하면 미리보기가 바로 다시 그려집니다.'}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => void window.conti.layout.openFolder(labT.id)} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-panel-2">
                <FolderOpen size={12} /> 폴더 열기
              </button>
              <button onClick={() => void duplicate()} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-panel-2">
                <Copy size={12} /> 복제해서 새 템플릿
              </button>
            </div>
            {templates.filter((t) => t.error).map((t) => (
              <div key={t.id} className="mt-2 rounded border border-red-900/60 bg-red-950/30 p-1.5 text-[11px] text-red-300">
                {t.id}: {t.error}
              </div>
            ))}
          </section>
        )}
        <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
          <div className="flex h-9 shrink-0 items-center px-3 text-[12.5px] font-medium">출력 기록 {seq ? `— ${seq}` : ''}</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3 text-[11.5px]">
            {!history.length && <div className="text-muted">아직 없습니다. 같은 내용을 다시 출력하면 새로 만들지 않고 이전 파일을 씁니다.</div>}
            {history.map((h) => (
              <button key={`${h.kind}-${h.v}-${h.at}`} onClick={() => void window.conti.layout.reveal(h.files[0])} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-panel-2" title={h.files.join('\n')}>
                <span className="w-16 shrink-0 text-muted">{KIND_LABEL[h.kind]}</span>
                <span className="font-mono">v{h.v}</span>
                <span className="truncate text-muted">{h.kind === 'animatic' ? '' : `${h.pages}쪽`}</span>
                <span className="ml-auto shrink-0 text-muted">{new Date(h.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
