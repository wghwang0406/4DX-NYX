// 아주 작은 PNG 인코더 — 애니매틱에서 콘티가 없는 컷의 빈 프레임(번호만 없는 회색 판)을 만든다. 의존성 없음.
import { deflateSync } from 'node:zlib'

let table: number[] | null = null
function crc32(buf: Buffer): number {
  if (!table) {
    table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** 단색 RGB PNG (가장자리 1/40 폭의 밝은 테두리) */
export function solidPng(w: number, h: number, rgb: [number, number, number] = [58, 61, 68]): Buffer {
  const border = Math.max(2, Math.round(w / 40))
  const row = Buffer.alloc(w * 3 + 1)
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    row[0] = 0
    for (let x = 0; x < w; x++) {
      const edge = x < border || x >= w - border || y < border || y >= h - border
      row[1 + x * 3] = edge ? 120 : rgb[0]
      row[2 + x * 3] = edge ? 124 : rgb[1]
      row[3 + x * 3] = edge ? 132 : rgb[2]
    }
    row.copy(raw, y * (w * 3 + 1))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
