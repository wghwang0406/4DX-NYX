---
name: conti-generate
description: |
  수락된 샷 분해에 콘티용 프롬프트 슬롯을 써 넣고(prompts_set, 무료) conti_generate로 생성을 요청한다(유료).
  파일럿 1장 → 승인 → 배치 순서. 수정 뒤에는 stale 샷만 재생성.
  Use when: "콘티 생성", "콘티 그려줘", "콘티 뽑아", "프롬프트 슬롯 채워", "파일럿", "conti-generate",
  "0030 다시 생성", "stale 재생성".
allowed-tools: mcp__conti__project_get, mcp__conti__sequence_get, mcp__conti__shots_list, mcp__conti__shots_update, mcp__conti__assets_list, mcp__conti__prompts_set, mcp__conti__conti_generate, mcp__conti__jobs_status, mcp__conti__jobs_wait, mcp__conti__spec_get, mcp__conti__image_view, mcp__conti__ui_focus
---

# conti-generate — 콘티 프롬프트 슬롯 + 생성 요청

생성 이미지는 **깨끗한 프레임**이다(샷 번호·화살표·대사는 레이아웃이 그린다). 프롬프트는 네가 슬롯을 채우고 **앱이 조립**한다. 스타일 문장은 `project.style`에서 온다 — 슬롯에 스타일을 쓰지 않는다.

## Step 0 — 전제 확인

```json
project_get {"fields":["style","defaults","episodeMap"]}
sequence_get {"seq":"S41","fields":["breakdown","locationMapEn","sceneStyleKo"]}
shots_list {"seq":"S41","fields":["no","sizeCode","angle","cameraMove","fovDeg","characters","location","props","actionKo","dialogue","tag","stages"]}
```

- `breakdown.status !== 'accepted'` → "샷 분해가 아직 수락되지 않았습니다" 하고 멈춘다(`conti-breakdown`으로).
- `project.style.contiSketchEn` / `contiCinematicEn`이 비어 있으면 **묻는다**. 네가 임의로 스타일을 박지 않는다. Pixar/Disney 등 브랜드명은 쓰지 않는다 — 묘사형(`clean 3D CG animated film look, soft subsurface skin, rounded forms`)으로 제안만.
- 증분 모드: 사용자가 "수정한 것만"·"stale만"이라고 했거나 이미 생성된 시퀀스라면 `stages.conti.status === 'stale' || 'none'`인 샷만 대상.

## Step 1 — 원문 규격 (필요한 구간만)

```json
spec_get {"spec":"lira","sections":["critical-anti-fail-rules-all-models","standing-rules"]}
spec_get {"spec":"acting","sections":["10-states-not-transitions"]}
```

구도 언어가 필요하면 `spec_get {"spec":"cinedance","sections":["camera-and-composition"]}`. 파일 전체 Read 금지.

## Step 2 — 샷별 슬롯 작성

슬롯은 전부 영문. 한 샷 80–150단어 안에서 끝낸다. 긍정문만(`monochrome` ○ / `no color` ✗).

| 슬롯 | 내용 | 예 |
|---|---|---|
| `shotSizeEn` | 사이즈 코드의 영문 풀이 | `medium close-up` |
| `angleEn` | 앵글 + 카메라 높이 | `eye level, camera at chest height` |
| `subjectsTags` | 프레임 안 에셋 태그 배열. **외형 프로즈 금지**(시트가 레퍼런스로 붙는다) | `["@해수","@prop_권총"]` |
| `actionStateEn` | **상태**(전환 아님). `mid-`, `already`, `holding` | `already turned toward the truck, pistol held low at the right thigh, weight on the back foot` |
| `expressionEn` | 근육의 일. 감정어 없음 | `jaw set, lips pressed flat, eyes narrowed with a slow blink, gaze fixed past the lens to screen left` |
| `compositionEn` | rule of thirds + 배치 + 전경/배경 | `rule of thirds, subject on the right third facing screen left, foggy road receding behind` |
| `countsEn` | 인원·소품 개수 못박기 | `exactly one person in frame, exactly one pistol` |
| `lightingEn` (선택) | 방향+폴오프, cinematic일 때만 | `cold dawn key from screen left, soft falloff` |

