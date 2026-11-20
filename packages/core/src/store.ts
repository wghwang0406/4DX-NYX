import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  Project,
  Sequence,
  EpisodeAssets,
  Asset,
  KO_PAIRS,
  PROJECT_DIRS,
  diffAsset,
  assetSnapshot,
  shotUsesTag,
  withKoSync,
  type AssetHistoryEntry,
  type AssetWriteMeta,
  type Shot,
} from '@conti/domain'
import { absPath, exists, readText, sha256, writeAtomic } from './fs'
import { parseConfigMd, renderConfigMd } from './md/config'
import { renderShotlistMd } from './md/shotlist'
import { upsertStyleAnchor } from './md/projectprompt'
import { renderCharacterMd } from './md/character'

/**
 * ProjectStore — 프로젝트 상태의 단일 writer.
 * 진실은 .conti/*.json. md 파일(config.md, shotlist, Projectprompt 앵커 절)은 여기서 생성하는 뷰다.
 */
/**
 * 바뀌면 그 에셋이 나오는 콘티를 다시 그려야 하는 필드 (생성 프롬프트·레퍼런스에 들어가는 것).
 * descriptionKo 는 영문 앵커가 비었을 때만 프롬프트에 들어가므로 그때만 센다 (patchAsset).
 */
export const VISUAL_ASSET_KEYS = ['anchorEn', 'cameraAnchorEn', 'descriptionKo', 'state', 'views'] as const

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

  /**
   * id 가 같으면 교체, 없으면 추가. Character.md 뷰도 다시 쓴다.
   * 글·이미지가 실제로 바뀌었으면 수정 히스토리에 한 줄 남긴다 (meta.by = 누가: 사람·AI·자동 맞춤·생성·되돌리기).
   */
  async upsertAsset(ep: string, asset: Asset, meta: AssetWriteMeta = {}): Promise<EpisodeAssets> {
    return this.assetLock(ep, () => this.writeAsset(ep, asset, meta))
  }

  /**
   * 지금 값을 읽어 고친 뒤 저장 — 읽기·쓰기 사이에 다른 쓰기가 끼지 않는다 (같은 에셋의 뷰 생성 작업 여러 개가 동시에 끝나도 버전이 사라지지 않게).
   */
  async mutateAsset(ep: string, id: string, fn: (cur: Asset) => Asset, meta: AssetWriteMeta = {}): Promise<{ prev: Asset; asset: Asset; rev: number }> {
    return this.assetLock(ep, async () => {
      const prev = (await this.listAssets(ep)).assets.find((a) => a.id === id)
      if (!prev) throw new Error(`에셋 없음: ${id}`)
      const asset = Asset.parse({ ...fn(prev), id: prev.id })
      const next = await this.writeAsset(ep, asset, meta)
      return { prev, asset, rev: next.rev }
    })
  }

  /**
   * 기존 에셋에 준 필드만 덮어쓴다 (UI 카드 수정 · MCP assets_upsert 공용).
   * 외형 필드가 실제로 바뀌면 그 에셋이 나오는 콘티 컷을 재생성 필요(stale)로 표시한다.
   */
  async patchAsset(ep: string, id: string, patch: Partial<Omit<Asset, 'id'>>, meta: AssetWriteMeta = {}): Promise<{ asset: Asset; staleShots: number; rev: number }> {
    const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<Asset>
    const { prev, asset, rev } = await this.mutateAsset(ep, id, (cur) => ({ ...cur, ...given }), meta)
    const changed = VISUAL_ASSET_KEYS.some(
      (k) => k in given && JSON.stringify(given[k]) !== JSON.stringify(prev[k]) && (k !== 'descriptionKo' || !asset.anchorEn.trim()),
    )
    const staleShots = changed ? await this.markStaleByAsset(asset.tag) : 0
    return { asset, staleShots, rev }
  }

  // ── 에셋 수정 히스토리 · 씬 연결 · 복제 ──────────────────────────────────

  /** 한 에셋의 히스토리 (최신이 앞) */
  async assetHistory(ep: string, assetId: string): Promise<AssetHistoryEntry[]> {
    const p = this.historyPath(ep)
    if (!(await exists(p))) return []
    const out: AssetHistoryEntry[] = []
    for (const line of (await readText(p)).split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as AssetHistoryEntry
        if (e.assetId === assetId) out.push(e)
      } catch {
        /* 깨진 줄은 건너뛴다 */
      }
    }
    return out.reverse()
  }

  /**
   * 글을 그 히스토리 항목 시점으로 되돌린다 (그 항목의 snapshot 을 덮어씀). 씬 연결(usedIn)은 그대로 둔다.
   * 한·영 짝이 둘 다 있으면 서로 맞춰진 것으로 기록해 다시 번역하지 않는다.
   */
  async restoreAsset(ep: string, id: string, entryId: string): Promise<{ asset: Asset; staleShots: number }> {
    const entry = (await this.assetHistory(ep, id)).find((e) => e.id === entryId)
    if (!entry) throw new Error('히스토리 항목이 없습니다')
    const cur = await this.requireAsset(ep, id)
    const patch: Record<string, unknown> = {}
    for (const [f, v] of Object.entries(entry.snapshot)) {
      if (f === 'usedIn') continue
      if (v == null) {
        if (f !== 'subkind' && cur[f as keyof Asset] != null) patch[f] = ''
      } else patch[f] = v
    }
    let koSync = cur.koSync
    for (const p of KO_PAIRS) {
      const en = (patch[p.en] ?? cur[p.en] ?? '') as string
      const ko = (patch[p.ko] ?? cur[p.ko] ?? '') as string
      if (en.trim() && ko.trim()) koSync = withKoSync({ koSync }, p.en, { en, ko })
    }
    const when = new Date(entry.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const r = await this.patchAsset(ep, id, { ...patch, koSync } as Partial<Asset>, { by: 'restore', action: 'restore', note: `${when} 시점으로` })
    return { asset: r.asset, staleShots: r.staleShots }
  }

  /** 예전 이미지 버전을 다시 현재로 — 같은 파일을 새 번호로 추가한다 (최신 번호 = 현재, 크레딧 0) */
  async restoreAssetImage(ep: string, id: string, view: string, versionId: string): Promise<{ asset: Asset; staleShots: number }> {
    const cur = await this.requireAsset(ep, id)
    const vers = cur.views[view] ?? []
    const v = vers.find((x) => x.id === versionId)
    if (!v) throw new Error('이미지 버전이 없습니다')
    const n = Math.max(...vers.map((x) => x.n)) + 1
    const copy = { ...v, id: randomUUID(), n, parentId: v.id, createdAt: Date.now() }
    const r = await this.patchAsset(ep, id, { views: { ...cur.views, [view]: [...vers, copy] } }, { by: 'restore', action: 'restore', note: `${view} v${v.n} 을 다시 현재로` })
    return { asset: r.asset, staleShots: r.staleShots }
  }

  /** 다른 씬의 에셋을 이 씬에서도 그대로 쓴다 (같은 에셋 — 고치면 양쪽에 반영) */
  async linkAsset(ep: string, id: string, seq: string): Promise<Asset> {
    const cur = await this.requireAsset(ep, id)
    if (cur.usedIn.includes(seq)) return cur
    return (await this.patchAsset(ep, id, { usedIn: [...cur.usedIn, seq].sort() }, { action: 'link', note: `${seq} 에서도 쓰기` })).asset
  }

  /** 이 씬에서 뺀다. 이 씬 샷이 태그로 쓰고 있으면 거부 */
  async unlinkAsset(ep: string, id: string, seq: string): Promise<Asset> {
    const cur = await this.requireAsset(ep, id)
    const using = (this.sequences.get(seq)?.shots ?? []).filter((sh) => shotUsesTag(sh, cur.tag)).length
    if (using) throw new Error(`${seq} 샷 ${using}개가 ${cur.tag} 를 쓰고 있어 뺄 수 없습니다`)
    return (await this.patchAsset(ep, id, { usedIn: cur.usedIn.filter((s) => s !== seq) }, { action: 'unlink', note: `${seq} 에서 빼기` })).asset
  }

  /**
   * 복제해서 변형 — 글·이미지 버전을 그대로 가진 새 에셋(새 태그)을 이 씬용으로 만든다.
   * replaceInSeq 면 이 씬 샷의 원래 태그를 새 태그로 바꾸고 원래 에셋을 이 씬에서 뺀다 (이 씬의 경찰차는 B 로).
   */
  async copyAsset(ep: string, id: string, seq: string, init: { tag: string; nameKo: string; replaceInSeq?: boolean }): Promise<{ asset: Asset; retagged: number }> {
    const src = await this.requireAsset(ep, id)
    const tag = init.tag.trim().normalize('NFC')
    if (!/^@\S+$/.test(tag)) throw new Error('태그는 @로 시작하고 띄어쓰기가 없어야 합니다')
    if ((await this.listAssets(ep)).assets.some((a) => a.tag === tag)) throw new Error(`이미 있는 태그입니다: ${tag}`)
    const asset = Asset.parse({ ...src, id: randomUUID(), tag, nameKo: init.nameKo.trim() || src.nameKo, usedIn: [seq] })
    await this.upsertAsset(ep, asset, { action: 'copy', note: `${src.tag} 에서 복제` })
    let retagged = 0
    if (init.replaceInSeq) {
      retagged = await this.retagShots(seq, src.tag, tag)
      if (src.usedIn.includes(seq)) await this.patchAsset(ep, src.id, { usedIn: src.usedIn.filter((s) => s !== seq) }, { action: 'unlink', note: `${seq} 은 ${tag} 로` })
    }
    return { asset, retagged }
  }

  /** 이 씬 샷의 태그를 바꾼다 (인물·장소·소품). 바꾼 샷 수 */
  async retagShots(seq: string, from: string, to: string): Promise<number> {
    const s = this.sequences.get(seq)
    if (!s) return 0
    let n = 0
    const shots = s.shots.map((sh) => {
      if (!shotUsesTag(sh, from)) return sh
      n++
      const swap = (xs: string[]) => xs.map((x) => (x === from ? to : x))
      return { ...sh, characters: swap(sh.characters), props: swap(sh.props), location: sh.location === from ? to : sh.location }
    })
    if (n) await this.upsertSequence({ ...s, shots })
    return n
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private assetLocks = new Map<string, Promise<unknown>>()

  /** 에피소드 에셋 쓰기를 한 줄로 세운다 */
  private assetLock<T>(ep: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.assetLocks.get(ep) ?? Promise.resolve()).then(fn, fn)
    this.assetLocks.set(
      ep,
      run.catch(() => undefined),
    )
    return run
  }

  private async writeAsset(ep: string, asset: Asset, meta: AssetWriteMeta): Promise<EpisodeAssets> {
    const prev = await this.listAssets(ep)
    const idx = prev.assets.findIndex((a) => a.id === asset.id)
    const assets = idx === -1 ? [...prev.assets, asset] : prev.assets.map((a, i) => (i === idx ? asset : a))
    const next = EpisodeAssets.parse({ ...prev, ep, assets, rev: prev.rev + 1 })
    this.assets.set(ep, next)
    await this.logAssetChange(ep, idx === -1 ? undefined : prev.assets[idx], asset, meta)
    await writeAtomic(this.assetsPath(ep), JSON.stringify(next, null, 2) + '\n')
    await this.writeView(`${PROJECT_DIRS.character(ep)}/Character.md`, renderCharacterMd(next))
    this.emit({ type: 'assets', ep, assets: next })
    return next
  }

  private async requireAsset(ep: string, id: string): Promise<Asset> {
    const a = (await this.listAssets(ep)).assets.find((x) => x.id === id)
    if (!a) throw new Error(`에셋 없음: ${id}`)
    return a
  }

  private historyPath(ep: string): string {
    return join(this.root, PROJECT_DIRS.state, 'episodes', ep, 'asset-history.ndjson')
  }

  private async logAssetChange(ep: string, prev: Asset | undefined, next: Asset, meta: AssetWriteMeta) {
    const { changes, images } = diffAsset(prev, next)
    if (prev && !changes.length && !images.length) return
    const action = meta.action ?? (!prev ? 'create' : !changes.length ? 'image' : 'edit')
    const entry: AssetHistoryEntry = {
      id: randomUUID(),
      at: Date.now(),
      assetId: next.id,
      tag: next.tag,
      by: meta.by ?? 'user',
      action,
      ...(meta.note ? { note: meta.note } : {}),
      changes,
      images,
      snapshot: assetSnapshot(next),
    }
    const p = this.historyPath(ep)
    await mkdir(dirname(p), { recursive: true })
    await appendFile(p, JSON.stringify(entry) + '\n', 'utf8')
  }

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
