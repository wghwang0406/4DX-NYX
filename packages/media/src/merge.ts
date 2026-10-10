// S7·S9·S13 — 측정(컷·패널·카메라) + 음성 인식 → 샷 초안. 순수 함수 (테스트는 고정 입력으로).
import { childShotNos, pad4, type DialogueLine, type ShotSize } from '@conti/domain'
import type { Asr, AsrSegment, Measure, MeasureCamera, MeasureSample, MeasureSegment } from './types'

type ReviewFlag = 'uncertain_cut' | 'asr_low' | 'motion_unreliable' | 'tight_split'
type AnnotationIn = { id: string; type: 'move' | 'camera' | 'pan' | 'tilt' | 'zoom' | 'frame' | 'note'; points: Array<[number, number]>; label?: string }

export interface DraftPanel {
  index: number
  t0: number
  t1: number
  key: number
  split: string
  label: string // 시트 라벨용 "0030" / "0030b"
  group?: string // 같은 카메라 셋업 "G2"
  annotations: AnnotationIn[]
}

export interface DraftShot {
  no: string
  t0: number
  t1: number
  camera: MeasureCamera
  cameraMove: string
  subject: MeasureSegment['subject']
  dialogue: DialogueLine[]
  tag?: '대사' | '반응'
  review: ReviewFlag[]
  panels: DraftPanel[]
  /** 샷별 클립 입력: 원본 파일 인덱스와 그 파일 안의 시간 (키프레임 추출용) */
  clip?: { index: number; offset: number }
  /** AI 가 채울 칸 */
  sizeCode?: ShotSize
  angle?: string
  characters?: string[]
  actionKo?: string
}

export interface BuildOptions {
  /** 애니매틱: 0010 부터 10 단위 / 클립: 파일 번호를 기준으로 자식 번호 */
  startNo?: number
  baseNo?: string
  /** 타임라인상 이 측정의 시작 시각 (클립을 이어 붙일 때) */
  offset?: number
  clipIndex?: number
  /** 대사가 다른 컷으로 이만큼 넘치면 그 컷은 [반응] */
  reactionSec?: number
}

const lit = (s: MeasureSample) => s.lab[0] >= 6

/** [t0,t1) 가운데 60% 에서 가장 선명한(검지 않은) 샘플 — 대사 컷의 키프레임 */
export function sharpestMiddle(samples: MeasureSample[], t0: number, t1: number): number {
  const lo = t0 + (t1 - t0) * 0.2
  const hi = t0 + (t1 - t0) * 0.8
  let pool = samples.filter((s) => s.t >= lo && s.t < hi)
  if (!pool.length) pool = samples.filter((s) => s.t >= t0 && s.t < t1)
  const bright = pool.filter(lit)
  if (bright.length) pool = bright
  if (!pool.length) return Math.round(((t0 + t1) / 2) * 1000) / 1000
  return pool.reduce((a, b) => (b.sharp > a.sharp ? b : a)).t
}

function nearestSample(samples: MeasureSample[], t: number): MeasureSample | undefined {
  let best: MeasureSample | undefined
  for (const s of samples) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
  return best
}

function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

const labDist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** 카메라 측정 → 타임라인 라벨 ("PAN →") */
export function cameraLabel(c: MeasureCamera): string {
  return c.dir ? `${c.label} ${c.dir}` : c.label
}

/** 카메라·피사체 측정 → 패널 주석(화살표·끝 프레임). 레이아웃이 이미지 위에 그린다. */
export function cameraAnnotations(c: MeasureCamera, subject: MeasureSegment['subject'], idBase: string): AnnotationIn[] {
  const out: AnnotationIn[] = []
  if ((c.label === 'PAN' || c.label === 'TILT' || c.label === 'WHIP') && c.path.length >= 2) {
    const [x0, y0] = c.path[0]
    const [x1, y1] = c.path[c.path.length - 1]
    const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0)
    out.push({ id: `${idBase}-cam`, type: horizontal ? 'pan' : 'tilt', points: c.path.map(([x, y]) => [clamp(x), clamp(y)] as [number, number]), label: cameraLabel(c) })
  } else if ((c.label.startsWith('ZOOM') || c.label.startsWith('DOLLY')) && c.end_quad) {
    const [a, b, cc, d] = c.end_quad
    out.push({ id: `${idBase}-cam`, type: 'zoom', points: [[clamp(a), clamp(b)], [clamp(cc), clamp(d)]], label: c.label })
  }
  if (subject.level === 'high' && subject.dir) {
    const len = Math.hypot(subject.dx, subject.dy) || 1
    const ux = subject.dx / len
    const uy = subject.dy / len
    out.push({ id: `${idBase}-move`, type: 'move', points: [[clamp(0.5 - ux * 0.18), clamp(0.55 - uy * 0.18)], [clamp(0.5 + ux * 0.18), clamp(0.55 + uy * 0.18)]] })
  }
  return out
}

