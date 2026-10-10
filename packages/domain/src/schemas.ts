import { z } from 'zod'

// ── 공통 ───────────────────────────────────────────────────────────────────

export const SeqId = z.string().regex(/^S\d{2,}$/, 'S41 형식')
export const EpId = z.string().regex(/^EP\d{2,}$/, 'EP01 형식')
export const ShotNo = z.string().regex(/^\d{4}$/, '4자리 샷 번호')

export const ShotSize = z.enum(['EWS', 'WS', 'MWS', 'MS', 'MCU', 'CU', 'ECU', 'POV', 'INSERT', 'OTS'])
export type ShotSize = z.infer<typeof ShotSize>

export const StageStatus = z.enum([
  'none',
  'prompt_ready',
  'awaiting_approval',
  'queued',
  'running',
  'review',
  'approved',
  'failed',
  'stale', // 입력이 바뀌어 재생성 필요 (증분 재생성)
])
export type StageStatus = z.infer<typeof StageStatus>

export const Stage = z.object({
  status: StageStatus.default('none'),
  currentVersionId: z.string().optional(),
  inputHash: z.string().optional(), // 프롬프트 슬롯 + 레퍼런스 해시 — 바뀌면 stale
  lastJobId: z.string().optional(),
  updatedAt: z.number().optional(),
})
export type Stage = z.infer<typeof Stage>

// ── 버전 ───────────────────────────────────────────────────────────────────

export const VersionSource = z.enum(['generated', 'video_frame', 'restyle', 'edit', 'upload'])
export type VersionSource = z.infer<typeof VersionSource>

export const Version = z.object({
  id: z.string(),
  n: z.number().int().positive(),
  stage: z.enum(['conti', 'image', 'video']),
  file: z.string(), // 프로젝트 루트 기준 상대 POSIX 경로
  sha256: z.string().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  source: VersionSource,
  parentId: z.string().optional(),
  jobId: z.string().optional(),
  createdAt: z.number(),
})
export type Version = z.infer<typeof Version>

// ── 샷 ─────────────────────────────────────────────────────────────────────

export const DialogueLine = z.object({
  speaker: z.string().optional(),
  text: z.string(),
  paren: z.string().optional(),
  lineN: z.number().int().optional(), // 시나리오 줄 번호
  tIn: z.number().optional(), // 영상 입력일 때 초
  tOut: z.number().optional(),
  asrConf: z.number().optional(),
})
export type DialogueLine = z.infer<typeof DialogueLine>

export const ReviewFlag = z.enum(['uncertain_cut', 'asr_low', 'motion_unreliable', 'tight_split'])

export const Annotation = z.object({
  id: z.string(),
  type: z.enum(['move', 'camera', 'pan', 'tilt', 'zoom', 'frame', 'note']),
  points: z.array(z.tuple([z.number(), z.number()])), // 0..1
  label: z.string().optional(),
})

export const Panel = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  captionKo: z.string().optional(),
  annotations: z.array(Annotation).default([]),
  versions: z
    .object({
      conti: z.array(Version).default([]),
      image: z.array(Version).default([]),
    })
    .default({ conti: [], image: [] }),
})
export type Panel = z.infer<typeof Panel>

export const Shot = z.object({
  id: z.string(),
  no: ShotNo,
  sizeCode: ShotSize.optional(),
  angle: z.string().optional(),
  cameraMove: z.string().optional(),
  fovDeg: z.number().optional(),
  durationSec: z.number().optional(),
  tc: z.object({ inMs: z.number(), outMs: z.number() }).optional(),
  characters: z.array(z.string()).default([]), // @태그
  location: z.string().optional(),
  props: z.array(z.string()).default([]),
  actionKo: z.string().default(''),
  dialogue: z.array(DialogueLine).default([]),
  tag: z.enum(['대사', '반응']).optional(),
  sourceLines: z.array(z.number()).default([]),
  review: z.array(ReviewFlag).default([]),
  // 콘티 프롬프트 슬롯 (AI 가 채움, 코드가 조립). 바뀌면 stages.conti 가 stale 이 된다
  promptSlots: z.record(z.string(), z.string()).optional(),
  panels: z.array(Panel).default([]),
  stages: z
    .object({
      conti: Stage.default({ status: 'none' }),
      image: Stage.default({ status: 'none' }),
      video: Stage.default({ status: 'none' }),
    })
    .default({ conti: { status: 'none' }, image: { status: 'none' }, video: { status: 'none' } }),
  deleted: z.boolean().optional(),
})
export type Shot = z.infer<typeof Shot>

