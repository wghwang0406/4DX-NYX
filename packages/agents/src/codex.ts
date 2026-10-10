// Codex CLI 어댑터 — `codex exec --json` 을 턴마다 한 프로세스씩 띄운다.
// 검증 근거: spikes/codex/REPORT.md (0.162.0). 파싱 로직은 ~/.claude/mcp-servers/codex/index.mjs 를 옮겼다.
//
// - 첫 턴: `codex exec --json ... -s <sandbox> -C <root> -c mcp_servers.conti.* … -` (프롬프트 stdin)
// - 다음 턴: `codex exec resume <thread_id> --all --json … -c (같은 MCP 오버라이드) -` — resume 에는 -C/-s 가
//   없으므로 cwd 는 spawn cwd 로 넘긴다.
// - 시스템 프롬프트 플래그가 없어서 첫 프롬프트 앞에 <studio_rules> 블록으로 붙인다.
// - 인터럽트: codex pid 에 SIGINT(그룹 아님) → ≤3초 대기 → 살아남은 자손 SIGKILL → 그래도 살아 있으면 트리 kill.
// - 생성 이미지는 JSONL 에 안 나온다 → ~/.codex/generated_images/<thread>/ 에 턴 중 생긴 파일을 찾아 text 로 알린다.

import { readdirSync, statSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { AgentAdapter, AgentDetect, AgentEvent, AgentSession, OpenOptions, SendMessage } from './types'
import { EventQueue, LineSplitter, parseJsonLine } from './jsonl'
import { findBin, isAlive, killTree, listDescendants, probe, spawnProc, waitExit } from './spawn'
import { classifyError } from './claude'

export const CODEX_TOKEN_ENV = 'CONTI_MCP_TOKEN'

export function codexMcpOverrides(url: string): string[] {
  return [
    '-c', `mcp_servers.conti.url="${url}"`,
    '-c', `mcp_servers.conti.bearer_token_env_var="${CODEX_TOKEN_ENV}"`,
    '-c', 'mcp_servers.conti.default_tools_approval_mode="approve"',
    '-c', 'mcp_servers.conti.startup_timeout_sec=20',
  ]
}

/**
 * 실행 인자. 프롬프트는 항상 stdin(`-`). `-i` 는 값을 여러 개 먹는 옵션이라 다음 플래그 바로 앞(--json 뒤)에 둔다 —
 * 맨 뒤에 두면 `-` 까지 이미지로 삼킨다.
 */
export function buildCodexArgs(o: OpenOptions, extra: { resume?: string; images?: string[] } = {}): string[] {
  const images = (extra.images ?? []).flatMap((p) => ['-i', p])
  const mcp = codexMcpOverrides(o.mcp.url)
  if (extra.resume) {
    return ['exec', 'resume', extra.resume, '--all', '--json', ...images, '--skip-git-repo-check', '--ignore-user-config', ...mcp, '-']
  }
  const args = [
    'exec', '--json', ...images,
    '--skip-git-repo-check', '--ignore-user-config',
    '-s', o.sandbox ?? 'read-only',
    '-C', o.projectRoot,
    ...mcp,
  ]
  if (o.model) args.push('-m', o.model)
  if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`)
  args.push('-')
  return args
}

export function wrapSystemPrompt(rules: string, text: string): string {
  return `<studio_rules>\n${rules.trim()}\n</studio_rules>\n\n${text}`
}

// ---------- 파서 ----------

type J = Record<string, any>

function mcpSummary(it: J): string {
  if (it.error?.message) return String(it.error.message).slice(0, 200)
  const parts: string[] = []
  for (const c of (it.result?.content ?? []) as J[]) {
    if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
    else if (c.type === 'image') parts.push('[image]')
  }
  return parts.join(' ').slice(0, 200)
}

/** stdout 이벤트 한 줄 → AgentEvent 0..n. 턴을 넘어 하나를 계속 쓴다 (session 은 한 번만). */
export class CodexParser {
  sessionEmitted = false
  threadId?: string
  private started = new Set<string>()

  private toolStart(it: J): AgentEvent {
    this.started.add(String(it.id))
    if (it.type === 'command_execution') return { t: 'tool_start', id: String(it.id), name: 'shell', input: { command: it.command } }
    if (it.type === 'mcp_tool_call') {
      return { t: 'tool_start', id: String(it.id), name: `mcp__${it.server ?? 'conti'}__${it.tool}`, input: it.arguments }
    }
    return { t: 'tool_start', id: String(it.id), name: String(it.type), input: it.changes ?? it }
  }

  feed(e: J): AgentEvent[] {
    const out: AgentEvent[] = []
    switch (e.type) {
      case 'thread.started': {
        this.threadId = String(e.thread_id ?? '')
        if (!this.sessionEmitted) {
          this.sessionEmitted = true
          out.push({ t: 'session', nativeSessionId: this.threadId })
        }
        break
      }
      case 'turn.started':
        out.push({ t: 'turn_start' })
        break
      case 'item.started': {
        const it: J = e.item ?? {}
        if (it.type === 'command_execution' || it.type === 'mcp_tool_call' || it.type === 'file_change') out.push(this.toolStart(it))
        break
      }
      case 'item.completed': {
        const it: J = e.item ?? {}
        const id = String(it.id)
        if (it.type === 'agent_message') {
          if (typeof it.text === 'string' && it.text) {
            out.push({ t: 'text_delta', text: it.text }) // 스트리밍 델타가 없어서 완성본을 한 번에
            out.push({ t: 'text', text: it.text })
          }
        } else if (it.type === 'command_execution') {
          if (!this.started.has(id)) out.push(this.toolStart(it))
          const ok = it.status === 'completed' && (it.exit_code === 0 || it.exit_code == null)
          out.push({ t: 'tool_end', id, ok, summary: String(it.aggregated_output ?? '').slice(0, 200) })
        } else if (it.type === 'mcp_tool_call') {
          if (!this.started.has(id)) out.push(this.toolStart(it))
          out.push({ t: 'tool_end', id, ok: it.status === 'completed', summary: mcpSummary(it) })
        } else if (it.type === 'file_change') {
          if (!this.started.has(id)) out.push(this.toolStart(it))
          const changes = ((it.changes ?? []) as J[]).map((c) => `${c.kind ?? 'edit'} ${c.path}`).join(', ')
          out.push({ t: 'tool_end', id, ok: it.status !== 'failed', summary: changes.slice(0, 200) })
        } else if (it.type === 'error') {
          const msg = String(it.message ?? JSON.stringify(it))
          out.push({ t: 'error', kind: classifyError(msg), message: msg })
        }
        // reasoning 등 나머지는 무시
        break
      }
      case 'turn.completed': {
        const u: J = e.usage ?? {}
        out.push({
          t: 'usage',
          inTok: u.input_tokens ?? 0,
          outTok: u.output_tokens ?? 0,
          cacheRead: u.cached_input_tokens,
          cacheWrite: u.cache_write_input_tokens,
        })
        out.push({ t: 'turn_end', stop: 'completed' })
        break
      }
      case 'turn.failed': {
        const msg = String(e.error?.message ?? JSON.stringify(e.error ?? e))
        out.push({ t: 'error', kind: classifyError(msg), message: msg })
        out.push({ t: 'turn_end', stop: 'failed' })
        break
      }
      case 'error': {
        const msg = String(e.message ?? JSON.stringify(e))
        out.push({ t: 'error', kind: classifyError(msg), message: msg })
        break
      }
      default:
        break
    }
    return out
  }
}

/** 샘플 재생 (테스트용) */
export function parseCodexEvents(objs: J[]): AgentEvent[] {
  const p = new CodexParser()
  return objs.flatMap((o) => p.feed(o))
}

// ---------- 생성 이미지 ----------

export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

export function generatedImages(threadId: string | undefined, sinceMs: number, home = codexHome()): string[] {
  if (!threadId) return []
  const dir = join(home, 'generated_images', threadId)
  try {
    return readdirSync(dir)
      .map((f) => join(dir, f))
      .filter((p) => /\.(png|jpe?g|webp)$/i.test(p) && statSync(p).mtimeMs >= sinceMs)
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  } catch {
    return []
  }
}

// ---------- 세션 ----------

async function materializeImages(images: string[] | undefined): Promise<string[]> {
  const out: string[] = []
  let dir: string | undefined
  for (const [i, src] of (images ?? []).entries()) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(src)
    if (!m) {
      out.push(src)
      continue
    }
    dir ??= await mkdtemp(join(tmpdir(), 'conti-codex-img-'))
    const ext = m[1].split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
    const p = join(dir, `img${i}.${ext}`)
    await writeFile(p, Buffer.from(m[2], 'base64'))
    out.push(p)
  }
  return out
}

class CodexSession implements AgentSession {
  readonly kind = 'codex' as const
  readonly threadId: string
  nativeSessionId?: string
  readonly events = new EventQueue<AgentEvent>()
  /** 현재 턴 프로세스의 pid (테스트·진단용) */
  pid: number | undefined
  private readonly opts: OpenOptions
  private readonly exe: string
  private readonly parser = new CodexParser()
  private child?: ChildProcess
  private rules?: string
  private firstTurn: boolean
  private closed = false
  private interrupted = false
  private lastExit: number | null = null

  constructor(opts: OpenOptions, exe: string) {
    this.opts = opts
    this.exe = exe
    this.threadId = opts.threadId
    this.nativeSessionId = opts.resume
    this.firstTurn = !opts.resume
    if (opts.resume) this.parser.sessionEmitted = true // 재개면 세션 이벤트를 다시 내지 않는다
  }

  on(fn: (e: AgentEvent) => void): () => void {
    return this.events.on(fn)
  }

  async send(m: SendMessage): Promise<void> {
    if (this.closed) throw new Error('codex session is closed')
    if (this.child) throw new Error('codex turn already in progress')
    let text = m.text
    if (this.firstTurn && this.opts.systemPromptFile) {
      this.rules ??= await readFile(this.opts.systemPromptFile, 'utf8')
      text = wrapSystemPrompt(this.rules, text)
    }
    const images = await materializeImages(m.images)
    const args = buildCodexArgs(this.opts, { resume: this.nativeSessionId, images })
    const startedAt = Date.now() - 1000
    const child = spawnProc(this.exe, args, {
      cwd: this.opts.projectRoot,
      env: { ...this.opts.env, [CODEX_TOKEN_ENV]: this.opts.mcp.token },
    })
    this.child = child
    this.pid = child.pid
    this.firstTurn = false

    const stdout = new LineSplitter()
    let stderrTail = ''
    let pendingEnd: AgentEvent | undefined // turn_end 는 프로세스가 끝난 뒤(이미지 스캔 후) 내보낸다
    this.interrupted = false
    const handle = (line: string): void => {
      const obj = parseJsonLine(line)
      if (!obj) return
      for (const ev of this.parser.feed(obj)) {
        if (ev.t === 'session') this.nativeSessionId = ev.nativeSessionId
        if (ev.t === 'turn_end') {
          pendingEnd = ev
          continue
        }
        this.events.push(ev)
      }
    }
    child.stdout?.on('data', (d: Buffer) => {
      for (const l of stdout.push(d)) handle(l)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString('utf8')).slice(-4000)
    })
    child.on('error', (err) => {
      this.events.push({ t: 'error', kind: 'crash', message: `codex 실행 실패: ${err.message} (${this.exe})` })
    })
    child.on('close', (code, signal) => {
      const tail = stdout.flush()
      if (tail) handle(tail)
      this.lastExit = code
      const imgs = generatedImages(this.parser.threadId, startedAt)
      if (imgs.length) this.events.push({ t: 'text', text: `[images: ${imgs.join(', ')}]` })
      if (pendingEnd) this.events.push(pendingEnd)
      else if (this.interrupted) this.events.push({ t: 'turn_end', stop: 'interrupted' })
      else {
        const detail = stderrTail.trim().slice(-500)
        const msg = `codex exited (code ${code ?? signal}) without turn.completed${detail ? `: ${detail}` : ''}`
        const kind = classifyError(detail)
        this.events.push({ t: 'error', kind: kind === 'other' ? 'crash' : kind, message: msg })
        this.events.push({ t: 'turn_end', stop: 'crash' })
      }
      if (this.child === child) this.child = undefined
    })
    await new Promise<void>((resolve, reject) => {
      child.stdin!.end(text, (err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }

  /** SIGINT → codex 가 자식을 직접 정리 → 3초 안에 안 끝나면 자손 SIGKILL, 그래도 살아 있으면 트리 kill. */
  async interrupt(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || !child.pid) return
    this.interrupted = true
    const descendants = await listDescendants(child.pid)
    try {
      process.kill(child.pid, 'SIGINT')
    } catch {
      /* 이미 종료 */
    }
    const done = await waitExit(child, 3000)
    for (const p of descendants.reverse()) {
      if (isAlive(p)) {
        try {
          process.kill(p, 'SIGKILL')
        } catch {
          /* 사라짐 */
        }
      }
    }
    if (!done) {
      await killTree(child.pid)
      await waitExit(child, 2000)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.interrupt()
    this.events.push({ t: 'exit', code: this.lastExit })
    this.events.end()
  }
}

export const codexAdapter: AgentAdapter = {
  kind: 'codex',

  async detect(): Promise<AgentDetect> {
    const path = await findBin('codex')
    if (!path) return { installed: false, auth: 'unknown', detail: 'codex 실행 파일을 찾지 못함' }
    const v = await probe(path, ['--version'])
    const auth = await probe(path, ['login', 'status'], 15000)
    let state: AgentDetect['auth'] = 'unknown'
    if (auth.ok && /logged in/i.test(auth.out) && !/not logged/i.test(auth.out)) state = 'ok'
    else if (/not logged/i.test(auth.out) || auth.code === 1) state = 'missing'
    return { installed: true, version: v.out.split('\n')[0], path, auth: state, detail: auth.out.slice(0, 200) }
  },

  async open(o: OpenOptions): Promise<AgentSession> {
    const exe = o.exe ?? o.env?.CONTI_AGENT_BIN ?? (await findBin('codex')) ?? 'codex'
    return new CodexSession(o, exe)
  },
}
