// 앱 설정(첫 실행 안내 완료 여부 등) · 새 버전 확인 · 진단 내보내기.
// 서명(Developer ID) 없이 배포하므로 macOS 자동 설치(Squirrel)는 쓸 수 없다 → 사내 뷰어 서버가 최신 버전을 알려주고 내려받기만 연다.
import { app, shell, type BrowserWindow } from 'electron'
import { mkdtemp, readFile, rm, writeFile, copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, release, cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import crossSpawn from 'cross-spawn'
import { writeAtomic, type ProjectStore } from '@conti/core'
import { logPath, redact } from './log'
import { toolStatuses } from './diag'
import type { AppSettings, UpdateInfo } from '../shared/app-ipc'

export class AppInfo {
  constructor(
    private getWindow: () => BrowserWindow | null,
    private getStore: () => ProjectStore | null,
    private publishConn: () => Promise<{ url: string; token: string } | null>,
  ) {}

  private path() {
    return join(app.getPath('userData'), 'settings.json')
  }
  async settings(): Promise<AppSettings> {
    try {
      return { onboarded: false, ...(JSON.parse(await readFile(this.path(), 'utf8')) as Partial<AppSettings>) }
    } catch {
      return { onboarded: false }
    }
  }
  async setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.settings()), ...patch }
    await writeAtomic(this.path(), JSON.stringify(next, null, 2))
    return next
  }

  // ── 새 버전 ────────────────────────────────────────────────────────────
  async checkUpdate(): Promise<UpdateInfo | null> {
    const conn = await this.publishConn()
    if (!conn?.url) return null
    try {
      const platform = `${process.platform}-${process.arch}`
      const res = await fetch(`${conn.url}/api/app/latest?platform=${platform}`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return null
      const j = (await res.json()) as { version: string; file: string; notes?: string; size?: number }
      if (!j.version || compareVersions(j.version, app.getVersion()) <= 0) return null
      const info: UpdateInfo = { version: j.version, current: app.getVersion(), url: `${conn.url}/releases/${encodeURIComponent(j.file)}`, notes: j.notes, size: j.size }
      this.getWindow()?.webContents.send('app:update', info)
      return info
    } catch {
      return null
    }
  }
  openDownload(url: string) {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }

  // ── 진단 내보내기 ──────────────────────────────────────────────────────
  /** 바탕화면에 NYX-진단-날짜.zip — 버전·도구·로그인 상태(이메일 가림)·프로젝트 요약·최근 작업 오류·로그. 토큰은 넣지 않는다. */
  async exportDiagnostics(outDir?: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nyx-diag-'))
    try {
      const tools = (await toolStatuses()).map((t) => ({ ...t, detail: t.detail ? maskEmail(redact(t.detail)) : undefined }))
      const store = this.getStore()
      let project: unknown = null
      let jobs: unknown[] = []
      if (store) {
        const p = store.getProject()
        project = {
          code: p.code,
          sequences: store.listSequences().map((s) => ({ seq: s.seq, ep: s.ep, kind: s.source.kind, shots: s.shots.filter((x) => !x.deleted).length, review: s.shots.filter((x) => x.review.length).length, stages: countBy(s.shots.map((x) => x.stages.conti.status)) })),
        }
        const jobDir = join(store.root, '.conti', 'jobs')
        if (existsSync(jobDir)) {
          const files = (await readdir(jobDir)).filter((f) => f.endsWith('.json')).slice(-200)
          for (const f of files) {
            try {
              const j = JSON.parse(await readFile(join(jobDir, f), 'utf8'))
              jobs.push({ id: j.id, kind: j.kind, model: j.model, status: j.status, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt }) // 프롬프트는 뺀다
            } catch {
              /* 손상 */
            }
          }
          jobs = jobs.filter((j) => (j as { status: string }).status !== 'done').slice(-50)
        }
      }
      const conn = await this.publishConn()
      const info = {
        app: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        os: `${process.platform} ${release()} ${process.arch}`,
        cpu: cpus()[0]?.model,
        memGB: Math.round(totalmem() / 1e9),
        packaged: app.isPackaged,
        userData: app.getPath('userData'),
        publishServer: conn?.url ? new URL(conn.url).host : null,
        tools,
        project,
        jobsNotDone: jobs,
        at: new Date().toISOString(),
      }
      await writeFile(join(dir, 'diagnostics.json'), JSON.stringify(info, null, 2))
      for (const lp of [logPath(), logPath().replace(/\.log$/, '.1.log')]) if (existsSync(lp)) await copyFile(lp, join(dir, lp.split('/').pop()!))
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')
      const out = join(outDir ?? app.getPath('desktop'), `NYX-진단-${stamp}.zip`)
      await zipDir(dir, out)
      if (!outDir) shell.showItemInFolder(out)
      return out
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/** 1.2.10 > 1.2.9 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

export function maskEmail(s: string): string {
  return s.replace(/([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (_m, a, rest, d) => `${a}${'*'.repeat(Math.min(6, rest.length))}${d}`)
}

function countBy(xs: string[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const x of xs) m[x] = (m[x] ?? 0) + 1
  return m
}

function zipDir(dir: string, out: string): Promise<void> {
  const [bin, args] = process.platform === 'win32' ? ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${dir}\\*' -DestinationPath '${out}'`]] : ['ditto', ['-c', '-k', '--sequesterRsrc', dir, out]]
  return new Promise((resolve, reject) => {
    const c = crossSpawn(bin as string, args as string[], { stdio: 'ignore' })
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`압축 실패 (exit ${code})`))))
  })
}
