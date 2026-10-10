import type { Api, StoreChange } from '../shared/ipc'
import type { AgentApi, AgentUiEvent } from '../shared/agent-ipc'
import type { AuthApi, AuthEvent } from '../shared/auth-ipc'
import type { LayoutApi } from '../shared/layout-ipc'
import type { VideoApi, VideoProgress } from '../shared/video-ipc'
import type { PublishApi, PublishProgress } from '../shared/publish-ipc'
import type { AppApi, UpdateInfo } from '../shared/app-ipc'

export {}

declare global {
  interface Window {
    conti: {
      platform: NodeJS.Platform
      version: string
      api: Api
      agent: AgentApi
      auth: AuthApi
      layout: LayoutApi
      video: VideoApi
      publish: PublishApi
      app: AppApi
      onUpdate(fn: (u: UpdateInfo) => void): () => void
      onPublishProgress(fn: (p: PublishProgress) => void): () => void
      onFeedbackChange(fn: (e: { added: number; open?: number }) => void): () => void
      onVideoProgress(fn: (p: VideoProgress) => void): () => void
      onLayoutChange(fn: (e: { file: string }) => void): () => void
      onAuthEvent(fn: (e: AuthEvent) => void): () => void
      onStoreChange(fn: (c: StoreChange) => void): () => void
      onAgentEvent(fn: (e: AgentUiEvent) => void): () => void
    }
  }
}
