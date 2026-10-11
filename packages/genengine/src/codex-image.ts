// GPT 이미지 엔진 — 사용자가 로그인한 Codex CLI(ChatGPT 계정)의 내장 image_gen 도구로 1장씩 만든다.
// Higgsfield 크레딧을 쓰지 않는다. 결과는 Codex 가 `$CODEX_HOME/generated_images/<thread>/<item>.png` 에 저장하고, 여기서 회수한다.
// 실측: spikes/codex/REPORT.md "이미지 생성". 프롬프트는 stdin, 인자 배열(셸 없음), 중단은 SIGINT.
import crossSpawn from 'cross-spawn'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type CodexImageErrorKind = 'auth' | 'usage_limit' | 'no_image' | 'crash' | 'timeout'

export class CodexImageError extends Error {
  constructor(
    message: string,
    readonly kind: CodexImageErrorKind,
    readonly threadId?: string,
  ) {
    super(message)
  }
}

export interface CodexImageRequest {
  prompt: string
  /** 레퍼런스 이미지 절대경로 — image_gen 의 referenced_image_paths 로 넘긴다 */
  refs: string[]
  /** '16:9' | '21:9' | '1:1' | '3:4' | '9:16' … */
  aspect: string
  cwd: string
  /** thread id 를 받자마자 알려준다 — 작업 기록에 남겨 재시작 때 회수 */
  onThread?: (threadId: string) => void
}

export interface CodexImageRunner {
  generate(r: CodexImageRequest): Promise<{ file: string; threadId: string }>
  /** 앱이 꺼진 사이 끝난 작업: 그 thread 폴더의 가장 최근 png (없으면 null) */
  recover(threadId: string): Promise<string | null>
}

export interface RealCodexImageOptions {
  bin?: string
  env?: NodeJS.ProcessEnv
  /** 기본 $CODEX_HOME 또는 ~/.codex */
  codexHome?: string
  timeoutMs?: number
}

const ASPECT_WORDS: Record<string, string> = {
  '16:9': 'wide landscape 16:9 (about 1672x941)',
  '21:9': 'ultra-wide cinematic 21:9 landscape',
  '3:2': 'landscape 3:2 (1536x1024)',
  '4:3': 'landscape 4:3',
  '1:1': 'square 1:1 (1024x1024)',
  '3:4': 'portrait 3:4',
  '2:3': 'portrait 2:3 (1024x1536)',
  '9:16': 'tall portrait 9:16',
}

/** Codex 에 보내는 지시. 이미지 프롬프트는 앱의 Lira 조립 결과를 그대로 싣는다. */
export function codexImageInstruction(r: Pick<CodexImageRequest, 'prompt' | 'refs' | 'aspect'>): string {
  const lines = [
    'You are an image renderer inside a storyboard app. Call the image generation tool exactly once, then stop.',
    'Do not run shell commands, do not read or write files, do not ask questions, do not describe the result at length.',
    `Output: exactly ONE image, ${ASPECT_WORDS[r.aspect] ?? `aspect ratio ${r.aspect}`}.`,
  ]
  if (r.refs.length) {
    lines.push(
      `Pass these reference images to the image tool as referenced_image_paths, in this order: ${JSON.stringify(r.refs)}.`,
      'Use them exactly as the prompt below describes (identity, location, prop or the frame to edit). Do not copy their composition unless the prompt says so.',
    )
  }
  lines.push('Use this image prompt verbatim as the tool prompt:', '<<<', r.prompt.trim(), '>>>')
  return lines.join('\n')
}

function enrichedPath(base: NodeJS.ProcessEnv): string {
  const home = base.HOME ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const extra = process.platform === 'win32' ? [] : [`${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/Library/pnpm`]
  const seen = new Set<string>()
  return [...extra, ...(base.PATH ?? '').split(sep)].filter((p) => p && !seen.has(p) && seen.add(p)).join(sep)
}

/** 오류 메시지 → 종류 (Codex 메시지는 영어) */
export function classifyCodexError(msg: string): CodexImageErrorKind {
  if (/401|unauthori|not logged in|login|missing bearer/i.test(msg)) return 'auth'
  if (/usage limit|rate limit|429|quota|too many requests/i.test(msg)) return 'usage_limit'
  return 'crash'
}

