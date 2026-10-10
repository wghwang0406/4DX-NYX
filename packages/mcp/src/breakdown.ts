import { z } from 'zod'
import { ShotSize } from '@conti/domain'
import { normalizeDialogue, type SceneLine } from './scene'

export const ShotDraft = z.object({
  sizeCode: z.string(),
  angle: z.string().optional(),
  cameraMove: z.string().optional(),
  // 스킬(conti-breakdown)이 채워 보내는 값 — 스키마에 없으면 zod 가 조용히 버린다
  fovDeg: z.number().optional(),
  durationSec: z.number().optional(),
  characters: z.array(z.string()).default([]),
  location: z.string().optional(),
  props: z.array(z.string()).default([]),
  actionKo: z.string().default(''),
  dialogue: z
    .array(z.object({ speaker: z.string().optional(), text: z.string(), lineN: z.number().int().optional() }))
    .default([]),
  tag: z.enum(['대사', '반응']).optional(),
  sourceLines: z.array(z.number().int()).default([]),
})
export type ShotDraft = z.infer<typeof ShotDraft>

export interface BreakdownReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  missingLines: Array<{ n: number; speaker?: string; text: string }>
  duplicatedLines: Array<{ n: number; shots: number[] }>
  /** 샷 인덱스별로 매칭된 원문 lineN (성공 시 dialogue.lineN 채우기용) */
  matched: Array<number | undefined>
}

/**
 * 결정적 검증 — 모델이 아니라 코드가 판정한다.
 * - 씬의 대사 줄마다 정확히 한 샷이 담당 (lineN 또는 정규화 텍스트로 매칭)
 * - 샷 하나에 대사 2줄 이상 금지
 * - sizeCode 유효
 */
export function validateBreakdown(scene: SceneLine[], drafts: ShotDraft[]): BreakdownReport {
  const errors: string[] = []
  const warnings: string[] = []
  const dialogueLines = scene.filter((l) => l.kind === 'dialogue')
  const byN = new Map(dialogueLines.map((l) => [l.n, l]))
  const byText = new Map<string, SceneLine[]>()
  for (const l of dialogueLines) {
    const k = normalizeDialogue(l.text)
    byText.set(k, [...(byText.get(k) ?? []), l])
  }
  const coverage = new Map<number, number[]>() // lineN → 샷 인덱스들
  const matched: Array<number | undefined> = []

  if (!drafts.length) errors.push('샷이 0개입니다')

  drafts.forEach((d, i) => {
    const label = `샷 ${i + 1}`
    if (!ShotSize.options.includes(d.sizeCode as never)) errors.push(`${label}: sizeCode '${d.sizeCode}' 는 유효하지 않음 (${ShotSize.options.join('/')})`)
    if (d.dialogue.length > 1) errors.push(`${label}: 대사가 ${d.dialogue.length}줄 — 대사 줄마다 샷을 나눠야 함`)
    if (!d.actionKo.trim() && !d.dialogue.length) warnings.push(`${label}: actionKo 와 dialogue 가 모두 비었음`)
    if (!d.sourceLines.length) warnings.push(`${label}: sourceLines 가 비었음`)
    const dl = d.dialogue[0]
    matched[i] = undefined
    if (!dl) return
    let hit: SceneLine | undefined
    if (dl.lineN != null) hit = byN.get(dl.lineN)
    if (!hit) {
      const cands = byText.get(normalizeDialogue(dl.text)) ?? []
      hit = cands.find((c) => !coverage.has(c.n)) ?? cands[0]
    }
    if (!hit) {
      errors.push(`${label}: 대사 "${dl.text}" 가 원문 대사 줄과 일치하지 않음`)
      return
    }
    if (dl.lineN != null && hit.n !== dl.lineN) warnings.push(`${label}: lineN ${dl.lineN} 대신 텍스트로 ${hit.n}줄에 매칭`)
    matched[i] = hit.n
    coverage.set(hit.n, [...(coverage.get(hit.n) ?? []), i + 1])
  })

  const missingLines = dialogueLines.filter((l) => !coverage.has(l.n)).map((l) => ({ n: l.n, speaker: l.speaker, text: l.text }))
  const duplicatedLines = [...coverage.entries()].filter(([, shots]) => shots.length > 1).map(([n, shots]) => ({ n, shots }))
  if (missingLines.length) errors.push(`원문 대사 ${missingLines.length}줄이 어떤 샷에도 없음`)
  if (duplicatedLines.length) errors.push(`원문 대사 ${duplicatedLines.length}줄이 두 샷 이상에 중복`)

  return { ok: errors.length === 0, errors, warnings, missingLines, duplicatedLines, matched }
}
