// AgentHost — 앱 MCP 서버를 띄우고, 로그인된 CLI(claude/codex)로 세션을 열어 이벤트를 렌더러로 흘린다.
// 유료 요청(승인 카드)은 여기서 판정 → JobService(genengine) 가 생성한다. 모든 생성은 이 한 통로다.
import { app, nativeImage, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createContiMcp, type JobView as McpJobView, type SpendKind, type SpendRequest } from '@conti/mcp'
import { adapters, pickAvailable, runStructured, type AgentEvent, type AgentKind, type AgentSession } from '@conti/agents'
import { ProjectStore, writeAtomic, exists, readText } from '@conti/core'
import { assetJobCount } from '@conti/domain'
import { JobService, ModelTable, RealCodexImage, RealHiggsfieldCli, analyzeConti, driftCheck, engineFor, expandNeighbors, planRequest, type JobEvent, type JobRecord, type RunAi } from '@conti/genengine'
import type { AgentAvailability, AgentUiEvent, ChatMessage, JobView, SpendPreview, SpendRequestView, ThreadInfo } from '../shared/agent-ipc'
import type { FeedbackItem } from '../shared/publish-ipc'
import { log } from './log'

interface LiveThread {
  info: ThreadInfo
  session: AgentSession | null
  currentAssistantId: string | null
}

const targetLabel = (j: JobRecord) => (j.target.type === 'shot' ? `${j.target.seq} ${j.target.shotNo}` : j.target.type === 'background' ? `${j.target.seq} 배경` : `${j.target.tag} ${j.target.view}`)

export function jobView(j: JobRecord): JobView {
  return {
    id: j.id,
    requestId: j.requestId,
    status: j.status,
    kind: j.kind,
    target: targetLabel(j),
    seq: j.target.type === 'shot' ? j.target.seq : undefined,
    shotNo: j.target.type === 'shot' ? j.target.shotNo : undefined,
    model: j.model,
    outFile: j.outFile,
    error: j.error,
    lint: j.lint,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }
}

export class AgentHost {
  private mcp: ReturnType<typeof createContiMcp> | null = null
  private mcpInfo: { url: string; token: string } | null = null
  private threads = new Map<string, LiveThread>()
  private spends = new Map<string, SpendRequestView>()
  private jobsvc: JobService | null = null
  private models: ModelTable | null = null

  constructor(
    private store: ProjectStore,
    private getWindow: () => BrowserWindow | null,
    /** 테스트·검증용으로 CLI 를 바꿔 끼운다 (기본 실제 higgsfield) */
    private makeCli: () => ConstructorParameters<typeof JobService>[0]['cli'] = () => new RealHiggsfieldCli({ bin: process.env.CONTI_HIGGSFIELD_BIN || undefined }),
    /** 뷰어 피드백 (게시 서버) — MCP feedback_list / feedback_update */
    private feedback?: {
      list(f: { seq?: string; state?: 'open' | 'applied' | 'declined' | 'all' }): Promise<FeedbackItem[]>
      update(id: string, state: 'open' | 'applied' | 'declined', o: { note?: string; versionId?: string }): Promise<FeedbackItem>
    },
  ) {}

  /** 번들 위치: 개발 중엔 저장소의 agent-bundle, 패키징 후엔 resources/agent-bundle */
  bundleDir(): string {
    const packaged = join(process.resourcesPath ?? '', 'agent-bundle')
    const dev = join(app.getAppPath(), '..', '..', 'agent-bundle')
    return app.isPackaged ? packaged : dev
  }

  private emit(e: AgentUiEvent) {
    this.getWindow()?.webContents.send('agent:event', e)
  }

  private viewOf(req: SpendRequest): SpendRequestView {
    const prev = this.spends.get(req.requestId)
    const args = req.args as { seq?: string; shots?: unknown }
    return {
      requestId: req.requestId,
      kind: req.kind,
      count: req.count,
      status: prev?.status ?? (req.status as SpendRequestView['status']),
      seq: args?.seq,
      shots: Array.isArray(args?.shots) ? (args.shots as string[]) : undefined,
      createdAt: req.createdAt,
      error: req.error,
      parentRequestId: req.parentRequestId,
      progress: prev?.progress,
      analysis: prev?.analysis,
      drift: prev?.drift,
    }
  }

