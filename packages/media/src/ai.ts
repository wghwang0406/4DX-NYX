// S11·S12 AI 판단 — 시트 몇 장 + 짧은 표를 한 번에 보내고, 패널 ID 별 판단 필드만 받는다(타임코드·대사를 되풀이하지 않음 → 출력 토큰 절감).
// 결과는 패널별 "증거 해시"로 캐시 — 다시 돌리면 바뀐 패널만 보낸다.
import { createHash } from 'node:crypto'
import { ShotSize } from '@conti/domain'
import type { DraftShot } from './merge'
import { fmtTc } from './merge'

export const SIZES = ShotSize.options

/** Claude --json-schema / Codex --output-schema 둘 다 받게: 모든 키 required + additionalProperties false (빈 값은 ""). */
export const PANEL_SCHEMA = {
  type: 'object',
  properties: {
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          size: { type: 'string', enum: SIZES },
          angle: { type: 'string' },
          chars: { type: 'array', items: { type: 'string' } },
          action: { type: 'string' },
          speaker: { type: 'string' },
          cam: { type: 'string' },
          conf: { type: 'number' },
        },
        required: ['id', 'size', 'angle', 'chars', 'action', 'speaker', 'cam', 'conf'],
        additionalProperties: false,
      },
    },
  },
  required: ['panels'],
  additionalProperties: false,
} as const

export interface PanelJudgement {
  id: string
  size: string
  angle: string
  chars: string[]
  action: string
  speaker: string
  cam: string
  conf: number
}

export interface AiRow {
  id: string // 패널 라벨 (0030 / 0030b)
  t: number
  cam: string
  camSure: boolean
  dialogue: string
  group?: string
}

export function rowsFor(shots: DraftShot[]): AiRow[] {
  return shots.flatMap((s) =>
    s.panels.map((p) => ({
      id: p.label,
      t: p.key,
      cam: s.cameraMove,
      camSure: s.camera.reliable,
      dialogue: p.index === 0 ? s.dialogue.map((d) => d.text).join(' / ') : '',
      group: p.group,
    })),
  )
}

/** 패널 판단의 근거가 같으면 캐시를 쓴다: 키프레임 지각 해시 + 측정 카메라 + 대사 + 인물 후보 */
export function evidenceHash(row: AiRow, phash: string, charHints: string[]): string {
  return createHash('sha256').update(JSON.stringify([phash, row.cam, row.camSure, row.dialogue, charHints])).digest('hex').slice(0, 24)
}

export function sheetLabel(row: AiRow): string {
  return `${row.id} ${fmtTc(row.t)}${row.group ? ` ${row.group}` : ''}`
}

