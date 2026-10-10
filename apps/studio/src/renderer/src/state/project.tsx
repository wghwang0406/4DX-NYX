import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, Sequence } from '@conti/domain'
import { legacyNav, navItems, type NavItem } from '../data/sampleScene'

interface ProjectState {
  root: string | null
  project: Project | null
  sequences: Sequence[]
  seq: string | null
  nav: NavItem
  loading: boolean
  error: string | null
  setSeq: (seq: string) => void
  setNav: (n: NavItem) => void
  openDialog: () => Promise<void>
  openPath: (root: string) => Promise<void>
  create: (init: { code: string; title: string }) => Promise<void>
  refresh: () => Promise<void>
  clearError: () => void
  /** 프로젝트 닫기 → 시작 화면. 진행 중 생성 작업이 있으면 먼저 묻는다 */
  close: () => Promise<void>
  /** 다른 프로젝트로 (최근 목록 경로) */
  switchTo: (root: string) => Promise<void>
  /** 폴더 고르는 대화상자로 다른 프로젝트 열기 */
  switchDialog: () => Promise<void>
}

const Ctx = createContext<ProjectState | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [root, setRoot] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [seq, setSeqRaw] = useState<string | null>(null)
  const [nav, setNav] = useState<NavItem>(() => {
    const q = new URLSearchParams(window.location.search).get('nav') ?? ''
    return (navItems as readonly string[]).includes(q) ? (q as NavItem) : (legacyNav[q] ?? 'Conti')
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const api = window.conti?.api
  const lastRoot = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!api) return
    const cur = await api.project.current()
    if (!cur) {
      lastRoot.current = null
      setRoot(null)
      setProject(null)
      setSequences([])
      return
    }
    // 다른 프로젝트로 바뀌었으면 이전 선택(같은 이름의 S41 등)을 이어받지 않는다
    const switched = lastRoot.current !== cur.root
    lastRoot.current = cur.root
    setRoot(cur.root)
    setProject(cur.project)
    const list = await api.sequence.list()
    setSequences(list)
    const want = new URLSearchParams(window.location.search).get('seq')
    setSeqRaw((prev) => (!switched && prev && list.some((s) => s.seq === prev) ? prev : want && list.some((s) => s.seq === want) ? want : (list[0]?.seq ?? null)))
  }, [api])

  const guard = useCallback(
    async (fn: () => Promise<unknown>) => {
      setLoading(true)
      setError(null)
      try {
        await fn()
        await refresh()
      } catch (e) {
        setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      } finally {
        setLoading(false)
      }
    },
    [refresh],
  )

  useEffect(() => {
    void refresh()
    return window.conti?.onStoreChange(() => void refresh())
  }, [refresh])

  /** 생성 작업이 돌고 있으면 확인 — 닫아도 작업은 서버에서 계속되고, 다시 열면 결과를 받아온다 */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (!api) return true
    const { jobs } = await api.project.busy().catch(() => ({ jobs: 0 }))
    if (!jobs) return true
    return window.confirm(`생성 작업 ${jobs}건이 진행 중입니다.\n\n프로젝트를 바꿔도 작업은 Higgsfield 에서 계속되고, 이 프로젝트를 다시 열면 결과를 받아와 저장합니다.\n바꿀까요?`)
  }, [api])

  const value = useMemo<ProjectState>(
    () => ({
      root,
      project,
      sequences,
      seq,
      nav,
      loading,
      error,
      setSeq: setSeqRaw,
      setNav,
      openDialog: () => guard(() => api.project.openDialog()),
      openPath: (r) => guard(() => api.project.openPath(r)),
      create: (init) => guard(() => api.project.createDialog(init)),
      refresh,
      clearError: () => setError(null),
      close: async () => {
        if (await confirmLeave()) await guard(() => api.project.close())
      },
      switchTo: async (r) => {
        if (r === root) return
        if (await confirmLeave()) await guard(() => api.project.openPath(r))
      },
      switchDialog: async () => {
        if (await confirmLeave()) await guard(() => api.project.openDialog())
      },
    }),
    [root, project, sequences, seq, nav, loading, error, guard, refresh, api, confirmLeave],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProject(): ProjectState {
  const v = useContext(Ctx)
  if (!v) throw new Error('ProjectProvider 밖에서 사용')
  return v
}
