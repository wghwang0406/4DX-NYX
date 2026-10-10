import type { Asset, EpisodeAssets } from '@conti/domain'

// {EP}/character/Character.md — 에셋 사전 뷰 (GenSetup SKILL.md §4-A 형식).
// 진실은 .conti/episodes/{ep}/assets.json 이고 이 파일은 거기서 생성한다.

const SECTION: Record<Asset['kind'], string> = { char: '등장체', loc: '배경', prop: '소품' }

/** 시트 경로: views 의 첫 버전 파일에서 `{ep}/character/` 접두를 뗀 상대경로. 여러 뷰면 `{a,b}` 로 묶는다. */
function sheetLine(a: Asset, ep: string): string | null {
  const prefix = `${ep}/character/`
  const files = Object.values(a.views)
    .map((vs) => vs[vs.length - 1]?.file)
    .filter((f): f is string => !!f)
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f))
  if (!files.length) return null
  return files.length === 1 ? files[0] : files.join(', ')
}

function renderAsset(a: Asset, ep: string): string {
  const lines: string[] = [`### ${a.tag}`]
  if (a.kind === 'char') lines.push(`- kind: ${a.subkind ?? 'human'} / state: ${a.state}`)
  else lines.push(`- state: ${a.state}`)
  lines.push(`- 설명: ${a.descriptionKo || ''}`.trimEnd())
  if (a.anchorEn) lines.push(`- 앵커: ${a.anchorEn}`)
  if (a.cameraAnchorEn) lines.push(`- 카메라 앵커: ${a.cameraAnchorEn}`)
  const sheet = sheetLine(a, ep)
  if (sheet) lines.push(`- 시트: ${sheet}`)
  if (a.kind === 'char') {
    if (a.masterProfileEn) lines.push(`- 마스터 프로필: ${a.masterProfileEn}`)
    if (a.voiceEn) lines.push(`- Voice: ${a.voiceEn}`)
  }
  return lines.join('\n')
}

export function renderCharacterMd(ea: EpisodeAssets): string {
  const out: string[] = [`# 에셋 사전 — ${ea.ep}`, '']
  for (const kind of ['char', 'loc', 'prop'] as const) {
    const items = ea.assets.filter((a) => a.kind === kind)
    out.push(`## ${SECTION[kind]}`, '')
    if (!items.length) {
      out.push('(없음)', '')
      continue
    }
    for (const a of items) out.push(renderAsset(a, ea.ep), '')
  }
  return out.join('\n')
}
