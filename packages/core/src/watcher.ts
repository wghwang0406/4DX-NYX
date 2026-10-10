import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { PROJECT_DIRS, ShotSize, type Shot } from '@conti/domain'
import { exists, readText, sha256 } from './fs'
import type { ProjectStore } from './store'
import { parseConfigMd } from './md/config'
import { mdCell, parseShotlistMd } from './md/shotlist'
import { mdLine, parseStyleAnchor } from './md/projectprompt'

/** 감시 대상 뷰 파일인가: config.md / Projectprompt.md / {EP}/Conti/{SEQ}/shotlist_{SEQ}.md */
export function isViewRel(rel: string): boolean {
  return rel === 'config.md' || rel === 'Projectprompt.md' || /^[^/]+\/Conti\/[^/]+\/shotlist_[^/]+\.md$/.test(rel)
}

/**
 * md 뷰 파일을 사용자가(또는 터미널 Claude가) 직접 고쳤는지 감지한다.
 * views.json 에 적힌 해시와 다르면 "외부 수정"으로 보고, 파싱해서 반영 제안을 만든다.
 * 조용히 합치지 않는다 — UI 가 보여주고 사용자가 수락/되돌리기를 고른다.
 */
export interface PendingChange {
  rel: string
  kind: 'config' | 'shotlist' | 'projectprompt'
  seq?: string
  summary: string[] // 사람이 읽을 변경 요약
  patch: unknown // accept 때 적용할 데이터
}

