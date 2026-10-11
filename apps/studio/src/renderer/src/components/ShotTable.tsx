import { Fragment, useState } from 'react'
import { Images, RefreshCw, Brush, Sparkles } from 'lucide-react'
import type { Sequence, Shot, ShotSize } from '@conti/domain'
import { useProject } from '../state/project'

const SIZES: ShotSize[] = ['EWS', 'WS', 'MWS', 'MS', 'MCU', 'CU', 'ECU', 'POV', 'INSERT', 'OTS']
const STATUS: Record<string, { icon: string; label: string }> = {
  none: { icon: '·', label: '아직 없음' },
  prompt_ready: { icon: '·', label: '프롬프트 준비' },
  awaiting_approval: { icon: '⏳', label: '승인 대기' },
  queued: { icon: '🔄', label: '대기열' },
  running: { icon: '🔄', label: '생성 중' },
  review: { icon: '✅', label: '생성됨' },
  approved: { icon: '✅', label: '확정' },
  failed: { icon: '❌', label: '실패' },
  stale: { icon: '🔁', label: '재생성 필요' },
}

interface Props {
  sequence: Sequence
  /** 샷 번호(0010…) — 시트 미리보기·타임라인·채팅 컨텍스트와 같은 키 */
  selectedShot: string | null
  onSelect: (no: string) => void
  /** 단계 탭: 콘티 / 콘티 기반 이미지 */
  stage?: 'conti' | 'image'
  onStageChange?: (s: 'conti' | 'image') => void
}

