// LayoutService — 템플릿 목록·렌더·출력(PDF/PNG/애니매틱 mp4)·Template Lab 감시.
// 출력은 숨은 Chromium 창에서 같은 HTML 을 그린다 → 앱 미리보기와 PDF 가 같고, 맥·윈도우가 같다(번들 폰트).
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import crossSpawn from 'cross-spawn'
import { absPath, sha256, writeAtomic, type ProjectStore } from '@conti/core'
import { PROJECT_DIRS, safeName } from '@conti/domain'
import { buildLayoutData, concatList, animaticArgs, listTemplates, loadTemplate, pageSizeMm, renderHtml, shotDuration, solidPng, type LoadedTemplate, type TemplateEntry } from '@conti/layout'
import { findBin } from '@conti/agents'
import type { ExportKind, ExportRecord, ExportResult, LayoutRenderResult, TemplateInfo } from '../shared/layout-ipc'

export const DEFAULT_TEMPLATE = 'placeholder-a4-6up'

type PageRects = Array<{ shotNo: string; panelIndex: number; label: string; x: number; y: number; w: number; h: number }>
const round4 = (v: number) => Math.round(v * 10000) / 10000
function fmtTc(ms: number): string {
  const t = ms / 1000
  const m = Math.floor(t / 60)
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/** 게시 번들 재료 (manifest 의 project·label·status 는 PublishService 가 채운다) */
export interface BundleDraft {
  dir: string
  files: Array<{ path: string; abs: string; size: number; sha256: string; type: string }>
  pages: Array<{ n: number; file: string; w: number; h: number; panels: PageRects }>
  panels: Array<{ shotNo: string; panelIndex: number; label: string; file?: string; size?: string; angle?: string; cameraMove?: string; duration?: string; tc?: string; action?: string; dialogue?: Array<{ speaker?: string; text: string }> }>
  pdf: string
  video?: { file: string; fps: number; duration: number }
  edl?: Array<{ shotNo: string; inMs: number; outMs: number }>
  heading: string
  ep: string
}
const PX_PER_MM = 96 / 25.4

export function fileUrl(rel: string): string {
  return `conti-file://project/${rel.split('/').map(encodeURIComponent).join('/')}`
}

export class LayoutService {
  private watchers: FSWatcher[] = []
  private debounce: NodeJS.Timeout | null = null
  private templates = new Map<string, TemplateEntry>()

  constructor(
    private getStore: () => ProjectStore | null,
    private getWindow: () => BrowserWindow | null,
  ) {}

  // ── 위치 ───────────────────────────────────────────────────────────────
  bundledTemplatesDir(): string {
    return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), '..', '..', 'templates')
  }
  userTemplatesDir(): string {
    return join(app.getPath('userData'), 'templates')
  }
  fontsDir(): string {
    return join(this.bundledTemplatesDir(), '_fonts')
  }

  /** conti-file://tpl/<id>/<path> 를 위한 템플릿 폴더 */
  templateDir(id: string): string | undefined {
    return this.templates.get(id)?.dir
  }

  // ── 템플릿 ─────────────────────────────────────────────────────────────
  async list(): Promise<TemplateInfo[]> {
    await mkdir(this.userTemplatesDir(), { recursive: true })
    const list = await listTemplates([
      { dir: this.bundledTemplatesDir(), builtin: true },
      { dir: this.userTemplatesDir(), builtin: false },
    ])
    this.templates = new Map(list.filter((t) => !t.error).map((t) => [t.id, t]))
    const current = this.getStore()?.getProject().layoutTemplateId
    return list.map((t) => ({ ...t, current: t.id === current }))
  }

  private async resolveTemplate(id?: string): Promise<LoadedTemplate> {
    if (!this.templates.size) await this.list()
    const want = id ?? this.getStore()?.getProject().layoutTemplateId ?? DEFAULT_TEMPLATE
    const entry = this.templates.get(want) ?? this.templates.get(DEFAULT_TEMPLATE)
    if (!entry) throw new Error(`템플릿을 찾을 수 없습니다: ${want}`)
    return loadTemplate(entry.dir)
  }

  async setProjectTemplate(id: string) {
    const store = this.requireStore()
    await this.resolveTemplate(id) // 존재 확인
    await store.updateProject({ layoutTemplateId: id })
  }

  /** 템플릿 복제 → 사용자 템플릿 폴더. Finder 로 연다. */
  async duplicate(fromId: string, name?: string, open = true): Promise<TemplateInfo> {
    const src = await this.resolveTemplate(fromId)
    const base = safeName(name || `${src.meta.id}-copy`).toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'template'
    let id = base
    for (let i = 2; this.templates.has(id); i++) id = `${base}-${i}`
    const dir = join(this.userTemplatesDir(), id)
    await cp(src.dir, dir, { recursive: true })
    const metaPath = join(dir, 'template.json')
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    meta.id = id
    meta.name = name || `${src.meta.name} (복사본)`
    meta.version = '1'
    await writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n')
    await this.list()
    this.watchTemplates()
    if (open) void shell.openPath(dir)
    return { ...this.templates.get(id)!, current: false }
  }

  openFolder(id: string) {
    const dir = this.templateDir(id)
    if (dir) void shell.openPath(dir)
  }

  /** 템플릿 파일이 바뀌면 렌더러에 알린다 (Template Lab 실시간 반영). 사용자 폴더 + (개발 중) 번들 폴더. */
  watchTemplates() {
    for (const w of this.watchers) w.close()
    this.watchers = []
    const roots = [this.userTemplatesDir(), ...(app.isPackaged ? [] : [this.bundledTemplatesDir()])]
    for (const r of roots) {
      try {
        this.watchers.push(
          watch(r, { recursive: true }, (_ev, file) => {
            if (!file || /(^|\/)\./.test(String(file))) return
            if (this.debounce) clearTimeout(this.debounce)
            this.debounce = setTimeout(() => {
              void this.list().then(() => this.getWindow()?.webContents.send('layout:changed', { file: String(file) }))
            }, 150)
          }),
        )
      } catch {
        /* 폴더 없음 */
      }
    }
  }

  stop() {
    for (const w of this.watchers) w.close()
    this.watchers = []
  }

  // ── 렌더 ───────────────────────────────────────────────────────────────
  private requireStore(): ProjectStore {
    const s = this.getStore()
    if (!s) throw new Error('열린 프로젝트가 없습니다')
    return s
  }

  private async build(seq: string, t: LoadedTemplate, o: { versionLabel?: string; status?: string; screen?: boolean }) {
    const store = this.requireStore()
    const s = store.getSequence(seq)
    if (!s) throw new Error(`시퀀스 없음: ${seq}`)
    const assets = (await store.listAssets(s.ep)).assets
    const data = buildLayoutData(store.getProject(), s, assets, {
      meta: t.meta,
      pageMm: pageSizeMm(t.meta),
      imageUrl: (rel) => (existsSync(absPath(store.root, rel)) ? fileUrl(rel) : null),
      templateId: t.meta.id,
      templateName: t.meta.name,
      templateVersion: t.meta.version,
      versionLabel: o.versionLabel,
      status: o.status,
    })
    return renderHtml(t, data, { fontBase: 'conti-file://font/', assetBase: `conti-file://tpl/${encodeURIComponent(t.meta.id)}/`, screen: o.screen })
  }

  /** 앱 미리보기. seq 없이 sample:true 면 템플릿의 sample.json 으로 (Template Lab). */
  async render(seq: string | null, o: { templateId?: string; sample?: boolean } = {}): Promise<LayoutRenderResult> {
    try {
      const t = await this.resolveTemplate(o.templateId)
      if (o.sample || !seq) {
        if (!t.sample) throw new Error(`${t.meta.id}: sample.json 이 없습니다`)
        const r = renderHtml(t, t.sample as never, { fontBase: 'conti-file://font/', assetBase: `conti-file://tpl/${encodeURIComponent(t.meta.id)}/`, screen: true })
        return { html: r.html, pages: r.pages, templateId: t.meta.id, pageMm: r.pageMm }
      }
      const r = await this.build(seq, t, { screen: true })
      return { html: r.html, pages: r.pages, templateId: t.meta.id, pageMm: r.pageMm }
    } catch (e) {
      return { html: '', pages: 0, templateId: o.templateId ?? '', pageMm: [297, 210], error: (e as Error).message }
    }
  }

  // ── 출력 ───────────────────────────────────────────────────────────────
  private indexPath() {
    return join(this.requireStore().root, PROJECT_DIRS.state, 'cache', 'exports.json')
  }
  private async readIndex(): Promise<Record<string, ExportRecord[]>> {
    try {
      return JSON.parse(await readFile(this.indexPath(), 'utf8'))
    } catch {
      return {}
    }
  }

  async history(seq: string): Promise<ExportRecord[]> {
    const idx = await this.readIndex()
    return (['pdf', 'png', 'animatic'] as ExportKind[]).flatMap((k) => idx[`${seq}:${k}`] ?? []).sort((a, b) => b.at - a.at)
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      await stat(absPath(this.requireStore().root, rel))
      return true
    } catch {
      return false
    }
  }

  /** 같은 내용(키)의 마지막 출력이 있고 파일이 남아 있으면 다시 만들지 않는다. 아니면 다음 버전 번호. */
  private async version(seq: string, kind: ExportKind, key: string): Promise<{ reuse?: ExportRecord; n: number }> {
    const list = (await this.readIndex())[`${seq}:${kind}`] ?? []
    const last = list[list.length - 1]
    if (last && last.key === key && (await Promise.all(last.files.map((f) => this.exists(f)))).every(Boolean)) return { reuse: last, n: last.v }
    return { n: (last?.v ?? 0) + 1 }
  }

  private async record(seq: string, kind: ExportKind, rec: ExportRecord) {
    const idx = await this.readIndex()
    const k = `${seq}:${kind}`
    idx[k] = [...(idx[k] ?? []), rec].slice(-30)
    await writeAtomic(this.indexPath(), JSON.stringify(idx, null, 2) + '\n')
  }

  private exportsDir(seq: string): string {
    const s = this.requireStore().getSequence(seq)!
    return `${PROJECT_DIRS.conti(s.ep, s.seq)}/exports`
  }

  /** 같은 시퀀스 출력은 한 번에 하나씩 — 연타해도 버전 번호가 겹치지 않게 */
  private locks = new Map<string, Promise<unknown>>()

  export(seq: string, kind: ExportKind, o: { status?: string; templateId?: string } = {}): Promise<ExportResult> {
    const prev = this.locks.get(seq) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(() => this.exportNow(seq, kind, o))
    this.locks.set(seq, next)
    return next
  }

  private async exportNow(seq: string, kind: ExportKind, o: { status?: string; templateId?: string }): Promise<ExportResult> {
    const t0 = Date.now()
    if (kind === 'animatic') return this.exportAnimatic(seq, t0)
    const t = await this.resolveTemplate(o.templateId)
    const probe = await this.build(seq, t, { status: o.status })
    const key = sha256(`${kind}:${probe.key}`)
    const ver = await this.version(seq, kind, key)
    if (ver.reuse) return { files: ver.reuse.files, version: ver.n, reused: true, ms: Date.now() - t0, pages: ver.reuse.pages }
    const r = await this.build(seq, t, { status: o.status, versionLabel: `v${ver.n}` })
    const dir = this.exportsDir(seq)
    const root = this.requireStore().root
    await mkdir(absPath(root, dir), { recursive: true })
    const files = kind === 'pdf' ? [await this.printPdf(r.html, r.pageMm, `${dir}/${seq}_conti_v${ver.n}.pdf`)] : await this.capturePngs(r.html, r.pageMm, r.pages, (i) => `${dir}/${seq}_conti_v${ver.n}_p${String(i + 1).padStart(2, '0')}.png`)
    const rec: ExportRecord = { kind, v: ver.n, key, files, at: Date.now(), pages: r.pages, templateId: t.meta.id }
    await this.record(seq, kind, rec)
    return { files, version: ver.n, reused: false, ms: Date.now() - t0, pages: r.pages }
  }

  /** 숨은 창에 HTML 을 띄우고 폰트·이미지가 다 올 때까지 기다린다. */
  private async withPage<T>(html: string, pageMm: [number, number], fn: (win: BrowserWindow, px: { w: number; h: number }) => Promise<T>): Promise<T> {
    const w = Math.round(pageMm[0] * PX_PER_MM)
    const h = Math.round(pageMm[1] * PX_PER_MM)
    const tmp = join(tmpdir(), `nyx-layout-${randomUUID()}.html`)
    await writeFile(tmp, html)
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    try {
      await win.loadFile(tmp)
      await win.webContents.executeJavaScript(
        `Promise.all([document.fonts.ready, ...Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r }))]).then(() => document.querySelectorAll('.page').length)`,
      )
      return await fn(win, { w, h })
    } finally {
      win.destroy()
      await rm(tmp, { force: true })
    }
  }

  private async printPdf(html: string, pageMm: [number, number], rel: string): Promise<string> {
    const buf = await this.withPage(html, pageMm, (win) =>
      win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: { width: pageMm[0] / 25.4, height: pageMm[1] / 25.4 } }),
    )
    await writeAtomic(absPath(this.requireStore().root, rel), buf)
    return rel
  }

  /** 페이지별 2x PNG — 각 페이지로 스크롤해 창 크기만큼 캡처 (deviceScaleFactor 2 로 고정 → 기기와 무관하게 같은 픽셀) */
  private async capturePngs(html: string, pageMm: [number, number], pages: number, relOf: (i: number) => string): Promise<string[]> {
    const root = this.requireStore().root
    const r = await this.capturePages(html, pageMm, pages, async (i, png) => {
      const rel = relOf(i)
      await writeAtomic(absPath(root, rel), png)
      return rel
    })
    return r.files
  }

  /** 캡처 + 페이지마다 패널 칸 위치(0..1) — 뷰어가 PNG 위에 클릭 영역을 만든다 */
  private async capturePages(html: string, pageMm: [number, number], pages: number, write: (i: number, png: Buffer) => Promise<string>): Promise<{ files: string[]; rects: PageRects[] }> {
    return this.withPage(html, pageMm, async (win, px) => {
      win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: px.w, height: px.h }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 2, viewSize: { width: px.w, height: px.h }, scale: 1 })
      await new Promise((r) => setTimeout(r, 120))
      const files: string[] = []
      const rects: PageRects[] = []
      for (let i = 0; i < pages; i++) {
        const rs = (await win.webContents.executeJavaScript(`(() => {
          const p = document.querySelectorAll('.page')[${i}]
          window.scrollTo(0, p.offsetTop)
          const pr = p.getBoundingClientRect()
          return [...p.querySelectorAll('[data-shot]')].map((c) => {
            const r = c.getBoundingClientRect()
            return { shotNo: c.getAttribute('data-shot'), panelIndex: Number(c.getAttribute('data-panel') || 0), label: (c.querySelector('.no')?.textContent || c.getAttribute('data-shot') || '').trim(),
              x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }
          })
        })()`)) as PageRects
        await new Promise((r) => setTimeout(r, 80))
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: px.w, height: px.h })
        if (img.isEmpty()) throw new Error('페이지 캡처가 비었습니다 (숨은 창 렌더 실패)')
        files.push(await write(i, img.toPNG()))
        rects.push(rs.map((r) => ({ ...r, x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) })))
      }
      return { files, rects }
    })
  }

  /**
   * 게시 번들 — 임시 폴더에 pages/*.png(2x) + conti.pdf + panels/*.jpg + (영상이면) video/proxy.mp4 + manifest 재료.
   * 파일은 내용이 같으면 해시가 같아 서버가 다시 받지 않는다.
   */
  async exportBundle(seq: string, o: { label: string; status: string; templateId?: string }): Promise<BundleDraft> {
    const store = this.requireStore()
    const s = store.getSequence(seq)
    if (!s) throw new Error(`시퀀스 없음: ${seq}`)
    const t = await this.resolveTemplate(o.templateId)
    const r = await this.build(seq, t, { status: o.status, versionLabel: o.label })
    const dir = await mkdtemp(join(tmpdir(), 'nyx-bundle-'))
    const files: BundleDraft['files'] = []
    const add = async (path: string, abs: string, type: string) => {
      const buf = await readFile(abs)
      files.push({ path, abs, size: buf.length, sha256: sha256(buf), type })
    }
    await mkdir(join(dir, 'pages'), { recursive: true })
    const cap = await this.capturePages(r.html, r.pageMm, r.pages, async (i, png) => {
      const name = `pages/p${String(i + 1).padStart(2, '0')}.png`
      await writeFile(join(dir, name), png)
      return name
    })
    const pxW = Math.round(r.pageMm[0] * PX_PER_MM * 2)
    const pxH = Math.round(r.pageMm[1] * PX_PER_MM * 2)
    for (const f of cap.files) await add(f, join(dir, f), 'image/png')
    const pdfBuf = await this.withPage(r.html, r.pageMm, (win) => win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: { width: r.pageMm[0] / 25.4, height: r.pageMm[1] / 25.4 } }))
    await writeFile(join(dir, 'conti.pdf'), pdfBuf)
    await add('conti.pdf', join(dir, 'conti.pdf'), 'application/pdf')
    // 패널 이미지 (현재 버전, 긴 변 1280 JPEG)
    await mkdir(join(dir, 'panels'), { recursive: true })
    const assets = (await store.listAssets(s.ep)).assets
    const nameOf = (tag: string) => assets.find((a) => a.tag === tag)?.nameKo || tag.replace(/^@(loc_|prop_)?/, '')
    const panels: BundleDraft['panels'] = []
    for (const shot of s.shots.filter((x) => !x.deleted)) {
      const subs = shot.panels.length ? shot.panels : [undefined]
      for (const [i, p] of subs.entries()) {
        const all = p?.versions.conti ?? []
        const v = (i === 0 && shot.stages.conti.currentVersionId && shot.panels.flatMap((x) => x.versions.conti).find((x) => x.id === shot.stages.conti.currentVersionId)) || [...all].sort((a, b) => b.n - a.n)[0]
        const label = subs.length > 1 ? `${shot.no}-${i + 1}` : shot.no
        let file: string | undefined
        if (v && existsSync(absPath(store.root, v.file))) {
          const img = nativeImage.createFromPath(absPath(store.root, v.file))
          if (!img.isEmpty()) {
            const { width, height } = img.getSize()
            const scaled = Math.max(width, height) > 1280 ? img.resize(width >= height ? { width: 1280, quality: 'good' } : { height: 1280, quality: 'good' }) : img
            file = `panels/${label}.jpg`
            await writeFile(join(dir, file), scaled.toJPEG(85))
            await add(file, join(dir, file), 'image/jpeg')
          }
        }
        const dur = shot.tc ? (shot.tc.outMs - shot.tc.inMs) / 1000 : (shot.durationSec ?? undefined)
        panels.push({
          shotNo: shot.no,
          panelIndex: i,
          label,
          file,
          size: shot.sizeCode,
          angle: shot.angle,
          cameraMove: shot.cameraMove,
          duration: dur ? `${Math.round(dur * 10) / 10}s` : undefined,
          tc: shot.tc ? `${fmtTc(shot.tc.inMs)} – ${fmtTc(shot.tc.outMs)}` : undefined,
          action: (i === 0 ? shot.actionKo : p?.captionKo || shot.actionKo) || [shot.characters.map(nameOf).join(', ')].filter(Boolean).join(''),
          dialogue: i === 0 ? shot.dialogue.map((d) => ({ speaker: d.speaker, text: d.text })) : undefined,
        })
      }
    }
    // 영상 입력이면 재생용 프록시 + EDL
    let video: BundleDraft['video']
    let edl: BundleDraft['edl']
    if (s.source.kind === 'video' && s.source.proxy && existsSync(absPath(store.root, s.source.proxy))) {
      await add('video/proxy.mp4', absPath(store.root, s.source.proxy), 'video/mp4')
      const live = s.shots.filter((x) => !x.deleted && x.tc)
      edl = live.map((x) => ({ shotNo: x.no, inMs: x.tc!.inMs, outMs: x.tc!.outMs }))
      // 실제 fps (원본 등록부) — 타임코드 코멘트를 프레임으로 바꿀 때 쓴다
      let fps = 24
      try {
        const reg = JSON.parse(await readFile(absPath(store.root, `${PROJECT_DIRS.state}/sources.json`), 'utf8')) as Array<{ id: string; files: Array<{ probe?: { fps?: number } }> }>
        fps = Math.round((reg.find((x) => x.id === s.source.sourceId)?.files[0]?.probe?.fps ?? 24) * 1000) / 1000 || 24
      } catch {
        /* 등록부 없음 → 24 */
      }
      video = { file: 'video/proxy.mp4', fps, duration: (live[live.length - 1]?.tc?.outMs ?? 0) / 1000 }
    }
    return {
      dir,
      files,
      pages: cap.files.map((f, i) => ({ n: i + 1, file: f, w: pxW, h: pxH, panels: cap.rects[i] })),
      panels,
      pdf: 'conti.pdf',
      video,
      edl,
      heading: s.headingKo || s.seq,
      ep: s.ep,
    }
  }

  private async exportAnimatic(seq: string, t0: number): Promise<ExportResult> {
    const store = this.requireStore()
    const s = store.getSequence(seq)
    if (!s) throw new Error(`시퀀스 없음: ${seq}`)
    const ffmpeg = await findBin('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg 가 없습니다 — `brew install ffmpeg` 후 다시 시도하세요')
    const root = store.root
    const blankRel = `${PROJECT_DIRS.state}/cache/blank_1920x1080.png`
    if (!(await this.exists(blankRel))) await writeAtomic(absPath(root, blankRel), solidPng(1920, 1080))
    const items = s.shots
      .filter((x) => !x.deleted)
      .map((shot) => {
        const all = shot.panels.flatMap((p) => p.versions.conti)
        const v = (shot.stages.conti.currentVersionId && all.find((x) => x.id === shot.stages.conti.currentVersionId)) || [...all].sort((a, b) => b.n - a.n)[0]
        return { rel: v?.file ?? blankRel, durationSec: shotDuration(shot), sha: v?.sha256 ?? v?.id ?? 'blank' }
      })
    if (!items.length) throw new Error('샷이 없습니다')
    const key = sha256(JSON.stringify(items))
    const ver = await this.version(seq, 'animatic', key)
    if (ver.reuse) return { files: ver.reuse.files, version: ver.n, reused: true, ms: Date.now() - t0, pages: 0 }
    const dir = this.exportsDir(seq)
    await mkdir(absPath(root, dir), { recursive: true })
    const rel = `${dir}/${seq}_animatic_v${ver.n}.mp4`
    const totalSec = items.reduce((n, i) => n + i.durationSec, 0)
    const list = join(tmpdir(), `nyx-animatic-${randomUUID()}.txt`)
    await writeFile(list, concatList(items.map((i) => ({ absImage: absPath(root, i.rel), durationSec: i.durationSec }))))
    try {
      try {
        await run(ffmpeg, animaticArgs({ listFile: list, outFile: absPath(root, rel), totalSec }))
      } catch (e) {
        if (!/libx264|Unknown encoder/i.test((e as Error).message)) throw e
        await run(ffmpeg, animaticArgs({ listFile: list, outFile: absPath(root, rel), codec: 'mpeg4', totalSec }))
      }
    } finally {
      await rm(list, { force: true })
    }
    const rec: ExportRecord = { kind: 'animatic', v: ver.n, key, files: [rel], at: Date.now(), pages: 0 }
    await this.record(seq, 'animatic', rec)
    return { files: [rel], version: ver.n, reused: false, ms: Date.now() - t0, pages: 0 }
  }

  reveal(rel: string) {
    const s = this.requireStore()
    shell.showItemInFolder(absPath(s.root, rel))
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 실패 (exit ${code}): ${err.trim().split('\n').slice(-3).join(' / ')}`))))
  })
}
