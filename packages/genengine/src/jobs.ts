// JobService — 모든 유료 생성의 단일 통로.
// 디스크 기록(queued) → 업로드(캐시) → `generate create --json`(wait 없이) → 원격 id 즉시 기록 → 폴링 → 다운로드 → 버전 기록.
// 재시작하면 .conti/jobs/*.json 을 읽어 이어 간다 (유료 작업 유실 없음). 유료 작업은 자동 재시도하지 않는다.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { absPath, sha256, writeAtomic, type ProjectStore } from '@conti/core'
import { PROJECT_DIRS, Version, assetFileName, shotFileName, type Shot, type VersionSource } from '@conti/domain'
import { CliError, remoteState, type CliParams, type HiggsfieldCli } from './cli'
import { downloadTo, imageDims, type FetchLike } from './download'
import type { CodexImageRunner } from './codex-image'
import { UploadCache } from './uploads'
import type { JobPlan, JobTarget, SpendKind } from './plan'

export const JobStatus = z.enum(['queued', 'uploading', 'submitting', 'submitted', 'running', 'downloading', 'done', 'failed', 'cancelled', 'unknown'])
export type JobStatus = z.infer<typeof JobStatus>
export const TERMINAL: ReadonlySet<JobStatus> = new Set(['done', 'failed', 'cancelled', 'unknown'])

