// 레이아웃(시트·출력·Template Lab) ↔ 렌더러 계약
export type ExportKind = 'pdf' | 'png' | 'animatic'

export interface TemplateInfo {
  id: string
  name: string
  dir: string
  version: string
  description: string
  builtin: boolean
  current: boolean
  error?: string
}

export interface LayoutRenderResult {
  html: string
  pages: number
  templateId: string
  pageMm: [number, number]
  error?: string
}

export interface ExportRecord {
  kind: ExportKind
  v: number
  key: string
  files: string[] // 프로젝트 상대경로
  at: number
  pages: number
  templateId?: string
}

export interface ExportResult {
  files: string[]
  version: number
  /** 내용이 같아 이전 출력을 그대로 돌려줌 */
  reused: boolean
  ms: number
  pages: number
}

export interface LayoutApi {
  templates(): Promise<TemplateInfo[]>
  render(seq: string | null, opts?: { templateId?: string; sample?: boolean }): Promise<LayoutRenderResult>
  export(seq: string, kind: ExportKind, opts?: { status?: string; templateId?: string }): Promise<ExportResult>
  history(seq: string): Promise<ExportRecord[]>
  reveal(rel: string): Promise<void>
  setTemplate(id: string): Promise<void>
  duplicate(fromId: string, name?: string): Promise<TemplateInfo>
  openFolder(id: string): Promise<void>
}
