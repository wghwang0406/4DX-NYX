import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import type { ToolStatus } from '../../../shared/ipc'

const LABEL: Record<ToolStatus['name'], string> = {
  claude: 'Claude Code CLI',
  codex: 'Codex CLI',
  higgsfield: 'Higgsfield CLI',
  ffmpeg: 'ffmpeg',
  uv: 'uv (Python 도구)',
}

const HINT: Record<ToolStatus['name'], string> = {
  claude: '설정 › 계정에서 로그인',
  codex: '설정 › 계정에서 로그인',
  higgsfield: '설정 › 계정에서 로그인',
  ffmpeg: '`brew install ffmpeg`',
  uv: '영상 가져오기 때 앱이 설치',
}

export default function DiagnosticsView() {
  const [tools, setTools] = useState<ToolStatus[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    try {
      setTools(await window.conti.api.diag.tools())
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0">
      <section className="rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold">진단</div>
            <div className="text-[12px] text-muted">앱이 쓰는 외부 도구 버전·경로·로그인 상태. 로그인은 계정 탭에서.</div>
          </div>
          <button onClick={() => void load()} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[12px] hover:bg-panel-2">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> 다시 확인
          </button>
        </div>
        <table className="mt-4 w-full text-[12.5px]">
          <tbody>
            {(tools ?? []).map((t) => (
              <tr key={t.name} className="border-t border-line/60">
                <td className="w-44 py-2.5 font-medium">{LABEL[t.name]}</td>
                <td className="w-28 py-2.5">
                  {t.installed ? (
                    <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={14} /> 설치됨</span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-400"><XCircle size={14} /> 없음</span>
                  )}
                </td>
                <td className="w-28 py-2.5">
                  {t.login === 'ok' && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={14} /> 로그인</span>}
                  {t.login === 'missing' && <span className="flex items-center gap-1 text-warn"><AlertCircle size={14} /> 로그인 필요</span>}
                  {t.login === 'unknown' && <span className="text-muted">확인 불가</span>}
                </td>
                <td className="py-2.5 font-mono text-[11.5px] text-muted">{t.version ?? ''}</td>
                <td className="py-2.5 text-[11.5px] text-muted">{t.installed && t.login !== 'missing' ? t.path : HINT[t.name]}</td>
              </tr>
            ))}
            {!tools && (
              <tr>
                <td className="py-3 text-muted">확인 중…</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
