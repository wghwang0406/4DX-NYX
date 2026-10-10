import { readFile } from 'node:fs/promises'
import type { Sequence } from '@conti/domain'
import { absPath, readText } from '@conti/core'
import { classifyLines, extractPdfLines, textToLines, type ClassifiedLine } from '@conti/screenplay'
import { ToolError } from './util'

export interface SceneLine {
  n: number
  kind: ClassifiedLine['kind']
  speaker?: string
  text: string
  paren?: string
}

/** sequence.source 가 가리키는 원문 구간을 다시 추출해 줄 단위로 분류한다 (blank 제외). */
export async function loadSceneLines(projectRoot: string, seq: Sequence): Promise<SceneLine[]> {
  const src = seq.source
  if (!src.sourceId) throw new ToolError(`시퀀스 ${seq.seq} 에 원문(source)이 없습니다`)
  const abs = absPath(projectRoot, src.sourceId)
  const lines = src.sourceId.toLowerCase().endsWith('.pdf')
    ? await extractPdfLines(new Uint8Array(await readFile(abs)))
    : textToLines(await readText(abs))
  const start = src.lineStart ?? 1
  const end = src.lineEnd ?? Number.MAX_SAFE_INTEGER
  const slice = lines.filter((l) => l.n >= start && l.n <= end)
  return classifyLines(slice)
    .filter((l) => l.kind !== 'blank')
    .map((l) => ({ n: l.n, lineN: l.n, kind: l.kind, speaker: l.speaker, text: l.text.trim(), paren: l.paren }))
}

/** 대사 비교용 정규화: 공백·따옴표·문장부호 제거. */
export function normalizeDialogue(s: string): string {
  return s.replace(/[\s"“”'‘’.,!?…·~\-—–()（）]/g, '').toLowerCase()
}
