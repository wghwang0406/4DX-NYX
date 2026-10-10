import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Project, Sequence, EpisodeAssets, PROJECT_DIRS, type Asset, type Shot } from '@conti/domain'
import { absPath, exists, readText, sha256, writeAtomic } from './fs'
import { parseConfigMd, renderConfigMd } from './md/config'
import { renderShotlistMd } from './md/shotlist'
import { upsertStyleAnchor } from './md/projectprompt'
import { renderCharacterMd } from './md/character'

/**
 * ProjectStore — 프로젝트 상태의 단일 writer.
 * 진실은 .conti/*.json. md 파일(config.md, shotlist, Projectprompt 앵커 절)은 여기서 생성하는 뷰다.
 */
export class ProjectStore {
  private project!: Project
  private sequences = new Map<string, Sequence>()
  private listeners = new Set<(e: StoreEvent) => void>()

  private constructor(readonly root: string) {}

  // ── 열기 / 만들기 ───────────────────────────────────────────────────────

  /** 주어진 경로에서 위로 올라가며 config.md 가 있는 폴더를 찾는다. */
  static async findRoot(start: string): Promise<string | null> {
    let dir = resolve(start)
    for (;;) {
      if (await exists(join(dir, 'config.md'))) return dir
      const up = dirname(dir)
      if (up === dir) return null
      dir = up
    }
  }

  static async open(root: string): Promise<ProjectStore> {
    const store = new ProjectStore(root)
    const pj = join(root, PROJECT_DIRS.state, 'project.json')
    if (await exists(pj)) {
      store.project = Project.parse(JSON.parse(await readText(pj)))
    } else {
      // 기존 스킬 프로젝트(config.md만 있음) → project.json 으로 승격
      if (!(await exists(join(root, 'config.md')))) throw new Error(`프로젝트 폴더가 없거나 config.md 가 없습니다: ${root}`)
      const cfg = parseConfigMd(await readText(join(root, 'config.md')))
      const now = Date.now()
      store.project = Project.parse({
        id: randomUUID(),
        code: cfg.code || 'PROJ',
        title: cfg.title || cfg.code || '프로젝트',
        type: cfg.type || 'drama',
        episodeMap: cfg.episodeMap,
        createdAt: now,
        updatedAt: now,
      })
      await store.saveProject()
    }
    await store.loadSequences()
    return store
  }

  static async create(root: string, init: { code: string; title: string; type?: string }): Promise<ProjectStore> {
    if (await exists(join(root, 'config.md'))) throw new Error('이미 프로젝트가 있는 폴더입니다')
    await mkdir(join(root, PROJECT_DIRS.state), { recursive: true })
    await mkdir(join(root, PROJECT_DIRS.sources), { recursive: true })
    const store = new ProjectStore(root)
    const now = Date.now()
    store.project = Project.parse({
      id: randomUUID(),
      code: init.code,
      title: init.title,
      type: init.type ?? 'drama',
      createdAt: now,
      updatedAt: now,
    })
    await store.saveProject()
    await store.writeProjectViews()
    return store
  }

  // ── 조회 ────────────────────────────────────────────────────────────────

  getProject(): Project {
    return this.project
  }

  listSequences(): Sequence[] {
    return [...this.sequences.values()].sort((a, b) => a.seq.localeCompare(b.seq, undefined, { numeric: true }))
  }

  getSequence(seq: string): Sequence | undefined {
    return this.sequences.get(seq)
  }

