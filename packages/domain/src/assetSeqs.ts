// 에셋이 어느 씬(시퀀스)에 나오는지 — 에셋 화면의 씬별 탭이 쓴다.
// 나온다 = 추출 때 기록한 usedIn 에 있거나, 그 씬의 샷이 태그를 인물·장소·소품으로 참조한다.
import type { Asset, Sequence } from './schemas'

type SeqLike = Pick<Sequence, 'seq' | 'ep'> & { shots: Array<Pick<Sequence['shots'][number], 'characters' | 'location' | 'props' | 'deleted'>> }

/** 이 샷이 태그를 인물·장소·소품으로 쓰나 (지운 샷은 빼고) */
export const shotUsesTag = (sh: SeqLike['shots'][number], tag: string) => !sh.deleted && (sh.characters.includes(tag) || sh.location === tag || sh.props.includes(tag))

/** 에셋이 나오는 씬 id (sequences 순서) */
export function assetSeqs(asset: Pick<Asset, 'tag' | 'usedIn'>, sequences: SeqLike[]): string[] {
  const used = new Set(asset.usedIn ?? [])
  return sequences
    .filter((s) => used.has(s.seq) || s.shots.some((sh) => shotUsesTag(sh, asset.tag)))
    .map((s) => s.seq)
}

/**
 * 복제해서 변형할 때 기본 태그·이름 — @prop_경찰차 → @prop_경찰차_B "경찰차 B", 이미 있으면 C, D…
 * 이미 변형(_B)이면 그 뒤 글자부터 찾는다.
 */
export function nextVariant(tag: string, nameKo: string, taken: Iterable<string>): { tag: string; nameKo: string } {
  const used = new Set(taken)
  const base = tag.replace(/_[A-Z]$/, '')
  const name = nameKo.replace(/ [A-Z]$/, '')
  for (let c = 66; c <= 90; c++) {
    const L = String.fromCharCode(c)
    if (!used.has(`${base}_${L}`)) return { tag: `${base}_${L}`, nameKo: `${name} ${L}` }
  }
  return { tag: `${base}_${Date.now().toString(36)}`, nameKo: name }
}
