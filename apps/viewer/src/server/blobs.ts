// 해시 주소 파일 저장소 — 이어올리기: 부분 파일(.part)에 오프셋 순서대로 붙이고, 크기가 차면 sha256 검증 후 확정.
// 같은 파일(바뀌지 않은 페이지·패널)은 다음 게시 때 다시 올리지 않는다.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage } from 'node:http'

export const SHA_RE = /^[0-9a-f]{64}$/

export class BlobStore {
  constructor(readonly dir: string) {}

  path(sha: string): string {
    return join(this.dir, sha.slice(0, 2), sha)
  }
  private part(sha: string): string {
    return `${this.path(sha)}.part`
  }

  async has(sha: string): Promise<boolean> {
    try {
      await stat(this.path(sha))
      return true
    } catch {
      return false
    }
  }

  async received(sha: string): Promise<number> {
    if (await this.has(sha)) return (await stat(this.path(sha))).size
    try {
      return (await stat(this.part(sha))).size
    } catch {
      return 0
    }
  }

  /** 오프셋은 이미 받은 크기와 같아야 한다 (어긋나면 409 로 현재 크기를 알려 클라이언트가 맞춘다). 다 받으면 검증 후 확정. */
  async append(sha: string, offset: number, size: number, body: IncomingMessage, maxChunk: number): Promise<{ received: number; complete: boolean; mismatch?: number }> {
    if (await this.has(sha)) return { received: size, complete: true }
    const cur = await this.received(sha)
    if (offset !== cur) return { received: cur, complete: false, mismatch: cur }
    await mkdir(dirname(this.part(sha)), { recursive: true })
    let n = 0
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(this.part(sha), { flags: 'a' })
      body.on('data', (chunk: Buffer) => {
        n += chunk.length
        if (n > maxChunk || cur + n > size) {
          body.destroy()
          ws.destroy()
          reject(new Error(n > maxChunk ? 'chunk too large' : 'exceeds declared size'))
          return
        }
        if (!ws.write(chunk)) {
          body.pause()
          ws.once('drain', () => body.resume())
        }
      })
      body.on('end', () => ws.end(() => resolve()))
      body.on('error', reject)
      ws.on('error', reject)
    })
    const received = cur + n
    if (received < size) return { received, complete: false }
    // 검증
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      createReadStream(this.part(sha)).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject)
    })
    const got = hash.digest('hex')
    if (got !== sha) {
      await rm(this.part(sha), { force: true })
      throw new Error(`해시 불일치 (${got.slice(0, 12)} ≠ ${sha.slice(0, 12)}) — 처음부터 다시 올리세요`)
    }
    await rename(this.part(sha), this.path(sha))
    return { received, complete: true }
  }
}