export function pass1Prompt(rows: AiRow[], sheets: number, charHints: string[], extra = ''): string {
  const table = rows.map((r) => `${r.id} | ${fmtTc(r.t)} | ${r.cam}${r.camSure ? '' : '?'} | ${r.dialogue ? `"${r.dialogue.slice(0, 80)}"` : ''}`).join('\n')
  return [
    `영상 콘티 분석 — 시트 이미지 ${sheets}장. 각 칸 = 패널 하나, 노란 라벨 = "패널ID 시각 [같은 셋업 그룹]".`,
    '아래 표의 패널마다 판단만 돌려줘. 타임코드·대사 원문은 되풀이하지 않는다. 표의 모든 id 를 빠짐없이.',
    '- size: EWS|WS|MWS|MS|MCU|CU|ECU|POV|INSERT|OTS (인물 기준 프레이밍, 인물이 없으면 공간·사물 기준)',
    '- angle: eye level | low | high | top | dutch | over-the-shoulder 중 하나 (필요하면 짧게 덧붙임)',
    `- chars: 프레임 안 인물·등장체. ${charHints.length ? `후보 태그: ${charHints.join(', ')} — 맞으면 그 태그로.` : '후보가 없으니 "인물A", "인물B" 처럼 임시 이름을 일관되게.'} 없으면 []`,
    '- action: 한국어 한 문장. 동작은 전환이 아니라 상태로(…한 채로 / …하는 중), 표정은 감정어가 아니라 근육의 일로.',
    '- speaker: 표에 대사가 있는 패널만, chars 중 말하는 사람. 아니면 ""',
    '- cam: 측정 카메라(표 3열, "?" = 불확실)가 틀렸을 때만 STATIC|PAN →|PAN ←|TILT ↑|TILT ↓|ZOOM IN|ZOOM OUT|DOLLY IN|DOLLY OUT|WHIP|HANDHELD|CRANE|ORBIT 중 하나. 맞으면 ""',
    '- conf: 0..1, 이 패널 판단의 확신 (작은 얼굴·흐림·애매하면 낮게)',
    '같은 셋업 그룹(G#)은 대표 칸을 자세히 보고 나머지는 같은 설정을 따르되 달라진 점만 반영한다.',
    extra,
    '',
    'id | 시각 | 측정 카메라 | 대사',
    table,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export function pass2Prompt(rows: AiRow[], charHints: string[]): string {
  return pass1Prompt(rows, Math.ceil(rows.length / 4), charHints, '이번 이미지는 패널마다 한 줄 = [시작 · 가운데 · 끝] 3프레임이다. 1차 판단이 불확실했던 패널만 다시 본다 — 움직임과 시선을 3프레임으로 확인해서 정확히.')
}

/** 응답 검증·정규화: 모르는 id 는 버리고, size 는 enum 밖이면 버린다. */
export function normalize(out: unknown, ids: Set<string>): Map<string, PanelJudgement> {
  const map = new Map<string, PanelJudgement>()
  const arr = (out as { panels?: unknown[] })?.panels
  if (!Array.isArray(arr)) return map
  for (const raw of arr) {
    const p = raw as Partial<PanelJudgement>
    if (!p?.id || !ids.has(p.id)) continue
    map.set(p.id, {
      id: p.id,
      size: SIZES.includes(p.size as never) ? (p.size as string) : '',
      angle: String(p.angle ?? '').slice(0, 60),
      chars: Array.isArray(p.chars) ? p.chars.map(String).filter(Boolean).slice(0, 8) : [],
      action: String(p.action ?? '').slice(0, 300),
      speaker: String(p.speaker ?? ''),
      cam: String(p.cam ?? '').trim(),
      conf: Math.max(0, Math.min(1, Number(p.conf ?? 0.5))),
    })
  }
  return map
}

/** 2차 대상: 확신 < 0.6, 낮은 순, 전체 패널의 최대 20% (최소 1) */
export function pass2Targets(j: Map<string, PanelJudgement>, total: number, threshold = 0.6): string[] {
  const low = [...j.values()].filter((p) => p.conf < threshold).sort((a, b) => a.conf - b.conf)
  return low.slice(0, Math.max(1, Math.floor(total * 0.2))).map((p) => p.id)
}

const TAG = /^@/

/** 판단을 샷 초안에 반영. 첫 패널이 샷 단위 필드를, 나머지 패널은 캡션을. 카메라 정정이 있으면 측정 화살표를 지운다. */
export function applyJudgements(shots: DraftShot[], j: Map<string, PanelJudgement>) {
  for (const s of shots) {
    for (const p of s.panels) {
      const r = j.get(p.label)
      if (!r) continue
      if (p.index === 0) {
        if (r.size) s.sizeCode = r.size as DraftShot['sizeCode']
        if (r.angle) s.angle = r.angle
        s.characters = r.chars.map((c) => (TAG.test(c) ? c : `@${c.replace(/\s+/g, '')}`))
        if (r.action) s.actionKo = r.action
        if (r.speaker && s.dialogue.length) s.dialogue = s.dialogue.map((d, k) => (k === 0 ? { ...d, speaker: r.speaker.replace(/^@/, '') } : d))
        if (r.cam && r.cam.toUpperCase() !== s.cameraMove.toUpperCase()) {
          s.cameraMove = r.cam.toUpperCase().replace(/\s+/g, ' ')
          p.annotations = p.annotations.filter((a) => !a.id.endsWith('-cam'))
          s.review = s.review.filter((f) => f !== 'motion_unreliable')
        } else if (r.cam === '' && !s.camera.reliable && r.conf >= 0.6) {
          // AI 가 측정 라벨을 그대로 인정하면 확인 필요 표시를 내린다
          s.review = s.review.filter((f) => f !== 'motion_unreliable')
        }
      } else {
        ;(p as DraftShot['panels'][number] & { caption?: string }).caption = r.action
      }
    }
  }
}
