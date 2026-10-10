// Higgsfield CLI 래퍼 — 항상 `--json --no-color`, 프롬프트는 stdin, 에러 판정은 종료코드(3/4)로.
// 메시지는 로케일(한국어)에 따라 바뀌므로 문자열 매칭을 하지 않는다 (spikes/higgsfield/REPORT.md §6).
import crossSpawn from 'cross-spawn'

export interface RemoteJob {
  id: string
  job_type?: string
  status: string
  result_url?: string | null
  min_result_url?: string | null
  created_at?: string
  params?: Record<string, unknown>
}

/** 미디어 플래그 값: 업로드 id(uuid) 또는 작업 id. 로컬 경로는 쓰지 않는다 (업로드 캐시를 거친다). */
export type CliParams = Record<string, string | string[] | undefined>

export interface HiggsfieldCli {
  accountStatus(): Promise<{ credits: number; email?: string; plan?: string }>
  upload(absFile: string): Promise<{ id: string; url?: string }>
  /** `generate create <model> --k v … --image-references <id>` (wait 없이) → {id, status}. 크레딧이 든다. */
  create(model: string, params: CliParams, prompt: string): Promise<RemoteJob>
  /** 무료 드라이런 — 파라미터 검증. */
  cost(model: string, params: CliParams, prompt: string): Promise<{ credits: number }>
  get(id: string): Promise<RemoteJob>
  list(size: number): Promise<RemoteJob[]>
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly kind: 'client' | 'server' | 'auth' | 'network' | 'unknown',
  ) {
    super(message)
  }
}

