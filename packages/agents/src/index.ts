// @conti/agents — claude / codex CLI 어댑터 공개 API.

export type { AgentKind, AgentDetect, OpenOptions, AgentEvent, AgentSession, AgentAdapter, SendMessage } from './types'
export { claudeAdapter, buildClaudeArgs, ClaudeParser, parseClaudeEvents, userMessageLine, mcpConfigJson, CLAUDE_ENV, classifyError } from './claude'
export { codexAdapter, buildCodexArgs, CodexParser, parseCodexEvents, codexMcpOverrides, wrapSystemPrompt, generatedImages, CODEX_TOKEN_ENV } from './codex'
export { LineSplitter, EventQueue, parseJsonLine, parseJsonlText } from './jsonl'
export { enrichedPath, findBin, probe } from './spawn'

import type { AgentAdapter, AgentKind } from './types'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'

export const adapters: Record<AgentKind, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter }

/** 로그인된 어댑터 하나를 고른다 — preferred 먼저, 없으면 나머지. 아무것도 없으면 null. */
export async function pickAvailable(preferred?: AgentKind): Promise<AgentKind | null> {
  const order: AgentKind[] = preferred ? [preferred, ...(['claude', 'codex'] as AgentKind[]).filter((k) => k !== preferred)] : ['claude', 'codex']
  const results = await Promise.all(order.map(async (k) => [k, await adapters[k].detect()] as const))
  for (const [k, d] of results) if (d.installed && d.auth === 'ok') return k
  return null
}
