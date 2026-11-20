import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { KO_PAIRS, koState, type Asset, type KoPair, type KoPairEn } from '@conti/domain'
import type { AssetPatch } from '../../../shared/ipc'

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
      className={`w-full resize-none overflow-hidden rounded border border-line bg-bg px-2 py-1.5 leading-relaxed text-ink outline-none focus:border-accent ${mono ? 'font-mono text-[10.5px] text-muted' : 'text-[11.5px]'}`}
    />
  )
}

const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
type Preview = Record<string, { en: string; changesKo: string[]; ko: string; before: string }>

/**
 * 에셋 카드 수정 — 한글로 고친다. 생성에는 영문이 쓰이므로, 한글을 고친 칸은 [저장] 때 AI 가 영문을 다시 쓰고
 * "바뀐 점"을 보여준 뒤 [이대로 저장]으로 확정한다. 영문은 [EN]을 펼쳐 직접 고칠 수도 있다(그 칸의 한글은 저장 뒤 다시 옮김).
 */
export default function AssetEditor({ asset, ep, alignFields, onClose }: { asset: Asset; ep: string; alignFields?: KoPairEn[]; onClose: (notice?: string) => void }) {
  const pairs: KoPair[] = KO_PAIRS.filter((p) => p.en === 'anchorEn' || asset[p.en] || asset[p.ko])
  const initial: Record<string, string> = { nameKo: asset.nameKo }
  for (const p of pairs) {
    initial[p.en] = asset[p.en] ?? ''
    initial[p.ko] = asset[p.ko] ?? ''
  }
  const [draft, setDraft] = useState(initial)
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const [showEn, setShowEn] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview>({})
  const [busy, setBusy] = useState<number | null>(null) // 영문 변환 시작 시각
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (busy == null) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - busy) / 1000)), 500)
    return () => clearInterval(t)
  }, [busy])

  const same = (a: string, b: string) => a.trim() === b.trim()
  // 영문을 다시 써야 하는 칸: 한글을 고쳤거나 맞추기를 요청했는데, 아직 이 한글 기준의 변환 결과가 없는 칸
  const needEn = pairs.filter((p) => {
    const want = !same(draft[p.ko], initial[p.ko]) || alignFields?.includes(p.en)
    if (!want || !draft[p.ko].trim()) return false
    return !(preview[p.en] && same(preview[p.en].ko, draft[p.ko]))
  })
  const changed = Object.keys(initial).filter((k) => !same(draft[k], initial[k]))

  async function convert(list: KoPair[]) {
    if (!list.length) return
    setErr(null)
    setElapsed(0)
    setBusy(Date.now())
    try {
      const r = await window.conti.api.assets.koToEn(
        ep,
        asset.id,
        list.map((p) => ({ field: p.en, ko: draft[p.ko], en: draft[p.en] })),
      )
      setPreview((pv) => {
        const next = { ...pv }
        for (const f of r) {
          const p = list.find((x) => x.en === f.field)!
          next[f.field] = { en: f.en, changesKo: f.changesKo, ko: draft[p.ko], before: pv[f.field]?.before ?? draft[p.en] }
        }
        return next
      })
      setDraft((d) => ({ ...d, ...Object.fromEntries(r.map((f) => [f.field, f.en])) }))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(null)
    }
  }

  // 카드의 [한글대로 영문 맞추기]로 들어왔으면 바로 변환
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !alignFields?.length) return
    started.current = true
    void convert(pairs.filter((p) => alignFields.includes(p.en) && draft[p.ko].trim()))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (needEn.length) {
      await convert(needEn) // 먼저 영문을 만들어 바뀐 점을 보여준다 — 확인 후 한 번 더 눌러 저장
      return
    }
    if (!changed.length) return onClose()
    setErr(null)
    setSaving(true)
    try {
      const syncFields = pairs.filter((p) => preview[p.en] && same(preview[p.en].ko, draft[p.ko]) && same(preview[p.en].en, draft[p.en])).map((p) => p.en)
      const patch = { ...Object.fromEntries(changed.map((k) => [k, draft[k]])), syncFields } as AssetPatch
      const r = await window.conti.api.assets.update(ep, asset.id, patch)
      // 영문만 직접 고친 칸은 한글을 다시 옮긴다 (기다리지 않음)
      const enOnly = pairs.filter((p) => !same(draft[p.en], initial[p.en]) && !syncFields.includes(p.en)).map((p) => p.en)
      if (enOnly.length) void window.conti.api.assets.translateKo(ep, [asset.id], enOnly).catch(() => undefined)
      onClose(`저장됨${r.staleShots ? ` · 이 에셋이 나오는 콘티 ${r.staleShots}컷 재생성 필요` : ''}`)
    } catch (e) {
      setErr(errText(e))
      setSaving(false)
    }
  }

  const pending = Object.keys(preview).length > 0 && !needEn.length
  return (
    <div
      className="mt-2 space-y-2 rounded border border-accent/50 bg-bg/60 p-2"
      data-testid="asset-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
      }}
    >
      <label className="block">
        <span className="text-[10px] text-muted">이름</span>
        <AutoText value={draft.nameKo} onChange={(v) => set('nameKo', v)} testid="edit-nameKo" />
      </label>
      {pairs.map((p) => {
        const pv = preview[p.en]
        const fresh = !!pv && same(pv.ko, draft[p.ko])
        const open = showEn.has(p.en)
        const st = koState(asset, p)
        return (
          <div key={p.en} data-pair={p.en}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted">
                {p.label}
                {(st === 'unknown' || st === 'koNewer') && !fresh ? <span className="ml-1 text-warn">· 영문과 다를 수 있음</span> : null}
              </span>
              <button
                data-testid={`edit-show-en-${p.en}`}
                onClick={() => setShowEn((s) => (s.has(p.en) ? new Set([...s].filter((x) => x !== p.en)) : new Set([...s, p.en])))}
                className={`rounded px-1 font-mono text-[9.5px] ${open ? 'bg-panel-2 text-ink' : 'text-muted/70 hover:text-muted'}`}
                title="생성에 쓰이는 영문 — 직접 고칠 수도 있다"
              >
                EN
              </button>
            </div>
            <AutoText value={draft[p.ko]} onChange={(v) => set(p.ko, v)} testid={`edit-${p.ko}`} />
            {pv && (
              <div className="mt-1 rounded bg-panel-2/70 px-2 py-1.5 text-[10.5px]" data-testid={`changes-${p.en}`}>
                <div className="flex items-center justify-between text-muted">
                  <span>{!fresh ? '한글을 다시 고쳤습니다 — 저장 때 영문을 다시 씁니다' : pv.changesKo.length ? '영문에서 바뀐 점' : '영문은 이미 같은 내용입니다'}</span>
                  <button
                    className="flex items-center gap-1 hover:text-ink"
                    onClick={() => {
                      set(p.en, pv.before)
                      setPreview((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== p.en)))
                    }}
                  >
                    <Undo2 size={11} /> 영문 되돌리기
                  </button>
                </div>
                {fresh &&
                  pv.changesKo.map((c, i) => (
                    <div key={i} data-change className="text-ink/85">
                      · {c}
                    </div>
                  ))}
              </div>
            )}
            {open && (
              <div className="mt-1">
                <AutoText value={draft[p.en]} onChange={(v) => set(p.en, v)} mono testid={`edit-${p.en}`} />
              </div>
            )}
          </div>
        )
      })}

      {err && <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{err}</div>}

      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-[10.5px] text-muted" data-testid="editor-status">
          {busy != null ? `영문으로 옮기는 중… ${elapsed}초` : needEn.length ? `한글을 고친 칸 ${needEn.length}개 — 저장하면 영문을 다시 씁니다` : pending ? '바뀐 점을 확인하고 저장하세요' : ''}
        </span>
        <button onClick={() => onClose()} className="rounded px-2 py-1 text-[11px] text-muted hover:text-ink" title="Esc">
          취소
        </button>
        <button
          data-testid="asset-save"
          disabled={saving || busy != null}
          onClick={() => void save()}
          className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          title="⌘Enter"
        >
          {saving ? '저장 중…' : needEn.length ? '저장 (영문 반영)' : pending ? '이대로 저장' : changed.length ? '저장' : '닫기'}
        </button>
      </div>
    </div>
  )
}
