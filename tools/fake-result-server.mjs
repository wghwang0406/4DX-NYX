#!/usr/bin/env node
// 가짜 결과 이미지 서버 — fake-higgsfield.mjs 의 result_url 이 가리키는 곳. 요청마다 색이 다른 1280x720 PNG 를 만든다.
//   node tools/fake-result-server.mjs [port]  → stdout 에 URL 한 줄
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'

const W = 1280
const H = 720

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(seed) {
  const r0 = (seed * 73) % 200, g0 = (seed * 151) % 200, b0 = (seed * 37) % 200
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0
    for (let x = 0; x < W; x++) {
      const i = y * (W * 3 + 1) + 1 + x * 3
      const t = x / W
      const frame = x < 24 || x > W - 24 || y < 24 || y > H - 24 ? 0 : 1
      raw[i] = frame ? Math.round(40 + r0 * (1 - t) + 30 * (y / H)) : 230
      raw[i + 1] = frame ? Math.round(40 + g0 * t) : 230
      raw[i + 2] = frame ? Math.round(50 + b0 * (y / H)) : 230
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let n = 0
const server = createServer((req, res) => {
  if (!req.url?.startsWith('/result/')) {
    res.writeHead(404)
    return res.end()
  }
  n++
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' })
  res.end(png(n))
})
const port = Number(process.argv[2] ?? 0)
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`http://127.0.0.1:${server.address().port}\n`)
})
