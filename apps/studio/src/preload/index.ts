import { contextBridge, ipcRenderer } from 'electron'
import type { Api, StoreChange } from '../shared/ipc'
import type { AgentApi, AgentUiEvent } from '../shared/agent-ipc'
import type { AuthApi, AuthEvent } from '../shared/auth-ipc'
import type { LayoutApi } from '../shared/layout-ipc'
import type { VideoApi, VideoProgress } from '../shared/video-ipc'
import type { PublishApi, PublishProgress } from '../shared/publish-ipc'
import type { AppApi, UpdateInfo } from '../shared/app-ipc'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: Api = {
  project: {
    openDialog: () => invoke('project:openDialog'),
    createDialog: (init) => invoke('project:createDialog', init),
    openPath: (root) => invoke('project:openPath', root),
    current: () => invoke('project:current'),
    recent: () => invoke('project:recent'),
    close: () => invoke('project:close'),
    busy: () => invoke('project:busy'),
    forgetRecent: (root) => invoke('project:forgetRecent', root),
    setDefaults: (patch) => invoke('project:setDefaults', patch),
  },
  sequence: {
    list: () => invoke('sequence:list'),
    get: (seq) => invoke('sequence:get', seq),
    updateShot: (seq, shotId, patch) => invoke('sequence:updateShot', seq, shotId, patch),
    setCurrentVersion: (seq, shotId, versionId) => invoke('sequence:setCurrentVersion', seq, shotId, versionId),
    setAnnotations: (seq, shotId, panelIndex, annotations) => invoke('sequence:setAnnotations', seq, shotId, panelIndex, annotations),
  },
  screenplay: {
    importDialog: () => invoke('screenplay:importDialog'),
    commit: (sourceId, picks) => invoke('screenplay:commit', sourceId, picks),
    sources: () => invoke('screenplay:sources'),
    open: (rel) => invoke('screenplay:open', rel),
  },
  assets: {
    list: (ep) => invoke('assets:list', ep),
  },
  md: {
    pending: () => invoke('md:pending'),
    accept: (rel) => invoke('md:accept', rel),
    discard: (rel) => invoke('md:discard', rel),
  },
  diag: {
    tools: () => invoke('diag:tools'),
  },
}

const agent: AgentApi = {
  availability: () => invoke('agent:availability'),
  threads: () => invoke('agent:threads'),
  history: (id) => invoke('agent:history', id),
  open: (opts) => invoke('agent:open', opts),
  send: (id, text, ctx) => invoke('agent:send', id, text, ctx),
  interrupt: (id) => invoke('agent:interrupt', id),
  close: (id) => invoke('agent:close', id),
  spendList: () => invoke('agent:spendList'),
  spendDecide: (id, d, n, engine) => invoke('agent:spendDecide', id, d, n, engine),
  spendPreview: (id, n, engine) => invoke('agent:spendPreview', id, n, engine),
  requestSpend: (kind, args) => invoke('agent:requestSpend', kind, args),
  jobs: (requestId) => invoke('agent:jobs', requestId),
  jobResubmit: (id) => invoke('agent:jobResubmit', id),
  runTask: (task, seq) => invoke('agent:runTask', task, seq),
}

const layout: LayoutApi = {
  templates: () => invoke('layout:templates'),
  render: (seq, opts) => invoke('layout:render', seq, opts),
  export: (seq, kind, opts) => invoke('layout:export', seq, kind, opts),
  history: (seq) => invoke('layout:history', seq),
  reveal: (rel) => invoke('layout:reveal', rel),
  setTemplate: (id) => invoke('layout:setTemplate', id),
  duplicate: (id, name) => invoke('layout:duplicate', id, name),
  openFolder: (id) => invoke('layout:openFolder', id),
}

const video: VideoApi = {
  pick: (kind) => invoke('video:pick', kind),
  suggest: () => invoke('video:suggest'),
  import: (o) => invoke('video:import', o),
}

