import { useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { KO_PAIRS, koState, type Asset, type KoPair, type KoPairEn } from '@conti/domain'

const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
const same = (a?: string, b?: string) => (a ?? '').trim() === (b ?? '').trim()

/** 그 자리에서 고치는 textarea — ⌘Enter·바깥 클릭 = 반영, Esc = 취소 */
function InlineEdit({ value, mono, testid, onCommit, onCancel }: { value: string; mono?: boolean; testid: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const cancelled = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [v])
  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.setSelectionRange(v.length, v.length)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea
      ref={ref}
      data-testid={testid}
      value={v}
      rows={1}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (cancelled.current ? onCancel() : onCommit(v))}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true
          ref.current?.blur()
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ref.current?.blur()
      }}
      className={`w-full resize-none overflow-hidden rounded border border-accent bg-bg px-1.5 py-1 leading-relaxed text-ink outline-none ${mono ? 'font-mono text-[10.5px]' : 'text-[11.5px]'}`}
    />
  )
}

type Note = { text: string; changesKo: string[]; undo: { ko: string; en: string; entry: { en: string; ko: string; diffKo?: string[] } | null } }

/**
 * 펼친 에셋 카드 — 프롬프트를 한글로 보여주고, [KR]/[EN] 을 누르면 그 칸이 영문(생성에 실제로 쓰이는 문장)으로 바뀐다.
 * 글자를 누르면 그 자리에서 고친다: 한글을 고치면 AI 가 영문을 다시 써서 저장하고 "바뀐 점"을, 영문을 고치면 한글을 다시 옮긴다.
 * 한·영이 실제로 다를 때만(AI 비교 결과) 어디가 다른지 보여주고 어느 쪽 기준으로 맞출지 고르게 한다.
 */
