// HTML 렌더 — 템플릿 + 데이터 → 완전한 HTML 문서 한 장 (모든 페이지). 숨은 창에서 PDF/PNG 로, 앱에선 iframe 미리보기로.
import Handlebars from 'handlebars'
import { sha256 } from '@conti/core'
import type { LayoutData } from './builder'
import { pageSizeMm, type LoadedTemplate } from './template'

export interface RenderOptions {
  /** 번들 폰트 폴더 URL (끝 슬래시 포함). 예: conti-file://font/ */
  fontBase?: string
  /** 템플릿 폴더 URL (끝 슬래시 포함) — 템플릿 안 이미지 등 상대 에셋용 (<base href>) */
  assetBase?: string
  /** 앱 미리보기용: 페이지 사이 간격·그림자 */
  screen?: boolean
}

export interface Rendered {
  html: string
  pages: number
  /** 템플릿 해시 + 데이터 — 같으면 다시 출력하지 않는다 */
  key: string
  pageMm: [number, number]
}

function compile(t: LoadedTemplate) {
  const hb = Handlebars.create()
  // 로직 없는 템플릿을 돕는 최소 헬퍼 (조건 비교 정도만)
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b)
  hb.registerHelper('join', (arr: unknown, sep: unknown) => (Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : ''))
  hb.registerHelper('inc', (n: unknown) => Number(n) + 1)
  for (const [name, src] of Object.entries(t.partials)) hb.registerPartial(name, src)
  return hb.compile(t.page, { strict: false, noEscape: false })
}

const cache = new Map<string, HandlebarsTemplateDelegate>()

function fontFaces(base: string): string {
  const face = (weight: number, file: string) =>
    `@font-face{font-family:'Pretendard';font-weight:${weight};font-style:normal;font-display:block;src:url('${base}${file}') format('woff2');}`
  return [face(400, 'Pretendard-Regular.woff2'), face(600, 'Pretendard-SemiBold.woff2'), face(700, 'Pretendard-Bold.woff2')].join('\n')
}

export function renderHtml(t: LoadedTemplate, data: LayoutData, o: RenderOptions = {}): Rendered {
  let fn = cache.get(t.hash)
  if (!fn) {
    fn = compile(t)
    cache.set(t.hash, fn)
  }
  const body = fn(data)
  const [w, h] = pageSizeMm(t.meta)
  const base = [
    o.fontBase ? fontFaces(o.fontBase) : '',
    `@page{size:${w}mm ${h}mm;margin:0}`,
    `html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    `body{font-family:'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif}`,
    `.page{width:${w}mm;height:${h}mm;box-sizing:border-box;overflow:hidden;position:relative;page-break-after:always;break-after:page}`,
    `.page:last-child{page-break-after:auto;break-after:auto}`,
    `svg.annotations{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}`,
    o.screen ? `body{background:#3a3d44}.page{margin:0 auto 8mm;box-shadow:0 2px 10px rgba(0,0,0,.4)}` : '',
  ].join('\n')
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
${o.assetBase ? `<base href="${o.assetBase}">` : ''}
<title>${Handlebars.escapeExpression(data.sequence.seq)} ${Handlebars.escapeExpression(data.sequence.heading)}</title>
<style>${base}</style>
<style>${t.css}</style>
</head><body>
${body}
</body></html>`
  return { html, pages: data.pages.length, key: sha256(t.hash + JSON.stringify(data.pages) + data.meta.versionLabel + data.meta.status), pageMm: [w, h] }
}