// ── 시퀀스 ─────────────────────────────────────────────────────────────────

export const Sequence = z.object({
  schemaVersion: z.literal(1).default(1),
  seq: SeqId,
  ep: EpId,
  rev: z.number().int().default(0),
  headingKo: z.string().default(''),
  source: z
    .object({
      sourceId: z.string().optional(),
      lineStart: z.number().optional(),
      lineEnd: z.number().optional(),
      textHash: z.string().optional(),
      kind: z.enum(['screenplay', 'video', 'images']).optional(),
    })
    .default({}),
  locationMapEn: z.string().default(''),
  sceneStyleKo: z.string().default(''),
  lightingKo: z.string().default(''),
  soundKo: z.string().default(''),
  breakdown: z
    .object({
      status: z.enum(['none', 'draft', 'accepted']).default('none'),
      acceptedAt: z.number().optional(),
    })
    .default({ status: 'none' }),
  shots: z.array(Shot).default([]),
})
export type Sequence = z.infer<typeof Sequence>

// ── 에셋 ───────────────────────────────────────────────────────────────────

export const AssetKind = z.enum(['char', 'loc', 'prop'])
export type AssetKind = z.infer<typeof AssetKind>

export const Asset = z.object({
  id: z.string(),
  tag: z.string().regex(/^@/, '@로 시작'),
  kind: AssetKind,
  subkind: z.enum(['human', 'animal', 'creature']).optional(),
  state: z.string().default('base'),
  nameKo: z.string(),
  descriptionKo: z.string().default(''),
  anchorEn: z.string().default(''),
  masterProfileEn: z.string().optional(),
  voiceEn: z.string().optional(),
  cameraAnchorEn: z.string().optional(),
  views: z.record(z.string(), z.array(Version)).default({}),
  soul: z.object({ id: z.string(), model: z.string(), status: z.string() }).optional(),
  usedIn: z.array(SeqId).default([]),
})
export type Asset = z.infer<typeof Asset>

export const EpisodeAssets = z.object({
  schemaVersion: z.literal(1).default(1),
  ep: EpId,
  rev: z.number().int().default(0),
  assets: z.array(Asset).default([]),
})
export type EpisodeAssets = z.infer<typeof EpisodeAssets>

// ── 프로젝트 ───────────────────────────────────────────────────────────────

export const Project = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,15}$/, '대문자 코드'),
  title: z.string(),
  type: z.string().default('drama'),
  rev: z.number().int().default(0),
  world: z
    .object({ eraKo: z.string().default(''), settingKo: z.string().default(''), toneKo: z.string().default('') })
    .default({ eraKo: '', settingKo: '', toneKo: '' }),
  style: z
    .object({
      anchorEn: z.string().default(''),
      contiSketchEn: z.string().default(''),
      contiCinematicEn: z.string().default(''),
      paletteEn: z.string().default(''),
    })
    .default({ anchorEn: '', contiSketchEn: '', contiCinematicEn: '', paletteEn: '' }),
  defaults: z
    .object({
      aspect: z.string().default('16:9'),
      contiStyle: z.enum(['sketch', 'cinematic']).default('sketch'),
      quality: z.string().default('high'),
      autoApproveCount: z.number().int().default(0),
      dailyCap: z.number().int().default(200),
    })
    .default({ aspect: '16:9', contiStyle: 'sketch', quality: 'high', autoApproveCount: 0, dailyCap: 200 }),
  layoutTemplateId: z.string().default('placeholder-a4-6up'),
  // 시퀀스 → 에피소드 매핑 (config.md Episode Mapping 과 동일)
  episodeMap: z.record(SeqId, EpId).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Project = z.infer<typeof Project>
