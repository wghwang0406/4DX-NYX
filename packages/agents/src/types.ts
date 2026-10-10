// 공개 타입 — 플랜 §2 어댑터 인터페이스.

export type AgentKind = 'claude' | 'codex'

export interface AgentDetect {
  installed: boolean
  version?: string
  path?: string
  auth: 'ok' | 'missing' | 'unknown'
  detail?: string
}

export interface OpenOptions {
  projectRoot: string
  threadId: string
  /** 네이티브 세션/스레드 id — claude `--resume <id>` / codex `exec resume <id>` */
  resume?: string
  model?: string
  effort?: string
  mcp: { url: string; token: string }
  bundleDir: string
  systemPromptFile?: string
  mode: 'chat' | 'task'
  /** codex 전용 (claude 는 무시) */
  sandbox?: 'read-only' | 'workspace-write'
  env?: Record<string, string>
  /**
   * 실행 파일 경로 덮어쓰기 (테스트·진단용). 없으면 `env.CONTI_AGENT_BIN`, 그다음 PATH 에서 찾는다.
   */
  exe?: string
}

export type AgentEvent =
  | { t: 'session'; nativeSessionId: string; model?: string; mcpOk?: boolean; tools?: string[] }
  | { t: 'turn_start' }
  | { t: 'text_delta'; text: string }
  | { t: 'text'; text: string }
  | { t: 'tool_start'; id: string; name: string; input: unknown }
  | { t: 'tool_end'; id: string; ok: boolean; summary: string }
  | {
      t: 'usage'
      inTok: number
      outTok: number
      cacheRead?: number
      cacheWrite?: number
      costUsd?: number
      utilization?: { fiveHour?: number; sevenDay?: number }
    }
  | { t: 'turn_end'; stop: string; structured?: unknown }
  | { t: 'error'; kind: 'auth' | 'rate_limit' | 'usage_limit' | 'mcp' | 'crash' | 'other'; message: string }
  | { t: 'exit'; code: number | null }

export interface SendMessage {
  text: string
  /** 이미지 — 파일 절대경로 또는 `data:<mime>;base64,<...>` URL */
  images?: string[]
}

export interface AgentSession {
  readonly kind: AgentKind
  readonly threadId: string
  nativeSessionId?: string
  send(m: SendMessage): Promise<void>
  interrupt(): Promise<void>
  close(): Promise<void>
  events: AsyncIterable<AgentEvent>
  /** 편의용 구독. 반환값을 부르면 구독 해제. */
  on(fn: (e: AgentEvent) => void): () => void
}

export interface AgentAdapter {
  kind: AgentKind
  detect(): Promise<AgentDetect>
  open(o: OpenOptions): Promise<AgentSession>
}
