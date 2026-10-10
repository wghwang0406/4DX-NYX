import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { absPath } from '@conti/core'
import { registerIpc } from './ipc'

// 프로젝트 안 이미지를 렌더러가 <img src="conti-file://project/EP01/Conti/S41/x.png"> 로 본다. 루트 밖은 거부.
protocol.registerSchemesAsPrivileged([{ scheme: 'conti-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }])

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
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // CONTI_NAV=<항목> 으로 시작 화면을 고를 수 있다 (캡처용)
    void win.loadFile(join(__dirname, '../renderer/index.html'), process.env.CONTI_NAV ? { query: { nav: process.env.CONTI_NAV } } : undefined)
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
  protocol.handle('conti-file', (req) => {
    const root = ipc.currentRoot()
    const u = new URL(req.url)
    if (!root || u.hostname !== 'project') return new Response('no project', { status: 404 })
    try {
      const rel = decodeURIComponent(u.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(absPath(root, rel)).toString())
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
