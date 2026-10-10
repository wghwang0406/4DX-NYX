// py/media 출력 계약 (conti_media measure / asr). 파이썬 쪽을 바꾸면 MEASURE_VERSION 과 함께 여기를 고친다.

export interface MeasureCamera {
  label: string // STATIC | PAN | TILT | ZOOM IN | ZOOM OUT | DOLLY IN | DOLLY OUT | ROLL | WHIP | HANDHELD
  dir: string
  size: 'small' | 'medium' | 'large'
  travel: number
  scale: number
  rot: number
  jitter: number
  parallax: number
  reliable: boolean
  path: Array<[number, number]>
  end_quad: [number, number, number, number] | null
}

export interface MeasurePanel {
  t0: number
  t1: number
  split: '' | 'view' | 'pose'
  key: number
}

export interface MeasureSegment {
  t0: number
  t1: number
  uncertain_in: boolean
  camera: MeasureCamera
  subject: { level: 'low' | 'medium' | 'high'; mag: number; dir: string; dx: number; dy: number }
  panels: MeasurePanel[]
}

export interface MeasureSample {
  t: number
  sharp: number
  phash: string
  lab: [number, number, number]
  motion: number | null
  subject: number | null
}

export interface Measure {
  version: number
  fps: number
  frames: number
  width: number
  height: number
  duration: number
  rate: number
  candidates: number
  boundaries: Array<{ frame: number; t: number; verdict: 'cut' | 'uncertain' | 'same'; cross: number; inside: number; hash_diff: number }>
  segments: MeasureSegment[]
  samples: MeasureSample[]
  elapsed?: number
}

export interface AsrSegment {
  t0: number
  t1: number
  text: string
  logprob: number
  no_speech: number
  low: boolean
}

export interface Asr {
  model: string
  device: string
  language: string
  language_prob?: number
  forced?: boolean
  duration: number
  segments: AsrSegment[]
  dropped: number
}

export interface Probe {
  duration: number
  width: number
  height: number
  fps: number
  vfr: boolean
  hasAudio: boolean
  hasVideo: boolean
  codec?: string
}

export type ImportKind = 'animatic' | 'longtake' | 'clips' | 'audio'
