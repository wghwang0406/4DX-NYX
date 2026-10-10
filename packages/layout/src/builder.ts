// LayoutDataBuilder — 시퀀스 → 템플릿 데이터. 템플릿은 이 모양만 안다 (sample.json 이 같은 모양의 예시).
import { annotationsSvg, estimateShotDuration, type Asset, type Panel, type Project, type Sequence, type Shot, type Version } from '@conti/domain'
import type { TemplateMeta } from './template'

export interface LayoutPanel {
  key: string // "0030" 또는 하위 패널 "0030-2"
  shotNo: string
  panelIndex: number
  panelLabel: string // 하위 패널이 있으면 "0030-2", 아니면 "0030"
  image: string | null // 템플릿에 그대로 넣을 URL
  imageSource: string // 생성 / 원본 프레임 / 다시 그리기 / 수정 / 업로드
  version: string // "v2"
  size: string
  angle: string
  cameraMove: string
  fov: string // "47°"
  duration: string // "2.5s"
  durationSec: number
  tc: string // "00:12.4 – 00:15.0"
  chips: string[] // 사이즈·앵글·카메라·화각·길이 — 템플릿이 그냥 나열하면 된다
  characters: string
  location: string
  props: string
  action: string
  dialogue: Array<{ speaker: string; text: string; paren: string }>
  hasDialogue: boolean
  tag: string // 대사 / 반응
  caption: string
  annotationsSvg: string // 이미지 위에 겹칠 <svg> (triple-stash {{{ }}} 로)
  stale: boolean
  empty: false
}

export interface LayoutPage {
  n: number
  total: number
  panels: Array<LayoutPanel | { empty: true; key: string }>
  first: boolean
  last: boolean
}

export interface LayoutData {
  project: { title: string; code: string; eraKo: string }
  sequence: { seq: string; ep: string; heading: string; place: string; time: string; shotCount: number; durationSec: number; duration: string }
  template: { id: string; name: string; version: string; panelsPerPage: number; panelAspect: string; pageWidthMm: number; pageHeightMm: number }
  meta: { date: string; versionLabel: string; status: string; generatedAt: string }
  pages: LayoutPage[]
  panels: LayoutPanel[]
}

export interface BuildOptions {
  meta: TemplateMeta
  pageMm: [number, number]
  /** 프로젝트 상대경로 → 이미지 URL (앱 미리보기: conti-file://, PDF: 같은 것). 파일이 없으면 null → "콘티 없음" 칸 */
  imageUrl: (rel: string) => string | null
  versionLabel?: string // "v3"
  status?: string // "컨펌용" / "작업 중"
  date?: Date
  templateId: string
  templateName: string
  templateVersion: string
}

const SOURCE: Record<string, string> = { generated: '생성', video_frame: '원본 프레임', restyle: '다시 그리기', edit: '수정', upload: '업로드' }

const fmtSec = (s: number) => `${Math.round(s * 10) / 10}s`
function fmtTc(ms: number): string {
  const t = ms / 1000
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}
const tagName = (t: string) => t.replace(/^@(loc_|prop_)?/, '').replace(/_/g, ' ')

function splitHeading(h: string): { place: string; time: string } {
  const m = /^(.*?)\s*-\s*([^-]+)$/.exec(h)
  return m ? { place: m[1].trim(), time: m[2].trim() } : { place: h.trim(), time: '' }
}

function currentVersion(shot: Shot, panel: Panel | undefined, index: number): Version | undefined {
  const list = panel?.versions.conti ?? []
  if (index === 0 && shot.stages.conti.currentVersionId) {
    const v = shot.panels.flatMap((p) => p.versions.conti).find((x) => x.id === shot.stages.conti.currentVersionId)
    if (v) return v
  }
  return [...list].sort((a, b) => b.n - a.n)[0]
}

export function shotDuration(shot: Shot): number {
  if (shot.tc) return Math.max(0.1, (shot.tc.outMs - shot.tc.inMs) / 1000)
  return shot.durationSec ?? estimateShotDuration(shot.actionKo, shot.dialogue.map((d) => d.text))
}

