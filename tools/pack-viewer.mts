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
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|pnpm_)/i.test(k)))

console.log('· 뷰어 빌드')
execFileSync('corepack', ['pnpm', '--filter', '@conti/viewer', 'build'], { cwd: root, stdio: 'inherit', env })
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(join(root, 'apps/viewer/dist/server.mjs'), join(out, 'server.mjs'))
await cp(join(root, 'apps/viewer/dist/web'), join(out, 'web'), { recursive: true })
for (const f of ['start.mjs', 'start.command', 'start.sh', 'start.bat', 'README.txt']) await cp(join(root, 'tools/viewer-pack', f), join(out, f))
await chmod(join(out, 'start.command'), 0o755)
await chmod(join(out, 'start.sh'), 0o755)
const zip = join(root, 'release', 'nyx-viewer.zip')
await rm(zip, { force: true })
if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', out, zip])
else execFileSync('zip', ['-qr', zip, 'nyx-viewer'], { cwd: join(root, 'release') })
console.log(`✓ ${out}\n✓ ${zip}`)
