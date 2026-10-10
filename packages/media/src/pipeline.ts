// 영상 → 콘티 파이프라인 (플랜 §4). 단계마다 결과를 .conti/cache/video/<원본키>/ 에 두고 키가 같으면 다시 하지 않는다.
// 측정은 로컬(토큰 0) → AI 는 시트 몇 장 + 표 한 번 → 샷·패널·원본 프레임·주석으로 시퀀스를 쓴다.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { absPath, writeAtomic, sha256, type ProjectStore } from '@conti/core'
import { PROJECT_DIRS, parseShotFileName, shotFileName, type Shot, type Version } from '@conti/domain'
import { runStructured, type AgentKind, type StructuredResult } from '@conti/agents'
import { audioArgs, concatArgs, findFfmpeg, frameArgs, probe, proxyArgs, run, type Bins } from './ffmpeg'
import { readJson, runConti, type PyConfig, type PyProgress } from './python'
import { assignDialogueToShots, buildShots, fmtTc, type DraftShot } from './merge'
import { PANEL_SCHEMA, applyJudgements, evidenceHash, normalize, pass1Prompt, pass2Prompt, pass2Targets, rowsFor, sheetLabel, type AiRow, type PanelJudgement } from './ai'
import type { Asr, ImportKind, Measure, Probe } from './types'

export const MEASURE_VERSION = 1

export interface ImportProgress {
  stage: 'prepare' | 'setup' | 'proxy' | 'measure' | 'asr' | 'keyframes' | 'sheets' | 'ai' | 'ai2' | 'write' | 'done'
  progress?: number
  message?: string
}

export interface VideoImportRequest {
  kind: ImportKind
  files: string[]
  seq: string
  ep: string
  headingKo?: string
  /** 대사 인식 (오디오가 있을 때). 기본 true */
  asr?: boolean
  asrModel?: string
  /** 대사 언어. 기본 auto(감지) — 강제하면 다른 언어 대사를 번역해 버린다 */
  asrLang?: string
  /** AI 1·2차 분석. null 이면 측정만 (사용자가 나중에 채팅으로) */
  ai?: AgentKind | null
  /** 이미 샷이 있는 시퀀스를 덮어쓸지 */
  overwrite?: boolean
}

export interface VideoImportResult {
  seq: string
  sourceId: string
  shots: number
  panels: number
  review: number
  dialogue: number
  ai: { panels: number; cached: number; pass2: number; inTok: number; outTok: number; ms: number; error?: string } | null
  stages: Record<string, number>
  cached: string[]
  warnings: string[]
  ms: number
}

export interface VideoImportDeps {
  store: ProjectStore
  py: PyConfig
  bins?: Bins
  onProgress?: (p: ImportProgress) => void
  /** 테스트에서 AI 호출을 바꿔 끼운다 */
  runAi?: <T>(req: Parameters<typeof runStructured>[0]) => Promise<StructuredResult<T>>
  concurrency?: number
}

interface SourceFile {
  path: string
  size: number
  mtimeMs: number
  probe: Probe
  work: string // 프로젝트 상대경로
  proxy: string
  audio?: string
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++
      await fn(items[k], k)
    }
  })
  await Promise.all(workers)
}

/** 원본 키 = 경로·크기·수정 시각 (플랜 S0) — 같은 파일을 다시 넣으면 캐시를 그대로 쓴다 */
export function sourceKey(path: string, size: number, mtimeMs: number): string {
  return createHash('sha256').update(`${path}|${size}|${Math.round(mtimeMs)}`).digest('hex').slice(0, 16)
}

const step = (d: VideoImportDeps, stage: ImportProgress['stage'], progress?: number, message?: string) => d.onProgress?.({ stage, progress, message })

