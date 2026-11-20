import { useEffect, useRef, useState } from 'react'
import { Box, User, MapPin, Package, Play, Images, ChevronDown, ChevronRight, ChevronsUpDown, Download, History, Copy, Unlink } from 'lucide-react'
import { ASSET_VIEWS, KO_PAIRS, assetSeqs, koState, shotUsesTag, type Asset, type KoPairEn } from '@conti/domain'
import { useProject } from '../state/project'
import { fileUrl } from '../data/adapters'
import AssetViewer from '../components/AssetViewer'
import AssetKoView from '../components/AssetKoView'
import AssetHistory from '../components/AssetHistory'
import AssetImport, { AssetCopyForm } from '../components/AssetImport'
import type { KoChange } from '../../../shared/ipc'

const KIND_LABEL = { char: '등장체', loc: '배경', prop: '소품' } as const
const KIND_ICON = { char: User, loc: MapPin, prop: Package } as const
const VIEW_LABEL: Record<string, string> = { sheet: '시트', front: '정면', back: '후면', face: '얼굴', wide: '와이드', '34': '3/4', top: '탑', detail: '디테일' }

/**
 * 에셋 사전 — AI(conti-setup)가 추출한 등장체/배경/소품 + 시트·뷰 이미지. 생성은 승인 카드를 거친다.
 * 에셋은 에피소드 단위로 저장되고, 화면은 씬별 탭으로 나눠 보여 준다 (나오는 씬 = usedIn ∪ 샷 태그, assetSeqs).
 * 씬 탭은 헤더의 현재 씬과 같이 움직인다. 다른 씬 에셋은 [다른 씬에서 가져오기]로 그대로 쓰거나(연결) 복제해서 변형한다.
 */