- 시선과 몸 방향은 따로 쓴다. `near/beside/around` 대신 측정 가능한 표현.
- 반응 샷(`tag:"반응"`)은 듣는 쪽의 `expressionEn`을 비운 채 두지 않는다.
- 대사 텍스트는 프롬프트에 넣지 않는다(레이아웃이 그린다). 입 모양이 중요하면 `mid-sentence, mouth slightly open`처럼 상태로.
- 인물이 없는 establishing은 `subjectsTags`에 장소 태그만, `countsEn`은 `empty deserted road, no people`가 아니라 `empty deserted road`.

```json
prompts_set {"target":{"seq":"S41","shotNo":"0030"},"stage":"conti","slots":{
  "shotSizeEn":"medium close-up",
  "angleEn":"eye level, camera at chest height",
  "subjectsTags":["@해수"],
  "actionStateEn":"already turned toward the truck, mouth mid-sentence, pistol held low at the right thigh",
  "expressionEn":"jaw set, lips pressed flat, eyes narrowed with a slow blink, gaze fixed past the lens to screen left",
  "compositionEn":"rule of thirds, subject on the right third facing screen left, foggy road receding behind",
  "countsEn":"exactly one person in frame, exactly one pistol"
}}
```

- 응답에 **린트 경고**가 오면(감정어, 브랜드, 전환 동사, 외형 프로즈, 파라미터 문구 등) 그 슬롯만 고쳐 다시 보낸다.
- **`prompts_set`이 도구 목록에 없으면** `shots_update {"seq":"S41","shotNo":"0030","patch":{"promptSlots":{…같은 슬롯…}}}`로 대체한다.

## Step 3 — 파일럿 1장 (유료, 확인 지점 ⑤)

```json
conti_generate {"seq":"S41","shots":["0010","0020","0030"],"style":"sketch","pilot":true}
```

- `style`은 `project.defaults.contiStyle`(사용자가 말하면 그 값): `sketch`=흑백 연필 선화 / `cinematic`=풀컬러 스틸. 모델은 앱이 `gpt_image_2_5`로 고정한다.
- 반환 `{requestId, count}` → **"파일럿 1장 승인 카드가 떴습니다. 승인하면 첫 컷을 먼저 확인합니다."** 크레딧 언급 없음. 사용자가 "전부 바로 생성"이라 하면 `pilot:false`로.
- 결과는 UI에 뜬다. `jobs_wait{requestId}`(≤50초 롱폴)는 승인이 나면 **작업이 끝날 때까지** 기다려 `jobs[{target, status, outFile}]`를 돌려준다. `timedOut:true`면 다시 부른다. 거절(`rejected`)이나 `error`(장수 상한·레퍼런스 없음)가 오면 이유를 전하고 멈춘다.
- 끝나면 `image_view{seq, shotNo}`로 본 뒤 **그림체·구도만** 짧게 평가한다. 실패한 작업(`status:"failed"`)은 자동 재시도하지 않고 `error`를 그대로 전한다 — 카드의 [다시] 버튼을 안내한다.

## Step 4 — 배치

파일럿을 사용자가 OK하면 나머지를 한 번에:

```json
conti_generate {"seq":"S41","shots":["0020","0030","0040","0050"],"style":"sketch","pilot":false}
```

→ 승인 카드 안내 → 끝. 실패한 샷은 자동 재시도하지 않고 알린다. 파일럿 뒤 나머지는 **앱이 후속 카드("추가 생성")를 자동으로 띄우므로** 네가 다시 `conti_generate`를 부를 필요가 없다 — 사용자가 "나머지도"라고 하면 카드 승인을 안내한다.

프롬프트는 앱이 조립한다: 스타일 문장(project.style) + 네 슬롯 + 인원수 + 레퍼런스 번호(에셋 시트가 있으면 `the character from reference image 1`). 슬롯이 비면 한국어 원문이 들어가 린트 경고가 붙으니 **모든 대상 샷의 슬롯을 먼저 채운다**.

## 증분 재생성

사용자가 샷을 고친 뒤("0030 로우앵글로", 샷 추가/삭제):
1. `shots_list {"seq":"S41","fields":["no","stages"]}` → `stages.conti.status === 'stale'`인 샷만 고른다.
2. 바뀐 슬롯만 `prompts_set`으로 갱신.
3. `conti_generate {"seq":"S41","shots":[…stale만…],"style":"sketch","pilot":false}`.
앞뒤 컷을 같이 돌릴지는 **UI 카드의 `[앞뒤 컷 포함]` 체크박스**가 정한다 — 네가 목록을 늘리지 않는다. 이전 이미지는 버전 기록에 남는다.
