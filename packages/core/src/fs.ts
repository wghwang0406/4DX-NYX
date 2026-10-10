import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

/** 원자적 쓰기 + 윈도우 EPERM/EBUSY 재시도. 항상 UTF-8, BOM 없음, LF. */
export async function writeAtomic(path: string, data: string | Buffer, retries = 5): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  for (let i = 0; ; i++) {
    try {
      await writeFileAtomic(path, data, { encoding: typeof data === 'string' ? 'utf8' : undefined })
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= retries || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
}

/** BOM 허용, CRLF → LF */
export async function readText(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8')
  return raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 프로젝트 루트 + POSIX 상대경로 → OS 절대경로. 루트 밖으로 나가면 거부. */
export function absPath(root: string, rel: string): string {
  const abs = resolve(root, ...rel.split('/'))
  const rootAbs = resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(`프로젝트 밖 경로: ${rel}`)
  }
  return abs
}

export { join }