const publish: PublishApi = {
  settings: () => invoke('publish:settings'),
  saveSettings: (url, token) => invoke('publish:saveSettings', url, token),
  test: () => invoke('publish:test'),
  publish: (seq, o) => invoke('publish:publish', seq, o),
  history: (seq, refresh) => invoke('publish:history', seq, refresh),
  revoke: (id) => invoke('publish:revoke', id),
  feedback: (f) => invoke('feedback:list', f),
  pull: () => invoke('feedback:pull'),
  updateFeedback: (id, state, note) => invoke('feedback:update', id, state, note),
  applyWithAi: (seq, ids) => invoke('feedback:applyWithAi', seq, ids),
}

const appApi: AppApi = {
  version: () => invoke('app:version'),
  settings: () => invoke('app:settings'),
  setSettings: (patch) => invoke('app:setSettings', patch),
  checkUpdate: () => invoke('app:checkUpdate'),
  openDownload: (url) => invoke('app:openDownload', url),
  exportDiagnostics: () => invoke('app:exportDiagnostics'),
}

const auth: AuthApi = {
  status: () => invoke('auth:status'),
  login: (tool, opts) => invoke('auth:login', tool, opts),
  pasteCode: (tool, code) => invoke('auth:pasteCode', tool, code),
  cancel: (tool) => invoke('auth:cancel', tool),
  logout: (tool) => invoke('auth:logout', tool),
  openUrl: (url) => invoke('auth:openUrl', url),
}

contextBridge.exposeInMainWorld('conti', {
  platform: process.platform,
  version: '0.0.1',
  api,
  agent,
  auth,
  layout,
  video,
  publish,
  app: appApi,
  onMenu(fn: (action: 'new-project' | 'settings') => void) {
    const a = () => fn('new-project')
    const b = () => fn('settings')
    ipcRenderer.on('menu:new-project', a)
    ipcRenderer.on('menu:settings', b)
    return () => {
      ipcRenderer.removeListener('menu:new-project', a)
      ipcRenderer.removeListener('menu:settings', b)
    }
  },
  onUpdate(fn: (u: UpdateInfo) => void) {
    const handler = (_e: unknown, u: UpdateInfo) => fn(u)
    ipcRenderer.on('app:update', handler)
    return () => ipcRenderer.removeListener('app:update', handler)
  },
  onPublishProgress(fn: (p: PublishProgress) => void) {
    const handler = (_e: unknown, p: PublishProgress) => fn(p)
    ipcRenderer.on('publish:progress', handler)
    return () => ipcRenderer.removeListener('publish:progress', handler)
  },
  onFeedbackChange(fn: (e: { added: number; open?: number }) => void) {
    const handler = (_e: unknown, p: { added: number; open?: number }) => fn(p)
    ipcRenderer.on('feedback:changed', handler)
    return () => ipcRenderer.removeListener('feedback:changed', handler)
  },
  onVideoProgress(fn: (p: VideoProgress) => void) {
    const handler = (_e: unknown, p: VideoProgress) => fn(p)
    ipcRenderer.on('video:progress', handler)
    return () => ipcRenderer.removeListener('video:progress', handler)
  },
  onLayoutChange(fn: (e: { file: string }) => void) {
    const handler = (_e: unknown, ev: { file: string }) => fn(ev)
    ipcRenderer.on('layout:changed', handler)
    return () => ipcRenderer.removeListener('layout:changed', handler)
  },
  onAuthEvent(fn: (e: AuthEvent) => void) {
    const handler = (_e: unknown, ev: AuthEvent) => fn(ev)
    ipcRenderer.on('auth:event', handler)
    return () => ipcRenderer.removeListener('auth:event', handler)
  },
  onAgentEvent(fn: (e: AgentUiEvent) => void) {
    const handler = (_e: unknown, ev: AgentUiEvent) => fn(ev)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
  onStoreChange(fn: (c: StoreChange) => void) {
    const handler = (_e: unknown, c: StoreChange) => fn(c)
    ipcRenderer.on('store:change', handler)
    return () => ipcRenderer.removeListener('store:change', handler)
  },
})
