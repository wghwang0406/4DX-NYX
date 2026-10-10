// extract.mjs — pdfjs-dist (legacy build, Node) 로 텍스트 아이템을 x/y 좌표와 함께 뽑고
// y 클러스터링으로 "줄"을 복원한다. 결과: samples/<name>.lines.json
//
// usage: node extract.mjs <pdf> [<pdf> ...]
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const Y_TOL = 2.5;      // 같은 줄로 묶는 y 허용 오차 (pt)
const GAP_SPACE = 0.25; // item 사이 간격이 폰트높이*GAP_SPACE 보다 크면 공백 삽입

export async function extractPdf(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  const fontNames = new Set();
  let itemCount = 0, emptyItems = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      itemCount++;
      if (it.str === '') { emptyItems++; continue; }
      const [a, b, c, d, e, f] = it.transform;
      const h = Math.hypot(b, d) || it.height || 10;
      items.push({
        str: it.str, x: e, y: vp.height - f, w: it.width, h,
        font: it.fontName, eol: !!it.hasEOL,
      });
      fontNames.add(it.fontName);
    }
    // y 클러스터링: y 내림차순 → 같은 줄 묶기
    items.sort((p1, p2) => p1.y - p2.y || p1.x - p2.x);
    const lines = [];
    let cur = null;
    for (const it of items) {
      if (cur && Math.abs(it.y - cur.y) <= Y_TOL) cur.items.push(it);
      else { cur = { y: it.y, items: [it] }; lines.push(cur); }
    }
    const out = lines.map(l => {
      l.items.sort((p1, p2) => p1.x - p2.x);
      let text = '';
      let prevEnd = null;
      const segs = [];   // 원본 text item 단위 (화자명/대사가 별도 item 인 PDF 를 위해 보존)
      for (const it of l.items) {
        if (prevEnd !== null) {
          const gap = it.x - prevEnd;
          if (gap > it.h * GAP_SPACE && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
        }
        text += it.str;
        segs.push({ x: +it.x.toFixed(1), w: +it.w.toFixed(1), font: it.font, text: it.str });
        prevEnd = it.x + it.w;
      }
      const x0 = l.items[0].x;
      const x1 = prevEnd;
      const h = Math.max(...l.items.map(i => i.h));
      return { page: p, y: +l.y.toFixed(1), x: +x0.toFixed(1), x1: +x1.toFixed(1), h: +h.toFixed(1),
               nItems: l.items.length, text: text.replace(/\s+/g, ' ').trim(), segs };
    }).filter(l => l.text.length > 0);
    pages.push({ page: p, width: vp.width, height: vp.height, lines: out });
  }
  return {
    file: path.basename(pdfPath), numPages: doc.numPages, itemCount, emptyItems,
    fonts: [...fontNames], pages,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'samples');
  fs.mkdirSync(outDir, { recursive: true });
  for (const pdf of process.argv.slice(2)) {
    const res = await extractPdf(pdf);
    const name = path.basename(pdf, '.pdf').replace(/[\s()]+/g, '_').replace(/_+$/, '');
    const outPath = path.join(outDir, `${name}.lines.json`);
    fs.writeFileSync(outPath, JSON.stringify(res, null, 1));
    const nLines = res.pages.reduce((s, p) => s + p.lines.length, 0);
    console.log(`${res.file}: pages=${res.numPages} items=${res.itemCount} (empty ${res.emptyItems}) lines=${nLines} fonts=${res.fonts.length} -> ${outPath}`);
  }
}
