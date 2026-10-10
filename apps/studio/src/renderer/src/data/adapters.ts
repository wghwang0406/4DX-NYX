import { estimateShotDuration, type Sequence } from '@conti/domain'
import type { Scene, Shot, DialogueLine, CameraBlock } from './sampleScene'

const DEFAULT_SHOT_SEC = 2.5

/** 프로젝트 상대경로 → 렌더러가 읽을 수 있는 URL (main 의 conti-file 프로토콜) */
export function fileUrl(rel: string): string {
  return `conti-file://project/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/** 샷의 현재 콘티 이미지 상대경로 */
export function currentContiFile(s: { panels: Array<{ versions: { conti: Array<{ id: string; n: number; file: string }> } }>; stages: { conti: { currentVersionId?: string } } }): string | undefined {
  const all = s.panels.flatMap((p) => p.versions.conti)
  const id = s.stages.conti.currentVersionId
  const v = (id && all.find((x) => x.id === id)) || [...all].sort((a, b) => b.n - a.n)[0]
  return v?.file
}

const REVIEW_LABEL: Record<string, string> = {
  uncertain_cut: '컷 확인',
  asr_low: '대사 확인',
  motion_unreliable: '카메라 확인',
  tight_split: '분할 확인',
}

/** 도메인 Sequence → 타임라인 뷰 모델. 타임코드가 없으면(텍스트 입력) 길이를 추정해 이어 붙인다. */
export function sequenceToScene(seq: Sequence, projectTitle: string): Scene {
  let t = 0
  let estimated = false
  const shots: Shot[] = []
  const dialogue: DialogueLine[] = []
  const camera: CameraBlock[] = []

  for (const s of seq.shots.filter((x) => !x.deleted)) {
    let tIn: number
    let tOut: number
    if (s.tc) {
      tIn = s.tc.inMs / 1000
      tOut = s.tc.outMs / 1000
    } else {
      estimated = true
      const dur = s.durationSec ?? estimateDuration(s.actionKo, s.dialogue.map((d) => d.text))
      tIn = t
      tOut = t + dur
    }
    t = tOut
    const caption = s.dialogue[0]?.text || s.actionKo || ''
    shots.push({
      id: s.id,
      no: s.no,
      size: s.sizeCode,
      tIn,
      tOut,
      caption,
      review: s.review[0] ? { flag: s.review[0], label: REVIEW_LABEL[s.review[0]] ?? '확인' } : undefined,
      stale: s.stages.conti.status === 'stale',
      image: (() => {
        const f = currentContiFile(s)
        return f ? fileUrl(f) : undefined
      })(),
      status: s.stages.conti.status,
    })
    s.dialogue.forEach((d, i) => {
      const span = tOut - tIn
      dialogue.push({
        id: `${s.no}-${i}`,
        shotNo: s.no,
        tIn: d.tIn ?? tIn + span * 0.08,
        tOut: d.tOut ?? tOut - span * 0.08,
        text: d.speaker ? `${d.speaker}: ${d.text}` : d.text,
      })
    })
    if (s.cameraMove) {
      const last = camera[camera.length - 1]
      if (last && last.move === s.cameraMove.toUpperCase() && Math.abs(last.tOut - tIn) < 0.01) last.tOut = tOut
      else camera.push({ tIn, tOut, move: s.cameraMove.toUpperCase() })
    }
  }

  return {
    seq: seq.seq,
    title: seq.headingKo || seq.seq,
    ep: seq.ep,
    project: projectTitle,
    duration: Math.max(t, 1),
    estimated,
    video: seq.source.kind === 'video' && seq.source.proxy ? fileUrl(seq.source.proxy) : undefined,
    shots,
    dialogue,
    camera,
  }
}

/** 길이 추정은 domain 의 estimateShotDuration 하나로 (레이아웃·애니매틱과 같은 값) */
export const estimateDuration = estimateShotDuration
