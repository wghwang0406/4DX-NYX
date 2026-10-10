// 모델 표 — agent-bundle/models.json(models.py CAPS 이식)을 읽어 단축명 해석·플래그 조립을 맡는다.
// 값은 `higgsfield model get` 에서 복사한 것이지 추측이 아니다. 표에 없는 모델은 막지 않고 그대로 넘긴다.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ModelCaps {
  kind: 'image' | 'video' | null
  quality?: string[] | null
  resolution?: string[] | null
  aspect?: string[] | null
  refs?: boolean
  max_images?: number | null
  soul_id?: boolean
  inpaint?: boolean
  aliases?: string[]
  mode?: string[]
  needs_omni_mode?: boolean
}

export interface ModelsJson {
  shorthand: Record<string, string>
  canonical: Record<string, string>
  caps: Record<string, ModelCaps>
}

export class ModelTable {
  constructor(private data: ModelsJson) {}

  static async load(bundleDir: string): Promise<ModelTable> {
    const raw = await readFile(join(bundleDir, 'models.json'), 'utf8')
    return new ModelTable(JSON.parse(raw) as ModelsJson)
  }

  /** `gpt` → `gpt_image_2_5`. 모르는 이름은 그대로. */
  resolve(name: string): string {
    return this.data.shorthand[name] ?? name
  }

  /** 서버 job_type 정규화 — `nano_banana_2` → `nano_banana_pro` (`generate list` 필터용). */
  canonical(id: string): string {
    return this.data.canonical[id] ?? id
  }

  caps(id: string): ModelCaps | undefined {
    const r = this.resolve(id)
    return this.data.caps[r] ?? this.data.caps[this.canonical(r)]
  }

  /**
   * 품질 플래그 (models.py image_flags 이식). 모델에 없는 값은 그 모델에서 가장 높은 값으로 옮긴다.
   * gpt_image_2_5: quality+resolution / nano: resolution만 / soul 계열: quality(1.5k|2k)만 / seedream: quality(basic|high)만.
   */
  imageParams(id: string, quality = 'high', resolution = '2k'): Record<string, string> {
    const c = this.caps(id)
    const out: Record<string, string> = {}
    if (!c) return { quality, resolution }
    const q = pick(c.quality, quality, '2k')
    if (q) out.quality = q
    const r = pick(c.resolution, resolution)
    if (r) out.resolution = r
    return out
  }

  supportsAspect(id: string, aspect: string): boolean {
    const allowed = this.caps(id)?.aspect
    return !allowed || allowed.includes(aspect)
  }

  /** 모델이 못 받는 화면비면 가장 가까운 허용값으로 (21:9 없으면 16:9). */
  clampAspect(id: string, aspect: string): string {
    if (this.supportsAspect(id, aspect)) return aspect
    const allowed = this.caps(id)!.aspect!
    if (aspect === '21:9' && allowed.includes('16:9')) return '16:9'
    if (allowed.includes('16:9')) return '16:9'
    return allowed[0]
  }

  maxImages(id: string): number {
    const c = this.caps(id)
    if (!c) return 14
    if (c.max_images != null) return c.max_images
    return c.refs === false ? 0 : 14
  }

  acceptsSoulId(id: string): boolean {
    return !!this.caps(id)?.soul_id
  }
}

function pick(allowed: string[] | null | undefined, want: string, fallback?: string): string | undefined {
  if (!allowed || !allowed.length) return undefined
  if (allowed.includes(want)) return want
  if (fallback && allowed.includes(fallback)) return fallback
  return allowed[allowed.length - 1]
}

/** 용도별 기본 모델 (CLAUDE.md 라우팅 표). */
export const ROUTE = {
  conti: 'gpt_image_2_5',
  charSheet: 'text2image_soul_v2',
  charPlate: 'nano_banana_2',
  locMaster: 'soul_cinematic',
  locView: 'gpt_image_2_5',
  prop: 'nano_banana_2',
  edit: 'nano_banana_2',
  restyle: 'gpt_image_2_5',
} as const
