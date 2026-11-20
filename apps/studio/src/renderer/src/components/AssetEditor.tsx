import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Languages, Undo2 } from 'lucide-react'
import type { Asset } from '@conti/domain'
import type { AssetPatch } from '../../../shared/ipc'

type Field = keyof Required<AssetPatch>
const FIELDS: Array<{ key: Field; label: string; mono?: boolean; always?: boolean }> = [
  { key: 'nameKo', label: '이름', always: true },
  { key: 'descriptionKo', label: '한글 설명 · 기준', always: true },
  { key: 'anchorEn', label: '외형 앵커 (EN) · 생성에 쓰임', mono: true, always: true },
  { key: 'cameraAnchorEn', label: '카메라 앵커 (EN)', mono: true },
  { key: 'masterProfileEn', label: '연기 마스터 프로필 (EN)', mono: true },
  { key: 'voiceEn', label: 'Voice (EN)', mono: true },
]

/** 내용만큼 늘어나는 textarea */
function AutoText({ value, onChange, mono, testid }: { value: string; onChange: (v: string) => void; mono?: boolean; testid: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      data-testid={testid}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded border border-line bg-bg px-2 py-1.5 leading-relaxed text-ink outline-none focus:border-accent ${mono ? 'font-mono text-[11px]' : 'text-[11.5px]'}`}
    />
  )
}

/**
 * 에셋 카드 수정 — 한글 설명이 기준이고, 생성에는 영문 외형 앵커가 쓰인다.
 * [한글대로 영문 맞추기]는 AI 가 영문만 다시 써서 칸에 채운다(저장 전). 저장은 바뀐 칸만 보낸다.
 */
export default function AssetEditor({ asset, ep, onClose }: { asset: Asset; ep: string; onClose: (notice?: string) => void }) {
  const initial = Object.fromEntries(FIELDS.map((f) => [f.key, asset[f.key] ?? ''])) as Record<Field, string>
  const [draft, setDraft] = useState(initial)
  const set = (k: Field, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const [aligning, setAligning] = useState<number | null>(null) // 시작 시각
  const [elapsed, setElapsed] = useState(0)
  const [changes, setChanges] = useState<string[] | null>(null)
  const [beforeAlign, setBeforeAlign] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (aligning == null) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - aligning) / 1000)), 500)
    return () => clearInterval(t)
  }, [aligning])

  const changed = FIELDS.filter((f) => draft[f.key].trim() !== (initial[f.key] ?? '').trim()).map((f) => f.key)
  const koOnly = changed.includes('descriptionKo') && !changed.includes('anchorEn')

  async function align() {
    setErr(null)
    setElapsed(0)
    setAligning(Date.now())
    try {
      const r = await window.conti.api.assets.alignAnchor(ep, asset.id, { nameKo: draft.nameKo, descriptionKo: draft.descriptionKo, anchorEn: draft.anchorEn })
      setBeforeAlign(draft.anchorEn)
      set('anchorEn', r.anchorEn)
      setChanges(r.changesKo)
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setAligning(null)
    }
  }

  async function save() {
    if (!changed.length) return onClose()
    setErr(null)
    setSaving(true)
    try {
      const patch = Object.fromEntries(changed.map((k) => [k, draft[k]])) as AssetPatch
      const r = await window.conti.api.assets.update(ep, asset.id, patch)
      onClose(`저장됨${r.staleShots ? ` · 이 에셋이 나오는 콘티 ${r.staleShots}컷 재생성 필요` : ''}`)
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      setSaving(false)
    }
  }

  return (
    <div
      className="mt-2 space-y-2 rounded border border-accent/50 bg-bg/60 p-2"
      data-testid="asset-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
      }}
    >
      {FIELDS.filter((f) => f.always || initial[f.key]).map((f) => (
        <label key={f.key} className="block">
          <span className={`text-[10px] ${f.key === 'anchorEn' ? 'text-accent' : 'text-muted'}`}>{f.label}</span>
          <AutoText value={draft[f.key]} onChange={(v) => set(f.key, v)} mono={f.mono} testid={`edit-${f.key}`} />
          {f.key === 'anchorEn' && changes && (
            <div className="mt-1 rounded bg-panel-2/70 px-2 py-1.5 text-[10.5px]" data-testid="align-changes">
              <div className="flex items-center justify-between text-muted">
                <span>{changes.length ? '바뀐 점' : '이미 한글과 같습니다'}</span>
                {beforeAlign != null && (
                  <button
                    className="flex items-center gap-1 hover:text-ink"
                    onClick={() => {
                      set('anchorEn', beforeAlign)
                      setBeforeAlign(null)
                      setChanges(null)
                    }}
                  >
                    <Undo2 size={11} /> 되돌리기
                  </button>
                )}
              </div>
              {changes.map((c, i) => (
                <div key={i} data-change className="text-ink/85">
                  · {c}
                </div>
              ))}
            </div>
          )}
        </label>
      ))}

      {koOnly && aligning == null && <div className="text-[10.5px] text-warn">영문 앵커는 그대로입니다 — 생성에는 영문이 쓰입니다. [한글대로 영문 맞추기]를 눌러 보세요.</div>}
      {err && <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{err}</div>}

      <div className="flex items-center gap-1.5">
        <button
          data-testid="align-anchor"
          disabled={aligning != null || saving || !draft.descriptionKo.trim()}
          onClick={() => void align()}
          className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] hover:bg-panel-2 disabled:opacity-50"
          title="한글 설명을 기준으로 AI 가 영문 외형 앵커를 다시 씁니다 (저장 전에 확인)"
        >
          <Languages size={12} /> {aligning != null ? `맞추는 중… ${elapsed}초` : '한글대로 영문 맞추기'}
        </button>
        <span className="flex-1" />
        <button onClick={() => onClose()} className="rounded px-2 py-1 text-[11px] text-muted hover:text-ink" title="Esc">
          취소
        </button>
        <button
          data-testid="asset-save"
          disabled={saving || aligning != null}
          onClick={() => void save()}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          title="⌘Enter"
        >
          {saving ? '저장 중…' : changed.length ? `저장 (${changed.length}칸)` : '닫기'}
        </button>
      </div>
    </div>
  )
}
