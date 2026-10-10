// agent-bundle/specs/index.json 생성기.
// 실행: corepack pnpm exec tsx tools/build-spec-index.mts
//
// Lira / Cinedance / Acting 원문(SKILL.md)의 `#`/`##`/`###` 제목마다
// {id, title, start, end, chars} 를 적는다. 줄 번호는 1-based inclusive.
// 한 섹션은 제목 줄부터 "같거나 더 높은 레벨의 다음 제목" 직전까지다
// (`#` 섹션은 자기 `##` 자식을 포함한다 → spec_get 한 번으로 묶음 읽기 가능).
// 코드펜스(```) 안의 `#` 줄은 제목으로 세지 않는다.
// id = 제목의 소문자 ascii 슬러그(`-` 구분), 중복은 `-2`, `-3` 꼬리.

import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = path.join(ROOT, 'agent-bundle')
const SPECS = ['lira', 'cinedance', 'acting'] as const
const DIR_OF: Record<(typeof SPECS)[number], string> = { lira: 'Lira', cinedance: 'Cinedance', acting: 'Acting' }

export interface SpecSection {
  id: string
  title: string
  level: 1 | 2 | 3
  start: number // 1-based, 제목 줄
  end: number // 1-based inclusive
  chars: number // start..end 줄의 글자 수(개행 포함)
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\x00-\x7f]/g, '') // ascii 밖(°, —, 한글)은 버린다
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function indexSections(text: string): SpecSection[] {
  const lines = text.split(/\r?\n/)
  const heads: Array<{ level: 1 | 2 | 3; title: string; line: number }> = []
  let inFence = false
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (m) heads.push({ level: m[1].length as 1 | 2 | 3, title: m[2].trim(), line: i + 1 })
  })

  const seen = new Map<string, number>()
  return heads.map((h, idx) => {
    let end = lines.length
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line - 1
        break
      }
    }
    // 섹션 끝의 빈 줄은 범위에서 뺀다(다음 제목 직전 공백)
    while (end > h.line && lines[end - 1].trim() === '') end--
    let id = slugify(h.title) || `section-${h.line}`
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    if (n > 1) id = `${id}-${n}`
    const chars = lines.slice(h.line - 1, end).join('\n').length + 1
    return { id, title: h.title, level: h.level, start: h.line, end, chars }
  })
}

async function main() {
  const out: Record<string, unknown> = {
    _generated_by: 'tools/build-spec-index.mts',
    _note: '줄 번호는 1-based inclusive. # 섹션은 하위 ##/### 를 포함한다. spec_get{spec, sections:[id…]} 로 필요한 구간만 읽는다.',
  }
  for (const spec of SPECS) {
    const file = path.join(BUNDLE, 'skills', DIR_OF[spec], 'SKILL.md')
    const text = await readFile(file, 'utf8')
    const sections = indexSections(text)
    out[spec] = {
      file: `skills/${DIR_OF[spec]}/SKILL.md`,
      sha256: createHash('sha256').update(text).digest('hex'),
      lines: text.split(/\r?\n/).length,
      sections,
    }
    console.log(`${spec}: ${sections.length} sections`)
  }
  const dest = path.join(BUNDLE, 'specs', 'index.json')
  await writeFile(dest, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(`wrote ${path.relative(ROOT, dest)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
