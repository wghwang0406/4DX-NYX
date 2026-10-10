// 화면이 쓰는 타임라인용 뷰 모델 + 데모 데이터.
// 실제 프로젝트가 열리면 adapters.ts 가 @conti/domain Sequence 를 이 모양으로 바꾼다.

export type ShotSize = 'EWS' | 'WS' | 'MWS' | 'MS' | 'MCU' | 'CU' | 'ECU' | 'POV' | 'INSERT' | 'OTS'
export type CameraMove = 'STATIC' | 'PAN' | 'TILT' | 'ZOOM IN' | 'ZOOM OUT' | 'DOLLY' | 'HANDHELD'
export type ReviewFlag = 'uncertain_cut' | 'asr_low' | 'motion_unreliable' | 'tight_split'

export interface Shot {
  id: string
  no: string
  size?: ShotSize
  tIn: number // 초
  tOut: number
  caption: string
  review?: { flag: ReviewFlag; label: string }
  stale?: boolean // 재생성 필요
  image?: string // 현재 콘티 이미지 (conti-file:// URL)
  status?: string // stages.conti.status
}

export interface DialogueLine {
  id: string
  shotNo: string
  tIn: number
  tOut: number
  text: string
}

export interface CameraBlock {
  tIn: number
  tOut: number
  move: CameraMove | string
  dir?: '→' | '←' | '↑' | '↓'
}

export interface Scene {
  seq: string
  title: string
  ep: string
  project: string
  duration: number
  estimated?: boolean // 텍스트 입력이라 길이가 추정값
  video?: string // 영상 입력: 재생용 프록시 URL (conti-file://)
  shots: Shot[]
  dialogue: DialogueLine[]
  camera: CameraBlock[]
}

export const demoScenes: Scene[] = [
  {
    seq: 'S41',
    title: '군산 외곽 도로 - 새벽',
    ep: 'EP01',
    project: '데모',
    duration: 48,
    shots: [
      { id: 'd1', no: '0010', size: 'EWS', tIn: 0, tOut: 8, caption: '새벽 도로.' },
      { id: 'd2', no: '0020', size: 'WS', tIn: 8, tOut: 16, caption: '트럭이 멈춘다.', review: { flag: 'uncertain_cut', label: '컷 확인' } },
      { id: 'd3', no: '0030', size: 'CU', tIn: 16, tOut: 24, caption: '여기서 멈춰.', review: { flag: 'asr_low', label: '대사 확인' } },
      { id: 'd4', no: '0040', size: 'MS', tIn: 24, tOut: 32, caption: '주변을 살핀다.' },
      { id: 'd5', no: '0050', size: 'CU', tIn: 32, tOut: 40, caption: '문을 연다.' },
      { id: 'd6', no: '0060', size: 'WS', tIn: 40, tOut: 48, caption: '엔진 소리.' },
    ],
    dialogue: [
      { id: 'L01', shotNo: '0020', tIn: 8.5, tOut: 15.5, text: '여기서 멈춰.' },
      { id: 'L02', shotNo: '0030', tIn: 16.5, tOut: 23.5, text: '누가 있었어.' },
      { id: 'L03', shotNo: '0050', tIn: 32.5, tOut: 39.5, text: '도로를 확인해.' },
    ],
    camera: [
      { tIn: 0, tOut: 16, move: 'PAN', dir: '→' },
      { tIn: 16, tOut: 32, move: 'ZOOM IN' },
      { tIn: 32, tOut: 48, move: 'STATIC' },
    ],
  },
]

export const navItems = ['소스', '에셋', '샷 분해', '콘티', '레이아웃', '게시'] as const
export type NavItem = (typeof navItems)[number]
