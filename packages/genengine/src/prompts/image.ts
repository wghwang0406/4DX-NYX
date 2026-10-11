// 이미지 단계 프롬프트 — 확정된 콘티 프레임을 구도 가이드로, 에셋 시트를 정체성 레퍼런스로 최종 스틸을 만든다 (GenConti2Img 대응).
// 콘티 프롬프트 조립을 그대로 쓰고 (1) 스타일 = 프로젝트 최종 룩 (2) 레퍼런스 1 = 콘티 프레임 (3) 에셋 번호는 2부터.
import type { Asset, Project, Sequence, Shot } from '@conti/domain'
import { buildContiPrompt, DEFAULT_CINEMATIC_STYLE, type BuiltPrompt, type ContiRef } from './conti'

export const STORYBOARD_GUIDE =
  'Reference image 1 is the approved storyboard frame: match its composition, framing, camera angle, blocking and every subject position, and render it as a finished cinematic film still'

/** 최종 이미지 룩 — project.style.anchorEn(한 곳에서 관리). 없으면 시네마틱 콘티 문구 → 기본값. */
export function finalStyleLine(project: Project): string {
  const c = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()
  return c(project.style.anchorEn) || c(project.style.contiCinematicEn) || DEFAULT_CINEMATIC_STYLE
}

export function buildShotImagePrompt(i: { project: Project; sequence: Sequence; shot: Shot; assets: Asset[]; refs: ContiRef[] }): BuiltPrompt {
  return buildContiPrompt({ ...i, style: 'cinematic', refOffset: 1, styleLine: finalStyleLine(i.project), leadLine: STORYBOARD_GUIDE })
}
