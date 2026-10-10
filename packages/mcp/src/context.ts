import type { ProjectStore } from '@conti/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodRawShape, z } from 'zod'
import type { SpendRegistry, SpendRequest } from './spend'
import { ToolError, errorMessage, fail } from './util'

export interface ContiMcpHooks {
  onToolCall?(name: string, args: unknown, result: { ok: boolean; ms: number }): void
  onUiFocus?(seq: string, shotNo?: string): void
  /** 유료 도구는 요청만 만들고 즉시 돌아온다. 호스트가 승인 카드를 띄우고, 승인되면 JobService 가 생성한다. */
  onSpendRequest?(req: SpendRequest): void
  /** 승인된 요청의 작업 진행 (JobService) — jobs_status / jobs_wait 가 보여준다. */
  jobsForRequest?(requestId: string): JobView[]
  /** 뷰어 피드백 (PublishService) — 게시 서버가 설정돼 있을 때만 */
  feedbackList?(f: { seq?: string; state?: 'open' | 'applied' | 'declined' | 'all' }): Promise<FeedbackView[]>
  feedbackUpdate?(commentId: string, state: 'open' | 'applied' | 'declined', o: { note?: string; versionId?: string }): Promise<FeedbackView>
}

export interface FeedbackView {
  commentId: string
  seq: string
  label: string
  kind: string
  shotNo?: string
  panelIndex?: number
  region?: { page: number; x: number; y: number; w: number; h: number }
  tMs?: number
  text: string
  author: string
  verdict?: 'approve' | 'changes'
  state: 'open' | 'applied' | 'declined'
  resolvedIn?: string
  note?: string
}

/** 작업 요약 — AI 에게 보여줄 만큼만 (프롬프트 전문은 뺀다). */
export interface JobView {
  id: string
  status: string
  target: string // "S41 0030" / "@해수 sheet"
  model: string
  outFile?: string
  error?: string
  lint?: string[]
}

export interface Ctx {
  store: ProjectStore
  bundleDir: string
  projectRoot: string
  hooks: ContiMcpHooks
  spend: SpendRegistry
}

export interface ToolDef<S extends ZodRawShape> {
  name: string
  description: string
  input: S
  handler(args: z.infer<z.ZodObject<S>>, ctx: Ctx): Promise<CallToolResult> | CallToolResult
}

export function defineTool<S extends ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def
}

/** 도구를 서버에 붙인다. 예외는 isError + 한국어로 바꾸고 onToolCall 훅에 시간·성공 여부를 넘긴다. */
export function registerTools(server: McpServer, ctx: Ctx, defs: ToolDef<any>[]) {
  for (const def of defs) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.input }, async (args: unknown) => {
      const t0 = performance.now()
      let result: CallToolResult
      try {
        result = await def.handler(args as never, ctx)
      } catch (e) {
        result = e instanceof ToolError ? fail(e.message, e.report) : fail(errorMessage(e))
      }
      ctx.hooks.onToolCall?.(def.name, args, { ok: !result.isError, ms: Math.round(performance.now() - t0) })
      return result
    })
  }
}
