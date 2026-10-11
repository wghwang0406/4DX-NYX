// NYX 뷰어 서버 시작기 — 서버 PC 에서 더블클릭(start.command / start.bat) 또는 `node start.mjs`.
// 처음이면 게시 토큰을 만들어 nyx-viewer.env 에 저장하고, 이 PC 의 사내 IP 로 주소를 잡아 터미널에 크게 보여준다.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`Node 22.5 이상이 필요합니다 (지금 ${process.versions.node}). https://nodejs.org 에서 LTS 를 설치하세요.`)
  process.exit(1)
}
// 오래된 22.x 는 SQLite 가 실험 플래그 뒤에 있다 — 없으면 플래그를 붙여 다시 실행
try {
  await import('node:sqlite')
} catch {
  if (!process.execArgv.includes('--experimental-sqlite')) {
    const r = spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: process.env })
    process.exit(r.status ?? 1)
  }
}

// 설정 파일 (KEY=VALUE)
const envFile = join(here, 'nyx-viewer.env')
const conf = {}
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m) conf[m[1]] = m[2]
  }
}
let changed = false
if (!conf.NYX_PUBLISH_TOKEN) {
  conf.NYX_PUBLISH_TOKEN = randomBytes(24).toString('hex')
  changed = true
}
conf.NYX_PORT ??= '8787'
if (changed || !existsSync(envFile)) {
  const lines = [
    '# NYX 뷰어 서버 설정 — 이 파일을 지우면 토큰이 새로 만들어집니다 (스튜디오 설정도 다시 넣어야 함)',
    `NYX_PUBLISH_TOKEN=${conf.NYX_PUBLISH_TOKEN}`,
    `NYX_PORT=${conf.NYX_PORT}`,
    '# 링크에 찍힐 주소 — 비워 두면 이 PC 의 사내 IP 로 자동',
    `NYX_PUBLIC_URL=${conf.NYX_PUBLIC_URL ?? ''}`,
    '# Dropbox 보관 (선택): DROPBOX_TOKEN=… 또는 DROPBOX_REFRESH_TOKEN / DROPBOX_APP_KEY / DROPBOX_APP_SECRET',
    ...Object.entries(conf)
      .filter(([k]) => /^DROPBOX_/.test(k))
      .map(([k, v]) => `${k}=${v}`),
  ]
  writeFileSync(envFile, lines.join('\n') + '\n')
}

// 사내 IP (사설 대역 우선)
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address)
const lan = ips.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? ips[0] ?? 'localhost'
const url = conf.NYX_PUBLIC_URL || `http://${lan}:${conf.NYX_PORT}`

for (const [k, v] of Object.entries(conf)) if (v !== '') process.env[k] = v
process.env.NYX_PUBLIC_URL = url
process.env.NYX_DATA ??= join(here, 'data')
process.env.NYX_WEB ??= join(here, 'web')

const bar = '═'.repeat(64)
console.log(`\n${bar}\n  NYX 뷰어 서버\n${bar}`)
console.log(`  현황 화면 (다른 PC 브라우저):  ${url}/`)
console.log(`  스튜디오 설정 › 게시 서버에 넣을 값`)
console.log(`     주소   ${url}`)
console.log(`     토큰   ${conf.NYX_PUBLISH_TOKEN}`)
console.log(`  데이터    ${process.env.NYX_DATA}`)
console.log(`  끄기      이 창에서 Ctrl+C (창을 닫으면 서버도 꺼집니다)`)
console.log(`${bar}\n`)

await import('./server.mjs')
