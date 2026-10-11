// 승인된 유료 요청 → 작업 계획(JobPlan[]). 프롬프트·모델·파라미터·레퍼런스를 여기서 전부 정한다.
// 실제 크레딧은 JobService 가 쓴다. 계획 자체는 무료라 승인 카드가 펼쳐 보여줄 수 있다.
import { existsSync } from 'node:fs'
import { absPath, type ProjectStore } from '@conti/core'
import { ASSET_VIEWS, MASTER_VIEW, PROJECT_DIRS, type Asset, type AssetKind, type Project, type Sequence, type Shot, type VersionSource } from '@conti/domain'
import { ROUTE, type ModelTable } from './models'
import { buildContiPrompt, styleLineFor } from './prompts/conti'
import { charPlatePrompt, charSheetPrompt, locMasterPrompt, locViewPrompt, propPrompt } from './prompts/assets'
import { restylePrompt, surgicalEditPrompt } from './prompts/edit'
import { buildShotImagePrompt, imageViewsForShotSize, type ImageRef } from './prompts/image'
import { currentContiVersion, latestView, pickShotRefs, pickView } from './refs'

export type SpendKind = 'conti_generate' | 'assets_generate' | 'image_edit' | 'panel_restyle' | 'image_generate'

export interface ShotTarget {
  type: 'shot'
  ep: string
  seq: string
  shotId: string
  shotNo: string
  /** 'image' = 콘티 기반 최종 이미지 단계 (없으면 콘티) */
  stage?: 'conti' | 'image'
}
export interface AssetTarget {
  type: 'asset'
  ep: string
  assetId: string
  tag: string
  kind: AssetKind
  view: string
}
/** 시퀀스 배경 폴백 한 장 (장소 에셋이 없을 때 — GenConti2Img Step 2-C) */
export interface BackgroundTarget {
  type: 'background'
  ep: string
  seq: string
}
export type JobTarget = ShotTarget | AssetTarget | BackgroundTarget

export interface PlanRef {
  file: string // 프로젝트 상대경로
  label: string
}

export interface JobPlan {
  kind: SpendKind
  target: JobTarget
  model: string // CLI 에 넘기는 id (별칭 허용)
  params: Record<string, string>
  prompt: string
  refs: PlanRef[]
  /** 같은 계획 안의 다른 작업 결과를 첫 레퍼런스로 쓴다 (char 파생 ← sheet, loc 뷰 ← wide). */
  dependsOn?: number
  source: VersionSource
  parentVersionId?: string
  lint: string[]
  style?: 'sketch' | 'cinematic'
  /** 'codex' = 로그인한 Codex 의 GPT 이미지로 만든다 (Higgsfield 아님) */
  engine?: 'higgsfield' | 'codex'
}

export interface PlanResult {
  plans: JobPlan[]
  /** 파일럿이면 남은 샷 — 파일럿이 끝난 뒤 후속 승인 카드를 만든다 */
  rest?: { args: Record<string, unknown>; count: number }
  notes: string[]
}

export interface PlanContext {
  store: ProjectStore
  models: ModelTable
}

export interface PlanOptions {
  includeNeighbors?: boolean
}

export class PlanError extends Error {}

const liveShots = (s: Sequence) => s.shots.filter((x) => !x.deleted)

function requireSeq(store: ProjectStore, seq: string): Sequence {
  const s = store.getSequence(seq)
  if (!s) throw new PlanError(`시퀀스 없음: ${seq}`)
  return s
}

function imageParams(models: ModelTable, model: string, project: Project, aspect?: string, quality?: string): Record<string, string> {
  return {
    aspect_ratio: models.clampAspect(model, aspect ?? project.defaults.aspect),
    ...models.imageParams(model, quality ?? project.defaults.quality, '2k'),
  }
}

