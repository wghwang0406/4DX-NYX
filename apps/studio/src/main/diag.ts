import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolStatus } from '../shared/ipc'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const run = promisify(execFile)

// Finder 에서 띄운 앱은 셸 PATH 를 못 받는다 — 흔한 설치 위치를 덧붙인다 (플랜 §8).
function enrichedPath(): string {
  const home = process.env.HOME ?? ''
  const extra =
    process.platform === 'win32'
      ? []
      : [`${home}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.cargo/bin`, `${home}/Library/pnpm`]
  return [...extra, process.env.PATH ?? ''].join(process.platform === 'win32' ? ';' : ':')
}

async function probe(cmd: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout, env: { ...process.env, PATH: enrichedPath() } })
    return { ok: true, out: (stdout || stderr).trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string }
    return { ok: false, out: (err.stdout || err.stderr || err.message).trim() }
  }
}

async function where(cmd: string): Promise<string | undefined> {
  const r = await probe(process.platform === 'win32' ? 'where' : 'which', [cmd])
  return r.ok ? r.out.split('\n')[0] : undefined
}

export async function toolStatuses(): Promise<ToolStatus[]> {
  const [claude, codex, higgs, ffmpeg, uv] = await Promise.all([
    (async (): Promise<ToolStatus> => {
      const path = await where('claude')
      if (!path) return { name: 'claude', installed: false }
      const v = await probe('claude', ['--version'])
      const auth = await probe('claude', ['auth', 'status'])
      const loggedIn = auth.ok && /logged\s*in|✔|authenticated|email/i.test(auth.out) && !/not logged/i.test(auth.out)
      return { name: 'claude', installed: true, version: v.out.split('\n')[0], path, login: auth.ok ? (loggedIn ? 'ok' : 'missing') : 'unknown', detail: auth.out.slice(0, 200) }
    })(),
    (async (): Promise<ToolStatus> => {
      const path = await where('codex')
      if (!path) return { name: 'codex', installed: false }
      const v = await probe('codex', ['--version'])
      const auth = await probe('codex', ['login', 'status'])
      const loggedIn = auth.ok && /logged in/i.test(auth.out) && !/not logged/i.test(auth.out)
      return { name: 'codex', installed: true, version: v.out.split('\n')[0], path, login: auth.ok ? (loggedIn ? 'ok' : 'missing') : 'unknown', detail: auth.out.slice(0, 200) }
    })(),
    (async (): Promise<ToolStatus> => {
      const path = await where('higgsfield')
      if (!path) return { name: 'higgsfield', installed: false }
      const v = await probe('higgsfield', ['--version'])
      const acct = await probe('higgsfield', ['account', 'status', '--json'], 15000)
      return { name: 'higgsfield', installed: true, version: v.out.split('\n')[0], path, login: acct.ok ? 'ok' : 'missing', detail: acct.out.slice(0, 200) }
    })(),
    (async (): Promise<ToolStatus> => {
      const path = await where('ffmpeg')
      if (!path) return { name: 'ffmpeg', installed: false }
      const v = await probe('ffmpeg', ['-version'])
      return { name: 'ffmpeg', installed: true, version: v.out.split('\n')[0].replace(/ Copyright.*/, ''), path }
    })(),
    (async (): Promise<ToolStatus> => {
      // 앱 번들(패키징) → 앱 데이터 tools/ → PATH 순 (영상 가져오기와 같은 순서)
      const candidates = [app.isPackaged ? join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv') : '', join(app.getPath('userData'), 'tools', process.platform === 'win32' ? 'uv.exe' : 'uv')].filter(Boolean)
      const path = candidates.find((p) => existsSync(p)) ?? (await where('uv'))
      if (!path) return { name: 'uv', installed: false, detail: '영상을 처음 가져올 때 앱이 앱 데이터 폴더에 자동으로 준비합니다' }
      const v = await probe(path, ['--version'])
      const env = existsSync(join(app.getPath('userData'), 'py-env', 'pyvenv.cfg'))
      return { name: 'uv', installed: true, version: `${v.out}${env ? ' · 분석 환경 준비됨' : ' · 분석 환경은 첫 영상 때 준비'}`, path }
    })(),
  ])
  return [claude, codex, higgs, ffmpeg, uv]
}