  // ── GenConti2Img: 콘티 Vision 분석 · 드리프트 확인 ─────────────────────────
  /** AI 구조화 호출 (로그인된 Claude → Codex). 검증은 CONTI_FAKE_ANALYSIS=1 로 고정 응답 */
  private async aiRunner(): Promise<RunAi> {
    if (process.env.CONTI_FAKE_ANALYSIS) {
      return (async (req: { prompt: string; schema: Record<string, unknown> }) => {
        const props = (req.schema as { properties: Record<string, unknown> }).properties
        if ('checks' in props) return { data: { checks: [...req.prompt.matchAll(/- (\d{4}): generated image/g)].map((m) => ({ no: m[1], tag: '@?', ok: true })) } }
        const shots = [...req.prompt.matchAll(/- (\d{4}): storyboard = image \d+; listed size (\w+|\?); characters ([^;]*);/g)].map((m) => ({ no: m[1], shotSize: m[2] === '?' ? 'MS' : m[2], angleEn: 'eye-level', expressionEn: m[3] === 'none' ? '' : 'jaw set, a held blink', useConti: true, people: m[3] === 'none' ? 0 : m[3].split(',').length }))
        return { data: { shots, locationMapEn: /LOCATION MAP/.test(req.prompt) ? 'Camera at the road shoulder facing east; light from screen left.' : undefined } }
      }) as unknown as RunAi
    }
    const kind = await pickAvailable('claude')
    if (!kind) throw new Error('로그인된 AI(Claude 또는 Codex)가 없어 콘티를 분석할 수 없습니다 — 설정 › 계정')
    return (async (req: { prompt: string; images: string[]; schema: Record<string, unknown> }) => {
      const r = await runStructured({ kind, cwd: this.store.root, prompt: req.prompt, images: req.images, schema: req.schema, timeoutMs: 240_000 })
      return { data: r.data }
    }) as unknown as RunAi
  }

  /** AI 에 보낼 크기(긴 변 1024 JPEG)로 줄인 임시 파일 */
  private async shrink(absFile: string): Promise<string> {
    const dir = join(app.getPath('userData'), 'tmp', 'conti2img')
    await mkdir(dir, { recursive: true })
    const out = join(dir, `${createHash('sha1').update(absFile).digest('hex').slice(0, 16)}.jpg`)
    const img = nativeImage.createFromPath(absFile)
    if (img.isEmpty()) return absFile
    const { width, height } = img.getSize()
    const scale = Math.min(1, 1024 / Math.max(width, height))
    await writeFile(out, (scale < 1 ? img.resize({ width: Math.round(width * scale) }) : img).toJPEG(82))
    return out
  }

  private async runAnalysis(view: SpendRequestView) {
    if (view.kind !== 'image_generate' || !view.seq || !view.shots?.length) return
    view.analysis = { state: 'running' }
    this.emit({ t: 'spend', request: view })
    try {
      const r = await analyzeConti({ store: this.store, seq: view.seq, shotNos: view.shots, runAi: await this.aiRunner(), shrink: (f) => this.shrink(f) })
      view.analysis = { state: 'done', analyzed: r.analyzed.length, locationMap: r.locationMap }
    } catch (e) {
      const msg = (e as Error).message
      log('warn', `콘티 분석 실패 ${view.seq}: ${msg}`)
      view.analysis = { state: 'failed', error: msg.slice(0, 300) }
    }
    this.emit({ t: 'spend', request: view })
  }

  async reanalyze(requestId: string) {
    const view = this.spends.get(requestId)
    if (view) await this.runAnalysis(view)
  }

