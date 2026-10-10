import { app, BrowserWindow, net, protocol, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { absPath } from '@conti/core'
import { registerIpc } from './ipc'
import { installLogging } from './log'
import { existsSync as existsSyncFs } from 'node:fs'

// 프로젝트 안 이미지를 렌더러가 <img src="conti-file://project/EP01/Conti/S41/x.png"> 로 본다. 루트 밖은 거부.
protocol.registerSchemesAsPrivileged([{ scheme: 'conti-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }])

// 앱 이름 NYX — 데이터 폴더는 ~/Library/Application Support/NYX.
// 예전 개발 폴더(@conti/studio)만 있으면 그 자리를 그대로 쓴다 (옮기지 않음 — 다른 창이 쓰고 있을 수 있고, uv·음성 모델 1.5GB 를 다시 받지 않게).
app.setName('NYX')
if (process.env.CONTI_USER_DATA) app.setPath('userData', process.env.CONTI_USER_DATA)
else {
  const appData = app.getPath('appData')
  const nyx = join(appData, 'NYX')
  const old = join(appData, '@conti', 'studio')
  // Chromium 이 시작하자마자 NYX 폴더(캐시 등)를 만들어 버리므로 "폴더가 있나"가 아니라 "앱 데이터가 있나"로 판단한다
  const hasData = (d: string) => ['recent.json', 'settings.json', 'publish.json', 'py-env'].some((f) => existsSyncFs(join(d, f)))
  app.setPath('userData', !hasData(nyx) && hasData(old) ? old : nyx)
}
installLogging()

// 한 대에서 NYX 는 하나만 (같은 프로젝트를 두 창이 동시에 쓰면 단일 writer 가 깨진다). 검증 실행은 예외.
const testRun = Object.keys(process.env).some((k) => k.startsWith('CONTI_E2E') || k === 'CONTI_SCREENSHOT')
if (!testRun && !app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

// CONTI_SCREENSHOT=<png 경로> 로 띄우면 화면이 그려진 뒤 캡처해 저장하고 종료한다 (검증용).
const screenshotPath = process.env.CONTI_SCREENSHOT

let mainWindow: BrowserWindow | null = null
let ipcHandle: ReturnType<typeof registerIpc> | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1100,
    minHeight: 700,
    title: 'NYX',
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + (testRun ? '?test=1' : ''))
  } else {
    // CONTI_NAV=<항목> 으로 시작 화면을 고를 수 있다 (캡처용)
    const query: Record<string, string> = testRun ? { test: '1' } : {}
    if (process.env.CONTI_ONBOARDING) query.onboarding = '1'
    if (process.env.CONTI_NAV) query.nav = process.env.CONTI_NAV
    if (process.env.CONTI_SHOT) query.shot = process.env.CONTI_SHOT
    if (process.env.CONTI_SEQ) query.seq = process.env.CONTI_SEQ
    if (process.env.CONTI_LAB) query.lab = '1'
    if (process.env.CONTI_VIDEO_UI) query.video = '1'
    if (process.env.CONTI_SETTINGS) query.settings = process.env.CONTI_SETTINGS
    void win.loadFile(join(__dirname, '../renderer/index.html'), Object.keys(query).length ? { query } : undefined)
  }

  // CONTI_E2E_PROMPT: 화면이 뜬 뒤 AI 에 한 턴 보내고 결과를 CONTI_E2E_OUT 에 JSON 으로 저장, 캡처 후 종료
  const e2ePrompt = process.env.CONTI_E2E_PROMPT
  if (e2ePrompt) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await ipcHandle!.e2e(e2ePrompt, process.env.CONTI_E2E_SEQ)
          await writeFile(process.env.CONTI_E2E_OUT ?? '/tmp/conti-e2e.json', JSON.stringify(r, null, 2))
        } catch (e) {
          await writeFile(process.env.CONTI_E2E_OUT ?? '/tmp/conti-e2e.json', JSON.stringify({ error: String(e) }))
        }
        if (screenshotPath) {
          await new Promise((r) => setTimeout(r, 800))
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_SWITCH) {
    // 프로젝트 전환: 사이드바 메뉴 열기(캡처) → 최근 목록의 다른 프로젝트 클릭 → 확인 → 닫기 → 시작 화면
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-switch.json'
        const shots = process.env.CONTI_E2E_SHOTDIR ?? '/tmp'
        const js = (c: string) => win.webContents.executeJavaScript(c)
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
        const r: Record<string, unknown> = {}
        try {
          r.before = ipcHandle!.currentRoot()
          r.menu = await js(`(() => { const b = document.querySelector('[title$="프로젝트 바꾸기"]'); if (!b) return 'no button'; b.click(); return 'ok' })()`)
          await wait(600)
          await writeFile(join(shots, 'switch_menu.png'), (await win.webContents.capturePage()).toPNG())
          const target = process.env.CONTI_E2E_SWITCH!
          r.click = await js(`(() => { const b = [...document.querySelectorAll('button[title]')].find((x) => x.title === ${JSON.stringify(target)}); if (!b) return 'no recent'; b.click(); return 'ok' })()`)
          await wait(2500)
          r.after = ipcHandle!.currentRoot()
          r.sidebarTitle = await js(`document.querySelector('[title$="프로젝트 바꾸기"]')?.textContent ?? ''`)
          await writeFile(join(shots, 'switch_after.png'), (await win.webContents.capturePage()).toPNG())
          // 닫기
          await js(`document.querySelector('[title$="프로젝트 바꾸기"]').click()`)
          await wait(400)
          r.closeClick = await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('프로젝트 닫기')); if (!b) return 'no close'; b.click(); return 'ok' })()`)
          await wait(1500)
          r.closed = ipcHandle!.currentRoot()
          r.startScreen = await js(`document.body.textContent.includes('프로젝트 폴더를 열거나 새로 만듭니다')`)
        } catch (e) {
          r.error = String((e as Error).stack ?? e)
        }
        await writeFile(out, JSON.stringify(r, null, 2))
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_QA7) {
    // M7: 진단 내보내기 + 새 버전 알림(사내 서버 latest) + 설정 저장
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-qa7.json'
        const r: Record<string, unknown> = {}
        try {
          const h = ipcHandle!
          if (process.env.CONTI_E2E_SERVER) await h.publish.saveSettings(process.env.CONTI_E2E_SERVER, process.env.CONTI_E2E_TOKEN)
          r.update = await h.appInfo.checkUpdate()
          r.settings = await h.appInfo.setSettings({ onboarded: true, onboardedAt: 1 })
          r.diag = await h.appInfo.exportDiagnostics(process.env.CONTI_E2E_DIAGDIR ?? '/tmp')
          await new Promise((res) => setTimeout(res, 1500))
          if (screenshotPath) await writeFile(screenshotPath, (await win.webContents.capturePage()).toPNG())
        } catch (e) {
          r.error = String((e as Error).stack ?? e)
        }
        await writeFile(out, JSON.stringify(r, null, 2))
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_QA6) {
    // M6: 게시 → 리뷰어(브라우저 창)가 0030 에 코멘트 → 스튜디오가 가져옴 → 반영 → v2 게시 → "v2에서 반영됨"
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-qa6.json'
        const shots = process.env.CONTI_E2E_SHOTDIR ?? '/tmp'
        const seq = process.env.CONTI_E2E_QA6!
        const target = process.env.CONTI_E2E_TARGET ?? '0030'
        const r: Record<string, unknown> = {}
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))
        const pub = ipcHandle!.publish
        let viewer: BrowserWindow | null = null
        try {
          await pub.saveSettings(process.env.CONTI_E2E_SERVER!, process.env.CONTI_E2E_TOKEN!)
          r.test = await pub.test()
          const t1 = Date.now()
          const v1 = await pub.publish(seq, { status: '컨펌용' })
          r.v1 = { ...v1, ms: Date.now() - t1 }
          // 리뷰어 = 별도 브라우저 창 (앱과 세션 분리)
          viewer = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { partition: 'reviewer' } })
          const vjs = (code: string) => viewer!.webContents.executeJavaScript(code)
          await viewer.loadURL(v1.url)
          await vjs(`localStorage.setItem('nyx_name', '김감독'); location.reload(); true`)
          await wait(1800)
          // 시트의 0030 칸 가운데를 누른다 (pointer 이벤트)
          r.click = await vjs(`(async () => {
            const pages = [...document.querySelectorAll('.page')]
            for (const pg of pages) {
              const hot = [...pg.querySelectorAll('.hot')].find((h) => true && h.style && pg.querySelector('img'))
            }
            const data = await (await fetch('/api/r/' + location.pathname.split('/')[2])).json()
            const pi = data.manifest.pages.findIndex((p) => p.panels.some((x) => x.shotNo === '${target}'))
            if (pi < 0) return 'no panel'
            const rect = data.manifest.pages[pi].panels.find((x) => x.shotNo === '${target}')
            const pg = document.querySelectorAll('.page')[pi]
            pg.scrollIntoView()
            await new Promise((r) => setTimeout(r, 300))
            const b = pg.getBoundingClientRect()
            const x = b.left + (rect.x + rect.w / 2) * b.width, y = b.top + (rect.y + rect.h / 2) * b.height
            const ev = (type) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 })
            pg.dispatchEvent(ev('pointerdown')); pg.dispatchEvent(ev('pointerup'))
            await new Promise((r) => setTimeout(r, 300))
            const ta = document.querySelector('.composer textarea')
            if (!ta) return 'no composer'
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
            set.call(ta, '너무 멀어요, 얼굴이 안 보여요. 바스트로 당겨 주세요.')
            ta.dispatchEvent(new Event('input', { bubbles: true }))
            await new Promise((r) => setTimeout(r, 100))
            ;[...document.querySelectorAll('.composer button')].find((b) => b.textContent.includes('남기기')).click()
            await new Promise((r) => setTimeout(r, 800))
            return document.querySelector('.composer') ? 'composer still open' : 'ok'
          })()`)
          await wait(500)
          await writeFile(join(shots, 'qa6_reviewer_v1.png'), (await viewer.webContents.capturePage()).toPNG())
          // 영상 시각 코멘트도 (영상 게시본일 때)
          // 스튜디오가 가져온다
          r.pull = await pub.pull()
          const items = await pub.list({ seq })
          r.inbox = items.map((i) => ({ shotNo: i.shotNo, kind: i.kind, text: i.text, author: i.author, state: i.state, label: i.label }))
          const it = items.find((i) => i.shotNo === target && i.kind !== 'verdict')
          if (!it) throw new Error('코멘트가 스튜디오에 안 왔습니다')
          // 반영 (AI 단계 대신 같은 결과: 샷사이즈를 바꾸고 applied 표시)
          const store = ipcHandle!.storeSnapshot(seq)!
          const shot = store.shots.find((x) => x.no === target)!
          await ipcHandle!.agentHost()!.updateShotForTest(seq, shot.id, { sizeCode: 'MCU' })
          r.applied = await pub.update(it.commentId, 'applied', { note: `${target} → 바스트(MCU)` })
          const t2 = Date.now()
          const v2 = await pub.publish(seq, { status: '컨펌용' })
          r.v2 = { ...v2, ms: Date.now() - t2 }
          r.after = (await pub.list({ seq, state: 'all' })).filter((i) => i.commentId === it.commentId).map((i) => ({ state: i.state, resolvedIn: i.resolvedIn, pendingSync: i.pendingSync }))
          await viewer.loadURL(v2.url)
          await wait(1800)
          r.viewerV2 = await vjs(`[...document.querySelectorAll('.link')].find((b) => b.textContent === '전체')?.click(), new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.done')].map((d) => d.textContent)), 500))`)
          await writeFile(join(shots, 'qa6_reviewer_v2.png'), (await viewer.webContents.capturePage()).toPNG())
          r.history = (await pub.refreshHistory(seq)).map((h) => ({ label: h.label, comments: h.comments, archive: h.archive.status }))
        } catch (e) {
          r.error = String((e as Error).stack ?? e)
        }
        viewer?.destroy()
        await writeFile(out, JSON.stringify(r, null, 2))
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_QA5) {
    // M5 QA: 영상 재생(프록시·Range)·탐색·재생 진행, 다시 그리기 요청(승인 안 함 = 크레딧 0), 재가져오기 캐시
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-qa5.json'
        const seq = process.env.CONTI_E2E_QA5!
        const r: Record<string, unknown> = {}
        const js = (code: string) => win.webContents.executeJavaScript(code)
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))
        try {
          const s = ipcHandle!.storeSnapshot(seq)!
          const proxy = s.source.proxy!
          const url = `conti-file://project/${proxy.split('/').map(encodeURIComponent).join('/')}`
          const full = await session.defaultSession.fetch(url)
          const part = await session.defaultSession.fetch(url, { headers: { range: 'bytes=1000-1999' } })
          r.range = { full: full.status, fullType: full.headers.get('content-type'), part: part.status, partLen: (await part.arrayBuffer()).byteLength, contentRange: part.headers.get('content-range') }
          await full.body?.cancel()
          await wait(1500)
          r.video0 = await js(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, w: v.videoWidth, dur: Math.round(v.duration*10)/10, t: v.currentTime, err: v.error && v.error.message } : null })()`)
          // 컷 선택 → 탐색
          const target = s.shots.find((x) => !x.deleted && (x.tc?.inMs ?? 0) > 5000) ?? s.shots[1]
          await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('${target.no}')); b && b.click(); return !!b })()`)
          await wait(1500)
          r.seek = { want: (target.tc?.inMs ?? 0) / 1000, video: await js(`(() => { const v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime*100)/100, ready: v.readyState, seeking: v.seeking } : null })()`) }
          // 재생 1.5초
          await js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`)
          await wait(1500)
          r.play = await js(`(() => { const v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime*100)/100, paused: v.paused } : null })()`)
          await js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`)
          // 다시 그리기 요청 (승인하지 않는다)
          const nos = s.shots.filter((x) => !x.deleted).slice(0, 2).map((x) => x.no)
          const req = await ipcHandle!.agentHost()!.requestSpend('panel_restyle', { seq, shotNos: nos })
          const prev = await ipcHandle!.agentHost()!.spendPreview(req.requestId)
          r.restyle = { count: req.count, status: req.status, items: prev.items.map((i) => ({ target: i.target, model: i.model, refs: i.refs })), promptHead: prev.items[0]?.prompt.split('\n')[0] }
          await ipcHandle!.agentHost()!.spendDecide(req.requestId, 'rejected')
          // 재가져오기 → 캐시 (AI 호출 0)
          if (process.env.CONTI_E2E_REIMPORT) {
            const t0 = Date.now()
            const again = await ipcHandle!.video.import({ kind: 'animatic', files: [process.env.CONTI_E2E_REIMPORT], seq, ep: s.ep, asr: true, ai: 'claude', overwrite: true })
            r.reimport = { ms: Date.now() - t0, ai: again.ai, cached: again.cached, shots: again.shots }
          }
        } catch (e) {
          r.error = String((e as Error).stack ?? e)
        }
        await writeFile(out, JSON.stringify(r, null, 2))
        if (screenshotPath) {
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 3000)
    })
  } else if (process.env.CONTI_E2E_VIDEO) {
    // CONTI_E2E_VIDEO=<파일[,파일…]> CONTI_E2E_KIND=animatic|clips|longtake|audio CONTI_E2E_SEQ=S10 CONTI_E2E_AI=none|claude|codex|auto CONTI_E2E_ASR=0|1
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-e2e-video.json'
        const stages: Array<[number, string, number | undefined]> = []
        const t0 = Date.now()
        const orig = win.webContents.send.bind(win.webContents)
        win.webContents.send = ((ch: string, payload: unknown) => {
          if (ch === 'video:progress') {
            const p = payload as { stage: string; progress?: number }
            if (!stages.length || stages[stages.length - 1][1] !== p.stage) stages.push([Date.now() - t0, p.stage, p.progress])
          }
          return orig(ch, payload)
        }) as typeof win.webContents.send
        let r: unknown
        try {
          r = await ipcHandle!.video.import({
            kind: (process.env.CONTI_E2E_KIND as never) ?? 'animatic',
            files: process.env.CONTI_E2E_VIDEO!.split(','),
            seq: process.env.CONTI_E2E_SEQ ?? 'S10',
            ep: 'EP01',
            headingKo: process.env.CONTI_E2E_HEADING,
            asr: process.env.CONTI_E2E_ASR !== '0',
            ai: (process.env.CONTI_E2E_AI as never) ?? 'none',
            overwrite: true,
          })
        } catch (e) {
          r = { error: String((e as Error).stack ?? e) }
        }
        await writeFile(out, JSON.stringify({ result: r, stages }, null, 2))
        if (screenshotPath) {
          await new Promise((res) => setTimeout(res, 1500))
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_QA4) {
    // M4 QA: 실제 UI 조작(길이 끌기·주석 그리기·재생) + main(템플릿 실시간 반영·프로토콜 보안·동시 출력)
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-qa4.json'
        const seq = process.env.CONTI_E2E_QA4!
        const r: Record<string, unknown> = {}
        const js = (code: string) => win.webContents.executeJavaScript(code)
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))
        const shotOf = (no: string) => ipcHandle!.storeSnapshot(seq)?.shots.find((x) => x.no === no)
        try {
          // 1) 프로토콜: 루트 밖 / 모르는 템플릿 / 폰트 CORS
          const f1 = await session.defaultSession.fetch('conti-file://project/..%2F..%2F..%2Fetc%2Fpasswd')
          const f2 = await session.defaultSession.fetch('conti-file://tpl/nope/style.css')
          const f3 = await session.defaultSession.fetch('conti-file://font/Pretendard-Regular.woff2')
          r.protocol = { escape: f1.status, unknownTpl: f2.status, font: f3.status, fontCors: f3.headers.get('access-control-allow-origin'), fontType: f3.headers.get('content-type') }
          // 2) 길이 끌기 (0010 오른쪽 끝을 +120px)
          const before = shotOf('0010')?.durationSec ?? null
          r.dragDom = await js(`(() => {
            const h = document.querySelectorAll('[role=separator]')[0]
            if (!h) return 'no handle'
            const b = h.getBoundingClientRect()
            const x = b.left + b.width / 2, y = b.top + b.height / 2
            h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }))
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 120, clientY: y }))
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 120, clientY: y }))
            return 'ok'
          })()`)
          await wait(700)
          r.drag = { before, after: shotOf('0010')?.durationSec ?? null }
          // 3) 주석 그리기: 0020 선택 → [주석] → 끌기
          await js(`document.querySelectorAll('[data-shot]').length`)
          r.selectDom = await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '0020'); if (!b) return 'no cut'; b.click(); return 'ok' })()`)
          await wait(300)
          r.annotateDom = await js(`(async () => {
            const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '주석')
            if (!btn) return 'no button'
            btn.click()
            await new Promise(r => setTimeout(r, 200))
            const ov = document.querySelector('.cursor-crosshair')
            if (!ov) return 'no overlay'
            const b = ov.getBoundingClientRect()
            const at = (fx, fy) => ({ bubbles: true, clientX: b.left + b.width * fx, clientY: b.top + b.height * fy })
            ov.dispatchEvent(new MouseEvent('mousedown', at(0.2, 0.7)))
            ov.dispatchEvent(new MouseEvent('mousemove', at(0.4, 0.6)))
            ov.dispatchEvent(new MouseEvent('mousemove', at(0.6, 0.5)))
            ov.dispatchEvent(new MouseEvent('mouseup', at(0.8, 0.4)))
            return 'ok'
          })()`)
          await wait(700)
          const ann = shotOf('0020')?.panels[0]?.annotations ?? []
          r.annotate = { count: ann.length, last: ann[ann.length - 1] }
          // 주석 닫기
          await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '닫기'); b?.click(); return !!b })()`)
          await wait(200)
          // 4) 재생: Space → 1.2초 → 시간 표시가 바뀌었는가
          const t0 = await js(`document.querySelector('[data-testid=player-time]')?.textContent ?? ''`)
          await js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`)
          await wait(1200)
          const t1 = await js(`document.querySelector('[data-testid=player-time]')?.textContent ?? ''`)
          await js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))`)
          r.play = { t0, t1 }
          // 5) 미리보기 iframe 안 패널 수
          r.previewCells = await js(`(() => { const f = document.querySelector('iframe[title=layout]'); return f?.contentDocument?.querySelectorAll('.cell[data-shot]').length ?? -1 })()`)
          // 6) Template Lab: 복제 → style.css 수정 → 변경 이벤트·렌더 반영
          const changes: string[] = []
          const orig = win.webContents.send.bind(win.webContents)
          win.webContents.send = ((ch: string, payload: unknown) => {
            if (ch === 'layout:changed') changes.push(JSON.stringify(payload))
            return orig(ch, payload)
          }) as typeof win.webContents.send
          const dup = await ipcHandle!.layout.duplicate('placeholder-a4-6up', 'qa lab', false)
          await wait(500)
          changes.length = 0
          const { appendFile } = await import('node:fs/promises')
          await appendFile(join(dup.dir, 'style.css'), '\n.seq{color:rgb(255,0,0)}\n')
          await wait(900)
          const rendered = await ipcHandle!.layout.render(seq, { templateId: dup.id })
          r.lab = { id: dup.id, events: changes.length, applied: rendered.html.includes('.seq{color:rgb(255,0,0)}') }
          await (await import('node:fs/promises')).rm(dup.dir, { recursive: true, force: true }) // 검증용 복제본은 지운다
          // 7) 동시 출력 2번 → 버전 겹치지 않음 (두 번째는 같은 내용이라 재사용)
          const [a, b] = await Promise.all([ipcHandle!.layout.export(seq, 'pdf', { status: 'QA' }), ipcHandle!.layout.export(seq, 'pdf', { status: 'QA' })])
          r.concurrent = { a: [a.version, a.reused], b: [b.version, b.reused] }
          // 8) 상태 표기만 바꿔도 새 버전
          const c = await ipcHandle!.layout.export(seq, 'pdf', { status: '컨펌용' })
          r.statusChange = [c.version, c.reused]
        } catch (e) {
          r.error = String((e as Error).stack ?? e)
        }
        await writeFile(out, JSON.stringify(r, null, 2))
        if (screenshotPath) {
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 3000)
    })
  } else if (process.env.CONTI_E2E_LAYOUT) {
    // CONTI_E2E_LAYOUT=<seq>: PDF → PNG → 애니매틱 출력 후 다시 PDF(재사용 확인), 결과 JSON 저장 후 종료
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-e2e-layout.json'
        const seq = process.env.CONTI_E2E_LAYOUT!
        const r: Record<string, unknown> = {}
        for (const k of ['pdf', 'png', 'animatic', 'pdf'] as const) {
          try {
            r[r[k] ? `${k}_again` : k] = await ipcHandle!.layout.export(seq, k)
          } catch (e) {
            r[r[k] ? `${k}_again` : k] = { error: String(e) }
          }
        }
        await writeFile(out, JSON.stringify(r, null, 2))
        if (screenshotPath) {
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 2500)
    })
  } else if (process.env.CONTI_E2E_GEN) {
    // CONTI_E2E_GEN=<seq>: 가짜 higgsfield(CONTI_HIGGSFIELD_BIN)로 생성 흐름을 끝까지 돌리고 결과·캡처 저장 후 종료
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = process.env.CONTI_E2E_OUT ?? '/tmp/conti-e2e-gen.json'
        try {
          const r = await ipcHandle!.e2eGenerate(process.env.CONTI_E2E_GEN!, Number(process.env.CONTI_E2E_N ?? 2), (process.env.CONTI_E2E_DECISION as 'approved' | 'pilot') ?? 'approved', Number(process.env.CONTI_E2E_WAIT_MS ?? 60000))
          await writeFile(out, JSON.stringify(r, null, 2))
        } catch (e) {
          await writeFile(out, JSON.stringify({ error: String(e) }))
        }
        if (screenshotPath) {
          await new Promise((r) => setTimeout(r, 1200))
          const img = await win.webContents.capturePage()
          await writeFile(screenshotPath, img.toPNG())
        }
        app.quit()
      }, 2500)
    })
  } else if (screenshotPath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        await writeFile(screenshotPath, img.toPNG())
        app.quit()
      }, 1500)
    })
  }

  return win
}

