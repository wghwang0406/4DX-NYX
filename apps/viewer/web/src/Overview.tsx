import { useCallback, useEffect, useState } from 'react'

interface OverviewPub {
  id: string
  seq: string
  version: number
  label: string
  status: string
  createdAt: number
  link: string
  closed: boolean
  open: number
  total: number
  verdict: string | null
  archive: string
}
interface OverviewData {
  server: { name: string; version: string; dropbox: boolean; startedAt: number; publicUrl: string | null; blobBytes: number; blobCount: number }
  projects: Array<{ id: string; code: string; title: string; publications: OverviewPub[] }>
}

const KEY = 'nyx_admin_token'
const readToken = () => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`)
const when = (t: number) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * 서버 PC 주소(http://IP:8787/)로 여는 현황 화면 — 서버 상태와 게시된 판 목록.
 * 서버가 NYX_OVERVIEW_OPEN=1 이면 토큰 없이 열리고, 아니면 팀 게시 토큰(스튜디오 설정 › 게시 서버와 같은 값)으로 잠근다.
 */
export default function Overview() {
  const [token, setToken] = useState(readToken())
  // 서버가 현황을 토큰 없이 열어 두면(NYX_OVERVIEW_OPEN=1) 토큰 없이 바로 보인다. 잠겨 있으면 401 → 입력 화면
  const [needToken, setNeedToken] = useState(false)
  const [input, setInput] = useState('')
  const [data, setData] = useState<OverviewData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview', token ? { headers: { authorization: `Bearer ${token}` } } : undefined)
      if (res.status === 401 || res.status === 403) {
        setNeedToken(true)
        setErr(token ? '토큰이 맞지 않습니다' : null)
        setToken('')
        try {
          localStorage.removeItem(KEY)
        } catch {
          /* */
        }
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setNeedToken(false)
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [token])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 15_000)
    return () => clearInterval(id)
  }, [load])

  if (needToken && !data)
    return (
      <div className="center">
        <form
          className="gate"
          onSubmit={(e) => {
            e.preventDefault()
            const t = input.trim()
            if (!t) return
            try {
              localStorage.setItem(KEY, t)
            } catch {
              /* */
            }
            setToken(t)
            setNeedToken(false)
          }}
        >
          <b>NYX 뷰어 현황</b>
          <span className="muted" style={{ fontSize: 12.5 }}>
            서버를 띄울 때 터미널에 나온 게시 토큰을 넣으세요 (스튜디오 설정 › 게시 서버와 같은 값). 리뷰어는 이 화면이 아니라 받은 링크로 들어갑니다.
          </span>
          <input autoFocus placeholder="게시 토큰" value={input} onChange={(e) => setInput(e.target.value)} />
          {err && <span style={{ color: 'var(--warn)', fontSize: 12.5 }}>{err}</span>}
          <button className="btn ok" type="submit">
            열기
          </button>
        </form>
      </div>
    )

  if (!data) return <div className="center">{err ?? '불러오는 중…'}</div>

  const pubCount = data.projects.reduce((n, p) => n + p.publications.length, 0)
  return (
    <div className="app" data-testid="overview">
      <header className="top" style={{ paddingBottom: 12 }}>
        <div className="title">
          NYX 뷰어 현황 <span className="chip" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>● 켜짐</span>
        </div>
        <div className="meta">
          v{data.server.version} · {when(data.server.startedAt)} 시작 · Dropbox 보관 {data.server.dropbox ? '연결됨' : '꺼짐'} · 파일 {data.server.blobCount}개 {mb(data.server.blobBytes)}
          {data.server.publicUrl ? ` · 링크 주소 ${data.server.publicUrl}` : ''}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void load()}>
            새로고침
          </button>
          {token && (
            <button
              className="link"
              onClick={() => {
                try {
                  localStorage.removeItem(KEY)
                } catch {
                  /* */
                }
                setToken('')
                setData(null)
              }}
            >
              토큰 지우기
            </button>
          )}
        </div>
      </header>
      <div className="stage" style={{ maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        {pubCount === 0 ? (
          <div className="center" style={{ height: 'auto', padding: 48 }} data-testid="overview-empty">
            아직 게시된 콘티가 없습니다.
            <br />
            스튜디오 › 설정 › 게시 서버에 이 주소와 토큰을 넣고 [연결 확인] → Publish 에서 게시하면 여기에 나타납니다.
          </div>
        ) : (
          data.projects
            .filter((p) => p.publications.length)
            .map((p) => {
              const seqs = [...new Set(p.publications.map((x) => x.seq))]
              return (
                <section key={p.id} style={{ marginBottom: 24 }}>
                  <h3 style={{ margin: '4px 0 10px' }}>
                    {p.title} <span className="muted mono" style={{ fontSize: 12 }}>{p.code}</span>
                  </h3>
                  {seqs.map((seq) => (
                    <div key={seq} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 10 }}>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', fontWeight: 600 }} className="mono">
                        {seq}
                      </div>
                      {p.publications
                        .filter((x) => x.seq === seq)
                        .map((x) => (
                          <div key={x.id} data-pub={`${seq}-v${x.version}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                            <span className="mono" style={{ width: 36 }}>v{x.version}</span>
                            <span className="chip">{x.status}</span>
                            <span className="muted" style={{ width: 110 }}>{when(x.createdAt)}</span>
                            <span>
                              코멘트 {x.total}
                              {x.open ? <b style={{ color: 'var(--warn)' }}> · 미해결 {x.open}</b> : ''}
                            </span>
                            {x.verdict && <span className="chip" style={{ color: x.verdict === 'approve' ? 'var(--ok)' : 'var(--warn)' }}>{x.verdict === 'approve' ? '승인' : '수정 요청'}</span>}
                            {x.archive === 'done' && <span className="chip muted">Dropbox 보관</span>}
                            <span className="grow" />
                            {x.closed ? (
                              <span className="muted">링크 닫힘</span>
                            ) : (
                              <a className="btn" href={x.link} target="_blank" rel="noreferrer">
                                열기
                              </a>
                            )}
                          </div>
                        ))}
                    </div>
                  ))}
                </section>
              )
            })
        )}
      </div>
    </div>
  )
}
