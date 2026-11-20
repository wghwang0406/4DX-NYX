import { useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight, ChevronDown, ChevronRight, Folder, FileText, Film, Box, ListTree, LayoutGrid, Image, Send, Settings, Clapperboard } from 'lucide-react'
import type { Scene, NavItem } from '../data/sampleScene'
import { navItems } from '../data/sampleScene'
import ProjectSwitcher from './ProjectSwitcher'

const navIcons: Record<NavItem, typeof Film> = {
  Sources: Film,
  Assets: Box,
  Shots: ListTree,
  Conti: LayoutGrid,
  Images: Image,
  Publish: Send,
  Video: Clapperboard,
}

interface Props {
  open: boolean
  onToggle: () => void
  projectTitle: string
  scenes: Scene[]
  activeSeq: string
  onSelectScene: (seq: string) => void
  /** 씬 › 어셋 (N) */
  assetCounts?: Record<string, number>
  onOpenAssets?: (seq: string) => void
  nav: NavItem
  onSelectNav: (n: NavItem) => void
  onDiagnostics: () => void
  diagActive: boolean
  /** 데모(프로젝트 없음) 화면이면 전환 메뉴 대신 이름만 */
  demo?: boolean
}

export default function Sidebar({ open, onToggle, projectTitle, scenes, activeSeq, onSelectScene, assetCounts, onOpenAssets, nav, onSelectNav, onDiagnostics, diagActive, demo }: Props) {
  // 에피소드별로 묶는다
  const eps = [...new Set(scenes.map((s) => s.ep))].sort()
  // 펼친 씬 — 현재 씬은 자동으로 펼친다 (씬이 많아도 길어지지 않게 나머지는 접힌 채)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeSeq ? [activeSeq] : []))
  useEffect(() => {
    if (activeSeq) setExpanded((s) => (s.has(activeSeq) ? s : new Set([...s, activeSeq])))
  }, [activeSeq])
  const toggle = (seq: string) => setExpanded((s) => (s.has(seq) ? new Set([...s].filter((x) => x !== seq)) : new Set([...s, seq])))
  const withAssets = !!assetCounts && !!onOpenAssets

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
                  <div key={s.seq}>
                    <TreeRow
                      icon={FileText}
                      label={`${s.seq}  ${s.title}`}
                      open={open}
                      depth={2}
                      active={s.seq === activeSeq && !diagActive && !(withAssets && nav === 'Assets')}
                      onClick={() => onSelectScene(s.seq)}
                      caret={withAssets ? (expanded.has(s.seq) ? 'open' : 'closed') : undefined}
                      onCaret={() => toggle(s.seq)}
                    />
                    {withAssets && open && expanded.has(s.seq) && (
                      <TreeRow
                        icon={Box}
                        label={`어셋 (${assetCounts![s.seq] ?? 0})`}
                        open={open}
                        depth={3}
                        testId={`tree-assets-${s.seq}`}
                        active={s.seq === activeSeq && nav === 'Assets' && !diagActive}
                        onClick={() => onOpenAssets!(s.seq)}
                      />
                    )}
                  </div>
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
  caret,
  onCaret,
  testId,
}: {
  icon: typeof Folder
  label: string
  open: boolean
  depth: number
  active?: boolean
  onClick?: () => void
  /** 하위 항목 펼침 표시 (▸/▾) — 누르면 onCaret */
  caret?: 'open' | 'closed'
  onCaret?: () => void
  testId?: string
}) {
  const Caret = caret === 'open' ? ChevronDown : ChevronRight
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      title={label}
      className={`mb-0.5 flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left ${
        active ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-panel-2 hover:text-ink'
      } ${open ? '' : 'justify-center'}`}
      style={open ? { paddingLeft: 8 + depth * 12 } : undefined}
    >
      {open && caret && (
        <span
          role="button"
          aria-label={caret === 'open' ? '접기' : '펼치기'}
          onClick={(e) => {
            e.stopPropagation()
            onCaret?.()
          }}
          className="-ml-1 shrink-0 rounded text-muted hover:text-ink"
        >
          <Caret size={12} />
        </span>
      )}
      <Icon size={14} className="shrink-0" />
      {open && <span className="truncate text-[12.5px]">{label}</span>}
    </button>
  )
}