export default function AssetsView() {
  const { sequences, seq, setSeq } = useProject()
  const ep = sequences.find((s) => s.seq === seq)?.ep ?? sequences[0]?.ep ?? 'EP01'
  const epSeqs = sequences.filter((s) => s.ep === ep)
  const [allAssets, setAssets] = useState<Asset[]>([])
  const [importing, setImporting] = useState(false)
  // 어느 씬에도 안 걸린 에셋 (예전 에셋·씬에서 다 뺀 것) — 있을 때만 [씬 미지정] 탭
  const [unassignedTab, setUnassignedTab] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // 카드별 열린 패널 — 히스토리 / 복제해서 변형
  const [panel, setPanel] = useState<Record<string, 'history' | 'copy' | undefined>>({})
  const togglePanel = (id: string, p: 'history' | 'copy') => setPanel((x) => ({ ...x, [id]: x[id] === p ? undefined : p }))
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // 크게 보기 (썸네일 클릭) — 다시 생성은 뷰어 안의 버튼으로만
  const [viewer, setViewer] = useState<{ id: string; view: string } | null>(null)
  const viewerOpened = useRef(false)
  // 펼친 카드 — 잘린 설명·앵커 전체를 본다 (화면 상태만, 저장 안 함)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // 영문 프롬프트를 한글로 옮기는 중인 카드 / 실패 이유 (펼치면 자동으로 옮긴다)
  const [translating, setTranslating] = useState<Set<string>>(new Set())
  const [tFailed, setTFailed] = useState<Record<string, string>>({})
  const [autoNotes, setAutoNotes] = useState<Record<string, Partial<Record<KoPairEn, KoChange>>>>({})
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function load() {
    try {
      const list = await window.conti.api.assets.list(ep)
      setAssets(list)
      if (new URLSearchParams(window.location.search).get('expand') === '1') setOpen(new Set(list.map((a) => a.id)))
      // 캡처용: ?view=@태그:뷰 면 그 이미지를 크게 연다
      const want = new URLSearchParams(window.location.search).get('view')
      const hit = want ? list.find((a) => a.tag === want.split(':')[0]) : undefined
      if (hit && !viewerOpened.current) {
        viewerOpened.current = true
        setViewer({ id: hit.id, view: want!.split(':')[1] })
      }
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

  // 한·영 자동 맞춤 — 한글 없는 칸 번역 / 한글만 바뀐 칸은 영문을 / 예전 에셋은 합쳐서 하나로. 화면을 열면 펼침과 상관없이
  // 이 에피소드 전체를 돌고, 에셋이 바뀔 때마다 다시 본다. 여러 에셋을 묶어 AI 호출을 줄인다. 사람에게 묻지 않는다.
  const asked = useRef(new Set<string>())
  async function reconcile(ids: string[], force?: KoPairEn[]) {
    if (!ids.length) return
    setTranslating((s) => new Set([...s, ...ids]))
    setTFailed((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !ids.includes(k))))
    try {
      const r = await window.conti.api.assets.reconcileKo(ep, ids, force)
      if (r.changes.length)
        setAutoNotes((n) => {
          const next = { ...n }
          for (const c of r.changes) next[c.id] = { ...(next[c.id] ?? {}), [c.field]: c }
          return next
        })
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      setTFailed((f) => ({ ...f, ...Object.fromEntries(ids.map((id) => [id, msg])) }))
    } finally {
      setTranslating((s) => new Set([...s].filter((x) => !ids.includes(x))))
    }
  }
  useEffect(() => {
    const todo = (a: Asset) => KO_PAIRS.filter((p) => ['enNewer', 'koNewer', 'unknown'].includes(koState(a, p)))
    // 같은 내용으로 두 번 부르지 않게 — 값이 바뀌면(키가 달라지면) 다시
    const key = (a: Asset) => `${a.id}:${todo(a).map((p) => `${p.en}=${(a[p.en] ?? '').length}/${(a[p.ko] ?? '').length}`).join(',')}`
    const need = allAssets.filter((a) => !translating.has(a.id) && !tFailed[a.id] && todo(a).length && !asked.current.has(key(a)))
    if (!need.length) return
    need.forEach((a) => asked.current.add(key(a)))
    void reconcile(need.map((a) => a.id))
  }, [allAssets]) // eslint-disable-line react-hooks/exhaustive-deps

  // 씬별 보기 — 나오는 씬이 없는 에셋은 [씬 미지정] 탭에 모인다 (거기서 다른 씬으로 가져다 쓸 수 있다)
  const seqsOf = new Map(allAssets.map((a) => [a.id, assetSeqs(a, epSeqs)]))
  const inSeq = (a: Asset, s: string) => (seqsOf.get(a.id) ?? []).includes(s)
  const unassigned = allAssets.filter((a) => !(seqsOf.get(a.id) ?? []).length)
  const showUnassigned = unassignedTab && unassigned.length > 0
  const scoped = !showUnassigned && seq && epSeqs.some((s) => s.seq === seq) ? seq : null
  const assets = showUnassigned ? unassigned : scoped ? allAssets.filter((a) => inSeq(a, scoped)) : allAssets
  const seqShots = epSeqs.find((s) => s.seq === scoped)?.shots ?? []
  const usingHere = (a: Asset) => seqShots.filter((sh) => shotUsesTag(sh, a.tag)).length
  async function unlink(a: Asset) {
    if (!scoped) return
    setErr(null)
    try {
      await window.conti.api.assets.unlink(ep, a.id, scoped)
      setNotice(`${a.tag} 를 ${scoped} 에서 뺐습니다 (에셋은 ${(seqsOf.get(a.id) ?? []).filter((x) => x !== scoped).join('·') || '씬 미지정'} 에 남아 있습니다)`)
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }
  const allOpen = assets.length > 0 && assets.every((a) => open.has(a.id))

  async function runSetup() {
    setErr(null)
    setRunning(true)
    try {
      await window.conti.agent.runTask('setup', scoped ?? undefined)
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
          <div className="text-[14px] font-semibold">
            에셋 — {ep}
            {scoped ? ` · ${scoped}` : ''}
          </div>
          <div className="text-[12px] text-muted">시나리오에서 등장체·배경·소품을 뽑아 사전을 만들고, 승인하면 시트·뷰 이미지를 생성합니다. 콘티는 이 시트를 레퍼런스로 그립니다.</div>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <button
            data-testid="assets-import"
            disabled={!scoped}
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2 disabled:opacity-50"
            title="다른 씬의 에셋을 이 씬에서 그대로 쓰거나 복제해서 변형"
          >
            <Download size={14} /> 다른 씬에서 가져오기
          </button>
          <button
            data-testid="assets-expand-all"
            disabled={!assets.length}
            onClick={() => setOpen(allOpen ? new Set() : new Set(assets.map((a) => a.id)))}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2 disabled:opacity-50"
          >
            <ChevronsUpDown size={14} /> {allOpen ? '모두 접기' : '모두 펼치기'}
          </button>
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
      {epSeqs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="asset-seq-tabs">
          {epSeqs.map((s) => {
            const on = !showUnassigned && scoped === s.seq
            return (
              <button
                key={s.seq}
                data-seq-tab={s.seq}
                aria-pressed={on}
                onClick={() => {
                  setUnassignedTab(false)
                  setSeq(s.seq)
                }}
                title={s.headingKo}
                className={`rounded-md border px-2.5 py-1 font-mono text-[12px] ${on ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`}
              >
                {s.seq} <span className="text-[10.5px] opacity-70">{allAssets.filter((a) => inSeq(a, s.seq)).length}</span>
              </button>
            )
          })}
          {unassigned.length > 0 && (
            <button
              data-seq-tab="unassigned"
              aria-pressed={showUnassigned}
              onClick={() => setUnassignedTab(true)}
              title="어느 씬에도 연결되지 않은 에셋 — 씬 탭에서 [다른 씬에서 가져오기]로 다시 쓸 수 있다"
              className={`rounded-md border border-dashed px-2.5 py-1 text-[12px] ${showUnassigned ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`}
            >
              씬 미지정 <span className="text-[10.5px] opacity-70">{unassigned.length}</span>
            </button>
          )}
        </div>
      )}
      {notice && (
        <div data-testid="assets-notice" className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[12px]">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-muted hover:text-ink">
            닫기
          </button>
        </div>
      )}
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
                {items.map((a) => {
                  const expanded = open.has(a.id)
                  return (
                  <div key={a.id} data-asset={a.tag} className="mb-2 rounded-md border border-line/70 bg-panel-2/60 p-2.5">
                    <button onClick={() => toggle(a.id)} className="block w-full text-left" title={expanded ? '접기' : '눌러서 펼치기'}>
                      <div className="flex items-baseline justify-between">
                        <span className="flex items-center gap-1 font-mono text-[12px] text-accent">
                          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {a.tag}
                        </span>
                        <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
                          {a.subkind ?? ''} {a.state !== 'base' ? `· ${a.state}` : ''}
                          {(seqsOf.get(a.id)?.length ?? 0) > 1 && (
                            <span data-shared={a.tag} className="rounded border border-line px-1 font-mono" title="여러 씬에 나오는 에셋">
                              {seqsOf.get(a.id)!.join('·')}
                            </span>
                          )}
                
                        </span>
                      </div>
                      {!expanded && <div className="mt-0.5 text-[12.5px]">{a.nameKo}</div>}
                      {a.descriptionKo && !expanded && (
                        <div title={a.descriptionKo} className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                          {a.descriptionKo}
                        </div>
                      )}
                    </button>
                    {expanded && (
                      <AssetKoView
                        asset={a}
                        ep={ep}
                        translating={translating.has(a.id)}
                        failed={tFailed[a.id]}
                        autoNotes={autoNotes[a.id]}
                        seqs={seqsOf.get(a.id) ?? []}
                        onRetry={() => void reconcile([a.id])}
                        onDismissAuto={(f) => setAutoNotes((n) => ({ ...n, [a.id]: Object.fromEntries(Object.entries(n[a.id] ?? {}).filter(([k]) => k !== f)) }))}
                      />
                    )}
                    <div className="mt-2 flex gap-1.5">
                      {ASSET_VIEWS[kind].map((v) => {
                        const ver = latest(a, v)
                        return (
                          <button
                            key={v}
                            data-thumb={`${a.tag}:${v}`}
                            onClick={() => setViewer({ id: a.id, view: v })}
                            title={ver ? `${VIEW_LABEL[v] ?? v} v${ver.n} — 눌러서 크게 보기` : `${VIEW_LABEL[v] ?? v} — 아직 없음 (눌러서 생성 메뉴)`}
                            className={`relative h-12 flex-1 overflow-hidden rounded border ${ver ? 'cursor-zoom-in border-line bg-black hover:border-accent' : 'border-dashed border-line/70 bg-bg hover:border-muted'}`}
                          >
                            {ver && <img src={fileUrl(ver.file)} alt={v} className="h-full w-full object-cover" draggable={false} />}
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9.5px] text-white">{VIEW_LABEL[v] ?? v}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 whitespace-nowrap">
                      <span className="flex flex-wrap gap-1.5">
                        <button
                          data-testid="card-history"
                          onClick={() => togglePanel(a.id, 'history')}
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${panel[a.id] === 'history' ? 'border-accent text-ink' : 'border-line text-muted hover:text-ink'}`}
                          title="수정 히스토리 — 글·이미지가 언제 누구 손으로 바뀌었는지, 되돌리기"
                        >
                          <History size={11} /> 히스토리
                        </button>
                        {scoped && (
                          <button
                            data-testid="card-copy"
                            onClick={() => togglePanel(a.id, 'copy')}
                            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] ${panel[a.id] === 'copy' ? 'border-accent text-ink' : 'border-line text-muted hover:text-ink'}`}
                            title={`${scoped} 에서 조금 다르게 쓸 새 에셋(_B)을 만든다`}
                          >
                            <Copy size={11} /> 복제해서 변형
                          </button>
                        )}
                        {scoped && (seqsOf.get(a.id) ?? []).includes(scoped) && (
                          <button
                            data-testid="card-unlink"
                            disabled={usingHere(a) > 0}
                            onClick={() => void unlink(a)}
                            className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-ink disabled:opacity-40"
                            title={usingHere(a) ? `${scoped} 샷 ${usingHere(a)}개가 쓰고 있어 뺄 수 없습니다` : `${scoped} 에서 빼기 (에셋은 남는다)`}
                          >
                            <Unlink size={11} /> 이 씬에서 빼기
                          </button>
                        )}
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <button onClick={() => void generate([a.id])} className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-ink">
                          전체 생성
                        </button>
                      </span>
                    </div>
                    {panel[a.id] === 'history' && (
                      <div className="mt-2">
                        <AssetHistory asset={a} ep={ep} />
                      </div>
                    )}
                    {panel[a.id] === 'copy' && scoped && (
                      <AssetCopyForm
                        asset={a}
                        ep={ep}
                        seq={scoped}
                        taken={allAssets.map((x) => x.tag)}
                        usingInSeq={usingHere(a)}
                        onCancel={() => togglePanel(a.id, 'copy')}
                        onDone={(m) => {
                          setNotice(m)
                          togglePanel(a.id, 'copy')
                        }}
                      />
                    )}
                  </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
      {importing && scoped && (
        <AssetImport
          ep={ep}
          seq={scoped}
          assets={allAssets}
          seqsOf={seqsOf}
          onClose={() => setImporting(false)}
          onDone={(m) => {
            setNotice(m)
            setImporting(false)
          }}
        />
      )}
      {viewer && allAssets.find((x) => x.id === viewer.id) && (
        <AssetViewer
          key={viewer.id}
          asset={allAssets.find((x) => x.id === viewer.id)!}
          view={viewer.view}
          onClose={() => setViewer(null)}
          onRegenerate={(views) => {
            // 승인 카드는 채팅 패널에 뜬다 — 뷰어를 닫아 카드가 보이게
            setViewer(null)
            void generate([viewer.id], views)
          }}
        />
      )}
    </div>
  )
}