const clamp = (v: number) => Math.round(Math.min(0.98, Math.max(0.02, v)) * 1000) / 1000
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** 측정 하나(파일 하나) → 샷 초안 */
export function buildShots(m: Measure, asr: Asr | undefined, o: BuildOptions = {}): DraftShot[] {
  const offset = o.offset ?? 0
  const reaction = o.reactionSec ?? 0.7
  const lines = (asr?.segments ?? []).filter((l) => l.text.trim())
  const segOf = (t: number) => m.segments.findIndex((s) => t >= s.t0 && t < s.t1)
  const bySeg = new Map<number, AsrSegment[]>()
  for (const l of lines) {
    const i = segOf((l.t0 + l.t1) / 2)
    if (i < 0) continue
    bySeg.set(i, [...(bySeg.get(i) ?? []), l])
  }
  // [반응]: 다른 컷의 대사가 이 컷으로 0.7초 이상 넘쳐 들어오고, 이 컷엔 제 대사가 없음
  const reactionSeg = new Set<number>()
  for (const l of lines) {
    const own = segOf((l.t0 + l.t1) / 2)
    m.segments.forEach((s, i) => {
      if (i === own || bySeg.has(i)) return
      const ov = Math.min(l.t1, s.t1) - Math.max(l.t0, s.t0)
      if (ov >= reaction) reactionSeg.add(i)
    })
  }

  type Raw = Omit<DraftShot, 'no'>
  const raws: Raw[] = []
  m.segments.forEach((seg, i) => {
    const own = (bySeg.get(i) ?? []).sort((a, b) => a.t0 - b.t0)
    const review: ReviewFlag[] = []
    if (seg.uncertain_in) review.push('uncertain_cut')
    if (!seg.camera.reliable) review.push('motion_unreliable')
    const dl = (l: AsrSegment): DialogueLine => ({ text: l.text, tIn: r3(l.t0 + offset), tOut: r3(l.t1 + offset), asrConf: r3(Math.exp(l.logprob)) })
    if (own.length >= 2) {
      // 대사 = 독립 샷: 대사 사이 침묵의 가운데에서 N개로 나눈다
      const bounds = [seg.t0]
      let tight = false
      for (let k = 0; k < own.length - 1; k++) {
        const gap = own[k + 1].t0 - own[k].t1
        if (gap < 0.15) tight = true
        bounds.push(r3(Math.min(seg.t1 - 0.1, Math.max(bounds[bounds.length - 1] + 0.1, (own[k].t1 + own[k + 1].t0) / 2))))
      }
      bounds.push(seg.t1)
      own.forEach((l, k) => {
        const t0 = bounds[k]
        const t1 = bounds[k + 1]
        raws.push({
          t0,
          t1,
          camera: seg.camera,
          cameraMove: cameraLabel(seg.camera),
          subject: seg.subject,
          dialogue: [dl(l)],
          tag: '대사',
          review: [...review, ...(tight ? (['tight_split'] as ReviewFlag[]) : []), ...(l.low ? (['asr_low'] as ReviewFlag[]) : [])],
          panels: [{ index: 0, t0, t1, key: sharpestMiddle(m.samples, t0, t1), split: '', label: '', annotations: k === 0 ? cameraAnnotations(seg.camera, seg.subject, 'p') : [] }],
        })
      })
      return
    }
    raws.push({
      t0: seg.t0,
      t1: seg.t1,
      camera: seg.camera,
      cameraMove: cameraLabel(seg.camera),
      subject: seg.subject,
      dialogue: own.map(dl),
      tag: own.length ? '대사' : reactionSeg.has(i) ? '반응' : undefined,
      review: [...review, ...(own.some((l) => l.low) ? (['asr_low'] as ReviewFlag[]) : [])],
      panels: (own.length ? [{ t0: seg.t0, t1: seg.t1, split: '', key: sharpestMiddle(m.samples, seg.t0, seg.t1) }] : seg.panels).map((p, k) => ({
        index: k,
        t0: p.t0,
        t1: p.t1,
        key: p.key,
        split: p.split,
        label: '',
        annotations: k === 0 ? cameraAnnotations(seg.camera, seg.subject, 'p') : [],
      })),
    })
  })

  // 번호
  let nos: string[]
  if (o.baseNo) {
    const kids = childShotNos(o.baseNo, Math.max(0, raws.length - 1)) ?? raws.slice(1).map((_, k) => pad4(Number(o.baseNo) + k + 1))
    nos = [o.baseNo, ...kids]
  } else {
    const start = o.startNo ?? 10
    nos = raws.map((_, k) => pad4(start + k * 10))
  }
  const shots: DraftShot[] = raws.map((r, k) => ({
    ...r,
    no: nos[k],
    t0: r3(r.t0 + offset),
    t1: r3(r.t1 + offset),
    clip: o.clipIndex != null ? { index: o.clipIndex, offset } : undefined,
    panels: r.panels.map((p) => ({ ...p, t0: r3(p.t0 + offset), t1: r3(p.t1 + offset), key: r3(p.key + offset), label: r.panels.length > 1 ? `${nos[k]}${String.fromCharCode(97 + p.index)}` : nos[k] })),
  }))
  assignGroups(shots, m.samples, offset)
  return shots
}

