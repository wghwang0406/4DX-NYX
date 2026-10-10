import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, Clock, Settings, X } from 'lucide-react'
import { useProject } from '../state/project'
import SettingsView from './SettingsView'

export default function StartScreen() {
  const { openDialog, openPath, create, loading, error, clearError } = useProject()
  const [recent, setRecent] = useState<Array<{ root: string; title: string; code: string; openedAt: number }>>([])
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    void window.conti.api.project.recent().then(setRecent)
  }, [])

  const codeOk = /^[A-Z][A-Z0-9_]{1,15}$/.test(code)

  if (showSettings)
    return (
      <div className="flex h-full flex-col bg-bg">
        <div className="drag flex h-[52px] shrink-0 items-center justify-between pl-[88px] pr-4">
          <span className="text-[13px] font-semibold">설정</span>
          <button onClick={() => setShowSettings(false)} className="no-drag flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:text-ink">
            <X size={13} /> 닫기
          </button>
        </div>
        <SettingsView />
      </div>
    )

  return (
    <div className="drag flex h-full items-center justify-center bg-bg">
      <div className="no-drag w-[560px] rounded-xl border border-line bg-panel p-8">
        <div className="flex items-start justify-between">
          <h1 className="text-[22px] font-semibold">NYX <span className="ml-1 text-[13px] font-normal text-muted">콘티 스튜디오</span></h1>
          <button onClick={() => setShowSettings(true)} title="설정 — 계정 로그인" className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:text-ink">
            <Settings size={13} /> 설정
          </button>
        </div>
        <p className="mt-1 text-muted">프로젝트 폴더를 열거나 새로 만듭니다. 폴더에 config.md 가 있으면 그대로 읽습니다.</p>

        {error && (
          <div className="mt-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-[12.5px] text-red-300">
            {error}
            <button onClick={clearError} className="ml-2 underline">
              닫기
            </button>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            disabled={loading}
            onClick={() => void openDialog()}
            className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-4 py-3 text-left hover:border-muted"
          >
            <FolderOpen size={20} className="text-accent" />
            <div>
              <div className="font-medium">프로젝트 열기</div>
              <div className="text-[11.5px] text-muted">기존 스킬 프로젝트도 됨</div>
            </div>
          </button>
          <button
            disabled={loading}
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-4 py-3 text-left hover:border-muted"
          >
            <FolderPlus size={20} className="text-accent" />
            <div>
              <div className="font-medium">새 프로젝트</div>
              <div className="text-[11.5px] text-muted">폴더·config.md 자동 생성</div>
            </div>
          </button>
        </div>

        {showCreate && (
          <div className="mt-3 rounded-lg border border-line p-4">
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <label className="text-[11.5px] text-muted">
                작품명
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="고래별"
                  className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="text-[11.5px] text-muted">
                코드 (대문자)
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="GRB"
                  className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
            <button
              disabled={!title.trim() || !codeOk || loading}
              onClick={() => void create({ code, title: title.trim() })}
              className="mt-3 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
            >
              상위 폴더 고르고 만들기
            </button>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
              <Clock size={12} /> 최근
            </div>
            {recent.map((r) => (
              <button
                key={r.root}
                onClick={() => void openPath(r.root)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
              >
                <span>
                  <span className="font-mono text-[11px] text-accent">{r.code}</span>
                  <span className="ml-2">{r.title}</span>
                </span>
                <span className="truncate pl-4 text-[11px] text-muted">{r.root}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
