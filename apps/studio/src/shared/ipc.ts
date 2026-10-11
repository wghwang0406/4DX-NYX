// 메인 ↔ 렌더러 계약. 양쪽이 이 타입만 본다.
import type { Annotation, Asset, Project, Sequence, Shot } from '@conti/domain'
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
  /** 이 씬(줄)이 이미 들어간 시퀀스 — 다시 만들지 않는다 */
  madeSeq?: string
}

export interface ImportPreview {
  sourceId: string
  /** 프로젝트 sources/ 안의 사본 — 다시 펼칠 때 쓴다 */
  sourceRel: string
  fileName: string
  lineCount: number
  scenes: ImportScene[]
}

/** 가져온 시나리오 파일 (sources/) */
export interface ImportSourceInfo {
  rel: string
  fileName: string
  madeCount: number
  /** 이번 실행에서 펼친 적이 있으면 씬 수 */
  sceneCount?: number
  importedAt: number
}

/** 가져오기 확정: 체크한 씬만 만든다. mergeFollowing 은 사용자가 "앞 씬에 합치기"를 켠 뒤따르는 씬 */
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
    close(): Promise<void>
    busy(): Promise<{ jobs: number }>
    forgetRecent(root: string): Promise<Array<{ root: string; title: string; code: string; openedAt: number }>>
    setDefaults(patch: { imageEngine?: 'higgsfield' | 'codex'; contiStyle?: 'sketch' | 'cinematic' }): Promise<Project>
  }
  sequence: {
    list(): Promise<Sequence[]>
    get(seq: string): Promise<Sequence | null>
    updateShot(seq: string, shotId: string, patch: Partial<Shot>): Promise<Sequence>
    /** 버전 기록에서 현재 콘티 버전을 바꾼다 (크레딧 0) */
    setCurrentVersion(seq: string, shotId: string, versionId: string): Promise<Sequence>
    /** 패널 주석(화살표·프레임·메모) 교체 — 크레딧 0, 재생성 표시 없음 */
    setAnnotations(seq: string, shotId: string, panelIndex: number, annotations: Annotation[]): Promise<Sequence>
  }
  screenplay: {
    importDialog(): Promise<ImportPreview | null>
    commit(sourceId: string, picks: ImportPick[]): Promise<Sequence[]>
    sources(): Promise<ImportSourceInfo[]>
    open(rel: string): Promise<ImportPreview>
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
