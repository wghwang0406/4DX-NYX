// Claude Code CLI 어댑터 — `claude -p --input-format stream-json --output-format stream-json`.
// 검증 근거: spikes/claude/REPORT.md (2.1.295). 프롬프트는 stdin, 프로세스는 턴을 넘어 살려 둔다.
//
// 인터럽트: 2.1.295 의 `claude --help` 에는 stream-json 입력으로 보내는 "턴 중단" 메시지가 없다
// (`--replay-user-messages` 만 있다). 그래서 interrupt() 는 프로세스 트리를 죽이고 세션을 끝낸다 —
// 이어가려면 `open({ resume: nativeSessionId })` 로 새 세션을 연다 (`--session-id` 로 열었을 때만 가능).

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import type { AgentAdapter, AgentDetect, AgentEvent, AgentSession, OpenOptions, SendMessage } from './types'
import { EventQueue, LineSplitter, parseJsonLine } from './jsonl'
import { findBin, killTree, probe, spawnProc, waitExit } from './spawn'

export const CLAUDE_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
}

export function mcpConfigJson(mcp: { url: string; token: string }): string {
  return JSON.stringify({
    mcpServers: { conti: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } },
  })
}

/**
 * 검증된 실행 인자 (REPORT "권장 실행 커맨드"). 프롬프트는 절대 argv 에 넣지 않는다 —
 * variadic 옵션(--tools/--allowedTools/--mcp-config/--plugin-dir)이 뒤의 positional 을 삼킨다.
 */
export function buildClaudeArgs(o: OpenOptions, extra: { sessionId?: string } = {}): string[] {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompts', 'none',
    '--setting-sources', 'project',
    '--plugin-dir', o.bundleDir,
    '--mcp-config', mcpConfigJson(o.mcp),
    '--strict-mcp-config',
    '--tools', 'Read,Glob,Grep,Skill',
    '--allowedTools', 'Skill', 'mcp__conti__*',
    '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ]
  if (o.systemPromptFile) args.push('--append-system-prompt-file', o.systemPromptFile)
  if (o.model) args.push('--model', o.model)
  if (o.effort) args.push('--effort', o.effort)
  if (o.mode === 'chat') {
    if (o.resume) args.push('--resume', o.resume)
    else args.push('--session-id', extra.sessionId ?? randomUUID())
  } else {
    args.push('--no-session-persistence')
  }
  return args
}

// ---------- stdin 메시지 ----------

const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

async function imageBlock(src: string): Promise<Record<string, unknown>> {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src)
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
  const ext = src.split('.').pop()?.toLowerCase() ?? ''
  const data = (await readFile(src)).toString('base64')
  return { type: 'image', source: { type: 'base64', media_type: MEDIA[ext] ?? 'image/png', data } }
}

export async function userMessageLine(m: SendMessage): Promise<string> {
  const content: Record<string, unknown>[] = []
  for (const img of m.images ?? []) content.push(await imageBlock(img))
  content.push({ type: 'text', text: m.text })
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

// ---------- 파서 ----------

type J = Record<string, any>

export function classifyError(msg: string): Extract<AgentEvent, { t: 'error' }>['kind'] {
  if (/not logged in|invalid api key|authentication|unauthori[sz]ed|\b401\b|login required/i.test(msg)) return 'auth'
  if (/\b429\b|overage|usage limit|out of (extra )?usage|quota|limit reached|credit/i.test(msg)) return 'usage_limit'
  if (/rate.?limit|too many requests/i.test(msg)) return 'rate_limit'
  if (/mcp/i.test(msg)) return 'mcp'
  return 'other'
}

function textOf(content: unknown, limit = 200): string {
  if (typeof content === 'string') return content.slice(0, limit)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const c of content as J[]) {
    if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
    else if (c?.type === 'image') parts.push('[image]')
    else if (c?.type === 'tool_reference') parts.push(`[tool: ${c.tool_name}]`)
  }
  return parts.join(' ').slice(0, limit)
}

/** stdout 이벤트 한 줄 → AgentEvent 0..n. 세션은 한 번만, rate_limit 은 다음 usage 에 합친다. */
export class ClaudeParser {
  sessionEmitted = false
  nativeSessionId?: string
  private utilization?: { fiveHour?: number; sevenDay?: number }

