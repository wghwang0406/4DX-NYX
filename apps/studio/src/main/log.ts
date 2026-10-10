// 메인 프로세스 로그 — userData/logs/main.log (5MB 넘으면 main.1.log 로 돌린다). 진단 내보내기에 들어간다.
// 토큰·비밀값은 쓰지 않는다 (Bearer/토큰 패턴은 가린다).
import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

let file: string | null = null
const MAX = 5 * 1024 * 1024

export function logPath(): string {
  return file ?? join(app.getPath('userData'), 'logs', 'main.log')
}

const SECRET = /(Bearer\s+)[\w.\-~+/=]{8,}|((?:token|secret|password|access_token|refresh_token)["'=:\s]+)[\w.\-~+/=]{8,}/gi

export function redact(s: string): string {
  return s.replace(SECRET, (_m, a, b) => `${a ?? b}***`)
}

export function log(level: 'info' | 'warn' | 'error', ...args: unknown[]) {
  try {
    file ??= logPath()
    mkdirSync(join(file, '..'), { recursive: true })
    try {
      if (statSync(file).size > MAX) renameSync(file, file.replace(/\.log$/, '.1.log'))
    } catch {
      /* 없음 */
    }
    appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${redact(format(...args))}\n`)
  } catch {
    /* 로그 실패로 앱을 멈추지 않는다 */
  }
}

/** console.warn/error 와 처리 안 된 예외를 파일에도 남긴다 */
export function installLogging() {
  const warn = console.warn.bind(console)
  const error = console.error.bind(console)
  console.warn = (...a: unknown[]) => (log('warn', ...a), warn(...a))
  console.error = (...a: unknown[]) => (log('error', ...a), error(...a))
  process.on('uncaughtException', (e) => log('error', 'uncaughtException', e))
  process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', e))
  log('info', `NYX ${app.getVersion()} 시작 · electron ${process.versions.electron} · ${process.platform}-${process.arch}`)
}
