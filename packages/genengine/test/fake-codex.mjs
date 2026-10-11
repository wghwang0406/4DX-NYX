#!/usr/bin/env node
// 가짜 codex — `codex exec --json … -` 의 이미지 생성 흐름을 흉내 낸다 (spikes/codex/REPORT.md "이미지 생성").
// stdin 지시를 받아 thread.started → (item.completed image_gen) → turn.completed, $CODEX_HOME/generated_images/<thread>/exec-<id>.png 저장.
// FAKE_CODEX_FAIL=auth|usage|noimage  FAKE_CODEX_MS=<지연>  FAKE_CODEX_LOG=<호출 기록 파일>  FAKE_CODEX_HANG=1(결과 파일만 쓰고 종료 안 함)
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// 로그인: FAKE_CODEX_REQUIRE_LOGIN=1 이면 $CODEX_HOME/fake-auth 가 있어야 로그인 상태.
// `codex login` 은 실제처럼 로그인 주소를 출력하고, 잠시 뒤(브라우저에서 끝낸 셈) 그 파일을 만들고 끝난다.
const HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex')
const AUTH = join(HOME, 'fake-auth')
const loggedIn = () => process.env.FAKE_CODEX_FAIL !== 'auth' && (!process.env.FAKE_CODEX_REQUIRE_LOGIN || existsSync(AUTH))
if (process.argv[2] === 'login' && process.argv[3] === 'status') {
  process.stdout.write(loggedIn() ? 'Logged in using ChatGPT\n' : 'Not logged in\n')
  process.exit(loggedIn() ? 0 : 1)
}
if (process.argv[2] === 'login' && !process.argv[3]) {
  process.stdout.write('Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=fake&state=x\n')
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CODEX_LOGIN_MS ?? 800)))
  mkdirSync(HOME, { recursive: true })
  writeFileSync(AUTH, 'ok')
  process.stdout.write('Successfully logged in\n')
  process.exit(0)
}

let stdin = ''
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', async () => {
  const args = process.argv.slice(2)
  if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args, stdin }) + '\n')
  const thread = randomUUID()
  out({ type: 'thread.started', thread_id: thread })
  out({ type: 'turn.started' })
  await sleep(Number(process.env.FAKE_CODEX_MS ?? 50))
  const fail = loggedIn() ? process.env.FAKE_CODEX_FAIL : 'auth'
  if (fail === 'auth') {
    out({ type: 'error', message: 'Reconnecting... 1/5 (unexpected status 401 Unauthorized)' })
    out({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header' } })
    process.exit(1)
  }
  if (fail === 'usage') {
    out({ type: 'turn.failed', error: { message: "You've hit your usage limit. Try again later." } })
    process.exit(1)
  }
  if (fail === 'noimage') {
    out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'I cannot create that image.' } })
    out({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } })
    process.exit(0)
  }
  const aspect = /21:9/.test(stdin) ? [21, 9] : /square 1:1/.test(stdin) ? [1, 1] : /portrait 3:4/.test(stdin) ? [3, 4] : [16, 9]
  const w = 336
  const h = Math.round((w * aspect[1]) / aspect[0])
  const id = `exec-${randomUUID()}`
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const dir = join(home, 'generated_images', thread)
  mkdirSync(dir, { recursive: true })
  // 레퍼런스가 있으면 색을 바꿔 구분 (검증용)
  const refs = /referenced_image_paths/.test(stdin)
  writeFileSync(join(dir, `${id}.png`), png(w, h, refs ? [70, 120, 200] : [200, 150, 60]))
  out({ type: 'item.completed', item: { id, type: 'image_generation', kind: 'image_gen.generation', status: 'completed' } })
  out({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done.' } })
  out({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 40 } })
  if (process.env.FAKE_CODEX_HANG) await sleep(10 * 60_000)
  process.exit(0)
})