export const JobRecord = z.object({
  id: z.string(),
  requestId: z.string(),
  kind: z.string(),
  target: z.any(),
  model: z.string(),
  params: z.record(z.string(), z.string()),
  prompt: z.string(),
  refs: z.array(z.object({ file: z.string(), label: z.string(), sha256: z.string().optional(), uploadId: z.string().optional() })),
  dependsOn: z.string().optional(),
  source: z.string(),
  parentVersionId: z.string().optional(),
  style: z.string().optional(),
  lint: z.array(z.string()).default([]),
  /** 이미지 엔진 — 없으면 higgsfield (기존 기록 호환). codex = 로그인한 Codex 의 GPT 이미지 */
  engine: z.enum(['higgsfield', 'codex']).optional(),
  inputHash: z.string().optional(),
  status: JobStatus,
  remote: z.object({ jobId: z.string(), status: z.string().optional(), resultUrl: z.string().optional() }).optional(),
  error: z.string().optional(),
  outFile: z.string().optional(),
  versionId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type JobRecord = z.infer<typeof JobRecord> & { target: JobTarget; kind: SpendKind; source: VersionSource }

export type JobEvent = { t: 'job'; job: JobRecord } | { t: 'request_done'; requestId: string; done: number; failed: number }

export interface JobServiceOptions {
  store: ProjectStore
  cli: HiggsfieldCli
  concurrency?: number
  pollMs?: number
  maxPollMs?: number
  fetchImpl?: FetchLike
  onEvent?: (e: JobEvent) => void
  /** 하루 장수 상한 (기본 project.defaults.dailyCap) */
  dailyCap?: number
  /** GPT(Codex) 엔진 — 없으면 codex 작업은 실패로 끝난다 */
  codex?: CodexImageRunner
  /** codex 엔진 동시 실행 (구독 한도 보호, 기본 2) */
  codexConcurrency?: number
}

export class JobCapError extends Error {}

export class JobService {
  private jobs = new Map<string, JobRecord>()
  private running = new Set<string>()
  private stopped = false
  private uploads: UploadCache
  private loaded = false
  private ticking = false
  readonly root: string

  constructor(private o: JobServiceOptions) {
    this.root = o.store.root
    this.uploads = new UploadCache(this.root, o.cli)
  }

  private get dir() {
    return join(this.root, PROJECT_DIRS.state, 'jobs')
  }

  // ── 기록 ────────────────────────────────────────────────────────────────
  private async save(job: JobRecord) {
    job.updatedAt = Date.now()
    await writeAtomic(join(this.dir, `${job.id}.json`), JSON.stringify(job, null, 2) + '\n')
    this.o.onEvent?.({ t: 'job', job: { ...job } })
  }

  private async set(job: JobRecord, status: JobStatus, patch: Partial<JobRecord> = {}) {
    Object.assign(job, patch, { status })
    await this.save(job)
    const started = status === 'submitted' || (status === 'running' && job.engine === 'codex' && !patch.remote)
    if (job.target.type === 'shot' && (status === 'queued' || started || status === 'failed')) {
      await this.setShotStage(job, started ? 'running' : status === 'failed' ? 'failed' : 'queued')
    }
    if (TERMINAL.has(status)) this.checkRequestDone(job.requestId)
  }

  private checkRequestDone(requestId: string) {
    const all = this.list(requestId)
    if (all.length && all.every((j) => TERMINAL.has(j.status))) {
      this.o.onEvent?.({ t: 'request_done', requestId, done: all.filter((j) => j.status === 'done').length, failed: all.filter((j) => j.status !== 'done').length })
    }
  }

  async init() {
    if (this.loaded) return
    this.loaded = true
    await mkdir(this.dir, { recursive: true })
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JobRecord.parse(JSON.parse(await readFile(join(this.dir, f), 'utf8'))) as JobRecord
        this.jobs.set(j.id, j)
      } catch (e) {
        console.error('job record 손상', f, e)
      }
    }
    await this.recover()
    void this.tick()
  }

  /** 크래시 복구 — 원격 id 가 있으면 폴링 재개, 제출 중이던 것은 generate list 로 대조, 제출 전이면 다시 큐. */
  private async recover() {
    for (const j of this.jobs.values()) {
      if (TERMINAL.has(j.status)) continue
      if (j.engine === 'codex') {
        await this.recoverCodex(j)
        continue
      }
      if (j.status === 'submitting') {
        const found = await this.reconcile(j)
        if (found) await this.set(j, 'submitted', { remote: { jobId: found } })
        else await this.set(j, 'unknown', { error: '제출 중 종료됨 — 서버 작업 목록에서 찾지 못했습니다. 크레딧이 쓰였는지 Higgsfield 에서 확인한 뒤 다시 생성하세요.' })
        continue
      }
      if ((j.status === 'submitted' || j.status === 'running' || j.status === 'downloading') && !j.remote?.jobId) {
        await this.set(j, 'unknown', { error: '원격 작업 id 없이 진행 상태로 남아 있었습니다.' })
        continue
      }
      if (j.status === 'uploading') await this.set(j, 'queued')
      // submitted/running/downloading 은 tick 이 폴링을 이어 간다
    }
  }

  /** codex: thread 폴더에 결과가 있으면 회수, 실행 전이면 다시 큐, 실행 중 끊겼는데 결과가 없으면 unknown(이중 사용 방지). */
  private async recoverCodex(j: JobRecord) {
    const thread = j.remote?.jobId?.startsWith('codex:') ? j.remote.jobId.slice(6) : undefined
    if (thread && this.o.codex) {
      const file = await this.o.codex.recover(thread)
      if (file) {
        try {
          await this.finishFromFile(j, file)
        } catch (e) {
          await this.set(j, 'failed', { error: (e as Error).message })
        }
        return
      }
    }
    if (j.status === 'queued') return
    if (j.status === 'uploading' && !thread) return void (await this.set(j, 'queued'))
    await this.set(j, 'unknown', { error: '앱이 꺼진 동안 Codex 작업이 끝나지 않았거나 결과를 찾지 못했습니다. 필요하면 [다시] 를 누르세요.' })
  }

  /** 제출 직후 죽었을 때: params.prompt 가 원문 그대로 돌아오므로(REPORT §3) 프롬프트로 찾는다. */
  private async reconcile(j: JobRecord): Promise<string | undefined> {
    try {
      const list = await this.o.cli.list(30)
      const since = j.updatedAt - 5 * 60_000
      const hit = list.find((r) => r.params?.prompt === j.prompt && (!r.created_at || Date.parse(r.created_at) >= since))
      return hit?.id
    } catch {
      return undefined
    }
  }

  // ── 조회 ────────────────────────────────────────────────────────────────
  list(requestId?: string): JobRecord[] {
    const all = [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt)
    return requestId ? all.filter((j) => j.requestId === requestId) : all
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id)
  }

  /** 오늘(로컬) 만든 작업 수 — 취소 제외. 장수 상한의 근거. */
  countToday(now = Date.now()): number {
    const d = new Date(now)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return [...this.jobs.values()].filter((j) => j.createdAt >= start && j.status !== 'cancelled').length
  }

  private dailyCap(): number {
    return this.o.dailyCap ?? this.o.store.getProject().defaults.dailyCap
  }

  // ── 제출 ────────────────────────────────────────────────────────────────
  async submit(requestId: string, plans: JobPlan[]): Promise<JobRecord[]> {
    await this.init()
    const cap = this.dailyCap()
    if (cap > 0 && this.countToday() + plans.length > cap) {
      throw new JobCapError(`하루 생성 상한(${cap}장)을 넘습니다 — 오늘 ${this.countToday()}장 + 요청 ${plans.length}장. 프로젝트 설정에서 상한을 올리거나 내일 다시 하세요.`)
    }
    const ids = plans.map(() => randomUUID())
    const out: JobRecord[] = []
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i]
      const job: JobRecord = {
        id: ids[i],
        requestId,
        kind: p.kind,
        target: p.target,
        model: p.model,
        params: p.params,
        prompt: p.prompt,
        refs: p.refs.map((r) => ({ ...r })),
        dependsOn: p.dependsOn != null ? ids[p.dependsOn] : undefined,
        source: p.source,
        parentVersionId: p.parentVersionId,
        style: p.style,
        lint: p.lint,
        engine: p.engine === 'codex' ? 'codex' : undefined,
        status: 'queued',
        createdAt: Date.now() + i, // 정렬 안정
        updatedAt: Date.now(),
      }
      this.jobs.set(job.id, job)
      await this.set(job, 'queued')
      out.push(job)
    }
    void this.tick()
    return out
  }

  /** 실패·불명 작업을 같은 내용으로 다시 큐에 넣는다 (새 id, 상한에 포함). */
  async resubmit(jobId: string): Promise<JobRecord> {
    const j = this.jobs.get(jobId)
    if (!j) throw new Error(`작업 없음: ${jobId}`)
    if (!TERMINAL.has(j.status)) throw new Error('진행 중인 작업은 다시 제출할 수 없습니다')
    const [n] = await this.submit(j.requestId, [{ kind: j.kind, target: j.target, model: j.model, params: j.params, prompt: j.prompt, refs: j.refs.map((r) => ({ file: r.file, label: r.label })), source: j.source, parentVersionId: j.parentVersionId, lint: j.lint, style: j.style as JobPlan['style'], engine: j.engine }])
    return n
  }

  async cancel(jobId: string) {
    const j = this.jobs.get(jobId)
    if (!j) return
    if (j.status === 'queued') await this.set(j, 'cancelled')
  }

  async stop() {
    this.stopped = true
  }

  async waitRequest(requestId: string, timeoutMs: number): Promise<{ jobs: JobRecord[]; pending: boolean }> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const jobs = this.list(requestId)
      const pending = jobs.some((j) => !TERMINAL.has(j.status))
      if (!pending || Date.now() >= deadline) return { jobs, pending }
      await sleep(Math.min(200, deadline - Date.now()))
    }
  }

  // ── 실행 ────────────────────────────────────────────────────────────────
  private async tick() {
    if (this.ticking || this.stopped) return
    this.ticking = true
    try {
      const limit = this.o.concurrency ?? 3
      const codexLimit = this.o.codexConcurrency ?? 2
      const codexRunning = () => [...this.running].filter((id) => this.jobs.get(id)?.engine === 'codex').length
      for (const j of this.list()) {
        if (this.running.size >= limit) break
        if (this.running.has(j.id)) continue
        if (j.engine === 'codex' && (j.status !== 'queued' || codexRunning() >= codexLimit)) continue
        if (j.status === 'queued') {
          const dep = j.dependsOn ? this.jobs.get(j.dependsOn) : undefined
          if (dep && !TERMINAL.has(dep.status)) continue
          if (dep && dep.status !== 'done') {
            await this.set(j, 'failed', { error: `정본 작업 실패로 건너뜀 (${dep.error ?? dep.status})` })
            continue
          }
          this.launch(j)
        } else if ((j.status === 'submitted' || j.status === 'running' || j.status === 'downloading') && j.remote?.jobId) {
          this.launch(j)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  private launch(j: JobRecord) {
    this.running.add(j.id)
    this.run(j)
      .catch(async (e) => {
        const msg = e instanceof CliError ? `${e.message} [${e.kind}${e.code != null ? ` exit ${e.code}` : ''}]` : (e as Error).message
        await this.set(j, 'failed', { error: msg })
      })
      .finally(() => {
        this.running.delete(j.id)
        void this.tick()
      })
  }

  private async run(j: JobRecord) {
    if (j.engine === 'codex') return this.runCodex(j)
    if (j.status === 'queued') {
      await this.set(j, 'uploading')
      const media: string[] = []
      const dep = j.dependsOn ? this.jobs.get(j.dependsOn) : undefined
      if (dep?.outFile) j.refs = [{ file: dep.outFile, label: '정본' }, ...j.refs.filter((r) => r.file !== dep.outFile)]
      for (const r of j.refs) {
        const up = await this.uploads.idFor(absPath(this.root, r.file), r.file)
        r.sha256 = up.sha256
        r.uploadId = up.id
        media.push(up.id)
      }
      j.inputHash = sha256(JSON.stringify({ model: j.model, params: j.params, prompt: j.prompt, refs: j.refs.map((r) => r.sha256) }))
      const params: CliParams = { ...j.params }
      if (media.length) params['image-references'] = media
      await this.set(j, 'submitting')
      let remote
      try {
        remote = await this.o.cli.create(j.model, params, j.prompt)
      } catch (e) {
        // exit 0 인데 id 를 못 읽음 = 서버엔 들어갔을 수 있다(크레딧 소비). 목록에서 프롬프트로 찾고, 없으면 unknown 으로 남긴다 — failed 로 두면 재제출로 이중 과금
        if (e instanceof CliError && e.kind === 'unknown' && e.code === 0) {
          const found = await this.reconcile(j)
          if (found) remote = { id: found, status: 'queued' }
          else {
            await this.set(j, 'unknown', { error: `${e.message} — 서버 작업 목록에서도 찾지 못했습니다. Higgsfield 에서 크레딧·결과를 확인한 뒤 필요하면 [다시]` })
            return
          }
        } else throw e
      }
      await this.set(j, 'submitted', { remote: { jobId: remote.id, status: remote.status } })
    }
    if (this.stopped) return
    // 폴링
    const started = Date.now()
    const maxPoll = this.o.maxPollMs ?? 15 * 60_000
    let resultUrl = j.remote?.resultUrl
    while (!resultUrl) {
      if (this.stopped) return
      if (Date.now() - started > maxPoll) throw new Error(`결과 대기 시간 초과 (${Math.round(maxPoll / 60000)}분) — 작업은 서버에 남아 있습니다: ${j.remote!.jobId}`)
      const r = await this.o.cli.get(j.remote!.jobId)
      const st = remoteState(r.status)
      if (st === 'failed') throw new Error(`서버에서 실패: ${r.status}`)
      if (st === 'done') {
        if (!r.result_url) throw new Error('완료됐지만 result_url 이 없습니다')
        resultUrl = r.result_url
        await this.set(j, 'downloading', { remote: { ...j.remote!, status: r.status, resultUrl } })
        break
      }
      if (j.status !== 'running' || j.remote?.status !== r.status) await this.set(j, 'running', { remote: { ...j.remote!, status: r.status } })
      await sleep(this.o.pollMs ?? 3000)
    }
    // 다운로드 → 버전
    const { rel, n } = await this.targetFile(j, resultUrl)
    const dl = await downloadTo(resultUrl, absPath(this.root, rel), this.o.fetchImpl)
    await this.finalize(j, rel, n, dl)
  }

  private async finalize(j: JobRecord, rel: string, n: number, img: { sha256: string; w?: number; h?: number }) {
    const version = Version.parse({
      id: randomUUID(),
      n,
      stage: j.target.type === 'shot' && j.target.stage !== 'image' ? 'conti' : 'image',
      file: rel,
      sha256: img.sha256,
      w: img.w,
      h: img.h,
      source: j.source,
      parentId: j.parentVersionId,
      jobId: j.id,
      createdAt: Date.now(),
    })
    await this.applyVersion(j, version)
    await this.set(j, 'done', { outFile: rel, versionId: version.id })
  }

  // ── GPT(Codex) 엔진 ─────────────────────────────────────────────────────
  private async runCodex(j: JobRecord) {
    if (!this.o.codex) throw new Error('GPT(Codex) 엔진이 준비되지 않았습니다')
    const dep = j.dependsOn ? this.jobs.get(j.dependsOn) : undefined
    if (dep?.outFile) j.refs = [{ file: dep.outFile, label: '정본' }, ...j.refs.filter((r) => r.file !== dep.outFile)]
    const refs = j.refs.map((r) => absPath(this.root, r.file))
    const hashes = await Promise.all(refs.map(async (f) => sha256(await readFile(f))))
    j.refs = j.refs.map((r, i) => ({ ...r, sha256: hashes[i] }))
    j.inputHash = sha256(JSON.stringify({ model: j.model, params: j.params, prompt: j.prompt, refs: hashes }))
    await this.set(j, 'running')
    const r = await this.o.codex.generate({
      prompt: j.prompt,
      refs,
      aspect: j.params.aspect_ratio ?? '16:9',
      cwd: this.root,
      onThread: (t) => void this.set(j, 'running', { remote: { jobId: `codex:${t}`, status: 'running' } }),
    })
    if (!j.remote?.jobId) j.remote = { jobId: `codex:${r.threadId}`, status: 'running' }
    await this.finishFromFile(j, r.file)
  }

  /** Codex 가 저장한 파일 → 검증 → 프로젝트 규칙 이름으로 원자적 복사 → 버전 */
  private async finishFromFile(j: JobRecord, absFile: string) {
    await this.set(j, 'downloading')
    const buf = await readFile(absFile)
    const dims = imageDims(buf)
    if (!dims) throw new Error(`이미지가 아닙니다: ${absFile}`)
    const { rel, n } = await this.targetFile(j, absFile)
    const target = absPath(this.root, rel)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.part`
    await copyFile(absFile, tmp)
    await rename(tmp, target)
    await this.finalize(j, rel, n, { sha256: sha256(buf), w: dims.w, h: dims.h })
  }

  // ── 파일명·버전 ─────────────────────────────────────────────────────────
  private async targetFile(j: JobRecord, url: string): Promise<{ rel: string; n: number }> {
    const ext = extOf(url)
    if (j.target.type === 'shot') {
      const t = j.target
      const stage = t.stage === 'image' ? 'image' : 'conti'
      const shot = this.o.store.getSequence(t.seq)?.shots.find((s) => s.id === t.shotId)
      const recorded = Math.max(0, ...(shot?.panels.flatMap((p) => p.versions[stage].map((v) => v.n)) ?? []))
      // 이미지 단계는 {EP}/Image/{SEQ}/ (기존 GenConti2Img 와 같은 자리), 콘티는 {EP}/Conti/{SEQ}/
      const dir = stage === 'image' ? PROJECT_DIRS.image(t.ep, t.seq) : PROJECT_DIRS.conti(t.ep, t.seq)
      const n = await nextFree(absPath(this.root, dir), recorded + 1, (v) => shotFileName({ seq: t.seq, shot: t.shotNo, v, ext }))
      return { rel: `${dir}/${shotFileName({ seq: t.seq, shot: t.shotNo, v: n, ext })}`, n }
    }
    const t = j.target
    const asset = (await this.o.store.listAssets(t.ep)).assets.find((a) => a.id === t.assetId)
    const recorded = Math.max(0, ...(asset?.views[t.view]?.map((v) => v.n) ?? []))
    const dir = PROJECT_DIRS.assetSub(t.ep, t.kind)
    const name = asset?.nameKo || t.tag.replace(/^@(loc_|prop_)?/, '')
    const n = await nextFree(absPath(this.root, dir), recorded + 1, (v) => assetFileName(t.kind, name, t.view, v, ext))
    return { rel: `${dir}/${assetFileName(t.kind, name, t.view, n, ext)}`, n }
  }

  /** 결과를 스토어에 기록 — 읽기와 쓰기 사이에 await 가 없어야 한다 (단일 writer 가 원자성을 보장). */
  private async applyVersion(j: JobRecord, version: Version) {
    if (j.target.type === 'shot') {
      const t = j.target
      const seq = this.o.store.getSequence(t.seq)
      const shot = seq?.shots.find((s) => s.id === t.shotId)
      if (!seq || !shot) throw new Error(`샷이 사라졌습니다: ${t.seq} ${t.shotNo} (파일은 ${version.file})`)
      const panels = shot.panels.length ? shot.panels.map((p) => ({ ...p })) : [{ id: randomUUID(), index: 0, annotations: [], versions: { conti: [], image: [] } }]
      const stage = t.stage === 'image' ? 'image' : 'conti'
      panels[0] = { ...panels[0], versions: { ...panels[0].versions, [stage]: [...panels[0].versions[stage], version] } }
      const stages: Shot['stages'] = { ...shot.stages, [stage]: { ...shot.stages[stage], status: 'review', currentVersionId: version.id, inputHash: j.inputHash, lastJobId: j.id, updatedAt: Date.now() } }
      // 콘티가 새로 바뀌었는데 그 콘티로 만든 이미지가 이미 있으면, 이미지는 재생성 필요
      if (stage === 'conti' && shot.stages.image.currentVersionId) stages.image = { ...shot.stages.image, status: 'stale', updatedAt: Date.now() }
      await this.o.store.updateShot(t.seq, t.shotId, { panels, stages })
      return
    }
    const t = j.target
    const ea = await this.o.store.listAssets(t.ep)
    const asset = ea.assets.find((a) => a.id === t.assetId)
    if (!asset) throw new Error(`에셋이 사라졌습니다: ${t.tag} (파일은 ${version.file})`)
    await this.o.store.upsertAsset(t.ep, { ...asset, views: { ...asset.views, [t.view]: [...(asset.views[t.view] ?? []), version] } })
  }

  private async setShotStage(j: JobRecord, status: 'queued' | 'running' | 'failed') {
    const t = j.target as Extract<JobTarget, { type: 'shot' }>
    const seq = this.o.store.getSequence(t.seq)
    const shot = seq?.shots.find((s) => s.id === t.shotId)
    if (!seq || !shot) return
    const stage = t.stage === 'image' ? 'image' : 'conti'
    if (shot.stages[stage].status === status) return
    await this.o.store.updateShot(t.seq, t.shotId, { stages: { ...shot.stages, [stage]: { ...shot.stages[stage], status, lastJobId: j.id, updatedAt: Date.now() } } })
  }
}

function extOf(url: string): string {
  try {
    const e = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? 'png'
    return /^(png|jpe?g|webp)$/.test(e) ? e : 'png'
  } catch {
    return 'png'
  }
}

/** 기록상 다음 번호부터 디스크에 없는 첫 파일명 (기존 스킬이 만든 `_v3` 와 안 겹치게). */
async function nextFree(absDir: string, from: number, name: (v: number) => string): Promise<number> {
  for (let v = from; ; v++) {
    try {
      await stat(join(absDir, name(v)))
    } catch {
      return v
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
