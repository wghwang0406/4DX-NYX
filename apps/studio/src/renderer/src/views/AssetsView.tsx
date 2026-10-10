import { useEffect, useState } from 'react'
import { Box, User, MapPin, Package, Play, Images } from 'lucide-react'
import { ASSET_VIEWS, type Asset } from '@conti/domain'
import { useProject } from '../state/project'
import { fileUrl } from '../data/adapters'

const KIND_LABEL = { char: '등장체', loc: '배경', prop: '소품' } as const
const KIND_ICON = { char: User, loc: MapPin, prop: Package } as const
const VIEW_LABEL: Record<string, string> = { sheet: '시트', front: '정면', back: '후면', face: '얼굴', wide: '와이드', '34': '3/4', top: '탑', detail: '디테일' }

/** 에셋 사전 — AI(conti-setup)가 추출한 등장체/배경/소품 + 시트·뷰 이미지. 생성은 승인 카드를 거친다. */
export default function AssetsView() {
  const { sequences, seq } = useProject()
  const ep = sequences.find((s) => s.seq === seq)?.ep ?? sequences[0]?.ep ?? 'EP01'
  const [assets, setAssets] = useState<Asset[]>([])
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    try {
      setAssets(await window.conti.api.assets.list(ep))
    } catch {
      setAssets([])
    }
  }
  useEffect(() => {
    void load()
    return window.conti.onStoreChange((c) => {
      if (c.type === 'assets') void load()
    })
  }, [ep]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runSetup() {
    setErr(null)
    setRunning(true)
    try {
      await window.conti.agent.runTask('setup', seq ?? undefined)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  async function generate(ids: string[], views?: string[]) {
    setErr(null)
    try {
      await window.conti.agent.requestSpend('assets_generate', { ep, ids, views })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  const latest = (a: Asset, view: string) => [...(a.views[view] ?? [])].sort((x, y) => y.n - x.n)[0]
  const missing = assets.filter((a) => ASSET_VIEWS[a.kind].some((v) => !latest(a, v)))
  const groups = (['char', 'loc', 'prop'] as const).map((k) => ({ kind: k, items: assets.filter((a) => a.kind === k) }))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0">
      <section className="flex items-center justify-between rounded-lg border border-line bg-panel p-4">
        <div>
          <div className="text-[14px] font-semibold">에셋 — {ep}</div>
          <div className="text-[12px] text-muted">시나리오에서 등장체·배경·소품을 뽑아 사전을 만들고, 승인하면 시트·뷰 이미지를 생성합니다. 콘티는 이 시트를 레퍼런스로 그립니다.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!missing.length}
            onClick={() => void generate(missing.map((a) => a.id))}
            className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2 disabled:opacity-50"
            title="시트·뷰가 빠진 에셋만 생성 (승인 카드)"
          >
            <Images size={14} /> 빠진 시트 생성 {missing.length ? `(${missing.length})` : ''}
          </button>
          <button disabled={running || !seq} onClick={() => void runSetup()} className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50">
            <Play size={14} /> {running ? '추출 중…' : 'AI로 에셋 추출'}
          </button>
        </div>
      </section>
      {err && <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12px] text-red-300">{err}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        {groups.map(({ kind, items }) => {
          const Icon = KIND_ICON[kind]
          return (
            <section key={kind} className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
              <div className="flex h-9 items-center gap-2 border-b border-line px-3 text-[12.5px] font-medium">
                <Icon size={14} className="text-muted" /> {KIND_LABEL[kind]} <span className="text-muted">{items.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {items.length === 0 && (
                  <div className="flex h-full items-center justify-center text-[12px] text-muted">
                    <Box size={14} className="mr-1" /> 없음
                  </div>
                )}
                {items.map((a) => (
                  <div key={a.id} className="mb-2 rounded-md border border-line/70 bg-panel-2/60 p-2.5">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[12px] text-accent">{a.tag}</span>
                      <span className="text-[10.5px] text-muted">
                        {a.subkind ?? ''} {a.state !== 'base' ? `· ${a.state}` : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12.5px]">{a.nameKo}</div>
                    {a.descriptionKo && <div className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{a.descriptionKo}</div>}
                    <div className="mt-2 flex gap-1.5">
                      {ASSET_VIEWS[kind].map((v) => {
                        const ver = latest(a, v)
                        return (
                          <button
                            key={v}
                            onClick={() => void generate([a.id], [v])}
                            title={ver ? `${VIEW_LABEL[v] ?? v} v${ver.n} — 클릭하면 이 뷰만 다시 생성` : `${VIEW_LABEL[v] ?? v} — 클릭하면 생성`}
                            className={`relative h-12 flex-1 overflow-hidden rounded border ${ver ? 'border-line bg-black' : 'border-dashed border-line/70 bg-bg'}`}
                          >
                            {ver && <img src={fileUrl(ver.file)} alt={v} className="h-full w-full object-cover" draggable={false} />}
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9.5px] text-white">{VIEW_LABEL[v] ?? v}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      {a.anchorEn ? <div className="line-clamp-1 font-mono text-[10px] text-muted/80">{a.anchorEn}</div> : <span />}
                      <button onClick={() => void generate([a.id])} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-ink">
                        전체 생성
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