export default function AssetKoView({
  asset,
  ep,
  translating,
  failed,
  onRetranslate,
}: {
  asset: Asset
  ep: string
  translating: boolean
  failed?: string
  /** 영문 기준으로 한글 다시 쓰기 (또는 실패한 번역 다시) */
  onRetranslate: (fields?: KoPairEn[]) => void
}) {
  const [lang, setLang] = useState<Record<string, 'ko' | 'en'>>({})
  const [editing, setEditing] = useState<string | null>(null) // `${field}:${lang}` 또는 'name'
  const [busy, setBusy] = useState<Record<string, { text: string; shown: string }>>({})
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const [err, setErr] = useState<string | null>(null)
  const pairs = KO_PAIRS.filter((p) => asset[p.en] || asset[p.ko])

  const prevOf = (p: KoPair): Note['undo'] => ({ ko: asset[p.ko] ?? '', en: asset[p.en] ?? '', entry: asset.koSync?.[p.en] ?? null })

  /** 한글 기준으로 영문을 다시 써서 저장 */
  async function koToEn(p: KoPair, ko: string) {
    const undo = prevOf(p)
    setErr(null)
    setBusy((b) => ({ ...b, [p.en]: { text: '영문으로 옮기는 중…', shown: ko } }))
    try {
      const [r] = await window.conti.api.assets.koToEn(ep, asset.id, [{ field: p.en, ko, en: asset[p.en] ?? '' }])
      const s = await window.conti.api.assets.update(ep, asset.id, { [p.ko]: ko, [p.en]: r.en, syncFields: [p.en] })
      setNotes((n) => ({
        ...n,
        [p.en]: { text: `${r.changesKo.length ? '영문에서 바뀐 점' : '영문은 이미 같은 내용이었습니다'}${s.staleShots ? ` · 이 에셋이 나오는 콘티 ${s.staleShots}컷 재생성 필요` : ''}`, changesKo: r.changesKo, undo },
      }))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== p.en)))
    }
  }

  /** 영문을 직접 고쳐 저장하고, 한글은 그 영문으로 다시 옮긴다 */
  async function saveEn(p: KoPair, en: string) {
    const undo = prevOf(p)
    setErr(null)
    setBusy((b) => ({ ...b, [p.en]: { text: '한글로 다시 옮기는 중…', shown: en } }))
    try {
      const s = await window.conti.api.assets.update(ep, asset.id, { [p.en]: en })
      await window.conti.api.assets.translateKo(ep, [asset.id], [p.en])
      setNotes((n) => ({ ...n, [p.en]: { text: `영문을 고쳤고 한글을 다시 옮겼습니다${s.staleShots ? ` · 콘티 ${s.staleShots}컷 재생성 필요` : ''}`, changesKo: [], undo } }))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== p.en)))
    }
  }

  async function undo(p: KoPair) {
    const n = notes[p.en]
    if (!n) return
    try {
      await window.conti.api.assets.update(ep, asset.id, { [p.ko]: n.undo.ko, [p.en]: n.undo.en, koSyncRestore: { field: p.en, entry: n.undo.entry } })
      setNotes((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== p.en)))
    } catch (e) {
      setErr(errText(e))
    }
  }

  return (
    <div className="mt-1 space-y-2" data-testid="asset-detail">
      {/* 이름 — 눌러서 고친다 */}
      {editing === 'name' ? (
        <InlineEdit
          value={asset.nameKo}
          testid="inline-nameKo"
          onCancel={() => setEditing(null)}
          onCommit={(v) => {
            setEditing(null)
            if (v.trim() && !same(v, asset.nameKo)) void window.conti.api.assets.update(ep, asset.id, { nameKo: v }).catch((e) => setErr(errText(e)))
          }}
        />
      ) : (
        <div data-testid="name-text" onClick={() => setEditing('name')} className="-mx-1 cursor-text rounded px-1 text-[12.5px] hover:bg-panel-2/60" title="눌러서 고치기">
          {asset.nameKo}
        </div>
      )}

      <dl className="space-y-2 rounded border border-line/60 bg-bg/60 p-2 text-[11px]">
        {pairs.map((p) => {
          const st = koState(asset, p)
          const l = lang[p.en] ?? 'ko'
          const value = (l === 'ko' ? asset[p.ko] : asset[p.en]) ?? ''
          const b = busy[p.en]
          const note = notes[p.en]
          const diff = st === 'differs' ? (asset.koSync?.[p.en]?.diffKo ?? []) : []
          const isEditing = editing === `${p.en}:${l}`
          return (
            <div key={p.en} data-pair={p.en} data-state={st}>
              <dt className="flex items-center justify-between gap-2 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  {p.label}
                  {(st === 'differs' || st === 'koNewer') && <AlertTriangle size={10} className="text-warn" />}
                  {st === 'unknown' && translating && <span className="text-muted/70">· 한글·영문 비교 중…</span>}
                </span>
                {asset[p.en] && (
                  <button
                    data-testid={`lang-${p.en}`}
                    onClick={() => {
                      setEditing(null)
                      setLang((x) => ({ ...x, [p.en]: l === 'ko' ? 'en' : 'ko' }))
                    }}
                    className={`rounded border px-1 font-mono text-[9.5px] ${l === 'en' ? 'border-accent/60 text-accent' : 'border-line text-muted hover:text-ink'}`}
                    title={l === 'ko' ? '눌러서 생성에 쓰이는 영문 보기' : '눌러서 한글 보기'}
                  >
                    {l === 'ko' ? 'KR' : 'EN'}
                  </button>
                )}
              </dt>
              {isEditing ? (
                <InlineEdit
                  value={value}
                  mono={l === 'en'}
                  testid={`inline-${l === 'ko' ? p.ko : p.en}`}
                  onCancel={() => setEditing(null)}
                  onCommit={(v) => {
                    setEditing(null)
                    if (!v.trim() || same(v, value)) return
                    void (l === 'ko' ? koToEn(p, v) : saveEn(p, v))
                  }}
                />
              ) : (
                <dd
                  data-testid={`text-${p.en}`}
                  data-lang={l}
                  onClick={() => !b && setEditing(`${p.en}:${l}`)}
                  title={b ? undefined : '눌러서 고치기'}
                  className={`-mx-1 cursor-text whitespace-pre-wrap rounded px-1 leading-relaxed hover:bg-panel-2/60 ${l === 'en' ? 'font-mono text-[10.5px] text-ink/75' : 'text-[11.5px] text-ink/85'}`}
                >
                  {b ? b.shown : value || (l === 'ko' && translating ? <span className="text-muted">한글로 옮기는 중…</span> : <span className="text-muted">—</span>)}
                  {!b && l === 'ko' && value && st === 'enNewer' && <span className="ml-1 text-[10px] text-muted">{translating ? '(영문이 바뀌어 다시 옮기는 중…)' : '(영문이 바뀜 — 이전 번역)'}</span>}
                </dd>
              )}
              {b && <div className="mt-0.5 text-[10px] text-accent">{b.text}</div>}

              {note && !b && (
                <div className="mt-1 rounded bg-panel-2/70 px-2 py-1.5 text-[10.5px]" data-testid={`note-${p.en}`}>
                  <div className="flex items-center justify-between gap-2 text-muted">
                    <span>{note.text}</span>
                    <button className="flex shrink-0 items-center gap-1 hover:text-ink" onClick={() => void undo(p)} data-testid={`undo-${p.en}`}>
                      <Undo2 size={11} /> 되돌리기
                    </button>
                  </div>
                  {note.changesKo.map((c, i) => (
                    <div key={i} data-change className="text-ink/85">
                      · {c}
                    </div>
                  ))}
                </div>
              )}

              {(st === 'differs' || st === 'koNewer') && !b && (
                <div className="mt-1 rounded bg-warn/10 px-2 py-1.5 text-[10.5px]" data-testid={`ko-off-${p.en}`}>
                  <div className="text-warn">{st === 'koNewer' ? '한글만 바뀌어 생성용 영문에는 아직 반영되지 않았습니다.' : '한글과 생성용 영문의 내용이 다릅니다:'}</div>
                  {diff.map((d, i) => (
                    <div key={i} data-diff className="text-ink/85">
                      · {d}
                    </div>
                  ))}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <button data-testid={`fix-en-${p.en}`} onClick={() => void koToEn(p, asset[p.ko] ?? '')} className="rounded border border-line px-1.5 py-0.5 hover:bg-panel-2">
                      한글 기준으로 영문 고치기
                    </button>
                    <button data-testid={`fix-ko-${p.en}`} disabled={translating} onClick={() => onRetranslate([p.en])} className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink disabled:opacity-50">
                      영문 기준으로 한글 고치기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {(failed || err) && (
          <div className="text-[10.5px] text-warn">
            {err ?? `한글로 옮기지 못했습니다: ${failed}`}{' '}
            {!err && (
              <button className="underline" onClick={() => onRetranslate()}>
                다시
              </button>
            )}
          </div>
        )}
        {asset.usedIn.length > 0 && (
          <div>
            <dt className="text-[10px] text-muted">나오는 씬</dt>
            <dd>{asset.usedIn.join(', ')}</dd>
          </div>
        )}
      </dl>
      <div className="text-[10px] text-muted/70">글자를 누르면 바로 고칩니다 · 한글을 고치면 생성용 영문도 맞춰집니다</div>
    </div>
  )
}