  onChange(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  // ── 변경 ────────────────────────────────────────────────────────────────

  async updateProject(patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<Project> {
    this.project = Project.parse({ ...this.project, ...patch, rev: this.project.rev + 1, updatedAt: Date.now() })
    await this.saveProject()
    await this.writeProjectViews()
    this.emit({ type: 'project', project: this.project })
    return this.project
  }

  /** 시퀀스를 만들거나(없으면) 전체를 교체한다. 에피소드 매핑도 같이 갱신. */
  async upsertSequence(input: Partial<Sequence> & { seq: string; ep: string }): Promise<Sequence> {
    const prev = this.sequences.get(input.seq)
    const next = Sequence.parse({ ...(prev ?? {}), ...input, rev: (prev?.rev ?? 0) + 1 })
    this.sequences.set(next.seq, next)
    await this.saveSequence(next)
    if (this.project.episodeMap[next.seq] !== next.ep) {
      await this.updateProject({ episodeMap: { ...this.project.episodeMap, [next.seq]: next.ep } })
    }
    await this.ensureSequenceDirs(next)
    await this.writeSequenceViews(next)
    this.emit({ type: 'sequence', sequence: next })
    return next
  }

  async updateShot(seq: string, shotId: string, patch: Partial<Shot>, expectedRev?: number): Promise<Sequence> {
    const s = this.requireSequence(seq)
    if (expectedRev != null && s.rev !== expectedRev) throw new Error(`rev 불일치 (현재 ${s.rev})`)
    const shots = s.shots.map((sh) => (sh.id === shotId ? { ...sh, ...patch, id: sh.id } : sh))
    return this.upsertSequence({ ...s, shots })
  }

  /**
   * 에셋이 바뀌면 그 에셋이 나오는 컷 전부를 재생성 필요(stale)로 표시한다 (증분 재생성 규칙).
   * 콘티 버전이 있는 샷만 — 아직 안 그린 샷은 바뀔 게 없다. 표시한 샷 수를 돌려준다.
   */
  async markStaleByAsset(tag: string): Promise<number> {
    let n = 0
    for (const s of this.listSequences()) {
      const uses = (sh: Shot) => sh.characters.includes(tag) || sh.location === tag || sh.props.includes(tag)
      const hit = s.shots.filter((sh) => !sh.deleted && uses(sh) && sh.stages.conti.currentVersionId && sh.stages.conti.status !== 'stale')
      if (!hit.length) continue
      const ids = new Set(hit.map((sh) => sh.id))
      await this.upsertSequence({ ...s, shots: s.shots.map((sh) => (ids.has(sh.id) ? { ...sh, stages: { ...sh.stages, conti: { ...sh.stages.conti, status: 'stale' as const } } } : sh)) })
      n += hit.length
    }
    return n
  }

  // ── 에셋 (에피소드 단위, .conti/episodes/{ep}/assets.json) ──────────────

  async listAssets(ep: string): Promise<EpisodeAssets> {
    const cached = this.assets.get(ep)
    if (cached) return cached
    const p = this.assetsPath(ep)
    const ea = (await exists(p)) ? EpisodeAssets.parse(JSON.parse(await readText(p))) : EpisodeAssets.parse({ ep })
    this.assets.set(ep, ea)
    return ea
  }

  /** id 가 같으면 교체, 없으면 추가. Character.md 뷰도 다시 쓴다. */
  async upsertAsset(ep: string, asset: Asset): Promise<EpisodeAssets> {
    const prev = await this.listAssets(ep)
    const idx = prev.assets.findIndex((a) => a.id === asset.id)
    const assets = idx === -1 ? [...prev.assets, asset] : prev.assets.map((a, i) => (i === idx ? asset : a))
    const next = EpisodeAssets.parse({ ...prev, ep, assets, rev: prev.rev + 1 })
    this.assets.set(ep, next)
    await writeAtomic(this.assetsPath(ep), JSON.stringify(next, null, 2) + '\n')
    await this.writeView(`${PROJECT_DIRS.character(ep)}/Character.md`, renderCharacterMd(next))
    this.emit({ type: 'assets', ep, assets: next })
    return next
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private assets = new Map<string, EpisodeAssets>()

  private assetsPath(ep: string): string {
    return join(this.root, PROJECT_DIRS.state, 'episodes', ep, 'assets.json')
  }

  private requireSequence(seq: string): Sequence {
    const s = this.sequences.get(seq)
    if (!s) throw new Error(`시퀀스 없음: ${seq}`)
    return s
  }

  private emit(e: StoreEvent) {
    for (const l of this.listeners) l(e)
  }

  private seqPath(ep: string, seq: string): string {
    return join(this.root, PROJECT_DIRS.state, 'episodes', ep, 'sequences', `${seq}.json`)
  }

  private async saveProject() {
    await writeAtomic(join(this.root, PROJECT_DIRS.state, 'project.json'), JSON.stringify(this.project, null, 2) + '\n')
  }

  private async saveSequence(s: Sequence) {
    await writeAtomic(this.seqPath(s.ep, s.seq), JSON.stringify(s, null, 2) + '\n')
  }

  private async loadSequences() {
    const epsDir = join(this.root, PROJECT_DIRS.state, 'episodes')
    if (!(await exists(epsDir))) return
    for (const ep of await readdir(epsDir)) {
      const dir = join(epsDir, ep, 'sequences')
      if (!(await exists(dir))) continue
      for (const f of await readdir(dir)) {
        if (!f.endsWith('.json')) continue
        const s = Sequence.parse(JSON.parse(await readText(join(dir, f))))
        this.sequences.set(s.seq, s)
      }
    }
  }

  private async ensureSequenceDirs(s: Sequence) {
    for (const rel of [
      PROJECT_DIRS.conti(s.ep, s.seq),
      PROJECT_DIRS.image(s.ep, s.seq),
      PROJECT_DIRS.video(s.ep, s.seq),
      PROJECT_DIRS.assetSub(s.ep, 'char'),
      PROJECT_DIRS.assetSub(s.ep, 'loc'),
      PROJECT_DIRS.assetSub(s.ep, 'prop'),
    ]) {
      await mkdir(absPath(this.root, rel), { recursive: true })
    }
  }

  /** md 뷰는 생성할 때마다 해시를 views.json 에 적어 둔다 — 외부 수정 감지용. */
  private async writeView(rel: string, content: string) {
    await writeAtomic(absPath(this.root, rel), content)
    const vp = join(this.root, PROJECT_DIRS.state, 'views.json')
    const views: Record<string, string> = (await exists(vp)) ? JSON.parse(await readText(vp)) : {}
    views[rel] = sha256(content)
    await writeAtomic(vp, JSON.stringify(views, null, 2) + '\n')
  }

  private async writeProjectViews() {
    const p = this.project
    await this.writeView(
      'config.md',
      renderConfigMd({ code: p.code, title: p.title, type: p.type, episodeMap: p.episodeMap }),
    )
    const ppPath = join(this.root, 'Projectprompt.md')
    const existing = (await exists(ppPath)) ? await readText(ppPath) : ''
    const next = upsertStyleAnchor(existing, p)
    if (next !== existing) await writeAtomic(ppPath, next)
  }

  private async writeSequenceViews(s: Sequence) {
    await this.writeView(`${PROJECT_DIRS.conti(s.ep, s.seq)}/shotlist_${s.seq}.md`, renderShotlistMd(s))
    // Sceneprompt / Shotprompt 는 내용이 없을 때만 빈 파일을 만들어 둔다 (기존 스킬 호환)
    for (const name of ['Sceneprompt.md', 'Shotprompt.md']) {
      const p = absPath(this.root, `${PROJECT_DIRS.image(s.ep, s.seq)}/${name}`)
      if (!(await exists(p))) await writeAtomic(p, '')
    }
  }
}

export type StoreEvent =
  | { type: 'project'; project: Project }
  | { type: 'sequence'; sequence: Sequence }
  | { type: 'assets'; ep: string; assets: EpisodeAssets }

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export { EpisodeAssets }
