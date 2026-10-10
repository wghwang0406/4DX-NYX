// 맥 메뉴 막대 — 파일(프로젝트 열기·최근·새로·닫기), 편집(복사·붙여넣기 — 직접 메뉴를 만들면 이게 없어서 입력란 단축키가 죽는다), 보기, 창.
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export interface MenuActions {
  open(): void
  openRecent(root: string): void
  newProject(): void
  close(): void
  settings(): void
  recent(): Promise<Array<{ root: string; title: string; code: string }>>
  current(): string | null
}

export async function buildMenu(a: MenuActions, getWindow: () => BrowserWindow | null) {
  const recent = (await a.recent()).filter((r) => r.root !== a.current()).slice(0, 8)
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `${app.name} 정보` },
              { type: 'separator' },
              { label: '설정…', accelerator: 'Cmd+,', click: () => a.settings() },
              { type: 'separator' },
              { role: 'hide', label: `${app.name} 숨기기` },
              { role: 'hideOthers', label: '기타 숨기기' },
              { role: 'unhide', label: '모두 보기' },
              { type: 'separator' },
              { role: 'quit', label: `${app.name} 종료` },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '파일',
      submenu: [
        { label: '새 프로젝트…', accelerator: 'CmdOrCtrl+Shift+N', click: () => a.newProject() },
        { label: '프로젝트 열기…', accelerator: 'CmdOrCtrl+O', click: () => a.open() },
        {
          label: '최근 프로젝트',
          enabled: recent.length > 0,
          submenu: recent.length ? recent.map((r) => ({ label: `${r.title}  (${r.code})`, toolTip: r.root, click: () => a.openRecent(r.root) })) : [{ label: '없음', enabled: false }],
        },
        { type: 'separator' },
        { label: '프로젝트 닫기', accelerator: 'CmdOrCtrl+Shift+W', enabled: !!a.current(), click: () => a.close() },
        ...(isMac ? [] : ([{ type: 'separator' }, { label: '설정…', accelerator: 'Ctrl+,', click: () => a.settings() }, { role: 'quit', label: '종료' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '오려두기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'resetZoom', label: '실제 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu', label: '창' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  void getWindow
}
