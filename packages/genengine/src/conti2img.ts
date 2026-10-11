// GenConti2Img Step 6·6b·2-A·9 — 콘티 Vision 분석(샷 사이즈·앵글·표정 세 가지만)과 배치 뒤 드리프트 확인.
// AI 호출(runAi)과 이미지 축소(shrink)는 앱이 주입한다 (앱 = Claude/Codex runStructured + Electron nativeImage).
// 결과는 shot.imageAnalysis 에 저장 — 분석한 콘티 버전이 같으면 다시 부르지 않는다(캐시).
import type { ProjectStore } from '@conti/core'
import { absPath } from '@conti/core'
import type { Asset, Sequence, Shot } from '@conti/domain'
import { currentContiVersion, pickView } from './refs'

export type RunAi = <T>(req: { prompt: string; images: string[]; schema: Record<string, unknown> }) => Promise<{ data: T }>
/** 절대경로 이미지를 AI 에 보낼 크기(긴 변 1024)로 줄인 임시 파일 경로 */
export type Shrink = (absFile: string) => Promise<string>

const SIZES = ['EWS', 'WS', 'MWS', 'MS', 'OTS', 'MCU', 'CU', 'ECU', 'INSERT', 'POV']

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'string' },
          shotSize: { type: 'string', enum: SIZES },
          angleEn: { type: 'string' },
          expressionEn: { type: 'string' },
          charView: { type: 'string', enum: ['front', 'back'] },
          useConti: { type: 'boolean' },
          compositionEn: { type: 'string' },
          people: { type: 'integer' },
        },
        required: ['no', 'shotSize', 'angleEn', 'expressionEn', 'useConti', 'people'],
      },
    },
    locationMapEn: { type: 'string' },
  },
  required: ['shots'],
} as const

interface AnalysisOut {
  shots: Array<{ no: string; shotSize: string; angleEn: string; expressionEn: string; charView?: 'front' | 'back'; useConti: boolean; compositionEn?: string; people: number }>
  locationMapEn?: string
}

/** 분석이 필요한 샷: 콘티가 있고, 분석이 없거나 다른 콘티 버전에서 한 것 */
export function needsAnalysis(seq: Sequence, shotNos: string[]): Shot[] {
  return seq.shots.filter((s) => !s.deleted && shotNos.includes(s.no)).filter((s) => {
    const cv = currentContiVersion(s)
    return !!cv && s.imageAnalysis?.contiVersionId !== cv.id
  })
}

/** 지시문 — GenConti2Img Step 6 원문 요지 + Acting(근육의 일·eye life·나쁜 연기 아틀라스) + Cinedance Location map */
export function analysisPrompt(lines: string[], wantLocationMap: boolean): string {
  return [
    'You analyze storyboard (conti) frames for the "storyboard → final film still" step of a film pipeline.',
    'For EACH shot below, look only at its storyboard image and return exactly three judgements:',
    `1. shotSize — one of ${SIZES.join(', ')} (exact abbreviation; it decides which reference views are attached).`,
    '2. angleEn — camera angle: eye-level / low angle / high angle / overhead / OTS / dutch.',
    '3. expressionEn — observable muscle work in English, never emotion words (write "jaw set, brow low and still, nostrils flared", not "angry"; "eyes wide, jaw slack, shoulders drawn up", not "terrified").',
    '   The tighter the shot, the less movement: eyes and thought only. Keep the eyes alive (a held blink, a saccade toward the hands, a real catchlight). No mugging, no playing the ending. Empty string if no face is visible.',
    'Never describe character appearance (hair, clothing, body type) — the character sheets define that. Do not describe positions or actions in expressionEn.',
    'Also return: people = number of people in frame; charView = "back" when the main character is seen from behind (else "front").',
    'useConti = false ONLY when the person drawn in the storyboard clearly contradicts the attached character sheet (a different person or costume); then give compositionEn (where subjects sit in the frame, facing, relative scale) so the composition can be written instead. Otherwise useConti = true.',
    ...(wantLocationMap
      ? [
          'locationMapEn — one LOCATION MAP for this scene in English: camera position and facing, foreground / midground / background, landmark positions, movement paths, light direction and colour temperature, the line the camera never crosses. Places only — no people, no actions. If the storyboards show no readable set, return an empty string.',
        ]
      : []),
    '',
    'Shots:',
    ...lines,
  ].join('\n')
}

/**
 * 콘티 분석 — 필요한 샷만 한 번의 AI 호출로. 결과를 shot.imageAnalysis 에, 비어 있던 LOCATION MAP 은 sequence.locationMapEn 에.
 * 반환: 분석한 샷 번호 (캐시 적중이면 빈 배열).
 */
