import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// 워크스페이스 패키지는 TS 소스라 번들에 포함한다 (외부화하면 Node가 .ts 를 못 읽는다)
const workspace = ['@conti/core', '@conti/domain', '@conti/screenplay', '@conti/mcp', '@conti/agents', '@conti/genengine']

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: workspace })] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: workspace })] },
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
  },
})
