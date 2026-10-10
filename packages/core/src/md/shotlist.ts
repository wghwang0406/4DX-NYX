import type { Sequence, Shot, StageStatus } from '@conti/domain'

// shotlist_{SEQ}.md — 기존 7컬럼(# / 샷사이즈 / 인물 / 장소 / 소품 / 묘사 / 상태) + 이미지 / 영상 상태.
// 러너(cache.py ShotlistUpdater)는 헤더 이름으로 상태 컬럼을 찾으므로 컬럼이 늘어도 깨지지 않는다.

const STATUS_EMOJI: Record<StageStatus, string> = {
  none: '⏳',
  prompt_ready: '⏳',
  awaiting_approval: '⏳',
  queued: '🔄',
  running: '🔄',
  review: '✅',
  approved: '✅',
  failed: '❌',
  stale: '🔁',
}

const dash = (s: string | undefined) => (s && s.trim() ? s : '—')
/** md 표 셀 규칙: `|` 는 전각 `｜` 로, 줄바꿈은 공백으로. 모든 셀과 제목에 쓴다 (열이 밀리지 않게). */
export const mdCell = (s: string) => s.replace(/\|/g, '｜').replace(/\s*\n+\s*/g, ' ').trim()
const cell = mdCell

function describe(shot: Shot): string {
  const parts: string[] = []
  if (shot.tag) parts.push(`[${shot.tag}]`)
  for (const d of shot.dialogue) parts.push(d.speaker ? `${d.speaker}: "${d.text}"` : `"${d.text}"`)
  if (shot.actionKo) parts.push(shot.actionKo)
  return cell(parts.join(' '))
}

export function renderShotlistMd(seq: Sequence): string {
  const rows = seq.shots
    .filter((s) => !s.deleted)
    .map(
      (s) =>
        `| ${s.no} | ${dash(s.sizeCode)} | ${dash(cell(s.characters.map((c) => c.replace(/^@/, '')).join(', ')))} | ${dash(
          cell(s.location?.replace(/^@loc_/, '') ?? ''),
        )} | ${dash(cell(s.props.map((p) => p.replace(/^@prop_/, '')).join(', ')))} | ${describe(s)} | ${
          STATUS_EMOJI[s.stages.conti.status]
        } | ${STATUS_EMOJI[s.stages.image.status]} | ${STATUS_EMOJI[s.stages.video.status]} |`,
    )
  return [
    `# 시퀀스 ${seq.seq} — ${cell(seq.headingKo || '')}`.trimEnd(),
    '',
    '> 상태: ✅완료 / ⏳대기 / ❌실패 / 🔄진행중 / 🔁재생성 필요',
    '> 이 파일은 앱이 .conti 데이터에서 생성한다. 직접 고치면 앱이 감지해 반영 여부를 묻는다.',
    '',
    '| # | 샷사이즈 | 인물 | 장소 | 소품 | 묘사 | 상태 | 이미지 | 영상 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

export interface ShotlistRow {
  no: string
  size?: string
  characters: string[]
  location?: string
  props: string[]
  description: string
  status?: string
}

/** 5컬럼(구형)·7컬럼·9컬럼 모두 헤더 이름으로 읽는다. */
export function parseShotlistMd(text: string): { heading: string; rows: ShotlistRow[] } {
  const lines = text.split('\n')
  const heading = (lines.find((l) => l.startsWith('# '))?.replace(/^#\s*시퀀스\s*\S+\s*—?\s*/, '') ?? '').trim()
  let headers: string[] | null = null
  const rows: ShotlistRow[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
    if (!headers) {
      if (cells[0] === '#') headers = cells.map((h) => h.toLowerCase())
      continue
    }
    if (/^-+$/.test(cells[0])) continue
    if (!/^\d{4}$/.test(cells[0])) continue
    const get = (...names: string[]) => {
      for (const n of names) {
        const i = headers!.indexOf(n)
        if (i >= 0) return cells[i] ?? ''
      }
      return ''
    }
    const list = (s: string) => (s === '—' || s === '-' || !s ? [] : s.split(/[,，]/).map((x) => x.trim()).filter(Boolean))
    rows.push({
      no: cells[0],
      size: get('샷사이즈', 'size') || undefined,
      characters: list(get('인물', 'characters')),
      location: (() => {
        const v = get('장소', 'location')
        return v && v !== '—' ? v : undefined
      })(),
      props: list(get('소품', 'props')),
      description: get('묘사', 'description'),
      status: get('상태', 'status') || undefined,
    })
  }
  return { heading, rows }
}
