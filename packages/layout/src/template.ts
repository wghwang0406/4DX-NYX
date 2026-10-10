// 템플릿 = 폴더 하나: template.json + page.hbs + partials/*.hbs + style.css + sample.json (+ 그 밖의 이미지 등 에셋).
// 로직 없는 Handlebars 라 디자인은 HTML/CSS 만 고치면 된다. "폼 디자인 = 새 템플릿 폴더 하나".
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { sha256 } from '@conti/core'

export const TemplateMeta = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i, '영문·숫자·-·_'),
  name: z.string(),
  version: z.union([z.string(), z.number()]).transform(String).default('1'),
  description: z.string().default(''),
  paper: z
    .object({
      size: z.enum(['A4', 'A3', 'Letter']).default('A4'),
      orientation: z.enum(['landscape', 'portrait']).default('landscape'),
    })
    .default({ size: 'A4', orientation: 'landscape' }),
  /** 페이지당 패널 수 (그리드 칸 수) */
  panelsPerPage: z.number().int().min(1).max(48).default(6),
  /** 패널 이미지 비율 (CSS aspect-ratio 로 쓰라고 템플릿에 넘긴다) */
  panelAspect: z.string().default('16 / 9'),
})
export type TemplateMeta = z.infer<typeof TemplateMeta>

export interface LoadedTemplate {
  meta: TemplateMeta
  dir: string
  page: string
  partials: Record<string, string>
  css: string
  sample?: unknown
  /** 폴더 내용 해시 — 템플릿을 고치면 바뀐다 (렌더 캐시 키) */
  hash: string
}

export const PAPER_MM: Record<TemplateMeta['paper']['size'], [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
}

/** 페이지 크기(mm) — [가로, 세로] */
export function pageSizeMm(meta: TemplateMeta): [number, number] {
  const [w, h] = PAPER_MM[meta.paper.size]
  return meta.paper.orientation === 'landscape' ? [h, w] : [w, h]
}

async function readIf(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

export async function loadTemplate(dir: string): Promise<LoadedTemplate> {
  const metaRaw = await readIf(join(dir, 'template.json'))
  if (!metaRaw) throw new Error(`template.json 이 없습니다: ${dir}`)
  let metaJson: unknown
  try {
    metaJson = JSON.parse(metaRaw)
  } catch (e) {
    throw new Error(`template.json 형식 오류 (${basename(dir)}): ${(e as Error).message}`)
  }
  const parsed = TemplateMeta.safeParse(metaJson)
  if (!parsed.success) throw new Error(`template.json 검증 실패 (${basename(dir)}): ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`)
  const page = await readIf(join(dir, 'page.hbs'))
  if (!page) throw new Error(`page.hbs 가 없습니다: ${dir}`)
  const css = (await readIf(join(dir, 'style.css'))) ?? ''
  const partials: Record<string, string> = {}
  try {
    for (const f of await readdir(join(dir, 'partials'))) {
      if (f.endsWith('.hbs')) partials[f.replace(/\.hbs$/, '')] = await readFile(join(dir, 'partials', f), 'utf8')
    }
  } catch {
    /* partials 없음 */
  }
  const sampleRaw = await readIf(join(dir, 'sample.json'))
  let sample: unknown
  if (sampleRaw) {
    try {
      sample = JSON.parse(sampleRaw)
    } catch (e) {
      throw new Error(`sample.json 형식 오류 (${basename(dir)}): ${(e as Error).message}`)
    }
  }
  const hash = sha256(JSON.stringify([metaRaw, page, css, partials]))
  return { meta: parsed.data, dir, page, partials, css, sample, hash }
}

export interface TemplateEntry {
  id: string
  name: string
  dir: string
  version: string
  description: string
  builtin: boolean
  error?: string
}

/** 여러 루트에서 템플릿 폴더를 찾는다. `_` 로 시작하는 폴더(_fonts 등)는 건너뛴다. 같은 id 는 앞 루트가 이긴다. */
export async function listTemplates(roots: Array<{ dir: string; builtin: boolean }>): Promise<TemplateEntry[]> {
  const out: TemplateEntry[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    let names: string[] = []
    try {
      names = await readdir(root.dir)
    } catch {
      continue
    }
    for (const n of names.sort()) {
      if (n.startsWith('_') || n.startsWith('.')) continue
      const dir = join(root.dir, n)
      try {
        if (!(await stat(dir)).isDirectory()) continue
      } catch {
        continue
      }
      try {
        const t = await loadTemplate(dir)
        if (seen.has(t.meta.id)) continue
        seen.add(t.meta.id)
        out.push({ id: t.meta.id, name: t.meta.name, dir, version: t.meta.version, description: t.meta.description, builtin: root.builtin })
      } catch (e) {
        out.push({ id: n, name: n, dir, version: '?', description: '', builtin: root.builtin, error: (e as Error).message })
      }
    }
  }
  return out
}