/** 앞뒤 컷 포함 — 사용자 체크박스. 대상마다 바로 앞·뒤 live 샷을 더한다 (순서 유지, 중복 제거). */
export function expandNeighbors(seq: Sequence, nos: string[]): string[] {
  const live = liveShots(seq).map((s) => s.no)
  const set = new Set(nos)
  for (const n of nos) {
    const i = live.indexOf(n)
    if (i > 0) set.add(live[i - 1])
    if (i >= 0 && i < live.length - 1) set.add(live[i + 1])
  }
  return live.filter((n) => set.has(n))
}

/** 이 요청이 쓸 이미지 엔진: 요청 인자(engine) > 프로젝트 기본값 > higgsfield */
export function engineFor(ctx: PlanContext, args: Record<string, unknown>): 'higgsfield' | 'codex' {
  const e = args.engine ?? ctx.store.getProject().defaults.imageEngine
  return e === 'codex' ? 'codex' : 'higgsfield'
}

export async function planRequest(ctx: PlanContext, kind: SpendKind, args: Record<string, unknown>, decision: 'approved' | 'pilot', opts: PlanOptions = {}): Promise<PlanResult> {
  const r = await planByKind(ctx, kind, args, decision, opts)
  const engine = engineFor(ctx, args)
  // 파일럿 후속 카드도 같은 엔진으로
  if (r.rest) r.rest.args = { ...r.rest.args, engine }
  if (engine !== 'codex') return r
  return { ...r, plans: r.plans.map(toCodexPlan), notes: [...r.notes, ...codexNotes(r.plans)] }
}

/** GPT(Codex) 엔진: 프롬프트·레퍼런스·체인은 그대로, 모델은 codex_image, 플랫폼 파라미터는 비율만. */
export function toCodexPlan(p: JobPlan): JobPlan {
  return { ...p, engine: 'codex', model: CODEX_IMAGE_MODEL, params: { aspect_ratio: p.params.aspect_ratio ?? '16:9' } }
}

function codexNotes(plans: JobPlan[]): string[] {
  const notes = ['GPT(Codex) 로 생성 — Higgsfield 크레딧을 쓰지 않고 Codex(ChatGPT) 사용량을 씁니다. 한 장에 1–2분']
  if (plans.some((p) => p.params.custom_reference_id)) notes.push('Soul ID 는 Soul 계열 모델에만 있어 GPT 에서는 쓰지 않습니다 — 시트 레퍼런스·외형 설명으로 정체성을 맞춥니다')
  return notes
}

export const CODEX_IMAGE_MODEL = 'codex_image'

async function planByKind(ctx: PlanContext, kind: SpendKind, args: Record<string, unknown>, decision: 'approved' | 'pilot', opts: PlanOptions): Promise<PlanResult> {
  switch (kind) {
    case 'conti_generate':
      return planConti(ctx, args as { seq: string; shots: string[]; style: 'sketch' | 'cinematic'; pilot?: boolean }, decision, opts)
    case 'assets_generate':
      return planAssets(ctx, args as { ep: string; ids: string[]; views?: string[] })
    case 'image_edit':
      return planEdit(ctx, args as { seq: string; shotNo: string; instructionEn: string; model?: string })
    case 'panel_restyle':
      return planRestyle(ctx, args as { seq: string; shotNos: string[] })
    case 'image_generate':
      return planImage(ctx, args as { seq: string; shots: string[]; pilot?: boolean; model?: string }, decision, opts)
  }
}

