// AI 채팅 ↔ 렌더러 계약 (packages/agents 의 AgentEvent 를 그대로 흘려보낸다)
export type AgentKind = 'claude' | 'codex'

export interface AgentAvailability {
  kind: AgentKind
  installed: boolean
  auth: 'ok' | 'missing' | 'unknown'
  version?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  at: number
  tool?: { name: string; ok?: boolean; summary?: string; pending?: boolean }
  streaming?: boolean
}

export interface ThreadInfo {
  id: string
  agent: AgentKind
  title: string
  seq?: string
  nativeSessionId?: string
  lastActiveAt: number
}

export type SpendKindView = 'conti_generate' | 'assets_generate' | 'image_edit' | 'panel_restyle'

/** 작업 한 건의 화면용 요약 (JobService JobRecord 에서 뽑음) */
export interface JobView {
  id: string
  requestId: string
  status: string
  kind: string
  target: string // "S41 0030" / "@해수 sheet"
  seq?: string
  shotNo?: string
  model: string
  outFile?: string
  error?: string
  lint: string[]
  createdAt: number
  updatedAt: number
}

export interface SpendRequestView {
  requestId: string
  kind: SpendKindView | string
  count: number
  status: 'awaiting_approval' | 'approved' | 'rejected' | 'pilot' | 'done' | 'failed'
  seq?: string
  shots?: string[]
  createdAt: number
  /** 승인 뒤 계획·제출에서 막힌 이유 */
  error?: string
  parentRequestId?: string
  progress?: { total: number; done: number; failed: number }
}

/** 승인 카드를 펼쳤을 때 보여줄 계획 (무료 — 크레딧은 표시하지 않는다) */
export interface SpendPreview {
  count: number
  notes: string[]
  items: Array<{ target: string; model: string; prompt: string; refs: string[]; lint: string[] }>
}

export interface UsageView {
  inTok: number
  outTok: number
  cacheRead?: number
  costUsd?: number
  fiveHour?: number // 구독 5시간 창 사용률 0..1
}

export type AgentUiEvent =
  | { t: 'message'; threadId: string; message: ChatMessage }
  | { t: 'delta'; threadId: string; messageId: string; text: string }
  | { t: 'tool'; threadId: string; messageId: string; tool: ChatMessage['tool'] }
  | { t: 'usage'; threadId: string; usage: UsageView }
  | { t: 'turn_end'; threadId: string }
  | { t: 'error'; threadId: string; message: string; kind: string }
  | { t: 'spend'; request: SpendRequestView }
  | { t: 'job'; job: JobView }
  | { t: 'focus'; seq: string; shotNo?: string }

export interface AgentApi {
  availability(): Promise<AgentAvailability[]>
  threads(): Promise<ThreadInfo[]>
  history(threadId: string): Promise<ChatMessage[]>
  open(opts: { agent: AgentKind; seq?: string; threadId?: string }): Promise<ThreadInfo>
  send(threadId: string, text: string, context?: { seq?: string; shotNo?: string }): Promise<void>
  interrupt(threadId: string): Promise<void>
  close(threadId: string): Promise<void>
  spendList(): Promise<SpendRequestView[]>
  spendDecide(requestId: string, decision: 'approved' | 'rejected' | 'pilot', includeNeighbors?: boolean): Promise<void>
  spendPreview(requestId: string, includeNeighbors?: boolean): Promise<SpendPreview>
  /** UI 버튼에서 유료 요청을 만든다 — 승인 카드가 뜬다 (바로 생성하지 않는다) */
  requestSpend(kind: SpendKindView, args: Record<string, unknown>): Promise<SpendRequestView>
  jobs(requestId?: string): Promise<JobView[]>
  jobResubmit(jobId: string): Promise<JobView>
  runTask(task: 'setup' | 'breakdown', seq?: string): Promise<{ threadId: string }>
}
