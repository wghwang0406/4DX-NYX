import { useState } from 'react'
import { ChevronLeft, ChevronRight, PenLine, X } from 'lucide-react'
import type { Annotation, Sequence, Shot, ShotSize } from '@conti/domain'
import type { Scene } from '../data/sampleScene'
import AnnotatedFrame from './AnnotatedFrame'

const SIZES: ShotSize[] = ['EWS', 'WS', 'MWS', 'MS', 'MCU', 'CU', 'ECU', 'POV', 'INSERT', 'OTS']

interface Props {
  scene: Scene
  sequence: Sequence | null
  selectedShot: string | null
  onSelect: (no: string) => void
}

/**
 * Conti 단계의 컷 상세: 선택한 컷의 현재 콘티 이미지를 크게 보고, 주석(화살표·프레임·메모)을 그리고,
 * 샷사이즈·앵글·카메라·길이·지문·대사를 바로 고친다. 고치면 shotlist md 와 시트 미리보기가 따라 바뀐다.
 */
export default function ShotDetail({ scene, sequence, selectedShot, onSelect }: Props) {
  const [edit, setEdit] = useState(false)
  const idx = scene.shots.findIndex((s) => s.no === selectedShot)
  const viewShot = idx >= 0 ? scene.shots[idx] : null
  const shot = sequence?.shots.find((s) => !s.deleted && s.no === selectedShot) ?? null
  const annotations: Annotation[] = shot?.panels[0]?.annotations ?? []

  function go(dir: 1 | -1) {
    const next = scene.shots[Math.min(scene.shots.length - 1, Math.max(0, (idx < 0 ? 0 : idx + dir)))]
    if (next) onSelect(next.no)
  }

  async function patch(p: Partial<Shot>) {
    if (sequence && shot) await window.conti.api.sequence.updateShot(sequence.seq, shot.id, p)
  }

  async function saveAnnotations(list: Annotation[]) {
    if (sequence && shot) await window.conti.api.sequence.setAnnotations(sequence.seq, shot.id, 0, list)
  }

  return (
    <section data-testid="shot-detail" className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[12.5px] font-medium">
        <span className="flex items-center gap-1">
          <button onClick={() => go(-1)} disabled={idx <= 0} title="이전 컷" className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          <span>
            컷 상세 {viewShot && <span className="ml-1 font-mono text-accent">{viewShot.no}</span>}
            {viewShot && <span className="ml-1.5 text-[11px] text-muted">{idx + 1} / {scene.shots.length}</span>}
          </span>
          <button onClick={() => go(1)} disabled={idx >= scene.shots.length - 1} title="다음 컷" className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </span>
        {sequence && (
          <button
            data-testid="annotate-toggle"
            disabled={!shot}
            onClick={() => setEdit((v) => !v)}
            title="이 컷에 화살표·프레임·메모 그리기"
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40 ${edit ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}
          >
            {edit ? <X size={11} /> : <PenLine size={11} />} {edit ? '닫기' : '주석'}
          </button>
        )}
      </div>

      {!viewShot ? (
        <div className="mx-3 mb-3 flex flex-1 items-center justify-center rounded-md border border-dashed border-line text-[12px] text-muted">
          타임라인이나 시트에서 컷을 고르세요
        </div>
      ) : (
        <>
          <AnnotatedFrame image={viewShot.image} annotations={annotations} editing={edit && !!shot} onChange={(l) => void saveAnnotations(l)}>
            {!viewShot.image && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">아직 콘티 이미지가 없습니다</div>}
          </AnnotatedFrame>
          {shot ? <Fields key={shot.id + (sequence?.rev ?? 0)} shot={shot} onPatch={(p) => void patch(p)} /> : <div className="h-3" />}
        </>
      )}
    </section>
  )
}

function Fields({ shot, onPatch }: { shot: Shot; onPatch: (p: Partial<Shot>) => void }) {
  const box = 'rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent'
  const commitText = (field: 'angle' | 'cameraMove', v: string) => {
    const t = v.trim()
    if (t !== (shot[field] ?? '')) onPatch({ [field]: t || undefined })
  }
  return (
    <div className="mx-3 mt-2 mb-3 space-y-1.5 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <select data-testid="detail-size" value={shot.sizeCode ?? ''} onChange={(e) => onPatch({ sizeCode: (e.target.value || undefined) as ShotSize })} className={box} title="샷사이즈">
          <option value="">사이즈 —</option>
          {SIZES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <input defaultValue={shot.angle ?? ''} placeholder="앵글" title="앵글" onBlur={(e) => commitText('angle', e.target.value)} onKeyDown={blurOnEnter} className={`${box} w-24`} />
        <input defaultValue={shot.cameraMove ?? ''} placeholder="카메라" title="카메라 무빙" onBlur={(e) => commitText('cameraMove', e.target.value)} onKeyDown={blurOnEnter} className={`${box} w-28`} />
        <label className="flex items-center gap-1 text-muted" title="길이 (초)">
          <input
            type="number"
            min={0.3}
            step={0.1}
            defaultValue={shot.durationSec ?? ''}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (e.target.value && n > 0 && n !== shot.durationSec) onPatch({ durationSec: Math.round(n * 10) / 10 })
            }}
            onKeyDown={blurOnEnter}
            className={`${box} w-14`}
          />
          초
        </label>
        {shot.characters.length > 0 && <span className="truncate text-muted">{shot.characters.join(' ')}</span>}
      </div>
      <input
        data-testid="detail-action"
        defaultValue={shot.actionKo}
        placeholder="지문"
        onBlur={(e) => e.target.value.trim() !== shot.actionKo && onPatch({ actionKo: e.target.value.trim() })}
        onKeyDown={blurOnEnter}
        className={`${box} w-full`}
      />
      {shot.dialogue.map((d, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="shrink-0 rounded bg-dialog/30 px-1 text-[10.5px]">{d.speaker ?? shot.tag ?? '대사'}</span>
          <input
            defaultValue={d.text}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v !== d.text) onPatch({ dialogue: shot.dialogue.map((x, k) => (k === i ? { ...x, text: v } : x)) })
            }}
            onKeyDown={blurOnEnter}
            className={`${box} min-w-0 flex-1`}
          />
        </div>
      ))}
    </div>
  )
}

function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
  if (e.key === 'Enter') (e.target as HTMLElement).blur()
}
