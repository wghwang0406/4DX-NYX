import type { Api, StoreChange } from '../shared/ipc'
import type { AgentApi, AgentUiEvent } from '../shared/agent-ipc'
import type { AuthApi, AuthEvent } from '../shared/auth-ipc'

export {}

declare global {
  interface Window {
    conti: {
      platform: NodeJS.Platform
      version: string
      api: Api
      agent: AgentApi
      auth: AuthApi
      onAuthEvent(fn: (e: AuthEvent) => void): () => void
      onStoreChange(fn: (c: StoreChange) => void): () => void
      onAgentEvent(fn: (e: AgentUiEvent) => void): () => void
    }
  }
}
