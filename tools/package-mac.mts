// NYX 맥 패키징 — corepack pnpm exec tsx tools/package-mac.mts [--skip-build] [--publish <서버 URL> (NYX_PUBLISH_TOKEN 환경변수)]
//
// 1) electron-vite 빌드 → apps/studio/out
// 2) 스테이징(apps/studio/.stage): out + 실행 시 require 하는 모듈만(handlebars·cross-spawn·ajv·ajv-formats) 설치
//    (워크스페이스 패키지는 이미 번들에 들어 있다 — pnpm 트리를 통째로 넣지 않는다)
// 3) electron-builder --dir: 리소스 = agent-bundle, templates(+폰트), py/media, bin/uv
// 4) Developer ID 가 없으므로 ad-hoc 서명(codesign -s -) → hdiutil 로 dmg
// 5) --publish 면 사내 뷰어 서버에 올리고 최신 버전으로 등록 (앱이 "새 버전" 알림을 띄운다)
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { ensureUv } from '../packages/media/src/python.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STUDIO = join(ROOT, 'apps', 'studio')
const STAGE = join(STUDIO, '.stage')
const RES = join(STUDIO, '.build-res')
const OUT = join(ROOT, 'release')
const args = process.argv.slice(2)
const pkg = JSON.parse(readFileSync(join(STUDIO, 'package.json'), 'utf8')) as { version: string }
const version = pkg.version
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
// pnpm exec 아래에서 돌면 electron-builder 가 pnpm 을 부르려 한다 (스테이징은 npm 폴더) → pnpm 흔적을 지운 환경으로
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|PNPM_|pnpm_)/i.test(k)))
const sh = (cmd: string, a: string[], cwd = ROOT) => execFileSync(cmd, a, { cwd, stdio: 'inherit', env: { ...cleanEnv, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
const t0 = Date.now()

// 1) 빌드
if (!args.includes('--skip-build')) sh('corepack', ['pnpm', '--filter', '@conti/studio', 'build'])

// 2) 스테이징
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })
cpSync(join(STUDIO, 'out'), join(STAGE, 'out'), { recursive: true })
// 워크스페이스 어디에 깔렸든 (앱 → MCP → 루트 순서로) 찾는다
const ver = (name: string): string => {
  for (const base of [STUDIO, join(ROOT, 'packages', 'mcp'), join(ROOT, 'packages', 'agents'), ROOT]) {
    try {
      const pj = createRequire(join(base, 'package.json')).resolve(`${name}/package.json`)
      return (JSON.parse(readFileSync(pj, 'utf8')) as { version: string }).version
    } catch {
      /* 다음 */
    }
  }
  throw new Error(`${name} 을 찾지 못했습니다`)
}
const runtime = ['handlebars', 'cross-spawn', 'ajv', 'ajv-formats']
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: 'nyx',
      productName: 'NYX',
      version,
      description: 'NYX — 콘티 스튜디오',
      author: '4DX',
      main: 'out/main/index.js',
      dependencies: Object.fromEntries(runtime.map((n) => [n, ver(n)])),
    },
    null,
    2,
  ),
)
sh('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--loglevel=error'], STAGE)

// 3) 리소스: uv 바이너리 (앱 데이터에 있으면 그걸, 없으면 내려받기)
rmSync(RES, { recursive: true, force: true })
mkdirSync(join(RES, 'bin'), { recursive: true })
// 이미 받아 둔 uv 를 쓰고(앱 데이터 NYX / 예전 개발 폴더), 없으면 임시 폴더에 받는다 — 앱 데이터 폴더를 새로 만들지 않게
const appSupport = join(homedir(), 'Library', 'Application Support')
const have = [join(appSupport, 'NYX', 'tools', 'uv'), join(appSupport, '@conti', 'studio', 'tools', 'uv')].find((p) => existsSync(p))
const uv = have ?? (await ensureUv({ projectDir: join(ROOT, 'py', 'media'), dataDir: join(tmpdir(), 'nyx-pack-uv') }))
copyFileSync(uv, join(RES, 'bin', 'uv'))
chmodSync(join(RES, 'bin', 'uv'), 0o755)

