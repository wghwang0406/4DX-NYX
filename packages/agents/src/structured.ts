// 1회성 구조화 호출 — 이미지 몇 장 + 짧은 텍스트 → JSON 스키마로 검증된 결과 하나. 도구·세션·MCP 없음.
// 영상 콘티 1차 분석(§4 S11)처럼 "판단만 받는" 작업용. 대화(AgentSession)와 달리 기본 시스템 프롬프트를
// 짧은 것으로 교체해 바닥 컨텍스트(~1.8만 토큰)를 없앤다.
//   claude: `claude -p --input-format stream-json --output-format stream-json --verbose --json-schema <json> --system-prompt <짧게> --tools "" --no-session-persistence`
//   codex:  `codex exec --json --output-schema <file> -i img… --skip-git-repo-check --ignore-user-config -s read-only -C <cwd> -`
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentKind } from './types'
import { CLAUDE_ENV, userMessageLine } from './claude'
import { LineSplitter, parseJsonLine } from './jsonl'
import { findBin, killTree, spawnProc } from './spawn'

export interface StructuredRequest {
  kind: AgentKind
  cwd: string
  prompt: string
  /** 파일 절대경로 (jpg/png/webp) */
  images?: string[]
  schema: Record<string, unknown>
  systemPrompt?: string
  model?: string
  timeoutMs?: number
  /** 실행 파일 덮어쓰기 (테스트) */
  exe?: string
}

export interface StructuredUsage {
  inTok: number
  outTok: number
  cacheRead?: number
  cacheWrite?: number
  costUsd?: number
}

export interface StructuredResult<T = unknown> {
  data: T
  usage: StructuredUsage
  ms: number
}

export class StructuredError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'usage_limit' | 'rate_limit' | 'timeout' | 'schema' | 'crash' | 'other',
  ) {
    super(message)
  }
}

const DEFAULT_SYSTEM = 'You are a precise film storyboard analyst. Answer only through the structured output. Write Korean for free-text fields unless told otherwise.'

function errKind(msg: string): StructuredError['kind'] {
  if (/not logged in|authentication|unauthori[sz]ed|\b401\b|login/i.test(msg)) return 'auth'
  if (/usage limit|quota|limit reached|out of (extra )?usage|\b429\b/i.test(msg)) return 'usage_limit'
  if (/rate.?limit|too many requests/i.test(msg)) return 'rate_limit'
  return 'other'
}

export function buildStructuredClaudeArgs(r: StructuredRequest): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(r.schema),
    '--system-prompt', r.systemPrompt ?? DEFAULT_SYSTEM,
    '--tools', '',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--permission-prompts', 'none',
    '--no-session-persistence',
    ...(r.model ? ['--model', r.model] : []),
  ]
}

export function buildStructuredCodexArgs(r: StructuredRequest, schemaFile: string): string[] {
  return [
    'exec', '--json',
    '--output-schema', schemaFile,
    ...(r.images ?? []).flatMap((p) => ['-i', p]),
    '--skip-git-repo-check', '--ignore-user-config',
    '-s', 'read-only', '-C', r.cwd,
    ...(r.model ? ['-m', r.model] : []),
    '-',
  ]
}

/** stream-json(claude) / JSONL(codex) 출력 → 결과. 순수 함수라 녹화 샘플로 테스트한다. */
export function parseStructuredOutput(kind: AgentKind, lines: string[]): { data?: unknown; usage: StructuredUsage; error?: string } {
  const usage: StructuredUsage = { inTok: 0, outTok: 0 }
  let data: unknown
  let error: string | undefined
  let lastText: string | undefined
  for (const line of lines) {
    const e = parseJsonLine(line) as Record<string, any> | null
    if (!e) continue
    if (kind === 'claude') {
      if (e.type === 'result') {
        const u = e.usage ?? {}
        usage.inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        usage.outTok = u.output_tokens ?? 0
        usage.cacheRead = u.cache_read_input_tokens
        usage.cacheWrite = u.cache_creation_input_tokens
        usage.costUsd = e.total_cost_usd
        if (e.is_error || e.subtype !== 'success') error = String(e.result ?? e.subtype ?? 'error')
        else data = e.structured_output ?? (typeof e.result === 'string' ? tryJson(e.result) : undefined)
      }
    } else {
      if (e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string') lastText = e.item.text
      if (e.type === 'turn.completed') {
        const u = e.usage ?? {}
        usage.inTok = u.input_tokens ?? 0
        usage.outTok = u.output_tokens ?? 0
        usage.cacheRead = u.cached_input_tokens
      }
      if (e.type === 'turn.failed' || e.type === 'error') error = String(e.error?.message ?? e.message ?? 'error')
    }
  }
  if (kind === 'codex' && !error && lastText !== undefined) data = tryJson(lastText)
  return { data, usage, error }
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    const m = /\{[\s\S]*\}/.exec(s)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* fallthrough */
      }
    }
    return undefined
  }
}

export async function runStructured<T = unknown>(r: StructuredRequest): Promise<StructuredResult<T>> {
  const t0 = Date.now()
  const exe = r.exe ?? (await findBin(r.kind))
  if (!exe) throw new StructuredError(`${r.kind} CLI 가 없습니다`, 'auth')
  let tmp: string | undefined
  let args: string[]
  let stdin: string
  if (r.kind === 'claude') {
    args = buildStructuredClaudeArgs(r)
    stdin = await userMessageLine({ text: r.prompt, images: r.images })
  } else {
    tmp = await mkdtemp(join(tmpdir(), 'nyx-schema-'))
    const schemaFile = join(tmp, 'schema.json')
    await writeFile(schemaFile, JSON.stringify(r.schema))
    args = buildStructuredCodexArgs(r, schemaFile)
    stdin = r.prompt
  }
  try {
    const child = spawnProc(exe, args, { cwd: r.cwd, env: r.kind === 'claude' ? CLAUDE_ENV : undefined })
    const lines: string[] = []
    const split = new LineSplitter()
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => lines.push(...split.push(d.toString('utf8'))))
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString('utf8')).slice(-4000)))
    child.stdin?.end(stdin)
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        void killTree(child.pid)
        reject(new StructuredError(`${r.kind} 응답 시간 초과 (${Math.round((r.timeoutMs ?? 300_000) / 1000)}초)`, 'timeout'))
      }, r.timeoutMs ?? 300_000)
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new StructuredError(e.message, 'crash'))
      })
      child.on('close', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    const tail = split.flush()
    if (tail) lines.push(tail)
    const parsed = parseStructuredOutput(r.kind, lines)
    if (parsed.error) throw new StructuredError(parsed.error, errKind(parsed.error))
    if (parsed.data === undefined) {
      const msg = stderr.trim().split('\n').slice(-2).join(' ') || `exit ${code}`
      throw new StructuredError(`구조화 결과가 없습니다: ${msg}`, code === 0 ? 'schema' : errKind(msg))
    }
    return { data: parsed.data as T, usage: parsed.usage, ms: Date.now() - t0 }
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
}