export interface RealCliOptions {
  bin?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

function enrichedPath(base: NodeJS.ProcessEnv): string {
  const home = base.HOME ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const extra = process.platform === 'win32' ? [] : [`${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin']
  const seen = new Set<string>()
  return [...extra, ...(base.PATH ?? '').split(sep)].filter((p) => p && !seen.has(p) && seen.add(p)).join(sep)
}

/** 종료코드 → 종류. 3 = 클라이언트 검증/작업 없음, 4 = 서버 파라미터 오류 (M0 실측). 로그인·네트워크는 미측정이라 메시지로만 힌트. */
export function classifyExit(code: number | null, stderr: string): CliError['kind'] {
  if (code === 3) return 'client'
  if (code === 4) return 'server'
  if (/unauthori|login|credential|token|401/i.test(stderr)) return 'auth'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|dial tcp|no such host/i.test(stderr)) return 'network'
  return 'unknown'
}

/** params → argv 조각. 배열은 플래그 반복(`--image-references a --image-references b`). undefined 는 생략. */
export function paramsToArgv(params: CliParams): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    const flag = `--${k}`
    if (Array.isArray(v)) for (const x of v) out.push(flag, x)
    else out.push(flag, v)
  }
  return out
}

/** stdout 에서 JSON 을 꺼낸다 — 앞뒤에 진행 표시가 섞여도 첫 `{`/`[` 부터 파싱. */
export function parseJsonOut(stdout: string): unknown {
  const s = stdout.trim()
  if (!s) throw new Error('빈 응답')
  try {
    return JSON.parse(s)
  } catch {
    const i = Math.min(...[s.indexOf('{'), s.indexOf('[')].filter((x) => x >= 0))
    if (!Number.isFinite(i)) throw new Error(`JSON 아님: ${s.slice(0, 120)}`)
    return JSON.parse(s.slice(i))
  }
}

export class RealHiggsfieldCli implements HiggsfieldCli {
  private bin: string
  private env: NodeJS.ProcessEnv
  private timeoutMs: number

  constructor(o: RealCliOptions = {}) {
    this.bin = o.bin ?? 'higgsfield'
    const base = o.env ?? process.env
    this.env = { ...base, PATH: enrichedPath(base), HIGGSFIELD_NO_UPDATE_CHECK: '1' }
    this.timeoutMs = o.timeoutMs ?? 120_000
  }

  private run(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = crossSpawn(this.bin, [...args, '--json', '--no-color'], { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new CliError(`higgsfield ${args.slice(0, 2).join(' ')} 시간 초과 (${this.timeoutMs}ms)`, null, stderr, 'network'))
      }, this.timeoutMs)
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new CliError(`higgsfield 실행 실패: ${e.message}`, null, '', 'unknown'))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code })
      })
      if (stdin !== undefined) child.stdin?.end(stdin, 'utf8')
      else child.stdin?.end()
    })
  }

  private async json<T>(args: string[], stdin?: string): Promise<T> {
    const r = await this.run(args, stdin)
    if (r.code !== 0) {
      const msg = r.stderr.trim().split('\n')[0] || r.stdout.trim().split('\n')[0] || `exit ${r.code}`
      throw new CliError(msg.replace(/^Error:\s*/, ''), r.code, r.stderr, classifyExit(r.code, r.stderr))
    }
    return parseJsonOut(r.stdout) as T
  }

  async accountStatus() {
    const r = await this.json<{ credits: number; email?: string; subscription_plan_type?: string }>(['account', 'status'])
    return { credits: Number(r.credits), email: r.email, plan: r.subscription_plan_type }
  }

  upload(absFile: string) {
    return this.json<{ id: string; url?: string }>(['upload', 'create', absFile])
  }

  async create(model: string, params: CliParams, prompt: string): Promise<RemoteJob> {
    // `--prompt` 를 생략하고 stdin 으로 넘긴다 (셸 인용·길이 무관, 로그에 안 남음)
    const r = await this.run(['generate', 'create', model, ...paramsToArgv(params)], prompt)
    if (r.code !== 0) {
      const msg = r.stderr.trim().split('\n')[0] || r.stdout.trim().split('\n')[0] || `exit ${r.code}`
      throw new CliError(msg.replace(/^Error:\s*/, ''), r.code, r.stderr, classifyExit(r.code, r.stderr))
    }
    const job = parseCreateOutput(r.stdout)
    // 응답 형태를 모르면(실측 전) 원문을 남겨 다음에 고칠 수 있게 한다. 크레딧은 이미 쓰였을 수 있다 → 호출자가 unknown 처리
    if (!job) throw new CliError(`generate create 응답에서 작업 id 를 찾지 못했습니다. 응답: ${r.stdout.trim().slice(0, 300)}`, 0, r.stderr, 'unknown')
    return job
  }

  cost(model: string, params: CliParams, prompt: string) {
    return this.json<{ credits: number }>(['generate', 'cost', model, ...paramsToArgv(params)], prompt)
  }

  get(id: string) {
    return this.json<RemoteJob>(['generate', 'get', id])
  }

  async list(size: number) {
    const r = await this.json<RemoteJob[] | { items: RemoteJob[] }>(['generate', 'list', '--size', String(size)])
    return Array.isArray(r) ? r : (r.items ?? [])
  }
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * `generate create --json` 출력에서 작업을 찾는다. 형태를 아직 실측하지 못했으므로(M0 에서 미호출) 넓게 받는다:
 * 객체 `{id}` / 배열 `[{id}]` / 래퍼 `{job|data|jobs|items|result: …}` / `job_id`·`jobId` 키 / 마지막 수단으로 본문의 uuid.
 */
export function parseCreateOutput(stdout: string): RemoteJob | null {
  let obj: unknown
  try {
    obj = parseJsonOut(stdout)
  } catch {
    obj = undefined
  }
  const found = findJob(obj, 0)
  if (found) return found
  const m = UUID_RE.exec(stdout)
  return m ? { id: m[0], status: 'queued' } : null
}

function findJob(v: unknown, depth: number): RemoteJob | null {
  if (!v || typeof v !== 'object' || depth > 4) return null
  if (Array.isArray(v)) {
    for (const x of v) {
      const f = findJob(x, depth + 1)
      if (f) return f
    }
    return null
  }
  const o = v as Record<string, unknown>
  for (const k of ['id', 'job_id', 'jobId', 'uuid']) {
    const val = o[k]
    if (typeof val === 'string' && UUID_RE.test(val)) return { ...(o as object), id: val, status: typeof o.status === 'string' ? o.status : 'queued' } as RemoteJob
  }
  for (const k of ['job', 'data', 'result', 'jobs', 'items', 'results']) {
    const f = findJob(o[k], depth + 1)
    if (f) return f
  }
  return null
}

/** 원격 상태값 → 단말/진행 (REPORT §0: queued, running, pending, completed, failed, cancelled/canceled, nsfw). 모르는 값은 진행 중으로 본다. */
export function remoteState(status: string): 'running' | 'done' | 'failed' {
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'succeeded' || s === 'success' || s === 'done') return 'done'
  if (s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'nsfw' || s === 'error') return 'failed'
  return 'running'
}
