// py/media 실행 — 번들/앱 전용 uv 로 Python 3.12 를 관리한다 (시스템 Python 은 쓰지 않는다, 플랜 §8).
// uv 가 없으면 앱 데이터 폴더(tools/)에 고정 버전을 내려받는다. 가상환경·캐시·파이썬도 전부 앱 데이터 폴더 안.
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crossSpawn from 'cross-spawn'
import { LineSplitter, findBin } from '@conti/agents'

export const UV_VERSION = '0.13.0'

export interface PyConfig {
  /** py/media 폴더 (pyproject.toml + uv.lock) */
  projectDir: string
  /** 앱 데이터 폴더 — tools/uv, py-env, uv-cache, uv-python, hf-cache 가 여기 생긴다 */
  dataDir: string
  /** 개발·테스트: 이 파이썬으로 바로 실행 (uv 없이). 예: /usr/bin/python3 */
  python?: string
  /** 번들된 uv (패키징 후 resources/bin/uv) */
  bundledUv?: string
  fetchImpl?: typeof fetch
}

export interface PyProgress {
  stage: string
  progress?: number
  error?: string
  info?: unknown
}

function uvAsset(): { name: string; exe: string } {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return { name: `uv-${arch}-apple-darwin.tar.gz`, exe: 'uv' }
  if (process.platform === 'win32') return { name: `uv-${arch}-pc-windows-msvc.zip`, exe: 'uv.exe' }
  return { name: `uv-${arch}-unknown-linux-gnu.tar.gz`, exe: 'uv' }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function spawnCollect(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = crossSpawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], env })
    let err = ''
    c.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} ${args[0]} 실패: ${err.trim()}`))))
  })
}

/** uv 위치: 번들 → 앱 데이터 tools/ → PATH → (없으면) 내려받기. sha256 검증. */
export async function ensureUv(cfg: PyConfig, onProgress?: (p: PyProgress) => void): Promise<string> {
  if (cfg.bundledUv && (await exists(cfg.bundledUv))) return cfg.bundledUv
  const { name, exe } = uvAsset()
  const local = join(cfg.dataDir, 'tools', exe)
  if (await exists(local)) return local
  const onPath = await findBin('uv')
  if (onPath) return onPath
  onProgress?.({ stage: 'uv', progress: 0 })
  const f = cfg.fetchImpl ?? fetch
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`
  const res = await f(`${base}/${name}`)
  if (!res.ok) throw new Error(`uv 내려받기 실패 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const shaRes = await f(`${base}/${name}.sha256`)
  if (shaRes.ok) {
    const want = (await shaRes.text()).trim().split(/\s+/)[0]
    const got = createHash('sha256').update(buf).digest('hex')
    if (want && want !== got) throw new Error(`uv 체크섬 불일치 (${got.slice(0, 12)} ≠ ${want.slice(0, 12)})`)
  }
  const tmp = await mkdtemp(join(tmpdir(), 'nyx-uv-'))
  try {
    const archive = join(tmp, name)
    await writeFile(archive, buf)
    if (name.endsWith('.zip')) await spawnCollect('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${archive}' -DestinationPath '${tmp}'`])
    else await spawnCollect('tar', ['-xzf', archive, '-C', tmp])
    const inner = name.replace(/\.(tar\.gz|zip)$/, '')
    const candidates = [join(tmp, inner, exe), join(tmp, exe)]
    let found: string | undefined
    for (const c of candidates) if (await exists(c)) found = c
    if (!found) throw new Error('uv 압축 안에서 실행 파일을 찾지 못했습니다')
    await mkdir(join(cfg.dataDir, 'tools'), { recursive: true })
    await rename(found, local)
    await chmod(local, 0o755)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  onProgress?.({ stage: 'uv', progress: 1 })
  return local
}

export function pyEnv(cfg: PyConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: join(cfg.dataDir, 'py-env'),
    UV_CACHE_DIR: join(cfg.dataDir, 'uv-cache'),
    UV_PYTHON_INSTALL_DIR: join(cfg.dataDir, 'uv-python'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_NO_PROGRESS: '1',
    HF_HOME: join(cfg.dataDir, 'hf-cache'),
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  }
}

/**
 * `python -m conti_media <args>` 실행. 진행 JSONL 을 콜백으로 넘기고, error 줄이 오면 그 메시지로 실패.
 * extras: 'asr' 이면 faster-whisper 까지 (첫 실행 때 내려받는다). --inexact 로 다른 extra 를 지우지 않는다.
 */
export async function runConti(cfg: PyConfig, args: string[], o: { extras?: string[]; onProgress?: (p: PyProgress) => void; timeoutMs?: number } = {}): Promise<void> {
  let bin: string
  let argv: string[]
  let env: NodeJS.ProcessEnv
  if (cfg.python) {
    bin = cfg.python
    argv = ['-m', 'conti_media', ...args]
    env = { ...process.env, PYTHONPATH: cfg.projectDir, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', HF_HOME: join(cfg.dataDir, 'hf-cache') }
  } else {
    bin = await ensureUv(cfg, o.onProgress)
    // 첫 실행(가상환경 없음)이면 Python 3.12·패키지 준비에 30초쯤 걸린다 — 화면에 "분석 도구 준비"로
    if (!(await exists(join(cfg.dataDir, 'py-env', 'pyvenv.cfg'))) || (o.extras?.includes('asr') && !(await exists(join(cfg.dataDir, 'py-env', 'lib'))))) o.onProgress?.({ stage: 'setup' })
    const locked = await exists(join(cfg.projectDir, 'uv.lock'))
    argv = ['run', '--project', cfg.projectDir, '--python', '3.12', '--inexact', ...(locked ? ['--frozen'] : []), ...(o.extras ?? []).flatMap((e) => ['--extra', e]), 'python', '-m', 'conti_media', ...args]
    env = pyEnv(cfg)
  }
  await new Promise<void>((resolve, reject) => {
    const child = crossSpawn(bin, argv, { cwd: cfg.projectDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const split = new LineSplitter()
    let stderr = ''
    let error: string | undefined
    const timer = o.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), o.timeoutMs) : null
    child.stdout?.on('data', (d: Buffer) => {
      for (const line of split.push(d)) {
        try {
          const p = JSON.parse(line) as PyProgress
          if (p.stage === 'error') error = p.error
          o.onProgress?.(p)
        } catch {
          /* uv 출력 등 JSON 아닌 줄 */
        }
      }
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stderr = (stderr + s).slice(-6000)
      // uv 가 패키지를 받는 중이면 알린다 (첫 실행)
      if (/Downloading|Installed|Resolved|Prepared/.test(s)) o.onProgress?.({ stage: 'setup' })
    })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0 && !error) return resolve()
      reject(new Error(error ?? `conti_media ${args[0]} 실패 (exit ${code}): ${stderr.trim().split('\n').slice(-4).join(' / ')}`))
    })
  })
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}
