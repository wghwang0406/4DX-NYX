// 영상 콘티 가져오기 ↔ 렌더러 계약
export type VideoKind = 'animatic' | 'longtake' | 'clips' | 'audio'

export interface VideoImportOptions {
  kind: VideoKind
  files: string[]
  seq: string
  ep: string
  headingKo?: string
  asr: boolean
  asrModel?: string
  /** 대사 언어 auto | ko | ja | en … */
  asrLang?: string
  /** auto = 로그인된 쪽(Claude 우선) / none = 측정만 */
  ai: 'auto' | 'claude' | 'codex' | 'none'
  overwrite?: boolean
}

export interface VideoProgress {
  stage: string
  progress?: number
  message?: string
}

export interface VideoImportSummary {
  seq: string
  sourceId: string
  shots: number
  panels: number
  review: number
  dialogue: number
  ai: { panels: number; cached: number; pass2: number; inTok: number; outTok: number; ms: number; error?: string } | null
  aiAgent: string | null
  stages: Record<string, number>
  cached: string[]
  warnings: string[]
  ms: number
}

export interface VideoApi {
  pick(kind: VideoKind): Promise<string[]>
  suggest(): Promise<{ seq: string; ep: string }>
  import(o: VideoImportOptions): Promise<VideoImportSummary>
}
