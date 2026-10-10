import type { Comment, ReviewPayload } from '../../src/shared/types'

export const token = (): string | null => /^\/r\/([\w-]{16,64})/.exec(location.pathname)?.[1] ?? null

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* text */
    }
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return (await res.json()) as T
}

export const api = {
  load: (t: string) => fetch(`/api/r/${t}`).then((r) => j<ReviewPayload>(r)),
  file: (t: string, path: string) => `/api/r/${t}/file/${path.split('/').map(encodeURIComponent).join('/')}`,
  comment: (t: string, body: Record<string, unknown>) => fetch(`/api/r/${t}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => j<Comment>(r)),
  setStatus: (t: string, id: string, status: 'open' | 'resolved') => fetch(`/api/r/${t}/comments/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) }).then((r) => j<Comment>(r)),
  verdict: (t: string, verdict: 'approve' | 'changes', author: string, body?: string) => fetch(`/api/r/${t}/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict, author, body }) }).then((r) => j<Comment>(r)),
}

/** 이름은 인증이 아니라 표시용 — 첫 방문에 묻고 이 브라우저에 기억 */
export function savedName(): string {
  try {
    return localStorage.getItem('nyx_name') ?? ''
  } catch {
    return ''
  }
}
export function saveName(n: string) {
  try {
    localStorage.setItem('nyx_name', n)
  } catch {
    /* 사생활 모드 */
  }
}

export function fmtTc(ms: number): string {
  const t = ms / 1000
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}
