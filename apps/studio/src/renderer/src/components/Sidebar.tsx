import { ChevronsLeft, ChevronsRight, Folder, FileText, Film, Box, ListTree, LayoutGrid, Layers, Send, Settings } from 'lucide-react'
import type { Scene, NavItem } from '../data/sampleScene'
import { navItems } from '../data/sampleScene'
import ProjectSwitcher from './ProjectSwitcher'

const navIcons: Record<NavItem, typeof Film> = {
  Sources: Film,
  Assets: Box,
  Shots: ListTree,
  Conti: LayoutGrid,
  'Conti Export': Layers,
  Publish: Send,
}

interface Props {
  open: boolean
  onToggle: () => void
  projectTitle: string
  scenes: Scene[]
  activeSeq: string
  onSelectScene: (seq: string) => void
  nav: NavItem
  onSelectNav: (n: NavItem) => void
  onDiagnostics: () => void
  diagActive: boolean
  /** 데모(프로젝트 없음) 화면이면 전환 메뉴 대신 이름만 */
  demo?: boolean
}

export default function Sidebar({ open, onToggle, projectTitle, scenes, activeSeq, onSelectScene, nav, onSelectNav, onDiagnostics, diagActive, demo }: Props) {
  // 에피소드별로 묶는다
  const eps = [...new Set(scenes.map((s) => s.ep))].sort()

  return (
    <aside
      className={`drag flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200 ${
        open ? 'w-[220px]' : 'w-[56px]'
      }`}
    >
      <div className="flex h-[52px] items-center justify-end pr-2 pl-[76px]">
        <button
          onClick={onToggle}
          title={open ? '사이드바 접기' : '사이드바 펼치기'}
          className="no-drag rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink"
        >
          {open ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </button>
      </div>

      <div className="no-drag flex min-h-0 flex-1 flex-col">
        {/* 전환 메뉴는 스크롤 영역 밖 — 안에 두면 드롭다운이 잘린다 */}
        <div className="px-2">
          {open && <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted">프로젝트</div>}
          {demo ? <TreeRow icon={Folder} label={projectTitle} open={open} depth={0} /> : <ProjectSwitcher open={open} title={projectTitle} />}
        </div>
        <section className="min-h-0 overflow-y-auto px-2">
          {eps.map((ep) => (
            <div key={ep}>
              <TreeRow icon={Folder} label={ep} open={open} depth={1} />
              {scenes
                .filter((s) => s.ep === ep)
                .map((s) => (
                  <TreeRow
                    key={s.seq}
                    icon={FileText}
                    label={`${s.seq}  ${s.title}`}
                    open={open}
                    depth={2}
                    active={s.seq === activeSeq && !diagActive}
                    onClick={() => onSelectScene(s.seq)}
                  />
                ))}
            </div>
          ))}
        </section>

        <div className="mx-3 my-4 border-t border-line" />

        <nav className="px-2">
          {navItems.map((item) => {
            const Icon = navIcons[item]
            const active = item === nav && !diagActive
            return (
              <button
                key={item}
                onClick={() => onSelectNav(item)}
                title={item}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left ${
                  active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-panel-2 hover:text-ink'
                } ${open ? '' : 'justify-center'}`}
              >
                <Icon size={16} className="shrink-0" />
                {open && <span className="truncate">{item}</span>}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto px-2 pb-3">
          <button
            onClick={onDiagnostics}
            title="설정 — 계정 로그인 · 도구 진단"
            className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left ${
              diagActive ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-panel-2 hover:text-ink'
            } ${open ? '' : 'justify-center'}`}
          >
            <Settings size={16} className="shrink-0" />
            {open && <span>설정</span>}
          </button>
        </div>
      </div>
    </aside>
  )
}

function TreeRow({
  icon: Icon,
  label,
  open,
  depth,
  active,
  onClick,
}: {
  icon: typeof Folder
  label: string
  open: boolean
  depth: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`mb-0.5 flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left ${
        active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-panel-2 hover:text-ink'
      } ${open ? '' : 'justify-center'}`}
      style={open ? { paddingLeft: 8 + depth * 12 } : undefined}
    >
      <Icon size={14} className="shrink-0" />
      {open && <span className="truncate text-[12.5px]">{label}</span>}
    </button>
  )
}
