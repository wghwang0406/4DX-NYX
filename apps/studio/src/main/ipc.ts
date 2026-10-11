import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join, basename } from 'node:path'
import { readFile, copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ProjectStore, MdWatcher, readText, writeAtomic, sha256 } from '@conti/core'
import { splitScenes, textToLines, seqIdFromSceneNumber, extractPdfLines, type SourceLine } from '@conti/screenplay'
import { safeName } from '@conti/domain'
import type { ImportPick, ImportPreview, ImportSourceInfo, StoreChange } from '../shared/ipc'
import { toolStatuses } from './diag'
import { AgentHost } from './agent-host'
import { AuthManager } from './auth'
import { LayoutService } from './layout'
import { VideoService } from './video'
import { PublishService } from './publish'
import { AppInfo } from './appinfo'
import { buildMenu } from './menu'
import type { ExportKind } from '../shared/layout-ipc'
import type { AuthTool, LoginOptions } from '../shared/auth-ipc'

let store: ProjectStore | null = null
let watcher: MdWatcher | null = null
let host: AgentHost | null = null
let unsubscribe: (() => void) | null = null
const pendingImports = new Map<string, { fileName: string; lines: SourceLine[]; sourceRel: string }>()

const recentPath = () => join(app.getPath('userData'), 'recent.json')

async function loadRecent(): Promise<Array<{ root: string; title: string; code: string; openedAt: number }>> {
  try {
    return JSON.parse(await readFile(recentPath(), 'utf8'))
  } catch {
    return []
  }
}

async function pushRecent(root: string, title: string, code: string) {
  const list = (await loadRecent()).filter((r) => r.root !== root)
  list.unshift({ root, title, code, openedAt: Date.now() })
  await writeAtomic(recentPath(), JSON.stringify(list.slice(0, 10), null, 2))
}

