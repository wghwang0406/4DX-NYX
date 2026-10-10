import { describe, expect, it } from 'vitest'
import { EpisodeAssets } from '@conti/domain'
import { renderCharacterMd } from './character'

describe('Character.md', () => {
  it('renders the three sections in GenSetup §4-A format', () => {
    const ea = EpisodeAssets.parse({
      ep: 'EP01',
      assets: [
        {
          id: 'a',
          tag: '@해수',
          kind: 'char',
          subkind: 'human',
          nameKo: '해수',
          descriptionKo: '검은 단발, 낡은 네이비 야상',
          anchorEn: '28yo lean female detective. 100% matches the reference.',
          masterProfileEn: 'Character acting as 해수. She leads with stillness.',
          voiceEn: '"A 28-year-old woman, low and even."',
          views: {
            sheet: [{ id: 'v1', n: 1, stage: 'image', file: 'EP01/character/char/해수_Character_sheet_v1.png', source: 'generated', createdAt: 1 }],
          },
        },
        { id: 'b', tag: '@loc_카페', kind: 'loc', state: 'day', nameKo: '카페', descriptionKo: '좁은 골목 카페', cameraAnchorEn: 'high angle three-quarter wide shot' },
        { id: 'c', tag: '@prop_권총', kind: 'prop', nameKo: '권총', descriptionKo: '구형 리볼버' },
      ],
    })
    const md = renderCharacterMd(ea)
    expect(md).toContain('# 에셋 사전 — EP01')
    expect(md).toContain('## 등장체\n\n### @해수\n- kind: human / state: base\n- 설명: 검은 단발, 낡은 네이비 야상\n- 앵커: 28yo lean')
    expect(md).toContain('- 시트: char/해수_Character_sheet_v1.png')
    expect(md).toContain('- 마스터 프로필: Character acting as 해수.')
    expect(md).toContain('- Voice: "A 28-year-old woman, low and even."')
    expect(md).toContain('## 배경\n\n### @loc_카페\n- state: day\n- 설명: 좁은 골목 카페\n- 카메라 앵커: high angle')
    expect(md).toContain('## 소품\n\n### @prop_권총\n- state: base\n- 설명: 구형 리볼버')
    // 등장체가 아닌 항목엔 프로필/Voice 줄이 없다
    expect(md.split('## 배경')[1]).not.toContain('마스터 프로필')
  })

  it('marks empty sections', () => {
    const md = renderCharacterMd(EpisodeAssets.parse({ ep: 'EP02' }))
    expect(md).toContain('## 등장체\n\n(없음)')
    expect(md).toContain('## 소품\n\n(없음)')
  })
})
