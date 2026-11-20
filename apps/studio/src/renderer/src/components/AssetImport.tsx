import { useMemo, useState } from 'react'
import { Copy, Link2, Search, X } from 'lucide-react'
import { ASSET_VIEWS, nextVariant, type Asset } from '@conti/domain'
import { fileUrl } from '../data/adapters'

const KIND_LABEL = { char: '등장체', loc: '배경', prop: '소품' } as const
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
const thumb = (a: Asset) => {
  for (const v of ASSET_VIEWS[a.kind]) {
    const ver = [...(a.views[v] ?? [])].sort((x, y) => y.n - x.n)[0]
    if (ver) return ver.file
  }
  return null
}

/**
 * 복제해서 변형 — 새 태그·이름(기본 _B, " B")으로 글·이미지를 그대로 가진 새 에셋을 이 씬용으로 만든다.
 * 이 씬 샷이 원래 에셋을 쓰고 있으면 "샷도 새 에셋으로 바꾸기"를 고를 수 있다 (켜면 원래 에셋은 이 씬에서 빠진다).
 */
export function AssetCopyForm({
  asset,
  ep,
  seq,
  taken,
  usingInSeq,
  onDone,
  onCancel,
}: {
  asset: Asset
  ep: string
  seq: string
  taken: string[]
  /** 이 씬에서 원래 에셋을 쓰는 샷 수 */
  usingInSeq: number
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const init = useMemo(() => nextVariant(asset.tag, asset.nameKo, taken), [asset, taken])
  const [tag, setTag] = useState(init.tag)
  const [name, setName] = useState(init.nameKo)
  const [replace, setReplace] = useState(usingInSeq > 0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await window.conti.api.assets.copy(ep, asset.id, seq, { tag, nameKo: name, replaceInSeq: replace })
      onDone(`${r.tag} 를 ${seq} 용으로 만들었습니다${r.retagged ? ` · 샷 ${r.retagged}개를 바꿈` : ''}. 글을 고친 뒤 시트를 다시 생성하세요.`)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="copy-form" className="mt-2 space-y-1.5 rounded border border-line bg-bg/60 p-2 text-[11.5px]" onClick={(e) => e.stopPropagation()}>
      <div className="text-muted">{asset.tag} 를 복제해 {seq} 에서 따로 고쳐 쓸 새 에셋을 만듭니다.</div>
      <div className="flex gap-1.5">
        <input data-testid="copy-tag" value={tag} onChange={(e) => setTag(e.target.value)} className="w-1/2 rounded border border-line bg-bg px-1.5 py-1 font-mono outline-none focus:border-accent" />
        <input data-testid="copy-name" value={name} onChange={(e) => setName(e.target.value)} className="w-1/2 rounded border border-line bg-bg px-1.5 py-1 outline-none focus:border-accent" />
      </div>
      {usingInSeq > 0 && (
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          {seq} 샷 {usingInSeq}개도 새 에셋으로 바꾸기 (원래 {asset.tag} 는 {seq} 에서 빠집니다)
        </label>
      )}
      {err && <div className="text-warn">{err}</div>}
      <div className="flex justify-end gap-1.5">
        <button onClick={onCancel} className="rounded border border-line px-2 py-0.5 text-muted hover:text-ink">
          취소
        </button>
        <button data-testid="copy-submit" disabled={busy || !tag.trim()} onClick={() => void submit()} className="rounded bg-accent px-2 py-0.5 text-white disabled:opacity-50">
          {busy ? '만드는 중…' : '복제해서 만들기'}
        </button>
      </div>
    </div>
  )
}

/** 다른 씬에서 가져오기 — 이 씬에 없는 에셋을 씬별로 보여 주고, 그대로 쓰기(연결) 또는 복제해서 변형 */
export default function AssetImport({
  ep,
  seq,
  assets,
  seqsOf,
  onClose,
  onDone,
}: {
  ep: string
  seq: string
  assets: Asset[]
  seqsOf: Map<string, string[]>
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [kind, setKind] = useState<Asset['kind'] | 'all'>('all')
  const [q, setQ] = useState('')
  const [copying, setCopying] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const others = assets.filter((a) => !(seqsOf.get(a.id) ?? []).includes(seq))
  const shown = others.filter((a) => (kind === 'all' || a.kind === kind) && (!q.trim() || `${a.tag} ${a.nameKo}`.toLowerCase().includes(q.trim().toLowerCase())))
  const bySeq = new Map<string, Asset[]>()
  for (const a of shown) {
    const first = seqsOf.get(a.id)?.[0] ?? '씬 미지정'
    bySeq.set(first, [...(bySeq.get(first) ?? []), a])
  }
  const link = async (a: Asset) => {
    setErr(null)
    try {
      await window.conti.api.assets.link(ep, a.id, seq)
      const was = seqsOf.get(a.id) ?? []
      onDone(was.length ? `${a.tag} 를 ${seq} 에서도 그대로 씁니다 (고치면 ${was.join('·')} 에도 반영)` : `${a.tag} 를 ${seq} 에서 씁니다`)
    } catch (e) {
      setErr(errText(e))
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose} data-testid="asset-import">
      <div className="flex max-h-[80vh] w-[640px] flex-col rounded-lg border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold">다른 씬에서 가져오기 → {seq}</div>
            <div className="text-[11.5px] text-muted">그대로 쓰기 = 같은 에셋을 이 씬에도 (고치면 양쪽 반영) · 복제해서 변형 = 이 씬용 새 에셋 (따로 고침)</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2">
          {(['all', 'char', 'loc', 'prop'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded px-2 py-0.5 text-[12px] ${kind === k ? 'bg-accent/15 text-ink' : 'text-muted hover:text-ink'}`}>
              {k === 'all' ? '전부' : KIND_LABEL[k]}
            </button>
          ))}
          <span className="grow" />
          <Search size={13} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·태그" className="w-40 rounded border border-line bg-bg px-1.5 py-0.5 text-[12px] outline-none focus:border-accent" />
        </div>
        {err && <div className="px-4 pt-2 text-[12px] text-warn">{err}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!shown.length && <div className="py-10 text-center text-[12px] text-muted">{others.length ? '찾는 에셋이 없습니다' : '가져올 에셋이 없습니다'}</div>}
          {[...bySeq.entries()].map(([s, list]) => (
            <section key={s} className="mb-3">
              <div className="mb-1 font-mono text-[11.5px] text-muted">{s}</div>
              {list.map((a) => {
                const t = thumb(a)
                return (
                  <div key={a.id} data-import={a.tag} className="mb-1.5 rounded-md border border-line/70 bg-panel-2/60 p-2">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-line bg-black">{t && <img src={fileUrl(t)} alt="" className="h-full w-full object-cover" draggable={false} />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] text-accent">{a.tag}</div>
                        <div className="truncate text-[12px]">
                          {a.nameKo} <span className="text-muted">· {KIND_LABEL[a.kind]} · {(seqsOf.get(a.id) ?? []).join('·') || '씬 미지정'}</span>
                        </div>
                      </div>
                      <button data-testid="import-link" onClick={() => void link(a)} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11.5px] hover:bg-panel-2">
                        <Link2 size={12} /> 그대로 쓰기
                      </button>
                      <button
                        data-testid="import-copy"
                        onClick={() => setCopying(copying === a.id ? null : a.id)}
                        className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11.5px] hover:bg-panel-2"
                      >
                        <Copy size={12} /> 복제해서 변형
                      </button>
                    </div>
                    {copying === a.id && (
                      <AssetCopyForm asset={a} ep={ep} seq={seq} taken={assets.map((x) => x.tag)} usingInSeq={0} onDone={onDone} onCancel={() => setCopying(null)} />
                    )}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
