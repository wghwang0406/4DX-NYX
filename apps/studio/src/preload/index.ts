import { contextBridge, ipcRenderer } from 'electron'
import type { Api, StoreChange } from '../shared/ipc'
import type { AgentApi, AgentUiEvent } from '../shared/agent-ipc'
import type { AuthApi, AuthEvent } from '../shared/auth-ipc'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: Api = {
  project: {
    openDialog: () => invoke('project:openDialog'),
    createDialog: (init) => invoke('project:createDialog', init),
    openPath: (root) => invoke('project:openPath', root),
    current: () => invoke('project:current'),
    recent: () => invoke('project:recent'),
  },
  sequence: {
    list: () => invoke('sequence:list'),
    get: (seq) => invoke('sequence:get', seq),
    updateShot: (seq, shotId, patch) => invoke('sequence:updateShot', seq, shotId, patch),
    setCurrentVersion: (seq, shotId, versionId) => invoke('sequence:setCurrentVersion', seq, shotId, versionId),
  },
  screenplay: {
    importDialog: () => invoke('screenplay:importDialog'),
    commit: (sourceId, picks) => invoke('screenplay:commit', sourceId, picks),
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
  spendDecide: (id, d, n) => invoke('agent:spendDecide', id, d, n),
  spendPreview: (id, n) => invoke('agent:spendPreview', id, n),
  requestSpend: (kind, args) => invoke('agent:requestSpend', kind, args),
  jobs: (requestId) => invoke('agent:jobs', requestId),
  jobResubmit: (id) => invoke('agent:jobResubmit', id),
  runTask: (task, seq) => invoke('agent:runTask', task, seq),
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