async function planConti(ctx: PlanContext, a: { seq: string; shots: string[]; style: 'sketch' | 'cinematic'; pilot?: boolean }, decision: 'approved' | 'pilot', opts: PlanOptions): Promise<PlanResult> {
  const project = ctx.store.getProject()
  const seq = requireSeq(ctx.store, a.seq)
  const assets = (await ctx.store.listAssets(seq.ep)).assets
  const notes: string[] = []
  let nos = opts.includeNeighbors ? expandNeighbors(seq, a.shots) : a.shots
  if (opts.includeNeighbors && nos.length !== a.shots.length) notes.push(`앞뒤 컷 포함: ${nos.length - a.shots.length}장 추가`)
  const pilot = decision === 'pilot' || !!a.pilot
  let rest: PlanResult['rest']
  if (pilot && nos.length > 1) {
    rest = { args: { seq: a.seq, shots: nos.slice(1), style: a.style, pilot: false }, count: nos.length - 1 }
    nos = nos.slice(0, 1)
  }
  const model = ROUTE.conti
  const plans: JobPlan[] = []
  for (const no of nos) {
    const shot = liveShots(seq).find((s) => s.no === no)
    if (!shot) throw new PlanError(`샷 없음: ${a.seq} ${no}`)
    const refs = pickShotRefs(shot, assets, ctx.models.maxImages(model))
    const built = buildContiPrompt({ project, sequence: seq, shot, assets, style: a.style, refs })
    plans.push({
      kind: 'conti_generate',
      target: { type: 'shot', ep: seq.ep, seq: seq.seq, shotId: shot.id, shotNo: shot.no },
      model,
      params: imageParams(ctx.models, model, project),
      prompt: built.text,
      refs: refs.map((r) => ({ file: r.file, label: `${r.tag} ${r.view}` })),
      source: 'generated',
      lint: built.warnings,
      style: a.style,
    })
  }
  return { plans, rest, notes }
}

/** 시퀀스 배경 폴백 파일 (GenConti2Img: {EP}/Image/{SEQ}/{SEQ}_Background.png) */
export const backgroundFile = (ep: string, seq: string) => `${PROJECT_DIRS.image(ep, seq)}/${seq}_Background.png`

/** 이미지 단계 레퍼런스 — 등장체(샷 사이즈별 뷰, 뒷모습이면 back) → 배경 → 소품. 콘티는 planImage 가 마지막에 붙인다. */
export function pickImageRefs(shot: Shot, assets: Asset[], size: string | undefined, charView: 'front' | 'back' | undefined, max: number): ImageRef[] {
  const byTag = new Map(assets.map((x) => [x.tag, x]))
  const v = imageViewsForShotSize(size, charView)
  const out: ImageRef[] = []
  const push = (role: ImageRef['role'], tag: string, want: string) => {
    const asset = byTag.get(tag)
    const p = asset ? pickView(asset, want) : undefined
    if (p) out.push({ role, tag, view: p.view, file: p.version.file, label: `${tag} ${p.view}` })
  }
  for (const c of shot.characters) push('char', c, v.char)
  if (shot.location) push('loc', shot.location, v.loc)
  for (const p of shot.props) push('prop', p, v.prop)
  return out.slice(0, Math.max(0, max))
}

/**
 * 콘티 → 영상용 최종 이미지 (GenConti2Img). 콘티(현재 버전)가 있는 샷만.
 * 분석(샷 사이즈·앵글·표정, 콘티 사용 여부)은 앱이 미리 `shot.imageAnalysis` 에 넣어 둔다 — 없거나 낡았으면 샷 표 값으로 폴백 + 경고.
 */
