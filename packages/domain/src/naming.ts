// 파일명 규칙 — 플랜 §8 윈도우 안전장치. 모든 파일명은 여기를 거친다.

const WIN_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g

/** 안전한 파일명 조각으로 만든다 (NFC, 금지 문자 제거, 끝 점/공백 제거, 예약어 회피). */
export function safeName(input: string, fallback = 'untitled'): string {
  let s = input.normalize('NFC').replace(ILLEGAL, '').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/g, '')
  if (!s) s = fallback
  if (WIN_RESERVED.test(s)) s = `_${s}`
  return s.slice(0, 120)
}

export interface ShotFileParts {
  seq: string
  shot: string
  key?: number // 키프레임 순번 (-1, -2 …)
  v: number
  ext: string
}

/** `{SEQ}_{SHOT}[-k]_v{N}.{ext}` */
export function shotFileName(p: ShotFileParts): string {
  const key = p.key != null ? `-${p.key}` : ''
  return `${p.seq}_${p.shot}${key}_v${p.v}.${p.ext}`
}

const SHOT_FILE = /^(S\d{2,})_(\d{4})(?:-(\d+))?_v(\d+)\.([A-Za-z0-9]+)$/

export function parseShotFileName(name: string): ShotFileParts | null {
  const m = SHOT_FILE.exec(name.normalize('NFC'))
  if (!m) return null
  return { seq: m[1], shot: m[2], key: m[3] ? Number(m[3]) : undefined, v: Number(m[4]), ext: m[5].toLowerCase() }
}

/** 에셋 파일명: `{이름}_{Character|Location|Prop}_{view}_v{N}.png` */
export function assetFileName(kind: 'char' | 'loc' | 'prop', name: string, view: string, v: number, ext = 'png'): string {
  const suffix = { char: 'Character', loc: 'Location', prop: 'Prop' }[kind]
  return `${safeName(name)}_${suffix}_${view}_v${v}.${ext}`
}

/** 프로젝트 상대 경로는 항상 POSIX 구분자. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

export const PROJECT_DIRS = {
  conti: (ep: string, seq: string) => `${ep}/Conti/${seq}`,
  image: (ep: string, seq: string) => `${ep}/Image/${seq}`,
  video: (ep: string, seq: string) => `${ep}/Video/${seq}`,
  character: (ep: string) => `${ep}/character`,
  assetSub: (ep: string, kind: 'char' | 'loc' | 'prop') => `${ep}/character/${kind}`,
  state: '.conti',
  sources: 'sources',
} as const
