import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Project, Sequence } from '@conti/domain'
import type { NavItem } from '../data/sampleScene'

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
}

const Ctx = createContext<ProjectState | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [root, setRoot] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [seq, setSeqRaw] = useState<string | null>(null)
  const [nav, setNav] = useState<NavItem>(() => (new URLSearchParams(window.location.search).get('nav') as NavItem) || '콘티')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const api = window.conti?.api

  const refresh = useCallback(async () => {
    if (!api) return
    const cur = await api.project.current()
    if (!cur) {
      setRoot(null)
      setProject(null)
      setSequences([])
      return
    }
    setRoot(cur.root)
    setProject(cur.project)
    const list = await api.sequence.list()
    setSequences(list)
    setSeqRaw((prev) => (prev && list.some((s) => s.seq === prev) ? prev : (list[0]?.seq ?? null)))
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
    }),
    [root, project, sequences, seq, nav, loading, error, guard, refresh, api],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProject(): ProjectState {
  const v = useContext(Ctx)
  if (!v) throw new Error('ProjectProvider 밖에서 사용')
  return v
}
