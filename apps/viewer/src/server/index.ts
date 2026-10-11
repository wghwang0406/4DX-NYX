// 실행: NYX_PUBLISH_TOKEN=… NYX_DATA=/data NYX_PORT=8787 node dist/server.mjs
// Dropbox 보관: DROPBOX_TOKEN 또는 DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY + DROPBOX_APP_SECRET, DROPBOX_ROOT=/NYX
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createViewerServer } from './app'
import { Dropbox } from './dropbox'

const env = process.env
if (!env.NYX_PUBLISH_TOKEN || env.NYX_PUBLISH_TOKEN.length < 16) {
  console.error('NYX_PUBLISH_TOKEN(16자 이상)을 설정하세요 — 스튜디오 설정 › 게시 서버에 같은 값을 넣습니다')
  process.exit(1)
}
const here = dirname(fileURLToPath(import.meta.url))
const webDir = [env.NYX_WEB, join(here, 'web'), join(here, '..', '..', 'dist', 'web')].find((d) => d && existsSync(join(d, 'index.html')))
const dropbox = Dropbox.fromEnv(env)
const server = createViewerServer({
  dataDir: env.NYX_DATA ?? join(process.cwd(), 'data'),
  publishToken: env.NYX_PUBLISH_TOKEN,
  publicUrl: env.NYX_PUBLIC_URL,
  host: env.NYX_HOST ?? '0.0.0.0',
  port: Number(env.NYX_PORT ?? 8787),
  webDir,
  dropbox,
  overviewPublic: env.NYX_OVERVIEW_OPEN === '1',
})
const { url } = await server.start()
console.log(`NYX viewer ${url}  web=${webDir ?? '(없음)'}  dropbox=${dropbox ? dropbox.root : '꺼짐'}`)
if (dropbox) void dropbox.check().then((r) => console.log(r.ok ? `Dropbox 연결: ${r.account}` : `Dropbox 확인 실패: ${r.error}`))
const stop = () => void server.stop().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
