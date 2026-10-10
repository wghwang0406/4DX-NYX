import { z } from 'zod'
import { defineTool } from '../context'
import { findSection, loadSpec, sectionText, type SpecName } from '../specs'
import { ok } from '../util'

const spec = z.enum(['lira', 'cinedance', 'acting'])
const MISSING = (s: SpecName) => `번들에 ${s} 원문(skills/*/SKILL.md)이 없습니다 — 요약 규칙(프롬프트 규칙 10개)만으로 진행하세요`

export const specTools = [
  defineTool({
    name: 'spec_toc',
    description: '원문 규격(lira / cinedance / acting)의 목차: [{id, title, chars}]. spec_get 에 id 를 넘긴다.',
    input: { spec },
    handler: async ({ spec }, { bundleDir }) => {
      const doc = await loadSpec(bundleDir, spec)
      if (!doc) return ok({ spec, sections: [], note: MISSING(spec) })
      return ok({ spec, sections: doc.sections.map((s) => ({ id: s.id, title: s.title, chars: s.chars })) })
    },
  }),
  defineTool({
    name: 'spec_get',
    description: '원문 규격의 특정 절만 읽는다 (토큰 절약). sections 는 spec_toc 의 id (또는 "lira#id", 제목). 첫 블록은 메타 JSON, 둘째 블록이 본문.',
    input: { spec, sections: z.array(z.string()).min(1) },
    handler: async ({ spec, sections }, { bundleDir }) => {
      const doc = await loadSpec(bundleDir, spec)
      if (!doc) return ok({ spec, found: [], missing: sections, totalChars: 0, note: MISSING(spec) })
      const found: Array<{ id: string; title: string; chars: number }> = []
      const missing: string[] = []
      const texts: string[] = []
      for (const ref of sections) {
        const s = findSection(doc, ref)
        if (!s) {
          missing.push(ref)
          continue
        }
        const t = sectionText(doc, s)
        found.push({ id: s.id, title: s.title, chars: t.length })
        texts.push(t)
      }
      const text = texts.join('\n\n')
      return ok({ spec, found, missing, totalChars: text.length }, text ? [{ type: 'text', text }] : [])
    },
  }),
]