export async function analyzeConti(o: { store: ProjectStore; seq: string; shotNos: string[]; runAi: RunAi; shrink: Shrink; maxShots?: number }): Promise<{ analyzed: string[]; locationMap: boolean }> {
  const seq = o.store.getSequence(o.seq)
  if (!seq) throw new Error(`시퀀스 없음: ${o.seq}`)
  const todo = needsAnalysis(seq, o.shotNos).slice(0, o.maxShots ?? 24)
  if (!todo.length) return { analyzed: [], locationMap: false }
  const assets = (await o.store.listAssets(seq.ep)).assets
  const byTag = new Map(assets.map((a) => [a.tag, a]))
  const images: string[] = []
  const sheetIndex = new Map<string, number>()
  const lines: string[] = []
  for (const shot of todo) {
    const cv = currentContiVersion(shot)!
    images.push(await o.shrink(absPath(o.store.root, cv.file)))
    const contiN = images.length
    const chars: string[] = []
    for (const tag of shot.characters) {
      const a: Asset | undefined = byTag.get(tag)
      const p = a ? (pickView(a, 'sheet') ?? pickView(a, 'front')) : undefined
      if (p && !sheetIndex.has(tag)) {
        images.push(await o.shrink(absPath(o.store.root, p.version.file)))
        sheetIndex.set(tag, images.length)
      }
      chars.push(sheetIndex.has(tag) ? `${tag} (character sheet: image ${sheetIndex.get(tag)})` : tag)
    }
    lines.push(
      `- ${shot.no}: storyboard = image ${contiN}; listed size ${shot.sizeCode ?? '?'}; characters ${chars.join(', ') || 'none'}; location ${shot.location ?? 'none'}; props ${shot.props.join(', ') || 'none'}`,
    )
  }
  const wantMap = !seq.locationMapEn.trim()
  const r = await o.runAi<AnalysisOut>({ prompt: analysisPrompt(lines, wantMap), images, schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown> })
  const analyzed: string[] = []
  for (const shot of todo) {
    const got = r.data.shots.find((x) => x.no === shot.no)
    if (!got) continue
    const cv = currentContiVersion(shot)!
    await o.store.updateShot(o.seq, shot.id, {
      imageAnalysis: {
        contiVersionId: cv.id,
        shotSize: SIZES.includes(got.shotSize) ? got.shotSize : (shot.sizeCode ?? 'MS'),
        angleEn: got.angleEn,
        expressionEn: got.expressionEn ?? '',
        charView: got.charView === 'back' ? 'back' : undefined,
        useConti: got.useConti !== false,
        compositionEn: got.useConti === false ? got.compositionEn : undefined,
        people: Number.isFinite(got.people) ? Math.max(0, Math.round(got.people)) : undefined,
        at: Date.now(),
      },
    })
    analyzed.push(shot.no)
  }
  let locationMap = false
  // 읽을 수 없는 장면이면 비워 둔다 — 'UNDEFINED…' 같은 자리표시를 LOCATION MAP 으로 저장하지 않는다
  const map = r.data.locationMapEn?.trim() ?? ''
  if (wantMap && map && !/^(undefined|placeholder|n\/a|none|unknown)\b/i.test(map)) {
    const cur = o.store.getSequence(o.seq)!
    await o.store.upsertSequence({ seq: cur.seq, ep: cur.ep, locationMapEn: map })
    locationMap = true
  }
  return { analyzed, locationMap }
}

export const DRIFT_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { no: { type: 'string' }, tag: { type: 'string' }, ok: { type: 'boolean' }, issueKo: { type: 'string' }, anchorFixEn: { type: 'string' } },
        required: ['no', 'tag', 'ok'],
      },
    },
  },
  required: ['checks'],
} as const

/**
 * 드리프트 확인 (Step 9) — 방금 만든 이미지 1–2장을 등장체 시트와 대조. 새로 생성하지 않는다. 한 줄 요약을 돌려준다.
 */
export async function driftCheck(o: { store: ProjectStore; seq: string; results: Array<{ shotNo: string; file: string }>; runAi: RunAi; shrink: Shrink }): Promise<string | null> {
  const seq = o.store.getSequence(o.seq)
  if (!seq) return null
  const assets = (await o.store.listAssets(seq.ep)).assets
  const byTag = new Map(assets.map((a) => [a.tag, a]))
  const picks: Array<{ no: string; tag: string; file: string; sheet: string }> = []
  for (const r of o.results) {
    const shot = seq.shots.find((s) => s.no === r.shotNo)
    const tag = shot?.characters.find((t) => byTag.get(t) && (pickView(byTag.get(t)!, 'sheet') ?? pickView(byTag.get(t)!, 'front')))
    if (!shot || !tag) continue
    const p = pickView(byTag.get(tag)!, 'sheet') ?? pickView(byTag.get(tag)!, 'front')
    picks.push({ no: r.shotNo, tag, file: r.file, sheet: p!.version.file })
    if (picks.length >= 2) break
  }
  if (!picks.length) return null
  const images: string[] = []
  const lines: string[] = []
  for (const p of picks) {
    images.push(await o.shrink(absPath(o.store.root, p.file)))
    images.push(await o.shrink(absPath(o.store.root, p.sheet)))
    lines.push(`- ${p.no}: generated image = image ${images.length - 1}, ${p.tag} character sheet = image ${images.length}`)
  }
  const r = await o.runAi<{ checks: Array<{ no: string; tag: string; ok: boolean; issueKo?: string; anchorFixEn?: string }> }>({
    prompt: [
      'Compare each generated film still with the character sheet: face structure, hairstyle and length, costume, body type.',
      'ok = true when the same person and costume are kept. When it drifts, issueKo = one short Korean sentence naming the exact difference, anchorFixEn = a sharper English appearance anchor that would prevent it.',
      '',
      ...lines,
    ].join('\n'),
    images,
    schema: DRIFT_SCHEMA as unknown as Record<string, unknown>,
  })
  const bad = r.data.checks.filter((c) => !c.ok)
  if (!bad.length) return `✅ 드리프트 확인 (기존 이미지 ${picks.length}장 대조, 생성 0장) — 이상 없음`
  return bad.map((c) => `⚠️ ${c.no} ${c.tag}: ${c.issueKo ?? '시트와 다릅니다'}${c.anchorFixEn ? ` → 앵커 제안: "${c.anchorFixEn}"` : ''}`).join('\n')
}