export async function importVideo(d: VideoImportDeps, req: VideoImportRequest): Promise<VideoImportResult> {
  const t0 = Date.now()
  const root = d.store.root
  const stages: Record<string, number> = {}
  const cached: string[] = []
  const warnings: string[] = []
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now()
    try {
      return await fn()
    } finally {
      stages[name] = (stages[name] ?? 0) + (Date.now() - s)
    }
  }
  if (!req.files.length) throw new Error('파일이 없습니다')
  const existing = d.store.getSequence(req.seq)
  if (req.kind !== 'audio' && existing?.shots.some((s) => !s.deleted) && !req.overwrite) throw new Error(`${req.seq} 에 이미 샷이 있습니다 — 새 시퀀스 번호를 쓰거나 덮어쓰기를 고르세요`)
  if (req.kind === 'audio' && !existing && req.files.length !== 1) throw new Error('대사 음성은 파일 하나씩 넣습니다')
  const bins = d.bins ?? (await findFfmpeg())
  const conc = d.concurrency ?? 4
  const pyProgress = (stage: ImportProgress['stage']) => (p: PyProgress) => {
    if (p.stage === 'setup' || p.stage === 'uv') step(d, 'setup', undefined, '분석 도구 준비 중 (처음 한 번)')
    else if (typeof p.progress === 'number') step(d, stage, p.progress, p.stage)
  }

  // ── 준비: 원본 정보·작업 폴더 ─────────────────────────────────────────
  step(d, 'prepare', 0)
  const ordered = req.kind === 'clips' ? sortClips(req.files) : req.files
  const files: SourceFile[] = []
  for (const f of ordered) {
    const st = await stat(f)
    const key = sourceKey(f, st.size, st.mtimeMs)
    const work = `${PROJECT_DIRS.state}/cache/video/${key}`
    await mkdir(absPath(root, work), { recursive: true })
    const p = await probe(bins, f)
    if (req.kind !== 'audio' && !p.hasVideo) throw new Error(`영상 트랙이 없습니다: ${basename(f)}`)
    files.push({ path: f, size: st.size, mtimeMs: st.mtimeMs, probe: p, work, proxy: `${work}/proxy.mp4`, audio: p.hasAudio ? `${work}/audio.wav` : undefined })
  }
  const sourceId = req.kind === 'clips' ? sha256(files.map((f) => f.work).join('|')).slice(0, 16) : basename(files[0].work)

  // ── 대사 음성만 ────────────────────────────────────────────────────────
  if (req.kind === 'audio') return importAudio(d, req, files[0], bins, { t0, stages, cached, warnings, timed, sourceId, pyProgress })

  // ── S2 프록시 ──────────────────────────────────────────────────────────
  await timed('proxy', async () => {
    let k = 0
    for (const f of files) {
      const out = absPath(root, f.proxy)
      if (await exists(out)) cached.push(`proxy:${basename(f.path)}`)
      else {
        step(d, 'proxy', k / files.length, basename(f.path))
        await run(bins.ffmpeg, proxyArgs(f.path, `${out}.part.mp4`, f.probe.fps, f.probe.hasAudio))
        await import('node:fs/promises').then((fs) => fs.rename(`${out}.part.mp4`, out))
      }
      if (f.audio && req.asr !== false && !(await exists(absPath(root, f.audio)))) await run(bins.ffmpeg, audioArgs(f.path, absPath(root, f.audio)))
      k++
    }
  })
  let playProxy = files[0].proxy
  if (files.length > 1) {
    playProxy = `${PROJECT_DIRS.state}/cache/video/${sourceId}/proxy.mp4`
    if (!(await exists(absPath(root, playProxy)))) {
      await mkdir(absPath(root, playProxy.replace(/\/[^/]+$/, '')), { recursive: true })
      const list = join(tmpdir(), `nyx-concat-${randomUUID()}.txt`)
      await writeFile(list, files.map((f) => `file '${absPath(root, f.proxy).replace(/'/g, "'\\''")}'`).join('\n') + '\n')
      try {
        await run(bins.ffmpeg, concatArgs(list, absPath(root, playProxy)))
      } finally {
        await rm(list, { force: true })
      }
    }
  }

  // ── S3–S8 측정 / S6 음성 ───────────────────────────────────────────────
  const measures: Measure[] = []
  const asrs: Array<Asr | undefined> = []
  for (const [i, f] of files.entries()) {
    const mPath = absPath(root, `${f.work}/measure.json`)
    let m: Measure | undefined = (await exists(mPath)) ? await readJson<Measure>(mPath).catch(() => undefined) : undefined
    if (m && m.version === MEASURE_VERSION) cached.push(`measure:${basename(f.path)}`)
    else {
      m = await timed('measure', async () => {
        await runConti(d.py, ['measure', '--input', absPath(root, f.proxy), '--out', mPath], { onProgress: (p) => step(d, 'measure', (i + (p.progress ?? 0)) / files.length, `${basename(f.path)} ${p.stage}`) })
        return readJson<Measure>(mPath)
      })
    }
    measures.push(m)
    let a: Asr | undefined
    if (f.audio && req.asr !== false) {
      const model = req.asrModel ?? 'large-v3-turbo'
      const lang = req.asrLang ?? 'auto'
      const aPath = absPath(root, `${f.work}/asr-${model}-${lang}.json`)
      if (await exists(aPath)) {
        a = await readJson<Asr>(aPath)
        cached.push(`asr:${basename(f.path)}`)
      } else {
        try {
          a = await timed('asr', async () => {
            const hot = (await d.store.listAssets(req.ep)).assets.filter((x) => x.kind === 'char').map((x) => x.nameKo).join(' ')
            await runConti(d.py, ['asr', '--input', absPath(root, f.audio!), '--out', aPath, '--model', model, '--lang', lang, ...(hot ? ['--hotwords', hot] : [])], { extras: ['asr'], onProgress: pyProgress('asr') })
            return readJson<Asr>(aPath)
          })
        } catch (e) {
          warnings.push(`대사 인식을 건너뜀: ${(e as Error).message}`)
        }
      }
    }
    asrs.push(a)
  }

  // ── S7·S9·S13 샷 초안 ──────────────────────────────────────────────────
  let shots: DraftShot[] = []
  if (req.kind === 'clips') {
    let offset = 0
    const used = new Set<string>()
    files.forEach((f, i) => {
      const fromName = parseShotFileName(basename(f.path).replace(/\.[^.]+$/, '.png'))?.shot ?? /(?:^|[_\s-])(\d{4})(?:[_\s-]|$)/.exec(basename(f.path))?.[1]
      let base = fromName && !used.has(fromName) ? fromName : String((i + 1) * 10).padStart(4, '0')
      while (used.has(base)) base = String(Number(base) + 10).padStart(4, '0')
      const part = buildShots(measures[i], asrs[i], { baseNo: base, offset, clipIndex: i })
      part.forEach((s) => used.add(s.no))
      shots.push(...part)
      offset += measures[i].duration
    })
  } else {
    shots = buildShots(measures[0], asrs[0])
  }
  if (!shots.length) throw new Error('샷을 찾지 못했습니다')

  // ── 키프레임 (원본 해상도) + 시트용 작은 사본 ───────────────────────────
  const conti = PROJECT_DIRS.conti(req.ep, req.seq)
  await mkdir(absPath(root, conti), { recursive: true })
  const kfDir = `${files.length > 1 ? `${PROJECT_DIRS.state}/cache/video/${sourceId}` : files[0].work}/kf`
  await mkdir(absPath(root, kfDir), { recursive: true })
  const panelsAll = shots.flatMap((s) => s.panels.map((p) => ({ s, p })))
  const frameFile = new Map<string, { rel: string; n: number }>()
  await timed('keyframes', async () => {
    let done = 0
    await pool(panelsAll, conc, async ({ s, p }) => {
      const src = s.clip ? files[s.clip.index] : files[0]
      const local = p.key - (s.clip?.offset ?? 0)
      const key = s.panels.length > 1 ? p.index + 1 : undefined
      const n = await nextFree(absPath(root, conti), (v) => shotFileName({ seq: req.seq, shot: s.no, key, v, ext: 'png' }))
      const rel = `${conti}/${shotFileName({ seq: req.seq, shot: s.no, key, v: n, ext: 'png' })}`
      await run(bins.ffmpeg, frameArgs(src.path, local, absPath(root, rel)))
      const small = absPath(root, `${kfDir}/${p.label}.jpg`)
      await run(bins.ffmpeg, frameArgs(absPath(root, src.proxy), local, small, 480))
      frameFile.set(p.label, { rel, n })
      step(d, 'keyframes', ++done / panelsAll.length)
    })
  })

  // ── S10–S12 AI ────────────────────────────────────────────────────────
  let aiInfo: VideoImportResult['ai'] = null
  if (req.ai) {
    const charHints = (await d.store.listAssets(req.ep)).assets.filter((a) => a.kind === 'char').map((a) => `${a.tag}(${a.nameKo})`)
    const rows = rowsFor(shots)
    const phashAt = (row: AiRow) => {
      const s = shots.find((x) => x.panels.some((p) => p.label === row.id))!
      const m = s.clip ? measures[s.clip.index] : measures[0]
      const local = row.t - (s.clip?.offset ?? 0)
      return m.samples.reduce((a, b) => (Math.abs(b.t - local) < Math.abs(a.t - local) ? b : a), m.samples[0])?.phash ?? ''
    }
    const cachePath = absPath(root, `${files.length > 1 ? `${PROJECT_DIRS.state}/cache/video/${sourceId}` : files[0].work}/ai.json`)
    const cache: Record<string, PanelJudgement> = (await exists(cachePath)) ? await readJson(cachePath) : {}
    const judged = new Map<string, PanelJudgement>()
    const todo: AiRow[] = []
    const hashOf = new Map<string, string>()
    for (const r of rows) {
      const h = evidenceHash(r, phashAt(r), charHints)
      hashOf.set(r.id, h)
      if (cache[h]) judged.set(r.id, { ...cache[h], id: r.id })
      else todo.push(r)
    }
    aiInfo = { panels: todo.length, cached: rows.length - todo.length, pass2: 0, inTok: 0, outTok: 0, ms: 0 }
    const ai = d.runAi ?? runStructured
    try {
      if (todo.length) {
        const sheetSpec = { tiles: todo.map((r) => ({ image: absPath(root, `${kfDir}/${r.id}.jpg`), label: sheetLabel(r) })), out_prefix: absPath(root, `${kfDir}/sheet`) }
        const specPath = absPath(root, `${kfDir}/sheet-spec.json`)
        await writeFile(specPath, JSON.stringify(sheetSpec))
        await timed('sheets', () => runConti(d.py, ['sheets', '--spec', specPath, '--out', absPath(root, `${kfDir}/sheets.json`)]))
        const sheets = (await readJson<{ sheets: string[] }>(absPath(root, `${kfDir}/sheets.json`))).sheets
        step(d, 'ai', 0, `시트 ${sheets.length}장 · 패널 ${todo.length}개`)
        const r1 = await timed('ai', () => ai({ kind: req.ai!, cwd: root, prompt: pass1Prompt(todo, sheets.length, charHints), images: sheets, schema: PANEL_SCHEMA as never, timeoutMs: 600_000 }))
        aiInfo.inTok += r1.usage.inTok
        aiInfo.outTok += r1.usage.outTok
        aiInfo.ms += r1.ms
        const got = normalize(r1.data, new Set(todo.map((r) => r.id)))
        for (const [id, j] of got) judged.set(id, j)
        const missing = todo.filter((r) => !got.has(r.id)).map((r) => r.id)
        if (missing.length) warnings.push(`AI 가 패널 ${missing.length}개를 빠뜨렸습니다: ${missing.slice(0, 6).join(', ')}`)
        // 2차: 확신 낮은 패널만 3프레임 스트립으로
        const targets = pass2Targets(got, rows.length)
        if (targets.length) {
          step(d, 'ai2', 0, `${targets.length}개 다시 보기`)
          const strips: Array<{ label: string; images: string[] }> = []
          for (const id of targets) {
            const s = shots.find((x) => x.panels.some((p) => p.label === id))!
            const p = s.panels.find((x) => x.label === id)!
            const src = s.clip ? files[s.clip.index] : files[0]
            const off = s.clip?.offset ?? 0
            const imgs: string[] = []
            for (const [k, t] of [p.t0 + 0.1, (p.t0 + p.t1) / 2, p.t1 - 0.1].entries()) {
              const out = absPath(root, `${kfDir}/${id}-s${k}.jpg`)
              await run(bins.ffmpeg, frameArgs(absPath(root, src.proxy), Math.max(0, t - off), out, 480))
              imgs.push(out)
            }
            strips.push({ label: `${id} ${fmtTc(p.t0)}–${fmtTc(p.t1)}`, images: imgs })
          }
          const spec2 = absPath(root, `${kfDir}/strip-spec.json`)
          await writeFile(spec2, JSON.stringify({ strips, out_prefix: absPath(root, `${kfDir}/strip`), strip_prefix: absPath(root, `${kfDir}/strip`) }))
          await runConti(d.py, ['sheets', '--spec', spec2, '--out', absPath(root, `${kfDir}/strips.json`)])
          const stripImgs = (await readJson<{ strips: string[] }>(absPath(root, `${kfDir}/strips.json`))).strips
          const rows2 = rows.filter((r) => targets.includes(r.id))
          const r2 = await timed('ai2', () => ai({ kind: req.ai!, cwd: root, prompt: pass2Prompt(rows2, charHints), images: stripImgs, schema: PANEL_SCHEMA as never, timeoutMs: 600_000 }))
          aiInfo.inTok += r2.usage.inTok
          aiInfo.outTok += r2.usage.outTok
          aiInfo.ms += r2.ms
          aiInfo.pass2 = targets.length
          for (const [id, j] of normalize(r2.data, new Set(targets))) judged.set(id, j)
        }
        for (const r of todo) {
          const j = judged.get(r.id)
          if (j) cache[hashOf.get(r.id)!] = j
        }
        await writeAtomic(cachePath, JSON.stringify(cache))
      }
    } catch (e) {
      aiInfo.error = (e as Error).message
      warnings.push(`AI 분석 실패 — 측정 결과만 썼습니다: ${(e as Error).message}`)
    }
    applyJudgements(shots, judged)
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────────
  step(d, 'write', 0)
  const now = Date.now()
  const seqShots: Shot[] = shots.map((s) => {
    const panels = s.panels.map((p) => {
      const f = frameFile.get(p.label)!
      const v: Version = { id: randomUUID(), n: f.n, stage: 'conti', file: f.rel, source: 'video_frame', createdAt: now }
      return { id: randomUUID(), index: p.index, captionKo: (p as typeof p & { caption?: string }).caption, annotations: p.annotations, versions: { conti: [v], image: [] } }
    })
    return {
      id: randomUUID(),
      no: s.no,
      sizeCode: s.sizeCode,
      angle: s.angle,
      cameraMove: s.cameraMove,
      durationSec: Math.round((s.t1 - s.t0) * 1000) / 1000,
      tc: { inMs: Math.round(s.t0 * 1000), outMs: Math.round(s.t1 * 1000) },
      characters: s.characters ?? [],
      props: [],
      actionKo: s.actionKo ?? '',
      dialogue: s.dialogue,
      tag: s.tag,
      sourceLines: [],
      review: [...new Set(s.review)],
      panels,
      stages: { conti: { status: 'review', currentVersionId: panels[0].versions.conti[0].id, updatedAt: now }, image: { status: 'none' }, video: { status: 'none' } },
    } as Shot
  })
  await d.store.upsertSequence({
    ...(existing ?? {}),
    seq: req.seq,
    ep: req.ep,
    headingKo: req.headingKo ?? existing?.headingKo ?? basename(files[0].path).replace(/\.[^.]+$/, ''),
    source: { kind: 'video', sourceId, proxy: playProxy },
    breakdown: { status: 'draft' },
    shots: seqShots,
  })
  await registerSource(d.store, { id: sourceId, kind: req.kind, files, proxy: playProxy })
  step(d, 'done', 1)
  return {
    seq: req.seq,
    sourceId,
    shots: seqShots.length,
    panels: seqShots.reduce((n, s) => n + s.panels.length, 0),
    review: seqShots.filter((s) => s.review.length).length,
    dialogue: seqShots.reduce((n, s) => n + s.dialogue.length, 0),
    ai: aiInfo,
    stages,
    cached,
    warnings,
    ms: Date.now() - t0,
  }
}

