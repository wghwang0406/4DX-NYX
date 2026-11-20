import { useState } from 'react'
import { AlertTriangle, Languages } from 'lucide-react'
import { KO_PAIRS, koState, type Asset, type KoPairEn } from '@conti/domain'

/**
 * 펼친 에셋 카드 (보기) — 프롬프트는 한글로 보여주고, 생성에 실제로 쓰이는 영문은 [EN]을 눌러야 펼친다.
 * 한글이 생성용 영문과 어긋나 있으면(한글만 바뀜·예전 에셋) 어느 쪽을 기준으로 맞출지 고르게 한다.
 */
export default function AssetKoView({
  asset,
  translating,
  failed,
  onAlign,
  onRetranslate,
}: {
  asset: Asset
  translating: boolean
  failed?: string
  /** 한글대로 영문 맞추기 → 수정 화면에서 바로 변환 */
  onAlign: (fields: KoPairEn[]) => void
  /** 영문대로 한글 다시 쓰기 (또는 실패한 번역 다시) */
  onRetranslate: (fields?: KoPairEn[]) => void
}) {
  const [showEn, setShowEn] = useState<Set<string>>(new Set())
  const pairs = KO_PAIRS.filter((p) => asset[p.en] || asset[p.ko])
  return (
    <dl className="mt-2 space-y-2 rounded border border-line/60 bg-bg/60 p-2 text-[11px]" data-testid="asset-detail">
      {pairs.map((p) => {
        const st = koState(asset, p)
        const ko = asset[p.ko]
        const en = asset[p.en]
        const open = showEn.has(p.en)
        const off = st === 'koNewer' || st === 'unknown'
        return (
          <div key={p.en} data-pair={p.en} data-state={st}>
            <dt className="flex items-center justify-between gap-2 text-[10px] text-muted">
              <span className="flex items-center gap-1">
                {p.label}
                {off && <AlertTriangle size={10} className="text-warn" />}
              </span>
              {en && (
                <button
                  data-testid={`show-en-${p.en}`}
                  onClick={() => setShowEn((s) => (s.has(p.en) ? new Set([...s].filter((x) => x !== p.en)) : new Set([...s, p.en])))}
                  className={`rounded px-1 font-mono text-[9.5px] ${open ? 'bg-panel-2 text-ink' : 'text-muted/70 hover:text-muted'}`}
                  title="생성에 실제로 쓰이는 영문 프롬프트"
                >
                  EN
                </button>
              )}
            </dt>
            <dd data-testid={`ko-${p.en}`} className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink/85">
              {ko || (st === 'enNewer' && translating ? <span className="text-muted">한글로 옮기는 중…</span> : <span className="text-muted">—</span>)}
              {ko && st === 'enNewer' && <span className="ml-1 text-[10px] text-muted">{translating ? '(영문이 바뀌어 다시 옮기는 중…)' : '(영문이 바뀜 — 이전 번역)'}</span>}
            </dd>
            {off && (
              <div className="mt-1 rounded bg-warn/10 px-2 py-1.5 text-[10.5px]" data-testid={`ko-off-${p.en}`}>
                <div className="text-warn">{st === 'koNewer' ? '한글만 바뀌어 생성용 영문과 다릅니다.' : '한글과 생성용 영문이 서로 다를 수 있습니다.'}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button data-testid={`align-${p.en}`} onClick={() => onAlign([p.en])} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 hover:bg-panel-2">
                    <Languages size={11} /> 한글대로 영문 맞추기
                  </button>
                  <button data-testid={`retranslate-${p.en}`} disabled={translating} onClick={() => onRetranslate([p.en])} className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink disabled:opacity-50">
                    영문대로 한글 다시 쓰기
                  </button>
                </div>
              </div>
            )}
            {open && en && <dd className="mt-1 whitespace-pre-wrap rounded bg-panel-2/60 px-2 py-1 font-mono text-[10.5px] leading-relaxed text-muted">{en}</dd>}
          </div>
        )
      })}
      {failed && (
        <div className="text-[10.5px] text-warn">
          한글로 옮기지 못했습니다: {failed}{' '}
          <button className="underline" onClick={() => onRetranslate()}>
            다시
          </button>
        </div>
      )}
      {asset.usedIn.length > 0 && (
        <div>
          <dt className="text-[10px] text-muted">나오는 씬</dt>
          <dd>{asset.usedIn.join(', ')}</dd>
        </div>
      )}
    </dl>
  )
}
