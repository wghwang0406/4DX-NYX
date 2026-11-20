// 에셋이 어느 씬(시퀀스)에 나오는지 — 에셋 화면의 씬별 탭이 쓴다.
// 나온다 = 추출 때 기록한 usedIn 에 있거나, 그 씬의 샷이 태그를 인물·장소·소품으로 참조한다.
import type { Asset, Sequence } from './schemas'

type SeqLike = Pick<Sequence, 'seq' | 'ep'> & { shots: Array<Pick<Sequence['shots'][number], 'characters' | 'location' | 'props'>> }

/** 에셋이 나오는 씬 id (sequences 순서) */
export function assetSeqs(asset: Pick<Asset, 'tag' | 'usedIn'>, sequences: SeqLike[]): string[] {
  const used = new Set(asset.usedIn ?? [])
  return sequences
    .filter((s) => used.has(s.seq) || s.shots.some((sh) => sh.characters.includes(asset.tag) || sh.location === asset.tag || sh.props.includes(asset.tag)))
    .map((s) => s.seq)
}
