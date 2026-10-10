// 업로드 캐시 — 서버는 같은 파일을 올려도 새 id 를 주고(dedupe 없음) 만료 필드도 없다 (REPORT §2).
// sha256 → upload id 를 .conti/cache/uploads.json 에 들고 재업로드를 피한다.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256, writeAtomic } from '@conti/core'
import type { HiggsfieldCli } from './cli'

interface Entry {
  id: string
  url?: string
  file: string
  at: number
}

export class UploadCache {
  private map: Record<string, Entry> = {}
  private loaded = false
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private root: string,
    private cli: HiggsfieldCli,
  ) {}

  private get path() {
    return join(this.root, '.conti', 'cache', 'uploads.json')
  }

  private async load() {
    if (this.loaded) return
    try {
      this.map = JSON.parse(await readFile(this.path, 'utf8'))
    } catch {
      this.map = {}
    }
    this.loaded = true
  }

  /** 파일 해시가 캐시에 있으면 그 id, 없으면 업로드하고 기록. 같은 파일 동시 요청은 직렬화. */
  async idFor(absFile: string, relForLog: string): Promise<{ id: string; sha256: string; cached: boolean }> {
    const buf = await readFile(absFile)
    const hash = sha256(buf)
    const run = async () => {
      await this.load()
      const hit = this.map[hash]
      if (hit) return { id: hit.id, sha256: hash, cached: true }
      const up = await this.cli.upload(absFile)
      this.map[hash] = { id: up.id, url: up.url, file: relForLog, at: Date.now() }
      await writeAtomic(this.path, JSON.stringify(this.map, null, 2) + '\n')
      return { id: up.id, sha256: hash, cached: false }
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => {})
    return p
  }

  /** 서버에서 지워진 업로드를 무효화할 때 (upload list 대조는 M3 범위 밖 — 수동 호출용). */
  async forget(hash: string) {
    await this.load()
    delete this.map[hash]
    await writeAtomic(this.path, JSON.stringify(this.map, null, 2) + '\n')
  }
}
