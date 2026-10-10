import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ProjectStore } from '@conti/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerTools, type ContiMcpHooks, type Ctx } from './context'
import { SpendRegistry, type SpendDecision, type SpendDecisionOptions, type SpendKind, type SpendRequest } from './spend'
import { projectTools } from './tools/project'
import { sequenceTools } from './tools/sequence'
import { shotTools } from './tools/shots'
import { assetTools } from './tools/assets'
import { specTools } from './tools/spec'
import { imageTools } from './tools/image'
import { jobTools, paidTools, uiTools } from './tools/jobs'
import { panelTools } from './tools/panels'
import { feedbackTools } from './tools/feedback'

export interface ContiMcpOptions {
  store: ProjectStore
  /** agent-bundle 폴더 (specs/index.json + skills/{Lira,Cinedance,Acting}/SKILL.md). 없으면 spec 도구는 빈 결과 + 안내. */
  bundleDir: string
  projectRoot: string
  hooks?: ContiMcpHooks
}

export interface ContiMcp {
  start(): Promise<{ url: string; token: string; port: number }>
  stop(): Promise<void>
  /** 호스트(UI 승인 카드)가 유료 요청을 판정한다 — jobs_wait 가 깨어난다. */
  resolveSpendRequest(requestId: string, decision: SpendDecision, options?: SpendDecisionOptions, error?: string): SpendRequest
  getSpendRequest(requestId: string): SpendRequest | undefined
  /** 호스트(UI 버튼·파일럿 후속)가 유료 요청을 만든다 — onSpendRequest 훅이 똑같이 불린다. */
  createSpendRequest(kind: SpendKind, count: number, args: unknown, parentRequestId?: string): SpendRequest
}

export const MCP_PATH = '/mcp'
const BODY_LIMIT = 8 * 1024 * 1024

export const ALL_TOOLS = [...projectTools, ...sequenceTools, ...shotTools, ...panelTools, ...assetTools, ...specTools, ...imageTools, ...uiTools, ...paidTools, ...jobTools, ...feedbackTools]
export const TOOL_NAMES = ALL_TOOLS.map((t) => t.name)

function buildMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: 'conti', version: '0.0.1' })
  registerTools(server, ctx, ALL_TOOLS)
  return server
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > BODY_LIMIT) throw new Error('body too large')
    chunks.push(c as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  // 오류 응답은 요청 바디를 다 읽지 않은 채 끝나므로 소켓을 재사용하면 다음 요청이 ECONNRESET 을 받는다 — 닫게 한다
  res.writeHead(status, { 'content-type': 'application/json', ...(status >= 400 ? { connection: 'close' } : {}) })
  res.end(JSON.stringify(body))
}

export function createContiMcp(o: ContiMcpOptions): ContiMcp {
  const token = randomBytes(32).toString('hex')
  const spend = new SpendRegistry()
  const ctx: Ctx = { store: o.store, bundleDir: o.bundleDir, projectRoot: o.projectRoot, hooks: o.hooks ?? {}, spend }
  let http: Server | null = null
  const sockets = new Set<import('node:net').Socket>()

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== MCP_PATH) return sendJson(res, 404, { error: 'not found' })
    if (req.headers.authorization !== `Bearer ${token}`) return sendJson(res, 401, { error: 'unauthorized' })
    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('allow', 'GET, POST, DELETE')
      return sendJson(res, 405, { error: 'method not allowed' })
    }
    let body: unknown
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req)
      } catch (e) {
        return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: `Parse error: ${(e as Error).message}` }, id: null })
      }
    }
    // stateless: 요청마다 새 서버 + 전송 (세션 없음) — 스파이크와 동일한 방식
    const server = buildMcpServer(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  return {
    async start() {
      if (http) throw new Error('이미 시작됨')
      http = createServer((req, res) => {
        handle(req, res).catch((e) => {
          if (!res.headersSent) sendJson(res, 500, { error: (e as Error).message })
          else res.end()
        })
      })
      http.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
      })
      const srv = http
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject)
        srv.listen(0, '127.0.0.1', () => resolve())
      })
      const port = (srv.address() as AddressInfo).port
      return { url: `http://127.0.0.1:${port}${MCP_PATH}`, token, port }
    },
    async stop() {
      const srv = http
      if (!srv) return
      http = null
      for (const s of sockets) s.destroy()
      await new Promise<void>((resolve) => srv.close(() => resolve()))
    },
    resolveSpendRequest: (id, decision, options, error) => spend.resolve(id, decision, options, error),
    getSpendRequest: (id) => spend.get(id),
    createSpendRequest: (kind, count, args, parent) => {
      const req = spend.create(kind, count, args, parent)
      ctx.hooks.onSpendRequest?.(req)
      return req
    },
  }
}