/** S9 같은 카메라 셋업 묶기: 대표 프레임 pHash ≤12/64 & 색차 ≤15, 앞뒤 15패널 안의 그룹 대표와 비교. 2개 이상만 G# 표시. */
export function assignGroups(shots: DraftShot[], samples: MeasureSample[], offset = 0) {
  const panels = shots.flatMap((s) => s.panels)
  const reps: Array<{ id: number; hash: string; lab: number[]; at: number }> = []
  const assigned: number[] = []
  panels.forEach((p, i) => {
    const s = nearestSample(samples, p.key - offset)
    if (!s) {
      assigned.push(-1)
      return
    }
    const hit = reps.find((r) => i - r.at <= 15 && hamming(r.hash, s.phash) <= 12 && labDist(r.lab, s.lab) <= 15)
    if (hit) assigned.push(hit.id)
    else {
      const id = reps.length + 1
      reps.push({ id, hash: s.phash, lab: s.lab, at: i })
      assigned.push(id)
    }
  })
  const count = new Map<number, number>()
  for (const g of assigned) if (g > 0) count.set(g, (count.get(g) ?? 0) + 1)
  // 화면에 보이는 번호는 2개 이상 묶인 그룹만 1, 2, 3 … 으로 다시 매긴다
  const visible = new Map<number, string>()
  panels.forEach((p, i) => {
    const g = assigned[i]
    if (g > 0 && (count.get(g) ?? 0) >= 2) {
      if (!visible.has(g)) visible.set(g, `G${visible.size + 1}`)
      p.group = visible.get(g)
    }
  })
}

/** 대사 음성만 들어온 경우: 기존 시퀀스 샷(타임코드 있음)에 시간 겹침으로 붙인다. 반환: shotNo → 대사들 */
export function assignDialogueToShots(lines: AsrSegment[], shots: Array<{ no: string; tc?: { inMs: number; outMs: number } }>, offset = 0): Map<string, DialogueLine[]> {
  const out = new Map<string, DialogueLine[]>()
  for (const l of lines) {
    const mid = (l.t0 + l.t1) / 2 + offset
    const sh = shots.find((s) => s.tc && mid * 1000 >= s.tc.inMs && mid * 1000 < s.tc.outMs)
    if (!sh) continue
    out.set(sh.no, [...(out.get(sh.no) ?? []), { text: l.text, tIn: r3(l.t0 + offset), tOut: r3(l.t1 + offset), asrConf: r3(Math.exp(l.logprob)) }])
  }
  return out
}

export function fmtTc(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}
