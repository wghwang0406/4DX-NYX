// PDF → 줄 (x/y/폰트 높이 포함). M0 스파이크(spikes/pdf) 결론: pdfjs legacy + 좌표 기반 줄 복원.
import type { SourceLine } from './split'

export interface PdfLine extends SourceLine {
  page: number
  y: number
  fontH: number
  items: Array<{ str: string; x: number; w: number }> // 화자/대사 분리에 쓰는 item 경계
}

const Y_TOL = 2.5
const GAP_SPACE = 0.25 // 폰트 높이 대비 — 이보다 넓은 item 간격엔 공백을 넣는다

export async function extractPdfLines(data: Uint8Array): Promise<PdfLine[]> {
  // 동적 import: 렌더러/테스트에서 이 모듈을 import 만 해도 pdfjs 를 로드하지 않게
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise
  const lines: PdfLine[] = []
  let n = 0

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    type Item = { str: string; x: number; y: number; w: number; h: number }
    const items: Item[] = []
    for (const it of tc.items as Array<{ str: string; transform: number[]; width: number; height: number }>) {
      if (!it.str) continue
      const [a, b, c, d, e, f] = it.transform
      void a
      void c
      const h = Math.hypot(b, d) || it.height || 10
      items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, h })
    }
    // y 클러스터링 → 줄
    items.sort((i1, i2) => i1.y - i2.y || i1.x - i2.x)
    const rows: Item[][] = []
    for (const it of items) {
      const row = rows[rows.length - 1]
      if (row && Math.abs(row[0].y - it.y) <= Y_TOL) row.push(it)
      else rows.push([it])
    }
    for (const row of rows) {
      row.sort((i1, i2) => i1.x - i2.x)
      let text = ''
      let prevEnd: number | null = null
      const fontH = Math.max(...row.map((i) => i.h))
      for (const it of row) {
        if (prevEnd != null && it.x - prevEnd > fontH * GAP_SPACE && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' '
        text += it.str
        prevEnd = it.x + it.w
      }
      if (!text.trim()) continue
      n += 1
      lines.push({
        n,
        text: text.normalize('NFC').replace(/ʻ/g, '‘'),
        x: Math.round(row[0].x),
        page: p,
        y: row[0].y,
        fontH: Math.round(fontH * 10) / 10,
        items: row.filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.x, w: i.w })),
      })
    }
    page.cleanup()
  }
  await doc.cleanup?.()
  return stripPageFurniture(lines)
}

/** 쪽번호, 페이지 절반 이상 반복되는 머리글/워터마크, 본문보다 2.2배 큰 글자를 뺀다. */
function stripPageFurniture(lines: PdfLine[]): PdfLine[] {
  const pages = new Set(lines.map((l) => l.page)).size
  const count = new Map<string, number>()
  for (const l of lines) count.set(l.text.trim(), (count.get(l.text.trim()) ?? 0) + 1)
  const bodyH = mode(lines.map((l) => l.fontH)) ?? 10
  const out = lines.filter((l) => {
    const t = l.text.trim()
    if (/^[-–—]?\s*\d{1,3}\s*[-–—]?$/.test(t)) return false
    if (pages >= 4 && (count.get(t) ?? 0) >= pages * 0.5) return false
    if (l.fontH > bodyH * 2.2) return false
    return true
  })
  return out.map((l, i) => ({ ...l, n: i + 1 }))
}

export function mode(nums: number[]): number | null {
  if (!nums.length) return null
  const c = new Map<number, number>()
  for (const v of nums) c.set(v, (c.get(v) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]
}
