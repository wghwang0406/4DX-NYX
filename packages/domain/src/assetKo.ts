// 에셋 프롬프트의 한·영 짝 — 사람은 한글을 읽고 고치고, 생성에는 영문이 쓰인다.
// koSync[영문필드] = 마지막으로 서로 맞춰진 때의 {en, ko}. 지금 값과 비교해 어느 쪽이 새것인지 정한다.
import type { Asset } from './schemas'

export type KoPairEn = 'anchorEn' | 'cameraAnchorEn' | 'masterProfileEn' | 'voiceEn'
export type KoPairKo = 'descriptionKo' | 'cameraAnchorKo' | 'masterProfileKo' | 'voiceKo'
export interface KoPair {
  en: KoPairEn
  ko: KoPairKo
  label: string
}

/** 카드에 보이는 순서 */
export const KO_PAIRS: readonly KoPair[] = [
  { en: 'anchorEn', ko: 'descriptionKo', label: '외형' },
  { en: 'cameraAnchorEn', ko: 'cameraAnchorKo', label: '카메라 앵커' },
  { en: 'masterProfileEn', ko: 'masterProfileKo', label: '연기 마스터 프로필' },
  { en: 'voiceEn', ko: 'voiceKo', label: 'Voice' },
] as const

/**
 * - synced: 맞춰진 그대로
 * - enNewer: 영문이 나중에 바뀌었거나 한글이 아직 없다 → 영문을 한글로 옮기면 된다 (자동)
 * - koNewer: 한글만 바뀌었다 → 한글대로 영문을 다시 써야 생성에 반영된다
 * - unknown: 둘 다 있는데 맞춰진 기록이 없다 (예전 에셋) → AI 가 자동으로 비교한다
 * - differs: 비교해 보니 내용이 다르다 (diffKo) → 사람이 어느 쪽 기준으로 맞출지 고른다
 * - empty: 영문이 비었다 (한글만 있거나 둘 다 없음)
 */
export type KoState = 'synced' | 'enNewer' | 'koNewer' | 'unknown' | 'differs' | 'empty'

const norm = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()

export function koState(a: Pick<Asset, KoPairEn | KoPairKo | 'koSync'>, pair: KoPair): KoState {
  const en = norm(a[pair.en])
  const ko = norm(a[pair.ko])
  if (!en) return 'empty'
  if (!ko) return 'enNewer'
  const s = a.koSync?.[pair.en]
  if (!s) return 'unknown'
  const enSame = norm(s.en) === en
  const koSame = norm(s.ko) === ko
  if (enSame && koSame) return s.diffKo?.length ? 'differs' : 'synced'
  if (!enSame) return 'enNewer' // 영문이 바뀌었으면 영문이 새것 (생성에 실제로 쓰이는 쪽)
  return 'koNewer'
}

/** 두 값을 맞춰진 것으로 기록한 koSync */
export function withKoSync(a: Pick<Asset, 'koSync'>, en: KoPairEn, values: { en: string; ko: string; diffKo?: string[] }): NonNullable<Asset['koSync']> {
  return { ...(a.koSync ?? {}), [en]: { en: values.en.trim(), ko: values.ko.trim(), ...(values.diffKo?.length ? { diffKo: values.diffKo } : {}) } }
}