async function importAudio(
  d: VideoImportDeps,
  req: VideoImportRequest,
  f: SourceFile,
  bins: Bins,
  ctx: { t0: number; stages: Record<string, number>; cached: string[]; warnings: string[]; timed: <T>(n: string, fn: () => Promise<T>) => Promise<T>; sourceId: string; pyProgress: (s: ImportProgress['stage']) => (p: PyProgress) => void },
): Promise<VideoImportResult> {
  const root = d.store.root
  const wav = absPath(root, `${f.work}/audio.wav`)
  if (!(await exists(wav))) await run(bins.ffmpeg, audioArgs(f.path, wav))
  const model = req.asrModel ?? 'large-v3-turbo'
  const lang = req.asrLang ?? 'auto'
  const aPath = absPath(root, `${f.work}/asr-${model}-${lang}.json`)
  if (!(await exists(aPath))) await ctx.timed('asr', () => runConti(d.py, ['asr', '--input', wav, '--out', aPath, '--model', model, '--lang', lang], { extras: ['asr'], onProgress: ctx.pyProgress('asr') }))
  else ctx.cached.push('asr')
  const asr = await readJson<Asr>(aPath)
  const existing = d.store.getSequence(req.seq)
  let count = 0
  if (existing?.shots.some((s) => s.tc)) {
    const map = assignDialogueToShots(asr.segments, existing.shots.filter((s) => !s.deleted))
    const shots = existing.shots.map((s) => {
      const add = map.get(s.no)
      if (!add || s.dialogue.length) return s
      count += add.length
      return { ...s, dialogue: add, tag: '대사' as const, review: [...new Set([...s.review, ...(asr.segments.some((l) => l.low && add.some((a) => a.text === l.text)) ? (['asr_low'] as const) : [])])] }
    })
    await d.store.upsertSequence({ ...existing, shots })
    const free = asr.segments.length - count
    if (free > 0) ctx.warnings.push(`대사 ${free}줄은 이미 대사가 있거나 타임코드가 맞는 샷이 없어 붙이지 않았습니다`)
  } else {
    // 샷이 없거나 타임코드가 없으면: 대사 줄마다 샷 하나 (콘티는 아직 없음)
    const base = existing?.shots.filter((s) => !s.deleted) ?? []
    const start = base.length ? Math.max(...base.map((s) => Number(s.no))) + 10 : 10
    const add: Shot[] = asr.segments.map((l, i) => ({
      id: randomUUID(),
      no: String(start + i * 10).padStart(4, '0'),
      durationSec: Math.max(0.6, Math.round((l.t1 - l.t0) * 1000) / 1000),
      tc: { inMs: Math.round(l.t0 * 1000), outMs: Math.round(l.t1 * 1000) },
      characters: [],
      props: [],
      actionKo: '',
      dialogue: [{ text: l.text, tIn: l.t0, tOut: l.t1, asrConf: Math.round(Math.exp(l.logprob) * 1000) / 1000 }],
      tag: '대사',
      sourceLines: [],
      review: l.low ? ['asr_low'] : [],
      panels: [],
      stages: { conti: { status: 'none' }, image: { status: 'none' }, video: { status: 'none' } },
    })) as Shot[]
    count = add.length
    await d.store.upsertSequence({ ...(existing ?? {}), seq: req.seq, ep: req.ep, headingKo: req.headingKo ?? existing?.headingKo ?? basename(f.path).replace(/\.[^.]+$/, ''), shots: [...(existing?.shots ?? []), ...add] })
  }
  await registerSource(d.store, { id: ctx.sourceId, kind: 'audio', files: [f], proxy: undefined })
  step(d, 'done', 1)
  const seq = d.store.getSequence(req.seq)!
  return { seq: req.seq, sourceId: ctx.sourceId, shots: seq.shots.filter((s) => !s.deleted).length, panels: 0, review: seq.shots.filter((s) => s.review.length).length, dialogue: count, ai: null, stages: ctx.stages, cached: ctx.cached, warnings: ctx.warnings, ms: Date.now() - ctx.t0 }
}