  private async runDrift(view: SpendRequestView) {
    if (!view.seq || !this.jobsvc) return
    const results = this.jobsvc
      .list(view.requestId)
      .filter((j) => j.status === 'done' && j.target.type === 'shot' && j.outFile)
      .map((j) => ({ shotNo: (j.target as { shotNo: string }).shotNo, file: j.outFile! }))
    if (!results.length) return
    try {
      const line = await driftCheck({ store: this.store, seq: view.seq, results, runAi: await this.aiRunner(), shrink: (f) => this.shrink(f) })
      if (line) {
        view.drift = line
        this.emit({ t: 'spend', request: view })
      }
    } catch (e) {
      log('warn', `드리프트 확인 실패: ${(e as Error).message}`)
    }
  }

  async start() {
    this.mcp = createContiMcp({
      store: this.store,
      bundleDir: this.bundleDir(),
      projectRoot: this.store.root,
      hooks: {
        onUiFocus: (seq, shotNo) => this.emit({ t: 'focus', seq, shotNo }),
        onSpendRequest: (req) => {
          const view = this.viewOf(req)
          this.spends.set(view.requestId, view)
          this.emit({ t: 'spend', request: view })
          // 콘티 → 최종 이미지: 승인 전에 콘티를 분석한다 (캐시 적중이면 바로 끝)
          if (view.kind === 'image_generate' && view.status === 'awaiting_approval') void this.runAnalysis(view)
        },
        feedbackList: this.feedback ? (f) => this.feedback!.list(f) : undefined,
        feedbackUpdate: this.feedback ? (id, state, o) => this.feedback!.update(id, state, o) : undefined,
        jobsForRequest: (requestId): McpJobView[] =>
          (this.jobsvc?.list(requestId) ?? []).map((j) => ({ id: j.id, status: j.status, target: targetLabel(j), model: j.model, outFile: j.outFile, error: j.error, lint: j.lint.length ? j.lint : undefined })),
      },
    })
    this.mcpInfo = await this.mcp.start()
    await this.writeAgentsMd()
    try {
      this.models = await ModelTable.load(this.bundleDir())
    } catch (e) {
      console.error('models.json 로드 실패', e)
    }
    // GPT 엔진: 로그인한 Codex 의 image_gen (검증은 CONTI_CODEX_BIN 가짜 바이너리 + CONTI_CODEX_HOME)
    const codex = new RealCodexImage({ bin: process.env.CONTI_CODEX_BIN || undefined, codexHome: process.env.CONTI_CODEX_HOME || undefined })
    this.jobsvc = new JobService({ store: this.store, cli: this.makeCli(), codex, onEvent: (e) => this.onJobEvent(e) })
    await this.jobsvc.init().catch((e) => console.error('JobService init 실패', e))
  }

  async stop() {
    for (const t of this.threads.values()) await t.session?.close()
    this.threads.clear()
    await this.jobsvc?.stop()
    await this.mcp?.stop()
    this.mcp = null
  }

