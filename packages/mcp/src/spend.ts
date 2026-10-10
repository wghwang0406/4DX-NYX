import { randomUUID } from 'node:crypto'

export type SpendKind = 'conti_generate' | 'assets_generate' | 'image_edit' | 'panel_restyle'
export type SpendStatus = 'awaiting_approval' | 'approved' | 'rejected' | 'pilot'
export type SpendDecision = Exclude<SpendStatus, 'awaiting_approval'>

export interface SpendRequest {
  requestId: string
  kind: SpendKind
  count: number
  status: SpendStatus
  createdAt: number
  resolvedAt?: number
  args: unknown
  /** 호스트가 판정하며 넘긴 옵션 (예: includeNeighbors — 파일럿 뒤 이웃 샷까지). */
  decisionOptions?: SpendDecisionOptions
  /** 승인했지만 계획·제출 단계에서 막힌 이유 (장수 상한, 레퍼런스 없음 등). status 는 rejected 로 돌아간다. */
  error?: string
  /** 파일럿 뒤 자동으로 만든 후속 요청이면 원 요청 id */
  parentRequestId?: string
}

export interface SpendDecisionOptions {
  includeNeighbors?: boolean
}

/** 유료 요청 레지스트리 — 지금은 메모리. M3 에서 JobService 가 승인 뒤 실제 생성을 맡는다. */
export class SpendRegistry {
  private map = new Map<string, SpendRequest>()

  create(kind: SpendKind, count: number, args: unknown, parentRequestId?: string): SpendRequest {
    const req: SpendRequest = { requestId: randomUUID(), kind, count, status: 'awaiting_approval', createdAt: Date.now(), args, parentRequestId }
    this.map.set(req.requestId, req)
    return req
  }

  get(requestId: string): SpendRequest | undefined {
    return this.map.get(requestId)
  }

  resolve(requestId: string, decision: SpendDecision, options?: SpendDecisionOptions, error?: string): SpendRequest {
    const req = this.map.get(requestId)
    if (!req) throw new Error(`요청 없음: ${requestId}`)
    req.status = decision
    req.resolvedAt = Date.now()
    if (options) req.decisionOptions = options
    if (error) req.error = error
    return req
  }

  list(): SpendRequest[] {
    return [...this.map.values()]
  }

  /** status 가 awaiting_approval 이 아니게 되거나 timeout 까지 500ms 폴링. */
  async wait(requestId: string, timeoutMs: number): Promise<{ request: SpendRequest; timedOut: boolean }> {
    const req = this.map.get(requestId)
    if (!req) throw new Error(`요청 없음: ${requestId}`)
    const deadline = Date.now() + timeoutMs
    while (req.status === 'awaiting_approval' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, deadline - Date.now()))))
    }
    return { request: req, timedOut: req.status === 'awaiting_approval' }
  }
}