  feed(e: J): AgentEvent[] {
    const out: AgentEvent[] = []
    switch (e.type) {
      case 'system': {
        if (e.subtype !== 'init') break
        if (!this.sessionEmitted) {
          this.sessionEmitted = true
          this.nativeSessionId = e.session_id
          const servers: J[] = Array.isArray(e.mcp_servers) ? e.mcp_servers : []
          const conti = servers.find((s) => s.name === 'conti')
          out.push({
            t: 'session',
            nativeSessionId: String(e.session_id ?? ''),
            model: e.model,
            mcpOk: conti ? conti.status === 'connected' : servers.length ? servers.every((s) => s.status === 'connected') : undefined,
            tools: Array.isArray(e.tools) ? e.tools : undefined,
          })
          if (conti && conti.status !== 'connected') out.push({ t: 'error', kind: 'mcp', message: `MCP conti: ${conti.status}` })
        }
        out.push({ t: 'turn_start' }) // init 은 턴마다 다시 나온다
        break
      }
      case 'stream_event': {
        const ev = e.event
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
          out.push({ t: 'text_delta', text: ev.delta.text })
        }
        break
      }
      case 'assistant': {
        for (const c of (e.message?.content ?? []) as J[]) {
          if (c.type === 'text' && typeof c.text === 'string') out.push({ t: 'text', text: c.text })
          else if (c.type === 'tool_use') out.push({ t: 'tool_start', id: String(c.id), name: String(c.name), input: c.input })
        }
        break
      }
      case 'user': {
        for (const c of (e.message?.content ?? []) as J[]) {
          if (c.type !== 'tool_result') continue
          out.push({ t: 'tool_end', id: String(c.tool_use_id), ok: !c.is_error, summary: textOf(c.content) })
        }
        break
      }
      case 'rate_limit_event': {
        const info = e.rate_limit_info ?? {}
        const w = info.unifiedWindows ?? {}
        this.utilization = { fiveHour: w.five_hour?.utilization, sevenDay: w.seven_day?.utilization }
        if (typeof info.status === 'string' && info.status !== 'allowed') {
          out.push({ t: 'error', kind: 'rate_limit', message: `rate limit ${info.status} (${info.rateLimitType ?? ''})`.trim() })
        }
        break
      }
      case 'result': {
        const u = e.usage ?? {}
        out.push({
          t: 'usage',
          inTok: u.input_tokens ?? 0,
          outTok: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
          costUsd: e.total_cost_usd,
          utilization: this.utilization,
        })
        this.utilization = undefined
        const subtype = String(e.subtype ?? 'unknown')
        if (e.is_error || subtype !== 'success') {
          const msg = typeof e.result === 'string' && e.result ? e.result : subtype
          out.push({ t: 'error', kind: subtype === 'error_max_turns' ? 'other' : classifyError(msg), message: msg })
        }
        out.push({ t: 'turn_end', stop: subtype, structured: e.structured_output ?? undefined })
        break
      }
      default:
        break // system/status, tool_progress, 기타
    }
    return out
  }

  /** stderr 줄에서 인증·한도 문제를 잡는다 (stdout JSON 이 안 나오고 죽는 경우). */
  feedStderr(line: string): AgentEvent[] {
    const kind = classifyError(line)
    if (kind === 'auth' || kind === 'usage_limit') return [{ t: 'error', kind, message: line.trim().slice(0, 300) }]
    return []
  }
}

/** 샘플 재생 (테스트용): JSON 객체 배열 → AgentEvent 배열 */
export function parseClaudeEvents(objs: J[]): AgentEvent[] {
  const p = new ClaudeParser()
  return objs.flatMap((o) => p.feed(o))
}

// ---------- 세션 ----------

class ClaudeSession implements AgentSession {
  readonly kind = 'claude' as const
  readonly threadId: string
  nativeSessionId?: string
  readonly events: EventQueue<AgentEvent>
  readonly pid: number | undefined
  private readonly child: ChildProcess
  private readonly parser = new ClaudeParser()
  private turnOpen = false
  private closing = false
  private stderrTail = ''
  private exited = false

