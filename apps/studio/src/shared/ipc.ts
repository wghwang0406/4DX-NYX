// 메인 ↔ 렌더러 계약. 양쪽이 이 타입만 본다.
import type { Asset, Project, Sequence, Shot } from '@conti/domain'
import type { SceneChunk } from '@conti/screenplay'

export interface ToolStatus {
  name: 'claude' | 'codex' | 'higgsfield' | 'ffmpeg' | 'uv'
  installed: boolean
  version?: string
  path?: string
  login?: 'ok' | 'missing' | 'unknown'
  detail?: string
}

export interface ImportScene extends Pick<SceneChunk, 'index' | 'number' | 'headingRaw' | 'title' | 'timeOfDay' | 'lineStart' | 'lineEnd'> {
  preview: string
  suggestedSeq: string
  lineCount: number
}

export interface ImportPreview {
  sourceId: string
  fileName: string
  lineCount: number
  scenes: ImportScene[]
}

/** 가져오기 확정: 체크 해제된 씬은 바로 앞의 체크된 씬에 합쳐진다 (씬 경계 수동 조정) */
export interface ImportPick {
  index: number
  seq: string
  ep: string
  mergeFollowing?: number[] // 이 씬에 합칠 뒤따르는 씬 index
}

export interface PendingChangeView {
  rel: string
  kind: 'config' | 'shotlist' | 'projectprompt'
  seq?: string
  summary: string[]
}

export interface Api {
  project: {
    openDialog(): Promise<{ root: string; project: Project } | null>
    createDialog(init: { code: string; title: string }): Promise<{ root: string; project: Project } | null>
    openPath(root: string): Promise<{ root: string; project: Project }>
    current(): Promise<{ root: string; project: Project } | null>
    recent(): Promise<Array<{ root: string; title: string; code: string; openedAt: number }>>
  }
  sequence: {
    list(): Promise<Sequence[]>
    get(seq: string): Promise<Sequence | null>
    updateShot(seq: string, shotId: string, patch: Partial<Shot>): Promise<Sequence>
    /** 버전 기록에서 현재 콘티 버전을 바꾼다 (크레딧 0) */
    setCurrentVersion(seq: string, shotId: string, versionId: string): Promise<Sequence>
  }
  screenplay: {
    importDialog(): Promise<ImportPreview | null>
    commit(sourceId: string, picks: ImportPick[]): Promise<Sequence[]>
  }
  assets: {
    list(ep: string): Promise<Asset[]>
  }
  md: {
    pending(): Promise<PendingChangeView[]>
    accept(rel: string): Promise<void>
    discard(rel: string): Promise<void>
  }
  diag: {
    tools(): Promise<ToolStatus[]>
  }
}

export type StoreChange = { type: 'project' } | { type: 'sequence'; seq: string } | { type: 'assets'; ep: string } | { type: 'md-pending'; count: number }