  // ── Codex 용 AGENTS.md (번들 템플릿) ───────────────────────────────────
  private async writeAgentsMd() {
    const tpl = join(this.bundleDir(), 'agents-md.hbs')
    if (!(await exists(tpl))) return
    const p = this.store.getProject()
    let text = await readText(tpl)
    const seqs = this.store.listSequences().map((s) => `- ${s.seq} (${s.ep}) ${s.headingKo}`).join('\n')
    text = text
      .replace(/\{\{!--[^]*?--\}\}\s*/g, '') // 템플릿 주석은 출력에 남기지 않는다
      .replace(/\{\{project\.title\}\}/g, p.title)
      .replace(/\{\{project\.code\}\}/g, p.code)
      .replace(/\{\{project\.type\}\}/g, p.type)
      .replace(/\{\{generatedAt\}\}/g, new Date().toISOString())
      .replace(/\{\{bundleDir\}\}/g, this.bundleDir())
      .replace(/\{\{sequences\}\}/g, seqs)
      .replace(/\{\{#each[^]*?\{\{\/each\}\}/g, seqs) // 단순 템플릿: each 블록은 목록으로 치환
    await writeAtomic(join(this.store.root, 'AGENTS.md'), text)
    const cm = join(this.store.root, 'CLAUDE.md')
    if (!(await exists(cm))) await writeAtomic(cm, '@AGENTS.md\n')
  }

  // ── 가용성 ──────────────────────────────────────────────────────────────
  async availability(): Promise<AgentAvailability[]> {
    const out: AgentAvailability[] = []
    for (const kind of ['claude', 'codex'] as AgentKind[]) {
      const d = await adapters[kind].detect()
      out.push({ kind, installed: d.installed, auth: d.auth, version: d.version })
    }
    return out
  }

  // ── 스레드 ──────────────────────────────────────────────────────────────
  private threadsPath() {
    return join(this.store.root, '.conti', 'agent', 'threads.json')
  }
  private transcriptPath(id: string) {
    return join(this.store.root, '.conti', 'agent', 'threads', `${id}.ndjson`)
  }

  async listThreads(): Promise<ThreadInfo[]> {
    try {
      return JSON.parse(await readFile(this.threadsPath(), 'utf8'))
    } catch {
      return []
    }
  }

  private async saveThreads() {
    const persisted = await this.listThreads()
    const map = new Map(persisted.map((t) => [t.id, t]))
    for (const t of this.threads.values()) map.set(t.info.id, t.info)
    await writeAtomic(this.threadsPath(), JSON.stringify([...map.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 50), null, 2))
  }

  async history(threadId: string): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(this.transcriptPath(threadId), 'utf8')
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }

  private async record(threadId: string, m: ChatMessage) {
    await mkdir(join(this.store.root, '.conti', 'agent', 'threads'), { recursive: true })
    await appendFile(this.transcriptPath(threadId), JSON.stringify(m) + '\n')
  }

  async open(opts: { agent: AgentKind; seq?: string; threadId?: string; mode?: 'chat' | 'task' }): Promise<ThreadInfo> {
    if (!this.mcpInfo) throw new Error('MCP 서버가 아직 준비되지 않았습니다')
    const existing = opts.threadId ? this.threads.get(opts.threadId) : undefined
    if (existing?.session) return existing.info
    const persisted = opts.threadId ? (await this.listThreads()).find((t) => t.id === opts.threadId) : undefined
    const info: ThreadInfo = persisted ?? {
      id: randomUUID(),
      agent: opts.agent,
      title: opts.seq ? `${opts.seq} 대화` : '대화',
      seq: opts.seq,
      lastActiveAt: Date.now(),
    }
    const systemPromptFile = join(this.bundleDir(), 'system', 'studio.md')
    const session = await adapters[opts.agent].open({
      projectRoot: this.store.root,
      threadId: info.id,
      resume: info.nativeSessionId,
      mcp: this.mcpInfo,
      bundleDir: this.bundleDir(),
      systemPromptFile: (await exists(systemPromptFile)) ? systemPromptFile : undefined,
      mode: opts.mode ?? 'chat',
    })
    const live: LiveThread = { info, session, currentAssistantId: null }
    this.threads.set(info.id, live)
    void this.pump(live)
    await this.saveThreads()
    return info
  }

  private async pump(live: LiveThread) {
    const session = live.session!
    const threadId = live.info.id
    try {
      for await (const e of session.events) await this.handle(live, e)
    } catch (err) {
      log('error', `agent thread ${threadId} pump failed: ${(err as Error).message}`)
      this.emit({ t: 'error', threadId, kind: 'crash', message: (err as Error).message })
    }
  }

  private async handle(live: LiveThread, e: AgentEvent) {
    const threadId = live.info.id
    switch (e.t) {
      case 'session':
        live.info.nativeSessionId = e.nativeSessionId
        await this.saveThreads()
        break
      case 'turn_start':
        break
      case 'text_delta': {
        if (!live.currentAssistantId) {
          const m: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', at: Date.now(), streaming: true }
          live.currentAssistantId = m.id
          this.emit({ t: 'message', threadId, message: m })
        }
        this.emit({ t: 'delta', threadId, messageId: live.currentAssistantId, text: e.text })
        break
      }
      case 'text': {
        // 델타 없이 완성 텍스트만 오는 어댑터(Codex)용. 델타를 받고 있었으면 기록만 한다.
        if (live.currentAssistantId) {
          await this.record(threadId, { id: live.currentAssistantId, role: 'assistant', text: e.text, at: Date.now() })
          live.currentAssistantId = null
        } else {
          const m: ChatMessage = { id: randomUUID(), role: 'assistant', text: e.text, at: Date.now() }
          this.emit({ t: 'message', threadId, message: m })
          await this.record(threadId, m)
        }
        break
      }
      case 'tool_start': {
        live.currentAssistantId = null
        const m: ChatMessage = { id: e.id, role: 'tool', text: '', at: Date.now(), tool: { name: e.name, pending: true } }
        this.emit({ t: 'message', threadId, message: m })
        break
      }
      case 'tool_end':
        this.emit({ t: 'tool', threadId, messageId: e.id, tool: { name: '', ok: e.ok, summary: e.summary, pending: false } })
        break
      case 'usage':
        this.emit({ t: 'usage', threadId, usage: { inTok: e.inTok, outTok: e.outTok, cacheRead: e.cacheRead, costUsd: e.costUsd, fiveHour: e.utilization?.fiveHour } })
        break
      case 'turn_end':
        live.currentAssistantId = null
        live.info.lastActiveAt = Date.now()
        await this.saveThreads()
        this.emit({ t: 'turn_end', threadId })
        break
      case 'error':
        // 채팅이 조용히 끊기는 경우를 나중에 알 수 있게 로그에도 남긴다 (진단 내보내기에 포함)
        log('warn', `agent ${live.info.agent} thread ${threadId} error [${e.kind}]: ${e.message}`)
        this.emit({ t: 'error', threadId, kind: e.kind, message: e.message })
        break
      case 'exit':
        log('info', `agent ${live.info.agent} thread ${threadId} exited (code ${e.code ?? 'null'})`)
        live.session = null
        break
    }
  }

  async send(threadId: string, text: string, context?: { seq?: string; shotNo?: string }) {
    let live = this.threads.get(threadId)
    if (!live?.session) {
      const info = (await this.listThreads()).find((t) => t.id === threadId)
      if (!info) throw new Error('스레드가 없습니다')
      await this.open({ agent: info.agent, seq: info.seq, threadId })
      live = this.threads.get(threadId)!
    }
    const user: ChatMessage = { id: randomUUID(), role: 'user', text, at: Date.now() }
    this.emit({ t: 'message', threadId, message: user })
    await this.record(threadId, user)
    const ctx = context?.seq ? `\n\n[현재 화면: ${context.seq}${context.shotNo ? ` / 샷 ${context.shotNo}` : ''}]` : ''
    await live.session!.send({ text: text + ctx })
  }

  async interrupt(threadId: string) {
    await this.threads.get(threadId)?.session?.interrupt()
  }

  async close(threadId: string) {
    const live = this.threads.get(threadId)
    await live?.session?.close()
    this.threads.delete(threadId)
  }

  /** 뷰어 피드백 반영 작업 — feedback-apply 스킬. 코멘트 본문은 프롬프트에 넣지 않고 도구로 읽게 한다(외부 입력 격리). */
  async feedbackTask(seq: string, commentIds?: string[]): Promise<{ threadId: string }> {
    const kind = (await pickAvailable('claude')) ?? (await pickAvailable('codex'))
    if (!kind) throw new Error('로그인된 AI CLI 가 없습니다 (claude 또는 codex)')
    const info = await this.open({ agent: kind, seq, mode: 'chat' })
    const only = commentIds?.length ? ` 이번엔 이 코멘트만: ${commentIds.join(', ')}.` : ''
    await this.send(info.id, `conti:feedback-apply 스킬로 ${seq} 의 열린 뷰어 코멘트를 반영해줘.${only} feedback_list 로 읽고, 변경안 표를 먼저 보여준 뒤 내 확인을 받아. 유료 작업은 승인 카드로.`, { seq })
    return { threadId: info.id }
  }

  // ── 작업 버튼 (headless 1회) ────────────────────────────────────────────
  async runTask(task: 'setup' | 'breakdown', seq?: string): Promise<{ threadId: string }> {
    const kind = (await pickAvailable('claude')) ?? (await pickAvailable('codex'))
    if (!kind) throw new Error('로그인된 AI CLI 가 없습니다 (claude 또는 codex)')
    const info = await this.open({ agent: kind, seq, mode: 'task' })
    const prompt =
      task === 'setup'
        ? `conti:conti-setup 스킬을 따라 ${seq ? `${seq} 씬` : '전체'}의 세계관과 등장체·배경·소품을 추출해 assets_upsert 로 저장하고, 표로 정리해 보고해줘.`
        : `conti:conti-breakdown 스킬을 따라 ${seq} 씬을 샷으로 분해해 shots_propose_breakdown 으로 제출하고 결과를 보고해줘.`
    await this.send(info.id, prompt, { seq })
    return { threadId: info.id }
  }

  // ── 승인 · 생성 ─────────────────────────────────────────────────────────
  spendList(): SpendRequestView[] {
    return [...this.spends.values()]
  }

  private requireEngine() {
    if (!this.mcp || !this.jobsvc || !this.models) throw new Error('생성 엔진이 아직 준비되지 않았습니다 (models.json / JobService)')
    return { mcp: this.mcp, jobs: this.jobsvc, models: this.models }
  }

  /** UI 버튼에서 유료 요청을 만든다 — AI 가 만든 것과 똑같이 승인 카드로 간다. */
  async requestSpend(kind: SpendKind, args: Record<string, unknown>): Promise<SpendRequestView> {
    const { mcp } = this.requireEngine()
    const count = await this.countFor(kind, args)
    if (!count) throw new Error('생성할 대상이 없습니다')
    const req = mcp.createSpendRequest(kind, count, args)
    return this.spends.get(req.requestId)!
  }

  /** 카드에 보일 장수 — MCP 도구와 같은 규칙 (에셋은 종류별 뷰 수) */
  private async countFor(kind: SpendKind, args: Record<string, unknown>): Promise<number> {
    if (kind === 'conti_generate' || kind === 'image_generate') return args.pilot ? 1 : ((args.shots as string[] | undefined)?.length ?? 0)
    if (kind === 'panel_restyle') return (args.shotNos as string[] | undefined)?.length ?? 0
    if (kind === 'image_edit') return 1
    const ea = await this.store.listAssets(String(args.ep))
    const views = args.views as string[] | undefined
    return ((args.ids as string[] | undefined) ?? []).reduce((n, id) => {
      const a = ea.assets.find((x) => x.id === id || x.tag === id)
      return n + (a ? assetJobCount(a.kind, views) : 0)
    }, 0)
  }

  /** 카드에서 엔진을 바꾸면 요청 인자에 남긴다 (미리보기·승인·파일럿 후속이 같은 엔진) */
  private argsWithEngine(req: { args: unknown }, engine?: 'higgsfield' | 'codex', model?: string): Record<string, unknown> {
    const args = req.args as Record<string, unknown>
    if (engine) args.engine = engine
    if (model) args.model = model
    return args
  }

  async spendPreview(requestId: string, includeNeighbors?: boolean, engine?: 'higgsfield' | 'codex', model?: string): Promise<SpendPreview> {
    const { mcp, models } = this.requireEngine()
    const req = mcp.getSpendRequest(requestId)
    if (!req) throw new Error('요청이 없습니다')
    const args = this.argsWithEngine(req, engine, model)
    const r = await planRequest({ store: this.store, models }, req.kind, args, 'approved', { includeNeighbors })
    return {
      engine: engineFor({ store: this.store, models }, args),
      count: r.plans.length,
      notes: r.notes,
      items: r.plans.map((p) => ({ target: p.target.type === 'shot' ? `${p.target.seq} ${p.target.shotNo}` : p.target.type === 'background' ? `${p.target.seq} 배경` : `${p.target.tag} ${p.target.view}`, model: p.model, prompt: p.prompt, refs: p.refs.map((x) => x.label), lint: p.lint })),
    }
  }

  async spendDecide(requestId: string, decision: 'approved' | 'rejected' | 'pilot', includeNeighbors?: boolean, engine?: 'higgsfield' | 'codex', model?: string) {
    const view = this.spends.get(requestId)
    if (!view) throw new Error('요청이 없습니다')
    if (view.status !== 'awaiting_approval') return
    const { mcp, jobs, models } = this.requireEngine()
    const req = mcp.getSpendRequest(requestId)
    if (!req) throw new Error('요청이 없습니다')
    if (decision === 'rejected') {
      mcp.resolveSpendRequest(requestId, 'rejected', { includeNeighbors })
      view.status = 'rejected'
      this.emit({ t: 'spend', request: view })
      return
    }
    try {
      // 이미지: [앞뒤 컷 포함] 으로 붙은 컷도 콘티 분석을 거친다 (이미 분석된 컷은 캐시로 바로 넘어간다)
      if (req.kind === 'image_generate' && includeNeighbors && view.seq && view.shots?.length) {
        const seqObj = this.store.getSequence(view.seq)
        if (seqObj) {
          const extra = expandNeighbors(seqObj, view.shots)
          if (extra.length > view.shots.length) {
            try {
              await analyzeConti({ store: this.store, seq: view.seq, shotNos: extra, runAi: await this.aiRunner(), shrink: (f) => this.shrink(f) })
            } catch (e) {
              log('warn', `앞뒤 컷 콘티 분석 실패: ${(e as Error).message}`)
            }
          }
        }
      }
      const plan = await planRequest({ store: this.store, models }, req.kind, this.argsWithEngine(req, engine, model), decision, { includeNeighbors })
      if (!plan.plans.length) throw new Error('생성할 것이 없습니다')
      await jobs.submit(requestId, plan.plans)
      mcp.resolveSpendRequest(requestId, decision, { includeNeighbors })
      view.status = decision
      view.count = plan.plans.length
      view.progress = { total: plan.plans.length, done: 0, failed: 0 }
      if (plan.rest) this.pendingRest.set(requestId, plan.rest)
    } catch (e) {
      const msg = (e as Error).message
      mcp.resolveSpendRequest(requestId, 'rejected', { includeNeighbors }, msg)
      view.status = 'failed'
      view.error = msg
    }
    this.emit({ t: 'spend', request: view })
  }

  /** 파일럿 뒤 남은 샷 — 파일럿이 끝나면 후속 승인 카드를 만든다 */
  private pendingRest = new Map<string, { args: Record<string, unknown>; count: number }>()

  private onJobEvent(e: JobEvent) {
    if (e.t === 'job') {
      this.emit({ t: 'job', job: jobView(e.job) })
      const view = this.spends.get(e.job.requestId)
      if (view && this.jobsvc) {
        const all = this.jobsvc.list(e.job.requestId)
        view.progress = { total: all.length, done: all.filter((j) => j.status === 'done').length, failed: all.filter((j) => j.status === 'failed' || j.status === 'unknown' || j.status === 'cancelled').length }
        this.emit({ t: 'spend', request: view })
      }
      return
    }
    const view = this.spends.get(e.requestId)
    if (view) {
      view.status = e.failed && !e.done ? 'failed' : 'done'
      this.emit({ t: 'spend', request: view })
      if (view.kind === 'image_generate' && e.done > 0) void this.runDrift(view)
    }
    const rest = this.pendingRest.get(e.requestId)
    if (rest && this.mcp) {
      this.pendingRest.delete(e.requestId)
      if (e.done > 0) {
        const req = this.mcp.getSpendRequest(e.requestId)
        this.mcp.createSpendRequest((req?.kind ?? 'conti_generate') as SpendKind, rest.count, rest.args, e.requestId)
      }
    }
  }

  /** 검증용 — 스토어 직접 수정 (AI 반영 단계 대신) */
  async updateShotForTest(seq: string, shotId: string, patch: Record<string, unknown>) {
    await this.store.updateShot(seq, shotId, patch as never)
  }

  jobs(requestId?: string): JobView[] {
    return (this.jobsvc?.list(requestId) ?? []).map(jobView)
  }

  async jobResubmit(jobId: string): Promise<JobView> {
    const { jobs } = this.requireEngine()
    const j = await jobs.resubmit(jobId)
    const view = this.spends.get(j.requestId)
    if (view) {
      view.status = 'approved'
      this.emit({ t: 'spend', request: view })
    }
    return jobView(j)
  }
}