app.whenReady().then(async () => {
  const ipc = registerIpc(() => mainWindow)
  ipcHandle = ipc
  // conti-file://project/<rel> = 프로젝트 파일 / font/<file> = 번들 폰트 / tpl/<templateId>/<rel> = 템플릿 폴더 에셋.
  // 미리보기 iframe(srcdoc)·출력용 숨은 창(file://) 모두 다른 출처라 폰트를 읽으려면 CORS 헤더가 필요하다.
  protocol.handle('conti-file', async (req) => {
    const u = new URL(req.url)
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''))
    let base: string | undefined
    let sub = rel
    if (u.hostname === 'project') base = ipc.currentRoot() ?? undefined
    else if (u.hostname === 'font') base = ipc.layout.fontsDir()
    else if (u.hostname === 'tpl') {
      const [id, ...rest] = rel.split('/')
      base = ipc.layout.templateDir(id)
      sub = rest.join('/')
    }
    if (!base) return new Response('not found', { status: 404 })
    try {
      const file = absPath(base, sub)
      const range = req.headers.get('range')
      // <video> 탐색은 206 부분 응답이 필요하다 — net.fetch(file://) 는 Range 를 무시하고 200 을 준다 (QA M5 에서 발견)
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const size = (await stat(file)).size
        let start = m?.[1] ? Number(m[1]) : NaN
        let end = m?.[2] ? Number(m[2]) : size - 1
        if (Number.isNaN(start)) {
          start = Math.max(0, size - (Number(m?.[2]) || 0)) // bytes=-N (끝에서 N)
          end = size - 1
        }
        end = Math.min(end, size - 1)
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
        const stream = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(end - start + 1),
            'accept-ranges': 'bytes',
            'content-type': sub.endsWith('.mp4') ? 'video/mp4' : sub.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream',
            'access-control-allow-origin': '*',
          },
        })
      }
      const res = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('accept-ranges', 'bytes')
      headers.set('access-control-allow-origin', '*')
      if (sub.endsWith('.woff2')) headers.set('content-type', 'font/woff2')
      if (sub.endsWith('.mp4')) headers.set('content-type', 'video/mp4')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('forbidden', { status: 403 })
    }
  })
  // CONTI_OPEN=<프로젝트 폴더> 로 띄우면 시작 화면 없이 바로 연다 (개발·검증용)
  if (process.env.CONTI_OPEN) await ipc.openProject(process.env.CONTI_OPEN).catch((e) => console.error(e))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false
app.on('before-quit', (e) => {
  if (shuttingDown || !ipcHandle) return
  e.preventDefault()
  shuttingDown = true
  void ipcHandle.shutdown().finally(() => app.quit())
})
