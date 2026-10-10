---
name: conti-setup
description: |
  시나리오에서 세계관(시대·배경·톤)과 에셋(등장체 char / 배경 loc / 소품 prop)을 추출해
  project_update·assets_upsert로 등록하고, 표를 보여준 뒤 사용자 확인에서 멈춘다.
  승인되면 assets_generate로 시트 생성을 요청한다(유료 → 승인 카드).
  Use when: "에셋 추출", "세계관 분석", "등장인물 뽑아줘", "소스 분석", "셋업", "conti-setup",
  "캐릭터 시트 만들어", "에셋 생성".
allowed-tools: mcp__conti__project_get, mcp__conti__project_update, mcp__conti__sequence_list, mcp__conti__scene_get, mcp__conti__assets_list, mcp__conti__assets_upsert, mcp__conti__assets_generate, mcp__conti__soulid_create, mcp__conti__spec_toc, mcp__conti__spec_get, mcp__conti__ui_focus
---

# conti-setup — 세계관·에셋 추출

시나리오 텍스트 → 세계관 3항목 + 에셋 레지스트리. **이미지 생성은 별도 단계**이며 사용자 승인 뒤에만 요청한다.
모든 상태 변경은 `conti` 도구로 한다. 파일을 쓰지 않는다.

## Step 1 — 범위 확인

```json
project_get {}
sequence_list {}
```

- 사용자가 시퀀스를 지정했으면(`S41`, `S41-S45`, `EP01 전부`) 그 범위만. 없으면 전체.
- 이미 등록된 에셋이 있으면 `assets_list{ep:"EP01"}`로 읽어 **중복 등록을 피한다**(같은 tag·state면 upsert로 보강만).

## Step 2 — 원문 규격 읽기 (필요한 구간만)

```json
spec_get {"spec":"cinedance","sections":["character-description-rule"]}
spec_get {"spec":"acting","sections":["6-the-character-acting-master-profile","7-eye-life-mandatory-in-every-profile-and-every-scene","9-voice-fixed-identity-never-adapted"]}
```

배경 카메라 앵커를 쓸 때만 추가: `spec_get {"spec":"lira","sections":["location-environment-soul-cinema"]}`.
파일 전체를 Read하지 않는다.

## Step 3 — 씬 읽기 → 세계관

시퀀스마다 `scene_get {"seq":"S41"}` (줄 단위 action/dialogue/paren). 큰 프로젝트면 대표 시퀀스 5~8개로 시대·배경·톤을 잡고, 나머지는 등장체·장소 이름만 훑는다.

```json
project_update {"world":{"eraKo":"2020년대 현재","settingKo":"군산 외곽 항구도시, 겨울","toneKo":"건조한 범죄 드라마, 차가운 청회색"}}
```

`project.style`이 비어 있으면 **묻는다** — 스타일 앵커는 프로젝트 상수라 임의로 채우지 않는다. 브랜드명(Pixar/Disney)은 쓰지 않고 묘사형 문장으로 제안한다.

## Step 4 — 에셋 추출 규칙

| 종류 | kind | 포함 | state |
|---|---|---|---|
| 등장체 | `char` (subkind `human`/`animal`/`creature`) | 인물·동물·크리처 전부 | `base`, 젖음·손상·환복은 **별개 에셋** |
| 배경 | `loc` | 씬 헤딩의 장소 | `day`/`night`/`rain` — 시나리오에 실제로 나오는 상태만 |
| 소품 | `prop` | 손에 닿거나 플롯에 걸리는 물건 | `base`, 깨끗/손상/피묻음은 별개 |

- 태그: 등장체 `@해수`, 상태 변형 `@해수_wet`, 배경 `@loc_카페_night`, 소품 `@prop_권총`.
- 로봇·차량·말하는 물건처럼 등장체/소품이 애매하면 표에 `← 소품 아닌가요?`로 표시하고 사용자에게 맡긴다.
- 실존 인물 이름·IP·브랜드 금지. **나이는 쓴다**(앵커 공식 요구).
- 엑스트라(행인 다수)는 에셋으로 만들지 않고 샷의 `countsEn`에서 처리한다.

### 등장체 필드

- `descriptionKo`: 한국어 외형·의상 2~4문장.
- `anchorEn`: CINEDANCE 공식 한 문장 — `age + role/body type + current state + 시각 앵커 + 행동에 필요한 소품/신체 상태. 100% matches the reference.`
  예: `28yo lean female detective, shoulder-length black hair tied back in a low ponytail, worn navy field jacket, right hand bandaged. 100% matches the reference.`