  constructor(child: ChildProcess, opts: OpenOptions, sessionId?: string) {
    this.threadId = opts.threadId
    this.child = child
    this.pid = child.pid
    this.nativeSessionId = opts.resume ?? sessionId
    this.events = new EventQueue<AgentEvent>()
    const stdout = new LineSplitter()
    const stderr = new LineSplitter()
    child.stdout?.on('data', (d: Buffer) => {
      for (const line of stdout.push(d)) this.handleLine(line)
    })
    child.stderr?.on('data', (d: Buffer) => {
      for (const line of stderr.push(d)) {
        this.stderrTail = (this.stderrTail + line + '\n').slice(-4000)
        for (const ev of this.parser.feedStderr(line)) this.events.push(ev)
      }
    })
    child.on('error', (err) => {
      this.events.push({ t: 'error', kind: 'crash', message: `claude 실행 실패: ${err.message}` })
    })
    child.on('close', (code, signal) => {
      const tail = stdout.flush()
      if (tail) this.handleLine(tail)
      this.exited = true
      if (this.turnOpen && !this.closing) {
        const detail = this.stderrTail.trim().slice(-500)
        this.events.push({
          t: 'error',
          kind: 'crash',
          message: `claude exited (code ${code ?? signal}) mid-turn${detail ? `: ${detail}` : ''}`,
        })
        this.events.push({ t: 'turn_end', stop: 'crash' })
      }
      this.turnOpen = false
      this.events.push({ t: 'exit', code })
      this.events.end()
    })
  }

  private handleLine(line: string): void {
    const obj = parseJsonLine(line)
    if (!obj) return
    for (const ev of this.parser.feed(obj)) {
      if (ev.t === 'session') this.nativeSessionId = ev.nativeSessionId
      if (ev.t === 'turn_end') this.turnOpen = false
      this.events.push(ev)
    }
  }

  on(fn: (e: AgentEvent) => void): () => void {
    return this.events.on(fn)
  }

  async send(m: SendMessage): Promise<void> {
    if (this.exited || !this.child.stdin || this.child.stdin.destroyed) throw new Error('claude session is closed')
    const line = await userMessageLine(m)
    this.turnOpen = true
    await new Promise<void>((resolve, reject) => {
      this.child.stdin!.write(line, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** stream-json 에는 턴 중단 메시지가 없다 — 프로세스를 죽이고 세션을 끝낸다 (resume 으로 복구). */
  async interrupt(): Promise<void> {
    if (this.exited) return
    this.closing = true
    if (this.turnOpen) {
      this.turnOpen = false
      this.events.push({ t: 'turn_end', stop: 'interrupted' })
    }
    await killTree(this.child.pid)
    await waitExit(this.child, 3000)
  }

  async close(): Promise<void> {
    if (this.exited) return
    this.closing = true
    try {
      this.child.stdin?.end()
    } catch {
      /* 이미 닫힘 */
    }
    if (await waitExit(this.child, 3000)) return
    await killTree(this.child.pid)
    await waitExit(this.child, 2000)
  }
}

export const claudeAdapter: AgentAdapter = {
  kind: 'claude',

  async detect(): Promise<AgentDetect> {
    const path = await findBin('claude')
    if (!path) return { installed: false, auth: 'unknown', detail: 'claude 실행 파일을 찾지 못함' }
    const v = await probe(path, ['--version'])
    const auth = await probe(path, ['auth', 'status'], 15000)
    const out = auth.out
    let state: AgentDetect['auth'] = 'unknown'
    if (/not logged|logged out|no credentials/i.test(out)) state = 'missing'
    else if (/logged\s*in|authenticated|[\w.+-]+@[\w-]+\.[\w.]+/i.test(out)) state = 'ok'
    else if (auth.ok) state = 'missing'
    return { installed: true, version: v.out.split('\n')[0], path, auth: state, detail: out.slice(0, 200) }
  },

  async open(o: OpenOptions): Promise<AgentSession> {
    const exe = o.exe ?? o.env?.CONTI_AGENT_BIN ?? (await findBin('claude')) ?? 'claude'
    const sessionId = o.mode === 'chat' && !o.resume ? randomUUID() : undefined
    const args = buildClaudeArgs(o, { sessionId })
    const child = spawnProc(exe, args, { cwd: o.projectRoot, env: { ...CLAUDE_ENV, ...o.env } })
    return new ClaudeSession(child, o, sessionId)
  },
}