/** 샷 분해 단계의 표 보기(B안). 셀을 고치면 바로 저장되고 shotlist md 가 다시 생성된다. */
export default function ShotTable({ sequence, selectedShot, onSelect, stage = 'conti', onStageChange }: Props) {
  const { project } = useProject()
  const [editing, setEditing] = useState<{ id: string; field: 'actionKo' } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const shots = sequence.shots.filter((s) => !s.deleted)
  const needs = shots.filter((s) => ['none', 'prompt_ready', 'stale', 'failed'].includes(s.stages.conti.status))
  const style = project?.defaults.contiStyle ?? 'sketch'
  // 영상 입력: 현재 버전이 원본 프레임인 컷 → 콘티 그림체로 다시 그리기
  const frames = shots.filter((s) => {
    const all = s.panels.flatMap((p) => p.versions.conti)
    const cur = all.find((v) => v.id === s.stages.conti.currentVersionId)
    return cur?.source === 'video_frame'
  })

  // 이미지 탭: 콘티가 있고 이미지가 없거나 재생성 필요한 컷만
  const withConti = shots.filter((s) => !!s.stages.conti.currentVersionId)
  const imageNeeds = withConti.filter((s) => ['none', 'stale', 'failed'].includes(s.stages.image.status))

  async function requestImages(nos: string[]) {
    setErr(null)
    try {
      await window.conti.agent.requestSpend('image_generate', { seq: sequence.seq, shots: nos })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  async function patch(shot: Shot, p: Partial<Shot>) {
    await window.conti.api.sequence.updateShot(sequence.seq, shot.id, p)
  }

  async function request(nos: string[]) {
    setErr(null)
    try {
      await window.conti.agent.requestSpend('conti_generate', { seq: sequence.seq, shots: nos, style })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[12.5px] font-medium">
        <span className="flex items-center gap-2">
          <span>
            샷 목록 <span className="ml-1 text-muted">{shots.length}개</span>
            <span className="ml-2 text-[11px] text-muted">{sequence.breakdown.status === 'accepted' ? '분해 확정' : sequence.breakdown.status === 'draft' ? '초안' : '분해 전'}</span>
          </span>
          {onStageChange && (
            <span className="ml-2 flex rounded-md border border-line p-0.5 text-[11.5px] font-normal" data-testid="stage-tabs">
              {(
                [
                  ['conti', '콘티'],
                  ['image', '이미지'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} data-stage={k} onClick={() => onStageChange(k)} className={`rounded px-2.5 py-0.5 ${stage === k ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {err && <span className="text-[11px] text-red-300">{err}</span>}
          {stage === 'image' ? (
            <button
              data-testid="images-needed"
              disabled={!imageNeeds.length}
              onClick={() => void requestImages(imageNeeds.map((s) => s.no))}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40"
              title="콘티가 있고 이미지가 없거나 재생성 필요한 컷만 (승인 카드에서 1장만 먼저 가능). 한 컷씩은 오른쪽 [이 컷 이미지 생성]"
            >
              <Sparkles size={12} /> 콘티 있는 컷 이미지 생성 {imageNeeds.length ? `(${imageNeeds.length})` : ''}
            </button>
          ) : (
          <>
          {frames.length > 0 && (
            <button
              onClick={() => void window.conti.agent.requestSpend('panel_restyle', { seq: sequence.seq, shotNos: frames.map((s) => s.no) }).catch((e: Error) => setErr(e.message))}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] hover:bg-panel-2"
              title="원본 프레임 컷을 구도 그대로 콘티 그림체로 (승인 카드에서 1장만 먼저 가능)"
            >
              <Brush size={12} /> 다시 그리기 ({frames.length})
            </button>
          )}
          <button
            disabled={!needs.length}
            onClick={() => void request(needs.map((s) => s.no))}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] hover:bg-panel-2 disabled:opacity-40"
            title="아직 없거나 재생성 필요한 컷만 (승인 카드)"
          >
            <RefreshCw size={12} /> 필요한 컷만 {needs.length ? `(${needs.length})` : ''}
          </button>
          <button
            disabled={!shots.length}
            onClick={() => void request(shots.map((s) => s.no))}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40"
            title="이 씬 전체 콘티 생성 (승인 카드에서 1장만 먼저 가능)"
          >
            <Images size={12} /> 콘티 생성
          </button>
          </>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-[12px]">
          <thead className="sticky top-0 bg-panel text-muted">
            <tr className="text-left">
              <th className="w-14 px-3 py-1.5">#</th>
              <th className="w-20 px-2 py-1.5">샷사이즈</th>
              <th className="w-24 px-2 py-1.5">인물</th>
              <th className="w-20 px-2 py-1.5">장소</th>
              <th className="w-20 px-2 py-1.5">소품</th>
              <th className="px-2 py-1.5">묘사</th>
              <th className="w-16 px-2 py-1.5 text-center">{stage === 'image' ? '이미지' : '콘티'}</th>
            </tr>
          </thead>
          <tbody>
            {shots.map((s) => {
              const stageStatus = s.stages[stage].status
              const noConti = stage === 'image' && !s.stages.conti.currentVersionId
              const st = noConti ? { icon: '–', label: '콘티 없음' } : (STATUS[stageStatus] ?? STATUS.none)
              const open = selectedShot === s.no
              return (
                <Fragment key={s.id}>
                <tr data-shot-row={s.no} onClick={() => onSelect(s.no)} className={`cursor-pointer border-t border-line/60 ${open ? 'bg-accent-soft' : 'hover:bg-panel-2'}`}>
                  <td className="px-3 py-1.5 font-mono">{s.no}</td>
                  <td className="px-2 py-1.5">
                    <select
                      value={s.sizeCode ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => void patch(s, { sizeCode: (e.target.value || undefined) as ShotSize })}
                      className="rounded border border-line bg-bg px-1 py-0.5 text-[11.5px] outline-none"
                    >
                      <option value="">—</option>
                      {SIZES.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="truncate px-2 py-1.5 text-muted">{s.characters.map((c) => c.replace(/^@/, '')).join(', ') || '—'}</td>
                  <td className="truncate px-2 py-1.5 text-muted">{s.location?.replace(/^@loc_/, '') ?? '—'}</td>
                  <td className="truncate px-2 py-1.5 text-muted">{s.props.map((p) => p.replace(/^@prop_/, '')).join(', ') || '—'}</td>
                  <td className="px-2 py-1.5 align-top">
                    {s.dialogue.length > 0 && (
                      <span className="mr-1 rounded bg-dialog/30 px-1 text-[10.5px]">
                        {s.tag ?? '대사'} {s.dialogue[0].speaker}
                      </span>
                    )}
                    {editing?.id === s.id ? (
                      <input
                        autoFocus
                        defaultValue={s.dialogue[0]?.text ?? s.actionKo}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          setEditing(null)
                          if (s.dialogue.length) void patch(s, { dialogue: [{ ...s.dialogue[0], text: v }, ...s.dialogue.slice(1)] })
                          else void patch(s, { actionKo: v })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="w-full rounded border border-accent bg-bg px-1 py-0.5 outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditing({ id: s.id, field: 'actionKo' })
                        }}
                        title={s.dialogue[0]?.text || s.actionKo || '더블클릭으로 수정'}
                        className="line-clamp-2"
                      >
                        {s.dialogue[0]?.text || s.actionKo || <span className="text-muted">—</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center" title={st.label}>
                    <span className="inline-flex items-center gap-1">
                      {st.icon}
                      {!noConti && (stageStatus === 'stale' || stageStatus === 'failed') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void (stage === 'image' ? requestImages([s.no]) : request([s.no]))
                          }}
                          className="rounded border border-line px-1 text-[10px] text-muted hover:text-ink"
                          title="이 컷만 재생성"
                        >
                          재생성
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr className="bg-accent-soft/40" data-testid="shot-detail-row">
                    <td colSpan={7} className="px-3 pb-3 pt-1">
                      <ShotFacts shot={s} />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 고른 샷의 묘사·대사·카메라 전체 (표 칸에서 잘리는 내용) */
function ShotFacts({ shot }: { shot: Shot }) {
  const tag = (t: string) => t.replace(/^@(loc_|prop_)?/, '')
  const facts: Array<[string, string]> = [
    ['샷', [shot.sizeCode, shot.angle, shot.cameraMove, shot.fovDeg ? `${shot.fovDeg}°` : '', shot.durationSec ? `${shot.durationSec}초` : ''].filter(Boolean).join(' · ')],
    ['인물', shot.characters.map(tag).join(', ')],
    ['장소', shot.location ? tag(shot.location) : ''],
    ['소품', shot.props.map(tag).join(', ')],
  ]
  return (
    <div className="space-y-1.5 rounded-md border border-line/70 bg-bg/70 p-2.5 text-[12px] leading-relaxed">
      <div>
        <span className="mr-2 text-[10.5px] text-muted">묘사</span>
        <span className="whitespace-pre-wrap">{shot.actionKo || '—'}</span>
      </div>
      {shot.dialogue.map((d, i) => (
        <div key={i}>
          <span className="mr-2 rounded bg-dialog/30 px-1 text-[10.5px]">{d.speaker ?? '대사'}</span>
          {d.paren && <span className="mr-1 text-muted">({d.paren})</span>}
          <span className="whitespace-pre-wrap">{d.text}</span>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <span key={k}>
              <span className="mr-1 text-[10.5px]">{k}</span>
              <span className="text-ink/80">{v}</span>
            </span>
          ))}
      </div>
    </div>
  )
}