async function planImage(ctx: PlanContext, a: { seq: string; shots: string[]; pilot?: boolean; model?: string }, decision: 'approved' | 'pilot', opts: PlanOptions): Promise<PlanResult> {
  const project = ctx.store.getProject()
  const seq = requireSeq(ctx.store, a.seq)
  const assets = (await ctx.store.listAssets(seq.ep)).assets
  const notes: string[] = []
  let nos = opts.includeNeighbors ? expandNeighbors(seq, a.shots) : a.shots
  if (opts.includeNeighbors && nos.length !== a.shots.length) notes.push(`앞뒤 컷 포함: ${nos.length - a.shots.length}장 추가`)
  const noConti = nos.filter((no) => {
    const shot = liveShots(seq).find((s) => s.no === no)
    return !shot || !currentContiVersion(shot)
  })
  if (noConti.length) throw new PlanError(`콘티 이미지가 없습니다: ${noConti.join(', ')} — 먼저 콘티를 만드세요`)
  const pilot = decision === 'pilot' || !!a.pilot
  let rest: PlanResult['rest']
  if (pilot && nos.length > 1) {
    rest = { args: { seq: a.seq, shots: nos.slice(1), pilot: false, ...(a.model ? { model: a.model } : {}) }, count: nos.length - 1 }
    nos = nos.slice(0, 1)
  }
  // 모델 단축명 gpt(기본, = gpt_image_2_5) / nano / cinema / soulcine
  const model = a.model ? ctx.models.resolve(a.model) : ROUTE.image
  const plans: JobPlan[] = []
  const unanalyzed: string[] = []
  let bgIdx: number | undefined
  const bgRel = backgroundFile(seq.ep, seq.seq)
  for (const no of nos) {
    const shot = liveShots(seq).find((s) => s.no === no)!
    const conti = currentContiVersion(shot)!
    const an = shot.imageAnalysis?.contiVersionId === conti.id ? shot.imageAnalysis : undefined
    if (!an) unanalyzed.push(no)
    const useConti = an?.useConti ?? true
    const refs = pickImageRefs(shot, assets, an?.shotSize ?? shot.sizeCode, an?.charView, ctx.models.maxImages(model) - (useConti ? 2 : 1))
    // 배경: 장소 에셋이 없으면 시퀀스 배경 폴백 (있으면 그 파일, 없으면 한 장 먼저 만든다)
    let dependsOn: number | undefined
    if (!refs.some((r) => r.role === 'loc')) {
      if (existsSync(absPath(ctx.store.root, bgRel))) refs.push({ role: 'background', file: bgRel, label: `${seq.seq} 배경` })
      else {
        if (bgIdx === undefined) {
          bgIdx = plans.length
          plans.push(backgroundPlan(ctx, project, seq))
          notes.push(`장소 에셋이 없어 ${seq.seq} 배경 한 장을 먼저 만듭니다 (Soul Cinema) — Assets 에서 장소 4뷰를 만들면 샷 사이즈에 맞는 뷰가 자동으로 붙습니다`)
        }
        dependsOn = bgIdx
      }
    }
    if (useConti) refs.push({ role: 'conti', file: conti.file, label: `${shot.no} 콘티 v${conti.n}` })
    const promptRefs: ImageRef[] = dependsOn !== undefined ? [{ role: 'background', file: '(배경 작업 결과)', label: `${seq.seq} 배경` }, ...refs] : refs
    const built = buildShotImagePrompt({ project, shot, assets, refs: promptRefs, analysis: an })
    const missingChar = shot.characters.filter((t) => !refs.some((r) => r.role === 'char' && r.tag === t))
    plans.push({
      kind: 'image_generate',
      target: { type: 'shot', ep: seq.ep, seq: seq.seq, shotId: shot.id, shotNo: shot.no, stage: 'image' },
      model,
      params: imageParams(ctx.models, model, project),
      prompt: built.text,
      refs: refs.map((r) => ({ file: r.file, label: r.label })),
      dependsOn,
      source: 'generated',
      parentVersionId: conti.id,
      lint: [...built.warnings, ...missingChar.map((t) => `${t} 시트가 없어 인물 일관성이 흔들릴 수 있습니다 — Assets 에서 생성`)],
      style: 'cinematic',
    })
  }
  if (unanalyzed.length) notes.push(`콘티 분석 없이 샷 표 값으로 만듭니다: ${unanalyzed.join(', ')}`)
  return { plans, rest, notes }
}