export class MdWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Map<string, PendingChange>()
  private listeners = new Set<(p: PendingChange[]) => void>()

  constructor(private store: ProjectStore) {}

  start() {
    const root = this.store.root
    // chokidar 4+ 는 glob 을 지원하지 않는다 — 루트를 얕게(depth 4) 감시하고 뷰 파일만 남긴다.
    // (.conti / sources 는 앱이 자주 쓰는 폴더라 아예 뺀다)
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 4,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignored: (p, stats) => {
        const rel = this.rel(p)
        if (!rel) return false
        if (/^(\.conti|sources|node_modules|\.git)(\/|$)/.test(rel)) return true
        return !!stats?.isFile() && !isViewRel(rel)
      },
    })
    this.watcher.on('change', (p) => void this.check(p))
    this.watcher.on('add', (p) => void this.check(p))
  }

  async stop() {
    await this.watcher?.close()
    this.watcher = null
  }

  onPending(fn: (p: PendingChange[]) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  list(): PendingChange[] {
    return [...this.pending.values()]
  }

  private emit() {
    const list = this.list()
    for (const l of this.listeners) l(list)
  }

  private async viewHash(rel: string): Promise<string | undefined> {
    const vp = join(this.store.root, PROJECT_DIRS.state, 'views.json')
    if (!(await exists(vp))) return undefined
    return (JSON.parse(await readText(vp)) as Record<string, string>)[rel]
  }

  private rel(abs: string): string {
    return abs.slice(this.store.root.length + 1).replace(/\\/g, '/')
  }

  async check(abs: string) {
    const rel = this.rel(abs)
    if (!isViewRel(rel)) return
    if (!(await exists(abs))) return
    const text = await readText(abs)
    const recorded = await this.viewHash(rel)
    if (recorded && sha256(text) === recorded) {
      // 앱이 쓴 그대로 — 대기 목록에서 제거
      if (this.pending.delete(rel)) this.emit()
      return
    }
    // 맥 Finder/일부 편집기는 한글을 NFD 로 저장한다 — 비교·반영은 NFC 로
    const change = this.diff(rel, text.normalize('NFC'))
    if (!change) return
    this.pending.set(rel, change)
    this.emit()
  }

  private diff(rel: string, text: string): PendingChange | null {
    if (rel === 'config.md') {
      const cfg = parseConfigMd(text)
      const cur = this.store.getProject()
      const summary: string[] = []
      if (cfg.title && cfg.title !== mdLine(cur.title)) summary.push(`제목: ${cur.title} → ${cfg.title}`)
      for (const [seq, ep] of Object.entries(cfg.episodeMap)) {
        if (cur.episodeMap[seq] !== ep) summary.push(`매핑 ${seq} → ${ep}${cur.episodeMap[seq] ? ` (이전 ${cur.episodeMap[seq]})` : ' (신규)'}`)
      }
      if (!summary.length) return null
      return { rel, kind: 'config', summary, patch: { title: cfg.title || cur.title, episodeMap: { ...cur.episodeMap, ...cfg.episodeMap } } }
    }
    if (rel === 'Projectprompt.md') {
      const st = parseStyleAnchor(text)
      const cur = this.store.getProject().style
      const summary: string[] = []
      const next = { ...cur }
      for (const k of ['anchorEn', 'contiSketchEn', 'contiCinematicEn', 'paletteEn'] as const) {
        const v = st[k]
        if (v != null && v !== mdLine(cur[k])) {
          summary.push(`${k}: "${cur[k].slice(0, 40)}" → "${v.slice(0, 40)}"`)
          next[k] = v
        }
      }
      if (!summary.length) return null
      return { rel, kind: 'projectprompt', summary, patch: { style: next } }
    }
    const m = /shotlist_(S[^/]+)\.md$/.exec(rel)
    if (m) {
      const seq = this.store.getSequence(m[1])
      if (!seq) return null
      const { rows } = parseShotlistMd(text)
      const summary: string[] = []
      const patches: Array<{ shotId?: string; no: string; patch: Partial<Shot> }> = []
      // md 셀은 `|`→`｜`, 줄바꿈→공백으로 쓰이므로 같은 규칙으로 맞춰 비교한다
      const same = (a: string | undefined, b: string | undefined) => mdCell(a ?? '') === mdCell(b ?? '')
      const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]))
      // 샷사이즈는 enum 밖이면 반영하지 않고 알린다 (zod 가 accept 에서 터지지 않게)
      const sizeOf = (raw: string | undefined, no: string): Shot['sizeCode'] | undefined => {
        if (!raw || raw === '—' || raw === '-') return undefined
        const parsed = ShotSize.safeParse(raw.toUpperCase())
        if (parsed.success) return parsed.data
        summary.push(`${no}: 샷사이즈 '${raw}' 는 알 수 없어 무시 (${ShotSize.options.join('/')})`)
        return undefined
      }
      for (const r of rows) {
        const shot = seq.shots.find((s) => s.no === r.no)
        const patch: Partial<Shot> = {}
        const size = sizeOf(r.size, r.no)
        if (shot) {
          if (size && size !== shot.sizeCode) patch.sizeCode = size
          const chars = r.characters.map((c) => (c.startsWith('@') ? c : `@${c}`))
          if (!sameList(chars, shot.characters)) patch.characters = chars
          if (r.location && !same(`@loc_${r.location}`, shot.location)) patch.location = `@loc_${r.location}`
          const props = r.props.map((p) => (p.startsWith('@') ? p : `@prop_${p}`))
          if (!sameList(props, shot.props)) patch.props = props
          const desc = r.description.replace(/^\[(대사|반응)\]\s*/, '')
          if (!shot.dialogue.length && desc && !same(desc, shot.actionKo)) patch.actionKo = desc
          if (Object.keys(patch).length) {
            summary.push(`${r.no}: ${Object.keys(patch).join(', ')} 변경`)
            patches.push({ shotId: shot.id, no: r.no, patch })
          }
        } else {
          summary.push(`${r.no}: 새 샷 (${size ?? '—'}) ${r.description.slice(0, 30)}`)
          patches.push({ no: r.no, patch: { sizeCode: size, actionKo: r.description, characters: r.characters.map((c) => (c.startsWith('@') ? c : `@${c}`)) } })
        }
      }
      if (!summary.length) return null
      return { rel, kind: 'shotlist', seq: seq.seq, summary, patch: patches }
    }
    return null
  }

  /** 반영: JSON 에 적용 → md 는 다시 생성되어 해시가 맞춰진다 */
  async accept(rel: string) {
    const c = this.pending.get(rel)
    if (!c) return
    if (c.kind === 'config') await this.store.updateProject(c.patch as never)
    else if (c.kind === 'projectprompt') await this.store.updateProject(c.patch as never)
    else if (c.kind === 'shotlist' && c.seq) {
      const seq = this.store.getSequence(c.seq)!
      const shots = [...seq.shots]
      for (const p of c.patch as Array<{ shotId?: string; no: string; patch: Partial<Shot> }>) {
        if (p.shotId) {
          const i = shots.findIndex((s) => s.id === p.shotId)
          if (i >= 0) shots[i] = { ...shots[i], ...p.patch }
        } else {
          shots.push({ id: `md-${p.no}-${Date.now()}`, no: p.no, ...(p.patch as object) } as Shot)
        }
      }
      shots.sort((a, b) => a.no.localeCompare(b.no))
      await this.store.upsertSequence({ ...seq, shots })
    }
    this.pending.delete(rel)
    this.emit()
  }

  /** 되돌리기: JSON 기준으로 md 를 다시 써서 외부 수정을 덮는다 */
  async discard(rel: string) {
    const c = this.pending.get(rel)
    if (!c) return
    if (c.kind === 'shotlist' && c.seq) {
      const seq = this.store.getSequence(c.seq)!
      await this.store.upsertSequence(seq)
    } else {
      await this.store.updateProject({})
    }
    this.pending.delete(rel)
    this.emit()
  }
}
