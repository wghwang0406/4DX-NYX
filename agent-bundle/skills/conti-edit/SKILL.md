---
name: conti-edit
description: |
  대화형 수정. "0030 로우앵글로"·"0020 뒤에 손 인서트"·"0040 빼" 같은 요청을
  shots_update / shots_insert / shots_delete + prompts_set으로 반영하고, 이미지가 바뀌어야 하면
  image_edit(NBP 우선) 또는 panel_restyle을 요청한다(유료 → 승인 카드).
  Use when: "로우앵글로", "사이즈 바꿔", "컷 추가", "컷 빼", "이 컷 고쳐", "배경만 바꿔", "다시 그려",
  "conti-edit", 샷 번호 + 수정 지시.
allowed-tools: mcp__conti__sequence_get, mcp__conti__shots_list, mcp__conti__shots_update, mcp__conti__shots_insert, mcp__conti__shots_delete, mcp__conti__panels_update, mcp__conti__panels_annotate, mcp__conti__assets_list, mcp__conti__prompts_set, mcp__conti__image_edit, mcp__conti__panel_restyle, mcp__conti__conti_generate, mcp__conti__image_view, mcp__conti__spec_get, mcp__conti__ui_focus
---

# conti-edit — 대화형 수정

요청 한 건 = 도구 호출 최소 단위. 호출 전에 "무엇을 바꿀지" 한 줄, 호출 후에 "무엇이 바뀌었고 유료면 승인 카드가 떴다"를 말한다. 샷 번호는 밀지 않는다.

## 요청 → 도구 매핑

| 요청 예 | 도구 | 이미지 영향 |
|---|---|---|
| "0030 로우앵글로" / "CU로" / "핸드헬드로" | `shots_update` (angle / sizeCode / cameraMove / fovDeg) | 코드가 `stale`로 표시 → 재생성은 사용자가 요청할 때 |
| "0030 묘사 고쳐: …" / 인물·소품 교체 | `shots_update` (actionKo / characters / props / location) | 동일 |
| "0020 뒤에 손잡이 클로즈업 넣어줘" | `shots_insert` + `prompts_set` | 신규 샷 → 생성 필요 |
| "0040 빼" | `shots_delete` | 없음(버전은 남음) |
| "0030 배경만 어둡게" / "모자 없애" (프레임 유지, 국소) | `image_edit` model `nano` | 유료 |
| "0030 선 더 깔끔하게" / 그림체 변환 | `panel_restyle` | 유료 |
| "0030 구도 자체를 다시" | `prompts_set` → `conti_generate{shots:["0030"]}` | 유료 — 편집이 아니라 재생성 |

사용자가 포커스한 컷(`ui_focus` 컨텍스트)이 있으면 번호를 생략해도 그 컷으로 본다. 애매하면 묻는다.

## 1. 메타 수정 (무료)

```json
shots_update {"seq":"S41","shotNo":"0030","patch":{"angle":"low angle, camera at knee height looking up","fovDeg":84}}
shots_update {"seq":"S41","shotNo":"0030","patch":{"sizeCode":"CU"}}
```

- 사이즈·앵글·카메라가 바뀌면 프롬프트 슬롯도 맞춘다: `prompts_set {"target":{"seq":"S41","shotNo":"0030"},"stage":"conti","slots":{"angleEn":"low angle, camera at knee height looking up","shotSizeEn":"close-up"}}` (없으면 `shots_update`의 `promptSlots`로).
- 응답 후: "0030 앵글을 로우앵글로 바꿨습니다. 타임라인에 재생성 필요 표시가 붙습니다. 다시 그릴까요?" — 묻고 멈춘다.

## 2. 삽입 / 삭제 (무료)

```json
shots_insert {"seq":"S41","after":"0020","shot":{"sizeCode":"INSERT","angle":"high angle","cameraMove":"static","fovDeg":47,"durationSec":1.5,"characters":["@해수"],"location":"@loc_카페_night","props":["@prop_손잡이"],"actionKo":"해수의 손이 문손잡이를 쥔 상태.","dialogue":[],"sourceLines":[12]}}
```

- 번호는 앱이 중간값(0025)으로 정한다. 자리가 없어 거절되면 사용자에게 재번호를 제안한다.
- 삽입 직후 `prompts_set`으로 슬롯을 채운다(`conti-generate` Step 2 규격). 생성은 사용자가 요청할 때 `conti_generate{shots:["0025"],pilot:false}`.
- 삭제: `shots_delete {"seq":"S41","shotNos":["0040"]}` — 대사가 있는 샷이면 "대사 줄 N이 빠집니다" 경고하고 확인받는다.

## 3. 이미지 편집 (유료)

먼저 필요할 때만 `spec_get {"spec":"lira","sections":["surgical-edit-template-nbp-first-the-whole-edit-lane-uses-it"]}`.

순서는 고정: **NBP(`nano`) → 텍스처만 `seed` → 최후 국소 `gpt` → 마스킹만 `gpt2`**. 프레임을 다시 짜야 하면 편집이 아니라 재생성.

```json
image_edit {"seq":"S41","shotNo":"0030","model":"nano","instructionEn":"Edit the image. CHANGE: darken the background wall to a deep charcoal, keep its texture. PRESERVE EXACTLY: the character's face, pose, hands, the pistol, the framing, the line weight and monochrome pencil grade. ONLY CHANGE the background tone. 100% identical otherwise."}
```

- `instructionEn`은 최소 CHANGE + 빠짐없는 PRESERVE EXACTLY. 한 번에 한 가지. 제거는 채울 것과 함께(`remove the hat; continuous hair and forehead behind`).
- `model:"gpt"`는 NBP가 못 잡은 미세 국소 편집에만. `"seed"`는 질감 복원에만.
- 그림체 변환: `panel_restyle {"seq":"S41","shotNos":["0030"]}` (그림체는 project.defaults.contiStyle).
- 반환 `{requestId}` → "승인 카드가 떴습니다." 결과는 새 버전으로 쌓이고 이전 버전은 남는다.

## 4. 주석 (무료)

카메라 화살표·프레임 표시 요청("0030에 패닝 화살표"):

```json
panels_annotate {"seq":"S41","shotNo":"0030","annotations":[{"type":"pan","points":[[0.2,0.5],[0.8,0.5]],"label":"pan right"}]}
```

## 마무리 문장

항상: 바뀐 샷 번호 + 바뀐 필드 + (유료면) "승인 카드에서 승인해 주세요" + (무료 수정이면) "재생성이 필요하면 말씀하세요". 사용자가 "앞뒤 컷도"라고 하면 UI 카드의 `[앞뒤 컷 포함]` 체크를 안내한다 — 네가 목록을 늘리지 않는다.
