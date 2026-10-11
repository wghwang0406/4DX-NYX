import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/**
 * pdf.js 는 PDF 를 읽을 때 자기 옆의 `pdf.worker.mjs` 를 불러온다 (Node 에선 "fake worker").
 * 메인 번들에 pdf.js 가 묶이면 그 파일이 따라오지 않아 PDF 가져오기가 실패했다 → 빌드 결과(out/main)에 복사한다.
 */
function copyPdfWorker(): Plugin {
  return {
    name: 'nyx-copy-pdf-worker',
    apply: () => true,
    writeBundle(opts) {
      const req = createRequire(resolve(__dirname, '../../packages/screenplay/package.json'))
      const src = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
      const outDir = opts.dir ?? resolve(__dirname, 'out/main')
      mkdirSync(outDir, { recursive: true })
      copyFileSync(src, resolve(outDir, 'pdf.worker.mjs'))
      void dirname
    },
  }
}

// 워크스페이스 패키지는 TS 소스라 번들에 포함한다 (외부화하면 Node가 .ts 를 못 읽는다)
const workspace = ['@conti/core', '@conti/domain', '@conti/screenplay', '@conti/mcp', '@conti/agents', '@conti/genengine', '@conti/layout', '@conti/media']

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: workspace }), copyPdfWorker()] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: workspace })] },
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
})