const KOREAN: Record<CodexImageErrorKind, string> = {
  auth: 'Codex 로그인이 필요합니다 — 설정 › 계정에서 Codex 에 로그인하세요',
  usage_limit: 'Codex(ChatGPT) 사용 한도에 걸렸습니다 — 잠시 뒤 [다시] 를 누르거나 Higgsfield 엔진을 쓰세요',
  no_image: 'Codex 가 이미지를 만들지 않았습니다',
  crash: 'Codex 실행이 실패했습니다',
  timeout: 'Codex 이미지 생성 시간 초과',
}

async function newestPng(dir: string, prefer: string[] = []): Promise<string | null> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
  } catch {
    return null
  }
  if (!names.length) return null
  for (const id of prefer.slice().reverse()) {
    const hit = names.find((n) => n.startsWith(id))
    if (hit) return join(dir, hit)
  }
  const withTime = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })))
  withTime.sort((a, b) => b.t - a.t)
  return join(dir, withTime[0].n)
}

export class RealCodexImage implements CodexImageRunner {
  private bin: string
  private env: NodeJS.ProcessEnv
  private home: string
  private timeoutMs: number

  constructor(o: RealCodexImageOptions = {}) {
    const base = o.env ?? process.env
    this.bin = o.bin ?? 'codex'
    this.env = { ...base, PATH: enrichedPath(base) }
    this.home = o.codexHome ?? base.CODEX_HOME ?? join(homedir(), '.codex')
    this.timeoutMs = o.timeoutMs ?? 6 * 60_000
  }

  private dirFor(threadId: string) {
    return join(this.home, 'generated_images', threadId)
  }

  recover(threadId: string) {
    return newestPng(this.dirFor(threadId))
  }

  generate(r: CodexImageRequest): Promise<{ file: string; threadId: string }> {
    const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'features.image_generation=true', '-C', r.cwd, '-']
    return new Promise((resolve, reject) => {
      const child = crossSpawn(this.bin, args, { env: this.env, cwd: r.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      let threadId = ''
      let buf = ''
      let stderr = ''
      let failure = ''
      let lastText = ''
      const imageIds: string[] = []
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => {
        child.kill('SIGINT')
        finish(() => reject(new CodexImageError(`${KOREAN.timeout} (${Math.round(this.timeoutMs / 60000)}분)`, 'timeout', threadId || undefined)))
      }, this.timeoutMs)

      const onEvent = (e: Record<string, unknown>) => {
        if (e.type === 'thread.started' && typeof e.thread_id === 'string') {
          threadId = e.thread_id
          r.onThread?.(threadId)
        } else if (e.type === 'turn.failed') {
          failure = String((e.error as { message?: string } | undefined)?.message ?? 'turn failed')
        } else if (e.type === 'error' && typeof e.message === 'string' && !/^Reconnecting/.test(e.message)) {
          failure = e.message
        } else if (e.type === 'item.completed' || e.type === 'item.started') {
          const it = (e.item ?? {}) as Record<string, unknown>
          const kind = `${it.type ?? ''} ${it.kind ?? ''}`
          if (/image/i.test(kind) && typeof it.id === 'string') imageIds.push(it.id)
          if (it.type === 'agent_message' && typeof it.text === 'string') lastText = it.text
        }
      }

      child.stdout?.on('data', (d: Buffer) => {
        buf += d.toString('utf8')
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          try {
            onEvent(JSON.parse(line))
          } catch {
            /* 진행 표시 줄 */
          }
        }
      })
      child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString('utf8')).slice(-4000)))
      child.on('error', (e) => finish(() => reject(new CodexImageError(`${KOREAN.crash}: ${e.message}`, 'crash'))))
      child.on('close', (code) => {
        void (async () => {
          const file = threadId ? await newestPng(this.dirFor(threadId), imageIds) : null
          if (file) return finish(() => resolve({ file, threadId }))
          const msg = failure || (code ? stderr.trim().split('\n').pop() ?? `exit ${code}` : '')
          if (msg) {
            const kind = classifyCodexError(msg)
            return finish(() => reject(new CodexImageError(`${KOREAN[kind]} — ${msg.slice(0, 200)}`, kind, threadId || undefined)))
          }
          finish(() => reject(new CodexImageError(`${KOREAN.no_image}${lastText ? ` — "${lastText.slice(0, 160)}"` : ''}`, 'no_image', threadId || undefined)))
        })()
      })
      child.stdin?.end(codexImageInstruction(r), 'utf8')
    })
  }
}