const electronDist = join(dirname(createRequire(join(STUDIO, 'package.json')).resolve('electron/package.json')), 'dist')
const electronVersion = ver('electron')
const config = {
  appId: 'com.fourdx.nyx',
  productName: 'NYX',
  copyright: '4DX — 팀 내부용',
  directories: { app: STAGE, output: OUT },
  electronDist,
  electronVersion,
  asar: true,
  npmRebuild: false,
  files: ['out/**', 'node_modules/**', 'package.json'],
  extraResources: [
    { from: join(ROOT, 'agent-bundle'), to: 'agent-bundle', filter: ['**/*', '!**/node_modules/**'] },
    { from: join(ROOT, 'templates'), to: 'templates', filter: ['**/*'] },
    { from: join(ROOT, 'py', 'media'), to: 'py/media', filter: ['**/*', '!.venv/**', '!**/__pycache__/**', '!tests/**'] },
    { from: join(RES, 'bin'), to: 'bin', filter: ['**/*'] },
  ],
  mac: { category: 'public.app-category.productivity', target: ['dir'], identity: null, hardenedRuntime: false, darkModeSupport: true, extendInfo: { NSHumanReadableCopyright: '4DX 팀 내부용' } },
}
const cfgPath = join(STUDIO, '.builder.json')
writeFileSync(cfgPath, JSON.stringify(config, null, 2))
rmSync(join(OUT, `mac-${arch}`), { recursive: true, force: true })
rmSync(join(OUT, 'mac'), { recursive: true, force: true })
sh(join(STUDIO, 'node_modules', '.bin', 'electron-builder'), ['--mac', 'dir', `--${arch}`, '--config', cfgPath, '--projectDir', STAGE])

const appDir = [join(OUT, `mac-${arch}`), join(OUT, 'mac')].find((d) => existsSync(join(d, 'NYX.app')))
if (!appDir) throw new Error('NYX.app 을 찾지 못했습니다')
const app = join(appDir, 'NYX.app')

// 4) ad-hoc 서명 (서명이 깨진 arm64 앱은 실행이 막힌다) → dmg
sh('codesign', ['--force', '--deep', '--sign', '-', app])
sh('codesign', ['--verify', '--deep', '--strict', app])
const dmgRoot = join(tmpdir(), `nyx-dmg-${Date.now()}`)
mkdirSync(dmgRoot, { recursive: true })
sh('ditto', [app, join(dmgRoot, 'NYX.app')])
symlinkSync('/Applications', join(dmgRoot, 'Applications'))
writeFileSync(
  join(dmgRoot, '처음 설치할 때 읽어 주세요.txt'),
  [
    'NYX 설치',
    '',
    '1. NYX.app 을 Applications 폴더로 끌어다 놓습니다.',
    '2. 처음 한 번은 Applications 에서 NYX 를 "우클릭 → 열기" 로 엽니다.',
    '   (팀 내부 배포라 Apple 공증이 없어 그냥 더블클릭하면 "열 수 없음" 이 뜹니다)',
    '   그래도 막히면 터미널에서:  xattr -dr com.apple.quarantine /Applications/NYX.app',
    '3. 첫 화면 안내를 따라 Claude 또는 Codex, Higgsfield 에 로그인합니다.',
    '',
    '필요: macOS 13 이상, Apple Silicon. 영상 기능은 ffmpeg (brew install ffmpeg).',
  ].join('\n'),
)
const dmg = join(OUT, `NYX-${version}-${arch}.dmg`)
rmSync(dmg, { force: true })
sh('hdiutil', ['create', '-volname', `NYX ${version}`, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', '-fs', 'HFS+', dmg])
rmSync(dmgRoot, { recursive: true, force: true })
const mb = (p: string) => `${(statSync(p).size / 1e6).toFixed(0)}MB`
console.log(`\n✓ ${app}\n✓ ${dmg} (${mb(dmg)}) · ${((Date.now() - t0) / 1000).toFixed(0)}초`)

// 5) 사내 서버에 배포 (선택)
const pi = args.indexOf('--publish')
if (pi >= 0) {
  const server = args[pi + 1]?.replace(/\/+$/, '')
  const token = process.env.NYX_PUBLISH_TOKEN
  if (!server || !token) throw new Error('--publish <서버 URL> 과 NYX_PUBLISH_TOKEN 이 필요합니다')
  const file = dmg.split('/').pop()!
  const put = await fetch(`${server}/api/admin/releases/${file}`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: readFileSync(dmg) })
  if (!put.ok) throw new Error(`업로드 실패 HTTP ${put.status}`)
  const reg = await fetch(`${server}/api/admin/releases/latest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ platform: `darwin-${arch}`, version, file, notes: process.env.NYX_RELEASE_NOTES }) })
  if (!reg.ok) throw new Error(`등록 실패 HTTP ${reg.status}`)
  console.log(`✓ 배포: ${server}/releases/${file} — 팀원 앱에 "새 버전 ${version}" 알림이 뜹니다`)
}