/** 배경 폴백 — Lira Location 템플릿, 인물 없음은 긍정문으로. LOCATION MAP(영문) > 씬 헤딩. */
function backgroundPlan(ctx: PlanContext, project: Project, seq: Sequence): JobPlan {
  const model = 'soul_cinematic'
  const pseudo = { tag: `@bg_${seq.seq}`, kind: 'loc', nameKo: seq.headingKo, descriptionKo: seq.headingKo, anchorEn: seq.locationMapEn, state: 'base', views: {}, usedIn: [] } as unknown as Asset
  const built = locMasterPrompt(pseudo, project)
  return {
    kind: 'image_generate',
    target: { type: 'background', ep: seq.ep, seq: seq.seq },
    model,
    params: imageParams(ctx.models, model, project, '16:9', '2k'),
    prompt: built.text,
    refs: [],
    source: 'generated',
    lint: built.warnings,
  }
}

async function planAssets(ctx: PlanContext, a: { ep: string; ids: string[]; views?: string[] }): Promise<PlanResult> {
  const project = ctx.store.getProject()
  const ea = await ctx.store.listAssets(a.ep)
  const notes: string[] = []
  const plans: JobPlan[] = []
  for (const idOrTag of a.ids) {
    const asset = ea.assets.find((x) => x.id === idOrTag || x.tag === idOrTag)
    if (!asset) throw new PlanError(`에셋 없음: ${idOrTag}`)
    const wanted = (a.views?.length ? a.views : ASSET_VIEWS[asset.kind]).filter((v) => ASSET_VIEWS[asset.kind].includes(v))
    if (!wanted.length) throw new PlanError(`${asset.tag}: 뷰가 없습니다 (${ASSET_VIEWS[asset.kind].join('/')})`)
    const master = MASTER_VIEW[asset.kind]
    const target = (view: string): AssetTarget => ({ type: 'asset', ep: a.ep, assetId: asset.id, tag: asset.tag, kind: asset.kind, view })

    // 정본이 필요한 파생 뷰가 있는데 정본이 없으면 정본을 먼저 넣는다
    let masterIdx: number | undefined
    let masterRef: PlanRef | undefined
    if (master) {
      const needsMaster = wanted.some((v) => v !== master)
      const existing = latestView(asset, master)
      if (wanted.includes(master)) {
        masterIdx = plans.length
        plans.push(masterPlan(ctx, asset, project, master, target(master)))
      } else if (needsMaster) {
        if (existing) masterRef = { file: existing.file, label: `${asset.tag} ${master}` }
        else {
          notes.push(`${asset.tag}: 정본(${master})이 없어 함께 생성`)
          masterIdx = plans.length
          plans.push(masterPlan(ctx, asset, project, master, target(master)))
        }
      }
    }
    for (const view of wanted) {
      if (view === master) continue
      plans.push(derivedPlan(ctx, asset, project, view, target(view), masterIdx, masterRef))
    }
  }
  return { plans, notes }
}

function masterPlan(ctx: PlanContext, asset: Asset, project: Project, view: string, target: AssetTarget): JobPlan {
  if (asset.kind === 'char') {
    const model = ROUTE.charSheet
    const built = charSheetPrompt(asset, project)
    const params = imageParams(ctx.models, model, project, '16:9', '2k')
    if (asset.soul?.id && ctx.models.acceptsSoulId(model)) params.custom_reference_id = asset.soul.id
    return { kind: 'assets_generate', target, model, params, prompt: built.text, refs: [], source: 'generated', lint: built.warnings }
  }
  const model = ROUTE.locMaster
  const built = locMasterPrompt(asset, project)
  return { kind: 'assets_generate', target, model, params: imageParams(ctx.models, model, project, project.defaults.aspect, '2k'), prompt: built.text, refs: [], source: 'generated', lint: built.warnings }
}

