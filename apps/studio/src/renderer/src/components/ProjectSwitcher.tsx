import { useEffect, useRef, useState } from 'react'
import { Folder, ChevronDown, FolderOpen, FolderPlus, X, Clock, Check } from 'lucide-react'
import { useProject } from '../state/project'

interface Recent {
  root: string
  title: string
  code: string
  openedAt: number
}

/** 사이드바 맨 위 프로젝트 이름 — 누르면 최근 프로젝트·다른 폴더 열기·새 프로젝트·닫기 */
export default function ProjectSwitcher({ open: sidebarOpen, title }: { open: boolean; title: string }) {
  const { root, switchTo, switchDialog, close } = useProject()
  const [menu, setMenu] = useState(false)
  const [recent, setRecent] = useState<Recent[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    void window.conti.api.project.recent().then(setRecent)
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const pick = (fn: () => Promise<void>) => {
    setMenu(false)
    void fn()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setMenu((v) => !v)}
        title={sidebarOpen ? `${title} — 프로젝트 바꾸기` : `${title} — 프로젝트 바꾸기`}
        className={`mb-0.5 flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left hover:bg-panel-2 ${menu ? 'bg-panel-2 text-ink' : 'text-ink'} ${sidebarOpen ? 'pl-2' : 'justify-center'}`}
      >
        <Folder size={14} className="shrink-0" />
        {sidebarOpen && (
          <>
            <span className="truncate text-[12.5px] font-medium">{title}</span>
            <ChevronDown size={12} className="ml-auto shrink-0 text-muted" />
          </>
        )}
      </button>
      {menu && (
        <div className="absolute top-full left-0 z-50 mt-1 w-[280px] rounded-lg border border-line bg-panel p-1 text-[12.5px] shadow-2xl">
          <div className="px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-wide text-muted">최근 프로젝트</div>
          {recent.length === 0 && <div className="px-2 py-1 text-muted">없음</div>}
          {recent.map((r) => (
            <div key={r.root} className="group flex items-center rounded-md hover:bg-panel-2">
              <button onClick={() => pick(() => switchTo(r.root))} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" title={r.root}>
                {r.root === root ? <Check size={13} className="shrink-0 text-accent" /> : <Clock size={13} className="shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted">{r.root.replace(/^\/Users\/[^/]+/, '~')}</span>
                </span>
              </button>
              {r.root !== root && (
                <button
                  onClick={() => void window.conti.api.project.forgetRecent(r.root).then(setRecent)}
                  title="목록에서 빼기 (폴더는 그대로)"
                  className="mr-1 hidden rounded p-1 text-muted group-hover:block hover:text-ink"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="my-1 border-t border-line" />
          <button onClick={() => pick(switchDialog)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2">
            <FolderOpen size={13} className="text-muted" /> 다른 프로젝트 열기… <span className="ml-auto text-[10.5px] text-muted">⌘O</span>
          </button>
          <button
            onClick={() =>
              pick(async () => {
                sessionStorage.setItem('nyx_new_project', '1')
                await close()
              })
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel-2"
          >
            <FolderPlus size={13} className="text-muted" /> 새 프로젝트… <span className="ml-auto text-[10.5px] text-muted">⇧⌘N</span>
          </button>
          <button onClick={() => pick(close)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted hover:bg-panel-2 hover:text-ink">
            <X size={13} /> 프로젝트 닫기 <span className="ml-auto text-[10.5px]">⇧⌘W</span>
          </button>
        </div>
      )}
    </div>
  )
}