- `masterProfileEn`: Acting §6 규격. **150–220단어 영문 한 문단**, 블록 순서 고정(`Character acting as NAME.` → 체형·자세 → 심리 엔진 → Vocal profile → 틱+트리거 → Walking style → `However, when X, …` 크랙 절 필수 → 선택적 softening target). eye life 포함. **의상·카메라·색은 넣지 않는다.**
- `voiceEn`: 1–2문장 따옴표. `"A 28-year-old Korean woman from a port city. Low dry alto; clipped, even pace; flattens further under pressure."` 씬마다 바꾸지 않는다.
- 동물·크리처도 마스터 프로필을 쓰되 종 특성으로 치환한다(Voice는 대사가 있을 때만).

### 배경 필드

- `descriptionKo`: 공간·재질·랜드마크·광원 방향.
- `anchorEn`: 장소 정체성 + 주요 요소 + 광원/색온도 한 문장.
- `cameraAnchorEn`: Lira 장소 템플릿의 카메라 앵커 — 단순한 표현으로(`high angle three-quarter wide shot, camera high above the room looking diagonally down at 45 degrees`). CCTV·fisheye 같은 용어 ✗. 인물 없음, 옵틱/DOF 언어 없음.

### 소품 필드

- `descriptionKo` + `anchorEn`(형태·스케일·재질·마모·손 접촉 방식). 로고가 없어야 하면 긍정문(`plain unbranded matte surface`). 무기류는 중립적 재질·기능 서술.

## Step 5 — 등록

에셋마다 한 번씩:

```json
assets_upsert {"ep":"EP01","asset":{"tag":"@해수","kind":"char","subkind":"human","state":"base","nameKo":"해수","descriptionKo":"…","anchorEn":"28yo lean female detective, … 100% matches the reference.","masterProfileEn":"Character acting as 해수. …","voiceEn":"\"A 28-year-old …\"","usedIn":["S41","S42"]}}
assets_upsert {"ep":"EP01","asset":{"tag":"@loc_카페_night","kind":"loc","state":"night","nameKo":"카페","descriptionKo":"…","anchorEn":"…","cameraAnchorEn":"…","usedIn":["S41"]}}
assets_upsert {"ep":"EP01","asset":{"tag":"@prop_권총","kind":"prop","state":"base","nameKo":"권총","descriptionKo":"…","anchorEn":"…","usedIn":["S41"]}}
```

검증 오류가 돌아오면 그 항목만 고쳐 다시 보낸다(최대 3회).

## Step 6 — 표를 보여주고 멈춘다 (확인 지점 ②)

```
📋 에셋 목록 — EP01 (등장체 3 · 배경 2 · 소품 1)

| 종류 | 태그 | kind/state | 나오는 씬 | 비고 |
|---|---|---|---|---|
| char | @해수 | human/base | S41,S42 | |
| char | @로봇K9 | creature/base | S43 | ← 소품 아닌가요? |
| loc | @loc_카페_night | night | S41 | |
| prop | @prop_권총 | base | S41 | |

분류·목록을 고치거나 추가·삭제할 게 있으면 말씀하세요. 확정되면 "에셋 생성"으로 시트를 요청합니다.
```

여기서 **반드시 멈춘다.** 유료 도구를 호출하지 않는다.

## Step 7 — 승인 후: 시트 생성 요청 (유료)

사용자가 생성을 요청하면 종류별 뷰를 안내하고 호출한다. 프롬프트는 앱이 에셋 필드 + Lira 템플릿으로 조립한다.

| 종류 | 생성물 | 모델 |
|---|---|---|
| char | Lira 3패널 시트 1장(정면 전신/후면 전신/클로즈업 초상) + 파생 `front/back/face` | soul → nano |
| loc | `wide` 정본 + `34`/`top`/`detail` 뷰 변경 (`top`은 LOCATION MAP 근거용) | soulcine → gpt |
| prop | `top`/`34`/`detail` | nano |

```json
assets_generate {"ep":"EP01","tags":["@해수","@loc_카페_night","@prop_권총"]}
```

→ `{requestId, count}`가 돌아오면: **"승인 카드가 떴습니다. 카드에서 [승인] / [1장만 먼저] / [거절]을 선택하세요."** 라고 말하고 기다린다. 크레딧 이야기는 하지 않는다.
일부만 원하면 `tags`를 줄인다. Soul ID는 사용자가 명시적으로 원할 때만 `soulid_create{ep, tag}`(유료, 승인 카드).

시트가 생기면 확인 지점 ③(에셋 시트 확정)이다 — 사용자가 얼굴·장소를 확정한 뒤에 콘티로 간다. 불일치가 있으면 모델이 아니라 **앵커 문장을 고친다**(`assets_upsert`로 해당 줄만 수정).