function derivedPlan(ctx: PlanContext, asset: Asset, project: Project, view: string, target: AssetTarget, masterIdx?: number, masterRef?: PlanRef): JobPlan {
  const refs = masterRef ? [masterRef] : []
  if (asset.kind === 'char') {
    const model = ROUTE.charPlate
    const built = charPlatePrompt(view as 'front' | 'back' | 'face')
    const aspect = view === 'face' ? '1:1' : '3:4'
    return { kind: 'assets_generate', target, model, params: imageParams(ctx.models, model, project, aspect, 'high'), prompt: built.text, refs, dependsOn: masterIdx, source: 'edit', lint: built.warnings }
  }
  if (asset.kind === 'loc') {
    const model = ROUTE.locView
    const built = locViewPrompt(view as '34' | 'top' | 'detail', asset)
    return { kind: 'assets_generate', target, model, params: imageParams(ctx.models, model, project, project.defaults.aspect, 'high'), prompt: built.text, refs, dependsOn: masterIdx, source: 'edit', lint: built.warnings }
  }
  const model = ROUTE.prop
  const built = propPrompt(view as 'top' | '34' | 'detail', asset, project)
  return { kind: 'assets_generate', target, model, params: imageParams(ctx.models, model, project, '1:1', 'high'), prompt: built.text, refs: [], source: 'generated', lint: built.warnings }
}

function requireCurrent(seq: Sequence, no: string): { shot: Shot; file: string; versionId: string } {
  const shot = liveShots(seq).find((s) => s.no === no)
  if (!shot) throw new PlanError(`샷 없음: ${seq.seq} ${no}`)
  const v = currentContiVersion(shot)
  if (!v) throw new PlanError(`${no}: 편집할 콘티 이미지가 아직 없습니다 (먼저 생성)`)
  return { shot, file: v.file, versionId: v.id }
}

async function planEdit(ctx: PlanContext, a: { seq: string; shotNo: string; instructionEn: string; model?: string }): Promise<PlanResult> {
  const project = ctx.store.getProject()
  const seq = requireSeq(ctx.store, a.seq)
  const { shot, file, versionId } = requireCurrent(seq, a.shotNo)
  const model = ctx.models.resolve(a.model ?? ROUTE.edit)
  const built = surgicalEditPrompt(a.instructionEn)
  return {
    plans: [
      {
        kind: 'image_edit',
        target: { type: 'shot', ep: seq.ep, seq: seq.seq, shotId: shot.id, shotNo: shot.no },
        model,
        params: imageParams(ctx.models, model, project),
        prompt: built.text,
        refs: [{ file, label: `${shot.no} 현재 버전` }],
        source: 'edit',
        parentVersionId: versionId,
        lint: built.warnings,
      },
    ],
    notes: [],
  }
}

async function planRestyle(ctx: PlanContext, a: { seq: string; shotNos: string[] }): Promise<PlanResult> {
  const project = ctx.store.getProject()
  const seq = requireSeq(ctx.store, a.seq)
  const model = ROUTE.restyle
  const style = project.defaults.contiStyle
  const built = restylePrompt(styleLineFor(project, style))
  const plans: JobPlan[] = a.shotNos.map((no) => {
    const cur = requireCurrent(seq, no)
    // 다시 그리기는 원본 프레임에서 — 이미 그린 버전 위에 또 그리면 그림이 뭉개진다
    const orig = cur.shot.panels[0]?.versions.conti.find((v) => v.source === 'video_frame')
    const { shot } = cur
    const file = orig?.file ?? cur.file
    const versionId = orig?.id ?? cur.versionId
    return {
      kind: 'panel_restyle',
      target: { type: 'shot', ep: seq.ep, seq: seq.seq, shotId: shot.id, shotNo: shot.no },
      model,
      params: imageParams(ctx.models, model, project),
      prompt: built.text,
      refs: [{ file, label: `${shot.no} 원본 프레임` }],
      source: 'restyle',
      parentVersionId: versionId,
      lint: built.warnings,
      style,
    }
  })
  return { plans, notes: [] }
}