export function buildLayoutData(project: Project, seq: Sequence, assets: Asset[], o: BuildOptions): LayoutData {
  const byTag = new Map(assets.map((a) => [a.tag, a]))
  const name = (t: string) => byTag.get(t)?.nameKo || tagName(t)
  const panels: LayoutPanel[] = []
  let total = 0
  for (const shot of seq.shots.filter((s) => !s.deleted)) {
    const dur = shotDuration(shot)
    total += dur
    const subPanels: Array<Panel | undefined> = shot.panels.length ? shot.panels : [undefined]
    subPanels.forEach((panel, i) => {
      const v = currentVersion(shot, panel, i)
      const url = v ? o.imageUrl(v.file) : null
      const multi = subPanels.length > 1
      const chips = [shot.sizeCode, shot.angle, shot.cameraMove && !/^static$/i.test(shot.cameraMove) ? shot.cameraMove : '', shot.fovDeg ? `${shot.fovDeg}°` : '', i === 0 ? fmtSec(dur) : ''].filter(Boolean) as string[]
      panels.push({
        key: multi ? `${shot.no}-${i + 1}` : shot.no,
        shotNo: shot.no,
        panelIndex: i,
        panelLabel: multi ? `${shot.no}-${i + 1}` : shot.no,
        image: url,
        imageSource: v && url ? (SOURCE[v.source] ?? v.source) : '',
        version: v && url ? `v${v.n}` : v ? `v${v.n} 파일 없음` : '',
        size: shot.sizeCode ?? '',
        angle: shot.angle ?? '',
        cameraMove: shot.cameraMove ?? '',
        fov: shot.fovDeg ? `${shot.fovDeg}°` : '',
        duration: fmtSec(dur),
        durationSec: dur,
        tc: shot.tc ? `${fmtTc(shot.tc.inMs)} – ${fmtTc(shot.tc.outMs)}` : '',
        chips,
        characters: shot.characters.map(name).join(', '),
        location: shot.location ? name(shot.location) : '',
        props: shot.props.map(name).join(', '),
        action: i === 0 || !panel?.captionKo ? shot.actionKo : panel.captionKo,
        dialogue: i === 0 ? shot.dialogue.map((d) => ({ speaker: d.speaker ?? '', text: d.text, paren: d.paren ?? '' })) : [],
        hasDialogue: i === 0 && shot.dialogue.length > 0,
        tag: shot.tag ?? '',
        caption: panel?.captionKo ?? '',
        annotationsSvg: annotationsSvg(panel?.annotations),
        stale: shot.stages.conti.status === 'stale',
        empty: false,
      })
    })
  }
  const per = o.meta.panelsPerPage
  const pageCount = Math.max(1, Math.ceil(panels.length / per))
  const pages: LayoutPage[] = Array.from({ length: pageCount }, (_, p) => {
    const slice: LayoutPage['panels'] = panels.slice(p * per, p * per + per)
    while (slice.length < per) slice.push({ empty: true, key: `empty-${p}-${slice.length}` })
    return { n: p + 1, total: pageCount, panels: slice, first: p === 0, last: p === pageCount - 1 }
  })
  const { place, time } = splitHeading(seq.headingKo || seq.seq)
  const d = o.date ?? new Date()
  return {
    project: { title: project.title, code: project.code, eraKo: project.world.eraKo },
    sequence: { seq: seq.seq, ep: seq.ep, heading: seq.headingKo || seq.seq, place, time, shotCount: seq.shots.filter((s) => !s.deleted).length, durationSec: total, duration: fmtTc(total * 1000) },
    template: { id: o.templateId, name: o.templateName, version: o.templateVersion, panelsPerPage: per, panelAspect: o.meta.panelAspect, pageWidthMm: o.pageMm[0], pageHeightMm: o.pageMm[1] },
    meta: {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      versionLabel: o.versionLabel ?? '',
      status: o.status ?? '작업 중',
      generatedAt: d.toISOString(),
    },
    pages,
    panels,
  }
}

/** 데이터 해시 — 날짜·생성 시각은 빼고 (같은 내용이면 같은 해시 → 다시 렌더하지 않는다) */
export function layoutDataKey(data: LayoutData): string {
  const { meta, ...rest } = data
  return JSON.stringify({ ...rest, meta: { versionLabel: meta.versionLabel, status: meta.status } })
}
