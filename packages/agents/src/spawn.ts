// 프로세스 스폰 공통 — 보강 PATH, cross-spawn(인자 배열, 셸 없음), 종료 대기, 트리 kill.

import crossSpawn from 'cross-spawn'
import treeKill from 'tree-kill'
import { execFile, type ChildProcess } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

/** Finder 에서 띄운 앱은 셸 PATH 를 못 받는다 — 흔한 설치 위치를 앞에 덧붙인다 (apps/studio diag.ts 와 동일 규칙). */
export function enrichedPath(base: NodeJS.ProcessEnv = process.env): string {
  const home = base.HOME ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const extra =
    process.platform === 'win32'
      ? []
      : [`${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.cargo/bin`, `${home}/Library/pnpm`]
  const seen = new Set<string>()
  return [...extra, ...(base.PATH ?? '').split(sep)].filter((p) => p && !seen.has(p) && seen.add(p)).join(sep)
}

export function envWithPath(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: enrichedPath() }
}

export interface ProbeResult {
  ok: boolean
  code: number | null
  out: string
}

/** 짧은 진단 명령 실행 (which / --version / auth status). 실패해도 throw 하지 않는다. */
export async function probe(cmd: string, args: string[], timeout = 8000): Promise<ProbeResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout, env: envWithPath() })
    return { ok: true, code: 0, out: (stdout || stderr).trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string; code?: number | string }
    const code = typeof err.code === 'number' ? err.code : null
    return { ok: false, code, out: (err.stdout || err.stderr || err.message || '').trim() }
  }
}

/** 실행 파일 찾기 — `which` 우선, 없으면 흔한 설치 위치를 직접 확인. */
export async function findBin(name: string): Promise<string | undefined> {
  const w = await probe(process.platform === 'win32' ? 'where' : 'which', [name])
  if (w.ok && w.out) return w.out.split('\n')[0].trim()
  const home = process.env.HOME ?? ''
  for (const p of [`${home}/.local/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    try {
      await access(p, constants.X_OK)
      return p
    } catch {
      /* 다음 후보 */
    }
  }
  return undefined
}

export interface SpawnOpts {
  cwd: string
  env?: Record<string, string>
}

/** 인자 배열 그대로 스폰 (셸 해석 없음). stdin/stdout/stderr 모두 pipe. */
export function spawnProc(exe: string, args: string[], opts: SpawnOpts): ChildProcess {
  return crossSpawn(exe, args, { cwd: opts.cwd, env: envWithPath(opts.env), stdio: ['pipe', 'pipe', 'pipe'] })
}

/** 종료를 최대 ms 만큼 기다린다. 제때 끝나면 true. */
export function waitExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, ms)
    const onExit = (): void => {
      clearTimeout(t)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

/** 프로세스 트리 kill (tree-kill). 이미 없는 pid 는 조용히 넘어간다. */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  if (!pid) return Promise.resolve()
  return new Promise((resolve) => treeKill(pid, signal, () => resolve()))
}

/** 자손 pid 스냅샷 (pgrep -P 재귀). 신호를 보내기 전에 찍어 두면 고아를 나중에 정리할 수 있다. win32 는 빈 배열. */
export async function listDescendants(pid: number): Promise<number[]> {
  if (process.platform === 'win32') return []
  const out: number[] = []
  const walk = async (p: number): Promise<void> => {
    const r = await probe('pgrep', ['-P', String(p)], 3000)
    if (!r.ok) return
    for (const s of r.out.split('\n')) {
      const c = Number(s.trim())
      if (c && !out.includes(c)) {
        out.push(c)
        await walk(c)
      }
    }
  }
  await walk(pid)
  return out
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
