// 결과 다운로드 — 임시 파일에 받아 검증한 뒤 원자적으로 옮긴다. 항상 로컬 사본이 정본, URL 은 메타데이터.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { sha256 } from '@conti/core'

export interface Downloaded {
  sha256: string
  bytes: number
  w?: number
  h?: number
  ext: string
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; headers: { get(k: string): string | null } }>

/** PNG IHDR / JPEG SOF / WebP VP8X 에서 크기만 읽는다 (sharp 없이). */
export function imageDims(buf: Buffer): { w: number; h: number } | undefined {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return undefined
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return undefined
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }
    }
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  }
  return undefined
}

export function extFromUrl(url: string, fallback = 'png'): string {
  const e = extname(new URL(url).pathname).replace('.', '').toLowerCase()
  return /^(png|jpe?g|webp)$/.test(e) ? e : fallback
}

export async function downloadTo(url: string, absTarget: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Downloaded> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 64) throw new Error(`다운로드 결과가 비어 있습니다 (${buf.length} bytes)`)
  const dims = imageDims(buf)
  if (!dims) throw new Error('이미지 형식을 알 수 없습니다 (png/jpg/webp 아님)')
  await mkdir(dirname(absTarget), { recursive: true })
  const tmp = `${absTarget}.part-${process.pid}-${Date.now()}`
  try {
    await writeFile(tmp, buf)
    await rename(tmp, absTarget)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  return { sha256: sha256(buf), bytes: buf.length, w: dims.w, h: dims.h, ext: extFromUrl(url) }
}
