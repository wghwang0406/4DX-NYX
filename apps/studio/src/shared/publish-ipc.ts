// 게시·피드백 ↔ 렌더러 계약
export type FeedbackState = 'open' | 'applied' | 'declined'

export interface PublishSettingsView {
  url: string
  hasToken: boolean
  encrypted: boolean
}

export interface PublishRecord {
  id: string
  seq: string
  version: number
  label: string
  status: string
  url: string
  at: number
  revoked: boolean
  archive: { status: string; error?: string; path?: string }
  comments: { open: number; total: number }
  files: number
  bytes: number
  /** 이번에 실제로 올린 바이트 (나머지는 서버에 이미 있어 건너뜀) */
  uploaded: number
}

export interface PublishProgress {
  stage: 'prepare' | 'render' | 'upload' | 'create' | 'done'
  message?: string
  done?: number
  total?: number
  file?: string
  index?: number
  count?: number
  skipped?: number
  url?: string
}

export interface FeedbackItem {
  commentId: string
  seq: string
  label: string // 코멘트가 달린 게시본
  kind: string // panel | region | time | general | verdict
  shotNo?: string
  panelIndex?: number
  region?: { page: number; x: number; y: number; w: number; h: number }
  tMs?: number
  frame?: number
  text: string
  author: string
  verdict?: 'approve' | 'changes'
  /** 스튜디오 쪽 상태 — applied 는 다음 게시 때 서버에 "vN에서 반영됨"으로 회신 */
  state: FeedbackState
  serverStatus: 'open' | 'resolved' | 'declined'
  resolvedIn?: string
  note?: string
  pendingSync: boolean
  createdAt: number
}

export interface PublishApi {
  settings(): Promise<PublishSettingsView>
  saveSettings(url: string, token?: string): Promise<void>
  test(): Promise<{ ok: boolean; message: string; dropbox?: boolean }>
  publish(seq: string, o: { status: string; templateId?: string }): Promise<PublishRecord>
  history(seq: string, refresh?: boolean): Promise<PublishRecord[]>
  revoke(id: string): Promise<void>
  feedback(filter?: { seq?: string; state?: FeedbackState | 'all' }): Promise<FeedbackItem[]>
  pull(): Promise<{ added: number; total: number; error?: string }>
  updateFeedback(commentId: string, state: FeedbackState, note?: string): Promise<FeedbackItem>
  /** 열린 코멘트를 AI 작업으로 (feedback-apply 스킬) */
  applyWithAi(seq: string, commentIds?: string[]): Promise<{ threadId: string }>
}
