// 서버 PC 용 뷰어 패키지: release/nyx-viewer/ + release/nyx-viewer.zip
//   corepack pnpm exec tsx tools/pack-viewer.mts
// 안: server.mjs(번들) · web/(리뷰어·현황 화면) · start.mjs · start.command / start.sh / start.bat · README.txt
// 서버 PC 엔 Node 22.5+ 만 있으면 된다 (저장소·pnpm 불필요).
import { execFileSync } from 'node:child_process'
import { chmod, cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'release', 'nyx-viewer')
const FILES = ['start.mjs', 'start.command', 'start.sh', 'start.bat', 'README.txt']
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|pnpm_)/i.test(k)))

console.log('· 뷰어 빌드')
execFileSync('corepack', ['pnpm', '--filter', '@conti/viewer', 'build'], { cwd: root, stdio: 'inherit', env })
// zip 은 깨끗한 임시 폴더에서 만든다 — 이 맥에서 띄워 둔 서버의 data/ · nyx-viewer.env(토큰) 가 섞이지 않게
const stage = join(root, 'release', '.viewer-stage')
const staged = join(stage, 'nyx-viewer')
await rm(stage, { recursive: true, force: true })
await mkdir(staged, { recursive: true })
await cp(join(root, 'apps/viewer/dist/server.mjs'), join(staged, 'server.mjs'))
await cp(join(root, 'apps/viewer/dist/web'), join(staged, 'web'), { recursive: true })
for (const f of FILES) await cp(join(root, 'tools/viewer-pack', f), join(staged, f))
await chmod(join(staged, 'start.command'), 0o755)
await chmod(join(staged, 'start.sh'), 0o755)
const zip = join(root, 'release', 'nyx-viewer.zip')
await rm(zip, { force: true })
if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', staged, zip])
else execFileSync('zip', ['-qr', zip, 'nyx-viewer'], { cwd: stage })
// release/nyx-viewer 는 프로그램 파일만 바꾼다 — data/ 와 nyx-viewer.env 는 그대로 (다시 빌드해도 토큰·게시본 유지)
await mkdir(out, { recursive: true })
for (const f of ['server.mjs', 'web', ...FILES]) {
  await rm(join(out, f), { recursive: true, force: true })
  await cp(join(staged, f), join(out, f), { recursive: true })
}
await rm(stage, { recursive: true, force: true })
console.log(`✓ ${out}  (data/ · nyx-viewer.env 유지)\n✓ ${zip}`)
