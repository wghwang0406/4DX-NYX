import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// 리뷰어 웹 — 서버가 dist/web 을 그대로 서빙한다 (/r/{token} 은 SPA 폴백)
export default defineConfig({
  root: resolve(__dirname),
  base: '/',
  plugins: [react()],
  build: { outDir: resolve(__dirname, '..', 'dist', 'web'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
