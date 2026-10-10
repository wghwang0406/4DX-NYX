import { useState } from 'react'
import { History, RefreshCw, Check, AlertTriangle, Brush } from 'lucide-react'
import type { Sequence } from '@conti/domain'
import { fileUrl } from '../data/adapters'
import { useProject } from '../state/project'

interface Props {
  sequence: Sequence
  selectedShot: string | null
}

const SOURCE_LABEL: Record<string, string> = { generated: '생성', video_frame: '원본 프레임', restyle: '다시 그리기', edit: '수정', upload: '업로드' }

/** 선택한 컷의 콘티 버전 기록 + 재생성 버튼. 버전 전환은 크레딧 0, 재생성은 승인 카드를 거친다. */
export default function VersionsBar({ sequence, selectedShot }: Props) {
  const { project } = useProject()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const shot = sequence.shots.find((s) => !s.deleted && s.no === selectedShot)
  if (!shot) return null
  const versions = shot.panels.flatMap((p) => p.versions.conti).sort((a, b) => a.n - b.n)
  const current = shot.stages.conti.currentVersionId
  const status = shot.stages.conti.status

  const cur = versions.find((v) => v.id === current) ?? versions[versions.length - 1]
  const original = versions.find((v) => v.source === 'video_frame')

  async function restyle() {
    setErr(null)
    setBusy(true)
    try {
      await window.conti.agent.requestSpend('panel_restyle', { seq: sequence.seq, shotNos: [shot!.no] })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    setErr(null)
    setBusy(true)
    try {
      await window.conti.agent.requestSpend('conti_generate', { seq: sequence.seq, shots: [shot!.no], style: project?.defaults.contiStyle ?? 'sketch' })
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-[76px] shrink-0 items-center gap-3 rounded-lg border border-line bg-panel px-3">
      <div className="flex w-[112px] shrink-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-[12.5px]">
          <History size={13} className="text-muted" /> {shot.no} 버전
        </div>
        <div className="text-[10.5px] text-muted">
          {status === 'stale' ? (
            <span className="text-warn">재생성 필요</span>
          ) : status === 'queued' || status === 'running' ? (
            <span className="text-accent">생성 중…</span>
          ) : status === 'failed' ? (
            <span className="text-red-400">실패</span>
          ) : versions.length ? (
            `${versions.length}개`
          ) : (
            '아직 없음'
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {versions.map((v) => (
          <button
            key={v.id}
            title={`v${v.n} · ${SOURCE_LABEL[v.source] ?? v.source}${v.w ? ` · ${v.w}×${v.h}` : ''}`}
            onClick={() => void window.conti.api.sequence.setCurrentVersion(sequence.seq, shot.id, v.id)}
            className={`relative h-14 w-[100px] shrink-0 overflow-hidden rounded-md border-2 bg-black ${current === v.id ? 'border-accent' : 'border-line hover:border-muted'}`}
          >
            <img src={fileUrl(v.file)} alt={`v${v.n}`} className="h-full w-full object-cover" draggable={false} />
            <span className="absolute left-1 top-0.5 rounded bg-black/60 px-1 font-mono text-[10px] text-white">v{v.n}</span>
            {current === v.id && <Check size={11} className="absolute right-1 top-1 rounded bg-accent p-0.5 text-white" />}
          </button>
        ))}
        {!versions.length && <span className="text-[11.5px] text-muted">생성하면 여기에 버전이 쌓입니다. 이전 버전은 지워지지 않습니다.</span>}
      </div>
      {err && (
        <span className="flex items-center gap-1 text-[11px] text-red-300">
          <AlertTriangle size={12} /> {err}
        </span>
      )}
      {original && (
        <button
          disabled={busy || status === 'queued' || status === 'running'}
          onClick={() => void restyle()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-panel-2 disabled:opacity-50"
          title={cur?.source === 'video_frame' ? '원본 프레임을 구도 그대로 콘티 그림체로 (승인 카드)' : '원본 프레임에서 다시 그리기 — v1 로 돌아가려면 버전을 고르면 됩니다 (크레딧 0)'}
        >
          <Brush size={13} /> 다시 그리기
        </button>
      )}
      <button
        disabled={busy || status === 'queued' || status === 'running'}
        onClick={() => void regenerate()}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-panel-2 disabled:opacity-50"
        title="이 컷만 다시 생성 (승인 카드)"
      >
        <RefreshCw size={13} /> {versions.length ? (original ? '새로 생성' : '재생성') : '콘티 생성'}
      </button>
    </div>
  )
}
