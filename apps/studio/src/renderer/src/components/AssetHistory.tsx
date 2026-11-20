import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Asset, AssetEditBy, AssetHistoryEntry, AssetHistoryField } from '@conti/domain'
import { fileUrl } from '../data/adapters'

const FIELD_LABEL: Record<AssetHistoryField, string> = {
  nameKo: '이름',
  descriptionKo: '외형',
  anchorEn: '외형 (영문)',
  cameraAnchorKo: '카메라 앵커',
  cameraAnchorEn: '카메라 앵커 (영문)',
  masterProfileKo: '연기 마스터 프로필',
  masterProfileEn: '연기 마스터 프로필 (영문)',
  voiceKo: 'Voice',
  voiceEn: 'Voice (영문)',
  state: '상태',
  subkind: '종류',
  usedIn: '나오는 씬',
}
const BY_LABEL: Record<AssetEditBy, string> = { user: '사람', ai: 'AI 채팅', auto: '자동 맞춤', gen: '이미지 생성', restore: '되돌림' }
const ACTION_LABEL: Record<AssetHistoryEntry['action'], string> = {
  create: '만듦',
  edit: '수정',
  image: '이미지',
  link: '씬 연결',
  unlink: '씬에서 뺌',
  copy: '복제',
  restore: '되돌림',
}
const isEn = (f: AssetHistoryField) => f.endsWith('En')
const show = (v: unknown) => (v == null || v === '' ? '(없음)' : Array.isArray(v) ? v.join(', ') || '(없음)' : String(v))
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * 에셋 수정 히스토리 — 언제·누가(사람/AI 채팅/자동 맞춤/생성/되돌림) 무엇을 바꿨는지, 이미지 버전까지.
 * [이 시점으로] = 글을 그 변경 직후로 되돌림 / [이 이미지로] = 그 이미지 버전을 다시 현재로 (크레딧 0).
 */
export default function AssetHistory({ asset, ep }: { asset: Asset; ep: string }) {
  const [items, setItems] = useState<AssetHistoryEntry[] | null>(null)
  const [enOpen, setEnOpen] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.conti.api.assets.history(ep, asset.id).then((h) => live && setItems(h))
    return () => {
      live = false
    }
  }, [ep, asset])

  const current = (view: string) => [...(asset.views[view] ?? [])].sort((a, b) => b.n - a.n)[0]
  const run = async (key: string, f: () => Promise<{ staleShots: number }>, done: string) => {
    setBusy(key)
    setMsg(null)
    try {
      const r = await f()
      setMsg(done + (r.staleShots ? ` · 재생성 필요 ${r.staleShots}컷` : ''))
    } catch (e) {
      setMsg((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(null)
    }
  }

  if (!items) return <div className="text-[11px] text-muted">히스토리 불러오는 중…</div>
  if (!items.length) return <div className="text-[11px] text-muted">아직 기록이 없습니다. 이제부터 고치는 내용이 여기에 남습니다.</div>

  return (
    <div data-testid="asset-history" className="space-y-1.5">
      {msg && <div className="text-[11px] text-accent">{msg}</div>}
      {items.map((e, i) => {
        const ko = e.changes.filter((c) => !isEn(c.field))
        const en = e.changes.filter((c) => isEn(c.field))
        const showEn = enOpen.has(e.id)
        return (
          <div key={e.id} data-history={e.action} className={`rounded border border-line/60 bg-bg/40 p-2 text-[11px] ${e.by === 'auto' ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">
                {when(e.at)} · <b className="font-medium text-ink/80">{BY_LABEL[e.by]}</b> · {ACTION_LABEL[e.action]}
                {e.note ? ` — ${e.note}` : ''}
              </span>
              {i > 0 && e.changes.length > 0 && (
                <button
                  data-testid="history-restore"
                  disabled={!!busy}
                  onClick={() => void run(e.id, () => window.conti.api.assets.restore(ep, asset.id, e.id), '이 시점으로 되돌렸습니다')}
                  className="flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink disabled:opacity-50"
                  title="이름·외형·프로필·Voice 를 이 변경 직후로 되돌립니다 (나오는 씬은 그대로)"
                >
                  <RotateCcw size={10} /> 이 시점으로
                </button>
              )}
            </div>
            {ko.map((c) => (
              <div key={c.field} className="mt-1">
                <span className="text-muted">{FIELD_LABEL[c.field]}</span>{' '}
                {e.action === 'create' || e.action === 'copy' ? (
                  <span className="line-clamp-2">{show(c.after)}</span>
                ) : (
                  <span>
                    <span className="text-muted line-through decoration-muted/60">{show(c.before)}</span> → <span>{show(c.after)}</span>
                  </span>
                )}
              </div>
            ))}
            {en.length > 0 && (
              <button
                className="mt-1 text-muted underline-offset-2 hover:underline"
                onClick={() => setEnOpen((s) => (s.has(e.id) ? new Set([...s].filter((x) => x !== e.id)) : new Set([...s, e.id])))}
              >
                영문 {en.length}칸 {showEn ? '접기' : '보기'}
              </button>
            )}
            {showEn &&
              en.map((c) => (
                <div key={c.field} className="mt-1 font-mono text-[10.5px]">
                  <span className="text-muted">{FIELD_LABEL[c.field]}</span>{' '}
                  <span className="text-muted line-through decoration-muted/60">{show(c.before)}</span> → {show(c.after)}
                </div>
              ))}
            {e.images.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {e.images.map((im) => {
                  const isCur = current(im.view)?.id === im.versionId
                  const exists = asset.views[im.view]?.some((v) => v.id === im.versionId)
                  return (
                    <div key={im.versionId} className="flex flex-col items-center gap-0.5">
                      <img src={fileUrl(im.file)} alt={im.view} className="h-12 w-12 rounded border border-line object-cover" draggable={false} />
                      <span className="text-[10px] text-muted">
                        {im.view} v{im.n}
                      </span>
                      {isCur ? (
                        <span className="text-[10px] text-accent">현재</span>
                      ) : (
                        exists && (
                          <button
                            data-testid="history-restore-image"
                            disabled={!!busy}
                            onClick={() => void run(im.versionId, () => window.conti.api.assets.restoreImage(ep, asset.id, im.view, im.versionId), `${im.view} v${im.n} 을 다시 현재로 했습니다`)}
                            className="rounded border border-line px-1 text-[10px] text-muted hover:text-ink disabled:opacity-50"
                          >
                            이 이미지로
                          </button>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