export function registerIpc(getWindow: () => BrowserWindow | null) {
  const broadcast = (change: StoreChange) => getWindow()?.webContents.send('store:change', change)

  async function attach(s: ProjectStore, root: string) {
    unsubscribe?.()
    await watcher?.stop()
    await host?.stop().catch(() => {})
    store = s
    const unsubStore = s.onChange((e) =>
      broadcast(e.type === 'project' ? { type: 'project' } : e.type === 'assets' ? { type: 'assets', ep: e.ep } : { type: 'sequence', seq: e.sequence.seq }),
    )
    host = new AgentHost(s, getWindow, undefined, { list: (f) => publish.list(f), update: (id, st, o) => publish.update(id, st, o) })
    host.start().catch((err) => console.error('AgentHost start failed', err))
    watcher = new MdWatcher(s)
    const unsubWatch = watcher.onPending((list) => broadcast({ type: 'md-pending', count: list.length }))
    watcher.start()
    publish.startPolling()
    unsubscribe = () => {
      unsubStore()
      unsubWatch()
    }
    const p = s.getProject()
    await pushRecent(root, p.title, p.code)
    broadcast({ type: 'project' })
    void refreshMenu()
    return { root, project: p }
  }

  /** 프로젝트 닫기 — 진행 중 생성 작업은 디스크에 기록돼 있어 다시 열면 이어서 폴링한다 (JobService 복구) */
  async function detach() {
    unsubscribe?.()
    unsubscribe = null
    await watcher?.stop().catch(() => {})
    watcher = null
    await host?.stop().catch(() => {})
    host = null
    store = null
    broadcast({ type: 'project' })
    void refreshMenu()
  }

  async function openViaDialog() {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: '프로젝트 폴더 열기 (config.md 가 있는 폴더)',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const picked = r.filePaths[0]
    const found = await ProjectStore.findRoot(picked)
    if (!found) {
      const title = basename(picked)
      const code = safeName(title).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 8)
      const s = await ProjectStore.create(picked, { code: /^[A-Z]/.test(code) ? code : `P${code || 'ROJ'}`, title })
      return attach(s, picked)
    }
    return attach(await ProjectStore.open(found), found)
  }

  /** 메뉴에서 연 경우 — 실패하면 대화상자로 알린다 (렌더러는 project 변경 방송으로 따라온다) */
  async function menuOpen(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      dialog.showErrorBox('프로젝트를 열 수 없습니다', (e as Error).message)
    }
  }

  async function refreshMenu() {
    await buildMenu(
      {
        open: () => void menuOpen(openViaDialog),
        openRecent: (root) => void menuOpen(async () => attach(await ProjectStore.open(root), root)),
        newProject: () => getWindow()?.webContents.send('menu:new-project'),
        close: () => void detach(),
        settings: () => getWindow()?.webContents.send('menu:settings'),
        recent: () => loadRecent(),
        current: () => store?.root ?? null,
      },
      getWindow,
    ).catch((e) => console.error('메뉴 만들기 실패', e))
  }
  app.whenReady().then(() => refreshMenu())

  const requireStore = () => {
    if (!store) throw new Error('열린 프로젝트가 없습니다')
    return store
  }

  ipcMain.handle('project:openDialog', () => openViaDialog())
  ipcMain.handle('project:close', () => detach())
  /** 전환 전에: 진행 중 생성 작업 수 (닫아도 유실되진 않지만 알려 준다) */
  ipcMain.handle('project:busy', () => ({ jobs: host?.jobs().filter((j) => !['done', 'failed', 'cancelled', 'unknown'].includes(j.status)).length ?? 0 }))
  ipcMain.handle('project:forgetRecent', async (_e, root: string) => {
    const list = (await loadRecent()).filter((r) => r.root !== root)
    await writeAtomic(recentPath(), JSON.stringify(list, null, 2))
    void refreshMenu()
    return list
  })

  ipcMain.handle('project:createDialog', async (_e, init: { code: string; title: string }) => {
    const win = getWindow()
    const r = await dialog.showOpenDialog(win!, {
      title: '새 프로젝트를 만들 상위 폴더 선택',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const root = join(r.filePaths[0], safeName(init.title))
    await mkdir(root, { recursive: true })
    const s = await ProjectStore.create(root, { code: init.code, title: init.title })
    return attach(s, root)
  })

  ipcMain.handle('project:openPath', async (_e, root: string) => attach(await ProjectStore.open(root), root))
  ipcMain.handle('project:current', async () => (store ? { root: store.root, project: store.getProject() } : null))
  // 프로젝트 기본값 일부만 (이미지 엔진·콘티 그림체) — 다른 필드는 MCP project_update 로
  ipcMain.handle('project:setDefaults', async (_e, patch: { imageEngine?: 'higgsfield' | 'codex'; contiStyle?: 'sketch' | 'cinematic' }) => {
    const s = requireStore()
    const cur = s.getProject().defaults
    const next = { ...cur }
    if (patch.imageEngine === 'higgsfield' || patch.imageEngine === 'codex') next.imageEngine = patch.imageEngine
    if (patch.contiStyle === 'sketch' || patch.contiStyle === 'cinematic') next.contiStyle = patch.contiStyle
    return s.updateProject({ defaults: next })
  })
  ipcMain.handle('project:recent', () => loadRecent())

  ipcMain.handle('sequence:list', () => requireStore().listSequences())
  ipcMain.handle('sequence:get', (_e, seq: string) => requireStore().getSequence(seq) ?? null)
  ipcMain.handle('sequence:updateShot', (_e, seq: string, shotId: string, patch) => requireStore().updateShot(seq, shotId, patch))
  ipcMain.handle('sequence:setCurrentVersion', (_e, seq: string, shotId: string, versionId: string, stage: 'conti' | 'image' = 'conti') => {
    const s = requireStore()
    const q = s.getSequence(seq)
    const shot = q?.shots.find((x) => x.id === shotId)
    if (!shot) throw new Error('샷이 없습니다')
    const st = stage === 'image' ? 'image' : 'conti'
    if (!shot.panels.some((p) => p.versions[st].some((v) => v.id === versionId))) throw new Error('버전이 없습니다')
    return s.updateShot(seq, shotId, { stages: { ...shot.stages, [st]: { ...shot.stages[st], currentVersionId: versionId, status: 'review', updatedAt: Date.now() } } })
  })

  ipcMain.handle('screenplay:importDialog', async (): Promise<ImportPreview | null> => {
    const s = requireStore()
    // E2E: 파일 대화상자 대신 지정한 파일 (CONTI_E2E_IMPORT)
    if (process.env.CONTI_E2E_IMPORT) return importFile(s, process.env.CONTI_E2E_IMPORT)
    const r = await dialog.showOpenDialog(getWindow()!, {
      title: '시나리오 가져오기',
      properties: ['openFile'],
      filters: [{ name: '시나리오', extensions: ['pdf', 'txt', 'md', 'fountain'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return importFile(s, r.filePaths[0])
  })

  async function readScreenplayLines(file: string): Promise<{ lines: SourceLine[]; hashSource: string | Buffer }> {
    if (file.toLowerCase().endsWith('.pdf')) {
      const buf = await readFile(file)
      const lines = await extractPdfLines(new Uint8Array(buf))
      const hangul = lines.reduce((n, l) => n + (l.text.match(/[가-힣]/g)?.length ?? 0), 0)
      if (lines.length > 20 && hangul < lines.length * 2) {
        throw new Error('PDF에서 한글 텍스트를 거의 못 읽었습니다 (스캔본이거나 폰트 매핑이 없음). 텍스트로 저장해 넣어 주세요.')
      }
      return { lines, hashSource: buf }
    }
    const text = await readText(file)
    return { lines: textToLines(text), hashSource: text }
  }

  /** 새 파일: sources/ 로 복사한 뒤 펼친다 */
  async function importFile(s: ProjectStore, file: string): Promise<ImportPreview> {
    const fileName = basename(file)
    const { lines, hashSource } = await readScreenplayLines(file)
    const rel = `sources/${sha256(hashSource).slice(0, 8)}_${safeName(fileName)}`
    await mkdir(join(s.root, 'sources'), { recursive: true })
    await copyFile(file, join(s.root, rel))
    return previewOf(s, rel, fileName, lines)
  }

  /** sources/ 안의 파일 이름 → 보여줄 원래 이름 (앞의 해시 8자리 떼기) */
  const displayName = (rel: string) => basename(rel).replace(/^[0-9a-f]{8}_/, '')
  const sceneCounts = new Map<string, number>()

  /** 펼친 표: 이미 만든 씬(그 줄이 어떤 시퀀스 범위 안에 있음)은 madeSeq 로 표시한다 */
  function previewOf(s: ProjectStore, rel: string, fileName: string, lines: SourceLine[]): ImportPreview {
    const scenes = splitScenes(lines)
    sceneCounts.set(rel, scenes.length)
    const sourceId = randomUUID()
    pendingImports.set(sourceId, { fileName, lines, sourceRel: rel })
    const all = s.listSequences()
    const fromThis = all.filter((q) => q.source?.sourceId === rel && q.source.lineStart != null)
    const madeFor = (lineStart: number) => fromThis.find((q) => lineStart >= q.source!.lineStart! && lineStart <= (q.source!.lineEnd ?? q.source!.lineStart!))?.seq
    const existing = new Set(all.map((q) => q.seq))
    return {
      sourceId,
      sourceRel: rel,
      fileName,
      lineCount: lines.length,
      scenes: scenes.map((sc) => {
        const madeSeq = madeFor(sc.lineStart)
        let seq = madeSeq ?? seqIdFromSceneNumber(sc.number, sc.index)
        if (!madeSeq && existing.has(seq)) seq = `${seq}_new`
        return {
          index: sc.index,
          number: sc.number,
          headingRaw: sc.headingRaw,
          title: sc.title,
          timeOfDay: sc.timeOfDay,
          lineStart: sc.lineStart,
          lineEnd: sc.lineEnd,
          lineCount: sc.lines.filter((l) => l.text.trim()).length,
          preview: sc.lines.map((l) => l.text.trim()).filter(Boolean).slice(0, 2).join(' / ').slice(0, 120),
          suggestedSeq: seq,
          ...(madeSeq ? { madeSeq } : {}),
        }
      }),
    }
  }

  // 가져온 시나리오 목록 — 표를 닫아도 다시 펼칠 수 있게
  ipcMain.handle('screenplay:sources', async (): Promise<ImportSourceInfo[]> => {
    const s = requireStore()
    let names: string[] = []
    try {
      names = (await readdir(join(s.root, 'sources'))).filter((n) => /\.(pdf|txt|md|fountain)$/i.test(n))
    } catch {
      return []
    }
    const seqs = s.listSequences()
    const out: ImportSourceInfo[] = []
    for (const n of names) {
      const rel = `sources/${n}`
      const st = await stat(join(s.root, rel))
      out.push({ rel, fileName: displayName(rel), madeCount: seqs.filter((q) => q.source?.sourceId === rel).length, sceneCount: sceneCounts.get(rel), importedAt: st.mtimeMs })
    }
    return out.sort((a, b) => b.importedAt - a.importedAt)
  })

  ipcMain.handle('screenplay:open', async (_e, rel: string): Promise<ImportPreview> => {
    const s = requireStore()
    if (!/^sources\/[^/\\]+$/.test(rel) || rel.includes('..')) throw new Error('잘못된 경로')
    const { lines } = await readScreenplayLines(join(s.root, rel))
    return previewOf(s, rel, displayName(rel), lines)
  })

  ipcMain.handle('screenplay:commit', async (_e, sourceId: string, picks: ImportPick[]) => {
    const s = requireStore()
    const imp = pendingImports.get(sourceId)
    if (!imp) throw new Error('가져오기 세션이 만료됐습니다. 다시 가져와 주세요.')
    const scenes = splitScenes(imp.lines)
    const out = []
    for (const pick of picks) {
      const sc = scenes[pick.index]
      if (!sc) continue
      // 씬 경계 조정: 뒤따르는 씬을 합치면 그 헤딩 줄도 본문으로 들어간다
      const merged = [...sc.lines]
      let lineEnd = sc.lineEnd
      for (const mi of pick.mergeFollowing ?? []) {
        const m = scenes[mi]
        if (!m) continue
        merged.push({ n: m.lineStart, text: m.headingRaw }, ...m.lines)
        lineEnd = Math.max(lineEnd, m.lineEnd)
      }
      const sceneText = merged.map((l) => l.text).join('\n')
      out.push(
        await s.upsertSequence({
          seq: pick.seq,
          ep: pick.ep,
          headingKo: `${sc.title}${sc.timeOfDay ? ` - ${sc.timeOfDay === 'D' ? '낮' : '밤'}` : ''}`,
          source: { sourceId: imp.sourceRel, lineStart: sc.lineStart, lineEnd, textHash: sha256(sceneText), kind: 'screenplay' },
        }),
      )
    }
    return out
  })

  ipcMain.handle('md:pending', () => watcher?.list().map(({ rel, kind, seq, summary }) => ({ rel, kind, seq, summary })) ?? [])
  ipcMain.handle('md:accept', (_e, rel: string) => watcher?.accept(rel))
  ipcMain.handle('md:discard', (_e, rel: string) => watcher?.discard(rel))

  ipcMain.handle('diag:tools', () => toolStatuses())

  // 영상 콘티 가져오기
  const video = new VideoService(() => store, getWindow)
  ipcMain.handle('video:pick', (_e, kind) => video.pick(kind))
  ipcMain.handle('video:suggest', () => video.suggest())
  ipcMain.handle('video:import', (_e, o) => video.import(o))

  // 레이아웃 — 템플릿·미리보기·출력
  const layout = new LayoutService(() => store, getWindow)
  layout.watchTemplates()
  ipcMain.handle('layout:templates', () => layout.list())
  ipcMain.handle('layout:render', (_e, seq: string | null, opts) => layout.render(seq, opts))
  ipcMain.handle('layout:export', (_e, seq: string, kind: ExportKind, opts) => layout.export(seq, kind, opts))
  ipcMain.handle('layout:history', (_e, seq: string) => layout.history(seq))
  ipcMain.handle('layout:reveal', (_e, rel: string) => layout.reveal(rel))
  ipcMain.handle('layout:setTemplate', (_e, id: string) => layout.setProjectTemplate(id))
  ipcMain.handle('layout:duplicate', (_e, id: string, name?: string) => layout.duplicate(id, name))
  ipcMain.handle('layout:openFolder', (_e, id: string) => layout.openFolder(id))
  // 게시·피드백 (사내 뷰어 서버)
  const publish = new PublishService(() => store, getWindow, layout)
  ipcMain.handle('publish:settings', () => publish.settings())
  ipcMain.handle('publish:saveSettings', (_e, url: string, token?: string) => publish.saveSettings(url, token))
  ipcMain.handle('publish:test', () => publish.test())
  ipcMain.handle('publish:publish', (_e, seq: string, o) => publish.publish(seq, o))
  ipcMain.handle('publish:history', (_e, seq: string, refresh?: boolean) => (refresh ? publish.refreshHistory(seq).catch(() => publish.history(seq)) : publish.history(seq)))
  ipcMain.handle('publish:revoke', (_e, id: string) => publish.revoke(id))
  ipcMain.handle('feedback:list', (_e, f) => publish.list(f))
  ipcMain.handle('feedback:pull', () => publish.pull())
  ipcMain.handle('feedback:update', (_e, id: string, state, note?: string) => publish.update(id, state, { note }))
  // 앱 — 첫 실행 안내·새 버전·진단 내보내기
  const appInfo = new AppInfo(getWindow, () => store, () => publish.connection())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:settings', () => appInfo.settings())
  ipcMain.handle('app:setSettings', (_e, patch) => appInfo.setSettings(patch))
  ipcMain.handle('app:checkUpdate', () => appInfo.checkUpdate())
  ipcMain.handle('app:openDownload', (_e, url: string) => appInfo.openDownload(url))
  ipcMain.handle('app:exportDiagnostics', () => appInfo.exportDiagnostics())
  setTimeout(() => void appInfo.checkUpdate(), 8000) // 켜고 조금 뒤 한 번, 이후 6시간마다
  setInterval(() => void appInfo.checkUpdate(), 6 * 3600_000).unref()
  ipcMain.handle('feedback:applyWithAi', (_e, seq: string, ids?: string[]) => requireHost().feedbackTask(seq, ids))

  ipcMain.handle('sequence:setAnnotations', (_e, seq: string, shotId: string, panelIndex: number, annotations) => {
    const s = requireStore()
    const shot = s.getSequence(seq)?.shots.find((x) => x.id === shotId)
    if (!shot) throw new Error('샷이 없습니다')
    const panels = shot.panels.length ? shot.panels.map((p) => ({ ...p })) : [{ id: randomUUID(), index: 0, annotations: [], versions: { conti: [], image: [] } }]
    if (!panels[panelIndex]) throw new Error('패널이 없습니다')
    panels[panelIndex] = { ...panels[panelIndex], annotations }
    return s.updateShot(seq, shotId, { panels })
  })

  // 계정 — 프로젝트가 없어도 쓴다 (시작 화면에서도 설정 가능)
  const auth = new AuthManager(getWindow)
  ipcMain.handle('auth:status', () => auth.status())
  ipcMain.handle('auth:login', (_e, tool: AuthTool, opts?: LoginOptions) => auth.login(tool, opts))
  ipcMain.handle('auth:pasteCode', (_e, tool: AuthTool, code: string) => auth.pasteCode(tool, code))
  ipcMain.handle('auth:cancel', (_e, tool: AuthTool) => auth.cancel(tool))
  ipcMain.handle('auth:logout', (_e, tool: AuthTool) => auth.logout(tool))
  ipcMain.handle('auth:openUrl', (_e, url: string) => auth.openUrl(url))

  // Api.assets.list 는 Asset[] 을 약속한다 — EpisodeAssets 통째로 보내면 렌더러의 .filter 가 터져 항상 "없음"이 됐다
  ipcMain.handle('assets:list', async (_e, ep: string) => (await requireStore().listAssets(ep)).assets)

  const requireHost = () => {
    if (!host) throw new Error('열린 프로젝트가 없습니다')
    return host
  }
  ipcMain.handle('agent:availability', () => requireHost().availability())
  ipcMain.handle('agent:threads', () => requireHost().listThreads())
  ipcMain.handle('agent:history', (_e, id: string) => requireHost().history(id))
  ipcMain.handle('agent:open', (_e, opts) => requireHost().open(opts))
  ipcMain.handle('agent:send', (_e, id: string, text: string, ctx) => requireHost().send(id, text, ctx))
  ipcMain.handle('agent:interrupt', (_e, id: string) => requireHost().interrupt(id))
  ipcMain.handle('agent:close', (_e, id: string) => requireHost().close(id))
  ipcMain.handle('agent:spendList', () => requireHost().spendList())
  ipcMain.handle('agent:spendDecide', (_e, id: string, d, n, engine, model) => requireHost().spendDecide(id, d, n, engine, model))
  ipcMain.handle('agent:spendPreview', (_e, id: string, n, engine, model) => requireHost().spendPreview(id, n, engine, model))
  ipcMain.handle('agent:reanalyze', (_e, id: string) => requireHost().reanalyze(id))
  ipcMain.handle('agent:requestSpend', (_e, kind, args) => requireHost().requestSpend(kind, args))
  ipcMain.handle('agent:jobs', (_e, requestId) => requireHost().jobs(requestId))
  ipcMain.handle('agent:jobResubmit', (_e, id: string) => requireHost().jobResubmit(id))
  ipcMain.handle('agent:runTask', (_e, task, seq) => requireHost().runTask(task, seq))

  return {
    /** conti-file:// 프로토콜용 — 현재 프로젝트 루트 (없으면 null) */
    currentRoot: () => store?.root ?? null,
    layout,
    video,
    publish,
    appInfo,
    /** 검증용 — 대화상자 없이 시나리오 파일 미리보기 (PDF·txt) */
    importPreview: (file: string) => importFile(requireStore(), file),
    /** 검증용 — 에이전트 호스트 (승인 요청·미리보기) */
    agentHost: () => host,
    /** 검증용 — 현재 스토어의 시퀀스 */
    storeSnapshot: (seq: string) => store?.getSequence(seq),
    sequenceCount: async () => store?.listSequences().length ?? 0,
    openProject: async (root: string) => attach(await ProjectStore.open(root), root),
    /** E2E 검증용: 로그인된 AI 로 한 턴 보내고 이벤트를 모아 돌려준다 */
    e2e: async (prompt: string, seq?: string) => {
      const h = requireHost()
      const kind = (await h.availability()).find((a) => a.installed && a.auth === 'ok')?.kind
      if (!kind) throw new Error('로그인된 AI 없음')
      const info = await h.open({ agent: kind, seq })
      const events: unknown[] = []
      const done = new Promise<void>((resolve) => {
        const win = getWindow()
        const orig = win?.webContents.send.bind(win.webContents)
        if (!win || !orig) return resolve()
        win.webContents.send = ((channel: string, payload: unknown) => {
          if (channel === 'agent:event') {
            events.push(payload)
            const e = payload as { t: string; threadId?: string }
            if (e.threadId === info.id && (e.t === 'turn_end' || e.t === 'error')) resolve()
          }
          return orig(channel, payload)
        }) as typeof win.webContents.send
      })
      await h.send(info.id, prompt, { seq })
      await Promise.race([done, new Promise((r) => setTimeout(r, 180000))])
      return { agent: kind, threadId: info.id, events }
    },
    /** E2E 검증용(가짜 CLI): 시퀀스 앞 n 샷의 콘티를 요청→승인→완료까지 돌리고 결과를 돌려준다 (AI 없이) */
    e2eGenerate: async (seq: string, n = 2, decision: 'approved' | 'pilot' = 'approved', waitMs = 60_000) => {
      const h = requireHost()
      const s = requireStore().getSequence(seq)
      if (!s) throw new Error(`시퀀스 없음: ${seq}`)
      const terminal = (j: { status: string }) => ['done', 'failed', 'cancelled', 'unknown'].includes(j.status)
      const waitAll = async (requestId?: string) => {
        const deadline = Date.now() + waitMs
        let jobs = h.jobs(requestId)
        while (Date.now() < deadline && (!jobs.length || jobs.some((j) => !terminal(j)))) {
          await new Promise((r) => setTimeout(r, 300))
          jobs = h.jobs(requestId)
        }
        return jobs
      }
      const dump = () => requireStore().getSequence(seq)!.shots.filter((x) => !x.deleted).slice(0, Math.max(n, 3)).map((x) => ({ no: x.no, stages: x.stages.conti, versions: x.panels.flatMap((p) => p.versions.conti), image: x.stages.image, imageVersions: x.panels.flatMap((p) => p.versions.image) }))
      // n=0: 요청을 만들지 않고 복구된 작업이 끝나기만 기다린다 (크래시 복구 검증)
      if (n === 0) return { recovered: true, jobs: await waitAll(), shots: dump() }
      const shots = s.shots.filter((x) => !x.deleted).slice(0, n).map((x) => x.no)
      const kind = process.env.CONTI_E2E_KIND
      let req: { requestId: string }
      if (kind === 'image' && process.env.CONTI_E2E_CARD) {
        // UI 로: Shots › 이미지 탭의 [이 컷 이미지 생성] 을 실제로 누른다
        const win = getWindow()!
        const before = new Set(h.spendList().map((r) => r.requestId))
        for (let i = 0; i < 40 && !(await win.webContents.executeJavaScript(`!!document.querySelector('[data-testid=shot-image-generate]:not([disabled])')`)); i++) await new Promise((r) => setTimeout(r, 250))
        await win.webContents.executeJavaScript(`document.querySelector('[data-testid=shot-image-generate]').click()`)
        let found: { requestId: string } | undefined
        for (let i = 0; i < 40 && !found; i++) {
          await new Promise((r) => setTimeout(r, 250))
          found = h.spendList().find((r) => !before.has(r.requestId))
        }
        if (!found) throw new Error('이미지 생성 요청이 만들어지지 않았습니다')
        req = found
      } else
        req =
          kind === 'assets'
            ? await h.requestSpend('assets_generate', { ep: s.ep, ids: (await requireStore().listAssets(s.ep)).assets.slice(0, n).map((a) => a.id) })
            : kind === 'image'
              ? await h.requestSpend('image_generate', { seq, shots })
              : await h.requestSpend('conti_generate', { seq, shots, style: 'sketch' })
      const engine = (process.env.CONTI_E2E_ENGINE as 'higgsfield' | 'codex' | undefined) || undefined
      // CONTI_E2E_CARD=1: 승인 카드 UI 에서 엔진 버튼·승인을 실제로 누른다
      if (process.env.CONTI_E2E_CARD) {
        const win = getWindow()!
        const js = (c: string) => win.webContents.executeJavaScript(c)
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        for (let i = 0; i < 40 && !(await js(`!!document.querySelector('[data-testid=engine-switch]')`)); i++) await sleep(250)
        await sleep(800) // 로그인 상태 확인이 끝날 때까지
        // 로그아웃 상태면 카드 안의 [Codex 로그인] 을 누른다 (가짜 codex 가 브라우저 로그인을 흉내)
        const before = await js(`({ gptDisabled: !!document.querySelector('[data-testid=engine-switch] [data-engine=codex][disabled]'), loginButton: !!document.querySelector('[data-testid=codex-login]') })`)
        if (before.loginButton) {
          if (process.env.CONTI_E2E_SHOTDIR) await writeFile(join(process.env.CONTI_E2E_SHOTDIR, 'card_login.png'), (await win.webContents.capturePage()).toPNG())
          await js(`document.querySelector('[data-testid=codex-login]').click()`)
          await sleep(300)
          before.runningShown = await js(`!!document.querySelector('[data-testid=codex-login-running]')`)
        }
        for (let i = 0; i < 60 && !(await js(`!!document.querySelector('[data-testid=engine-switch] [data-engine=codex]:not([disabled])')`)); i++) await sleep(250)
        before.afterLogin = await js(`({ gptEnabled: !!document.querySelector('[data-testid=engine-switch] [data-engine=codex]:not([disabled])'), loginRow: !!document.querySelector('[data-testid=codex-login-row]') })`)
        await js(`document.querySelector('[data-testid=engine-switch] [data-engine=${engine ?? 'codex'}]').click()`)
        await new Promise((r) => setTimeout(r, 700))
        // 이미지 요청은 콘티 분석이 끝나야 승인이 열린다
        for (let i = 0; i < 80 && (await js(`document.querySelector('[data-testid=analysis-status]')?.textContent?.includes('분석 중') ?? false`)); i++) await sleep(250)
        before.analysis = await js(`document.querySelector('[data-testid=analysis-status]')?.textContent ?? null`)
        const card = await js(`(() => { const sw = document.querySelector('[data-testid=engine-switch]'); return { active: sw?.querySelector('.border-accent')?.textContent, text: sw?.closest('.rounded-lg')?.innerText.slice(0, 300) } })()`)
        if (process.env.CONTI_E2E_SHOTDIR) await writeFile(join(process.env.CONTI_E2E_SHOTDIR, 'card_engine.png'), (await win.webContents.capturePage()).toPNG())
        await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '승인')?.click()`)
        const jobs = await waitAll(req.requestId)
        // 이미지 배치 뒤 드리프트 확인 줄
        for (let i = 0; i < 40 && kind === 'image' && !h.spendList().find((r) => r.requestId === req.requestId)?.drift; i++) await sleep(250)
        await sleep(400)
        if (process.env.CONTI_E2E_SHOTDIR) await writeFile(join(process.env.CONTI_E2E_SHOTDIR, 'card_done.png'), (await win.webContents.capturePage()).toPNG())
        return { login: before, card, request: h.spendList().find((r) => r.requestId === req.requestId), jobs, shots: dump() }
      }
      const preview = await h.spendPreview(req.requestId, undefined, engine)
      await h.spendDecide(req.requestId, decision, undefined, engine)
      const jobs = await waitAll(req.requestId)
      // 파일럿이면 후속 카드가 생겼는지 (승인하지 않고 둔다)
      await new Promise((r) => setTimeout(r, 500))
      const followUp = h.spendList().find((r) => r.parentRequestId === req.requestId)
      return { request: h.spendList().find((r) => r.requestId === req.requestId), preview, jobs, followUp, shots: dump() }
    },
    shutdown: async () => {
      await auth.stop().catch(() => {})
      layout.stop()
      publish.stop()
      await host?.stop().catch(() => {})
      await watcher?.stop().catch(() => {})
    },
  }
}
