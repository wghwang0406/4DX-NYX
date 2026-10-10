import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { exists, readText, sha256 } from '@conti/core'

export type SpecName = 'lira' | 'cinedance' | 'acting'
export const SPEC_DIR: Record<SpecName, string> = { lira: 'Lira', cinedance: 'Cinedance', acting: 'Acting' }

export interface SpecSection {
  id: string
  title: string
  start: number // 1-based, inclusive
  end: number // 1-based, inclusive
  chars: number
}

export interface SpecDoc {
  spec: SpecName
  lines: string[]
  sections: SpecSection[]
}

export function slugify(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

/** `# ` / `## ` 제목으로 구간을 만든다. 제목 앞의 서문은 `_intro` 로 묶는다. */
export function buildIndex(lines: string[]): SpecSection[] {
  const heads: Array<{ line: number; title: string }> = []
  let inFence = false
  lines.forEach((l, i) => {
    if (/^```/.test(l)) inFence = !inFence
    if (inFence) return
    const m = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) heads.push({ line: i + 1, title: m[1].trim() })
  })
  const out: SpecSection[] = []
  const seen = new Map<string, number>()
  const push = (id: string, title: string, start: number, end: number) => {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    const uid = n === 1 ? id : `${id}-${n}`
    out.push({ id: uid, title, start, end, chars: lines.slice(start - 1, end).join('\n').length })
  }
  if (heads.length === 0 || heads[0].line > 1) push('_intro', '(서문)', 1, (heads[0]?.line ?? lines.length + 1) - 1)
  heads.forEach((h, i) => push(slugify(h.title) || `section-${i + 1}`, h.title, h.line, (heads[i + 1]?.line ?? lines.length + 1) - 1))
  return out
}

/**
 * bundleDir/specs/index.json 이 있으면 쓰고(두 형태 허용: `[섹션…]` 또는 tools/build-spec-index.mts 가 내는
 * `{file, sha256, lines, sections}`), 원문 해시가 안 맞거나 줄 범위가 파일 밖이면 제목에서 다시 만든다.
 * SKILL.md 가 없으면 null.
 */
export async function loadSpec(bundleDir: string, spec: SpecName): Promise<SpecDoc | null> {
  const path = join(bundleDir, 'skills', SPEC_DIR[spec], 'SKILL.md')
  if (!(await exists(path))) return null
  const raw = await readFile(path, 'utf8')
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const indexPath = join(bundleDir, 'specs', 'index.json')
  let sections: SpecSection[] | null = null
  if (await exists(indexPath)) {
    try {
      type Entry = SpecSection[] | { sha256?: string; sections?: SpecSection[] }
      const idx = JSON.parse(await readText(indexPath)) as Partial<Record<SpecName, Entry>>
      const entry = idx[spec]
      const list = Array.isArray(entry) ? entry : entry?.sections
      const hashOk = !entry || Array.isArray(entry) || !entry.sha256 || entry.sha256 === sha256(raw)
      const rangeOk = Array.isArray(list) && list.every((s) => s.start >= 1 && s.end >= s.start && s.end <= lines.length)
      if (Array.isArray(list) && list.length && hashOk && rangeOk) sections = list
    } catch {
      sections = null
    }
  }
  return { spec, lines, sections: sections ?? buildIndex(lines) }
}

export function findSection(doc: SpecDoc, ref: string): SpecSection | undefined {
  const key = ref.replace(/^[a-z]+#/i, '').trim()
  const k = key.toLowerCase()
  return (
    doc.sections.find((s) => s.id === key) ??
    doc.sections.find((s) => s.id.toLowerCase() === k || s.title.toLowerCase() === k) ??
    doc.sections.find((s) => slugify(s.title) === slugify(key))
  )
}

export function sectionText(doc: SpecDoc, s: SpecSection): string {
  return doc.lines.slice(s.start - 1, s.end).join('\n')
}
