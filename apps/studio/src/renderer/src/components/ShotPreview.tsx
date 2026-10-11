import { useState } from 'react'
import { RefreshCw, Brush, Sparkles, Maximize2 } from 'lucide-react'
import type { Sequence, Version } from '@conti/domain'
import { fileUrl, currentStageFile } from '../data/adapters'
import { useProject } from '../state/project'
import ImageLightbox from './ImageLightbox'

const STATUS_LABEL: Record<string, string> = {
  none: '아직 없음',
  queued: '대기열',
  running: '생성 중',
  review: '생성됨',
  approved: '확정',
  failed: '실패',
  stale: '재생성 필요',
  awaiting_approval: '승인 대기',
}
const SOURCE_LABEL: Record<string, string> = { generated: '생성', video_frame: '원본', restyle: '다시 그림', edit: '수정', upload: '올림' }

interface Props {
  sequence: Sequence
  selectedShot: string | null
  stage: 'conti' | 'image'
}

/**
 * Shots 오른쪽 위 — 고른 샷의 완성 그림(콘티 탭 = 콘티, 이미지 탭 = 콘티 기반 최종 이미지)을 크게.
 * 아래 버전 썸네일로 전환(크레딧 0), 생성은 버튼 → 채팅 승인 카드. 그림을 누르면 전체 화면.
 */
export default function ShotPreview({ sequence, selectedShot, stage }: Props) {
  const { project } = useProject()
  const [zoom, setZoom] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const shot = sequence.shots.find((s) => !s.deleted && s.no === selectedShot)

  if (!shot)
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-line bg-panel text-[12px] text-muted" data-testid="shot-preview">
        왼쪽 목록에서 샷을 고르세요
      </section>
    )

  const versions: Version[] = shot.panels.flatMap((p) => (stage === 'image' ? p.versions.image : p.versions.conti)).sort((a, b) => b.n - a.n)
  const st = shot.stages[stage]
  const currentId = st.currentVersionId ?? versions[0]?.id
  const file = currentStageFile(shot, stage)
  const hasConti = !!currentStageFile(shot, 'conti')
  const original = shot.panels[0]?.versions.conti.find((v) => v.source === 'video_frame')

  async function spend(kind: 'conti_generate' | 'panel_restyle' | 'image_generate') {
    setErr(null)
    try {
      if (kind === 'conti_generate') await window.conti.agent.requestSpend(kind, { seq: sequence.seq, shots: [shot!.no], style: project?.defaults.contiStyle ?? 'sketch' })
      else if (kind === 'panel_restyle') await window.conti.agent.requestSpend(kind, { seq: sequence.seq, shotNos: [shot!.no] })
      else await window.conti.agent.requestSpend(kind, { seq: sequence.seq, shots: [shot!.no] })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel" data-testid="shot-preview" data-stage={stage}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 text-[12.5px]">
        <span className="flex items-center gap-2 font-medium">
          <span className="font-mono text-accent">{shot.no}</span> {stage === 'image' ? '이미지' : '콘티'}
          <span className={`text-[11px] font-normal ${st.status === 'stale' || st.status === 'failed' ? 'text-warn' : 'text-muted'}`}>{STATUS_LABEL[st.status] ?? st.status}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {err && <span className="max-w-[220px] truncate text-[11px] text-red-300" title={err}>{err}</span>}
          {stage === 'conti' ? (
            <>
              {original && (
                <button onClick={() => void spend('panel_restyle')} className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:bg-panel-2" title="원본 프레임을 구도 그대로 콘티 그림체로">
                  <Brush size={12} /> 다시 그리기
                </button>
              )}
              <button onClick={() => void spend('conti_generate')} className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] hover:bg-panel-2">
                <RefreshCw size={12} /> {versions.length ? '콘티 재생성' : '콘티 생성'}
              </button>
            </>
          ) : (
            <button
              data-testid="shot-image-generate"
              disabled={!hasConti}
              onClick={() => void spend('image_generate')}
              title={hasConti ? '이 컷의 콘티를 구도 가이드로 최종 이미지 생성 (승인 카드)' : '먼저 콘티를 만드세요'}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              <Sparkles size={12} /> {versions.length ? '이미지 다시 생성' : '이 컷 이미지 생성'}
            </button>
          )}
        </span>
      </div>

      <div className="relative mx-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
        {file ? (
          <button onClick={() => setZoom(true)} className="group relative flex h-full w-full items-center justify-center" title="눌러서 크게 보기">
            <img data-testid="shot-preview-image" src={fileUrl(file)} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
            <Maximize2 size={14} className="absolute right-2 top-2 text-white/0 group-hover:text-white/70" />
          </button>
        ) : stage === 'image' && hasConti ? (
          // 이미지 탭엔 콘티 그림을 보여 주지 않는다 — 영상용 최종 이미지 자리
          <div className="text-center text-[12px] leading-relaxed text-white/60" data-testid="image-empty">
            아직 영상용 이미지가 없습니다
            <br />
            <span className="text-white/40">콘티는 Shots·Conti 에서 확인하고, [이 컷 이미지 생성] 으로 만듭니다 (콘티 분석 → 승인 카드)</span>
          </div>
        ) : (
          <div className="text-[12px] text-white/50">{stage === 'image' ? '콘티가 없어 이미지를 만들 수 없습니다 — Shots·Conti 에서 콘티 먼저' : '아직 콘티 이미지가 없습니다'}</div>
        )}
      </div>

      <div className="flex h-[64px] shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-2" data-testid="shot-preview-versions">
        {versions.length === 0 && <span className="text-[11px] text-muted">버전 없음 — 생성하면 여기에 쌓이고 이전 것은 지워지지 않습니다</span>}
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => void window.conti.api.sequence.setCurrentVersion(sequence.seq, shot.id, v.id, stage)}
            title={`v${v.n} · ${SOURCE_LABEL[v.source] ?? v.source} — 눌러서 이 버전 사용 (크레딧 0)`}
            className={`relative h-full shrink-0 overflow-hidden rounded border ${v.id === currentId ? 'border-accent' : 'border-line hover:border-muted'}`}
          >
            <img src={fileUrl(v.file)} alt="" className="h-full w-auto object-contain" draggable={false} />
            <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9.5px] text-white">v{v.n}</span>
          </button>
        ))}
      </div>

      {zoom && file && <ImageLightbox src={fileUrl(file)} caption={`${sequence.seq} ${shot.no} ${stage === 'image' ? '이미지' : '콘티'} v${versions.find((v) => v.id === currentId)?.n ?? ''}`} onClose={() => setZoom(false)} />}
    </section>
  )
}
