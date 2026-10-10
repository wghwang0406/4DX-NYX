// 스튜디오 ↔ 뷰어 서버 ↔ 뷰어 웹 공통 계약. 게시본(번들)은 불변이다 — 같은 내용을 다시 올리면 파일은 해시로 재사용된다.

export interface BundleFile {
  path: string // 번들 안 상대경로 (pages/p01.png …)
  sha256: string
  size: number
  type: string // MIME
}

export interface PanelRect {
  shotNo: string
  panelIndex: number
  label: string
  /** 페이지 이미지 기준 0..1 */
  x: number
  y: number
  w: number
  h: number
}

export interface BundlePage {
  n: number
  file: string
  w: number
  h: number
  panels: PanelRect[]
}

export interface BundlePanel {
  shotNo: string
  panelIndex: number
  label: string
  file?: string
  size?: string
  angle?: string
  cameraMove?: string
  duration?: string
  tc?: string
  action?: string
  dialogue?: Array<{ speaker?: string; text: string }>
}

export interface EdlEntry {
  shotNo: string
  inMs: number
  outMs: number
}

export interface Manifest {
  schema: 1
  project: { id: string; code: string; title: string }
  seq: string
  ep: string
  heading: string
  label: string // "v3"
  status: string // 작업 중 / 컨펌용 / 최종
  createdAt: number
  pages: BundlePage[]
  panels: BundlePanel[]
  pdf?: string
  video?: { file: string; fps: number; duration: number }
  edl?: EdlEntry[]
  files: BundleFile[]
}

export type CommentKind = 'panel' | 'region' | 'time' | 'general' | 'verdict'
export type CommentStatus = 'open' | 'resolved' | 'declined'

export interface Comment {
  id: string
  publicationId: string
  projectId: string
  seq: string
  label: string // 코멘트가 달린 게시본 라벨
  kind: CommentKind
  shotNo?: string
  panelIndex?: number
  page?: number
  x?: number
  y?: number
  w?: number
  h?: number
  tMs?: number
  frame?: number
  body: string
  author: string
  verdict?: 'approve' | 'changes'
  status: CommentStatus
  resolvedIn?: string // "v4"
  resolvedNote?: string
  createdAt: number
  updatedAt: number
}

export interface PublicationInfo {
  id: string
  projectId: string
  seq: string
  version: number
  label: string
  status: string
  token: string
  url: string
  createdAt: number
  revoked: boolean
  expiresAt?: number
  archive: { status: 'pending' | 'running' | 'done' | 'error' | 'skipped'; error?: string; path?: string }
  comments: { open: number; total: number }
}

export interface ChangesResponse {
  cursor: number
  comments: Comment[]
}

export interface ReviewPayload {
  manifest: Omit<Manifest, 'files'>
  publication: { id: string; label: string; status: string; createdAt: number; version: number }
  /** 같은 시퀀스의 다른 게시본 (최신 순) — 뷰어가 "최신본 있음"을 알린다 */
  versions: Array<{ label: string; token: string; createdAt: number; current: boolean }>
  comments: Comment[]
}