/** 샷별 클립 정렬: 파일명의 샷 번호(0010) 순, 없으면 이름 순 */
export function sortClips(files: string[]): string[] {
  const no = (f: string) => {
    const m = /(?:^|[_\s-])(\d{4})(?:[_\s-]|$)/.exec(basename(f))
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
  }
  return [...files].sort((a, b) => no(a) - no(b) || basename(a).localeCompare(basename(b)))
}

async function nextFree(absDir: string, name: (v: number) => string): Promise<number> {
  for (let v = 1; ; v++) if (!(await exists(join(absDir, name(v))))) return v
}

/** .conti/sources.json — 원본은 복사하지 않고 경로만 기억한다 (플랜 §11-5) */
async function registerSource(store: ProjectStore, s: { id: string; kind: ImportKind; files: SourceFile[]; proxy?: string }) {
  const p = absPath(store.root, `${PROJECT_DIRS.state}/sources.json`)
  let list: Array<Record<string, unknown>> = []
  try {
    list = JSON.parse(await readFile(p, 'utf8'))
  } catch {
    list = []
  }
  list = list.filter((x) => x.id !== s.id)
  list.push({ id: s.id, kind: s.kind, proxy: s.proxy, files: s.files.map((f) => ({ path: f.path, size: f.size, mtimeMs: f.mtimeMs, probe: f.probe, work: f.work })), at: Date.now() })
  await writeAtomic(p, JSON.stringify(list, null, 2) + '\n')
}
