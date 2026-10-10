---
name: conti-breakdown
description: |
  시퀀스 텍스트를 샷으로 분해해 shots_propose_breakdown으로 초안을 제출한다(무료).
  대사 한 줄 = 독립 샷(예외 없음), [대사]/[반응] 태그, 액션 비트, wide→medium→close 드릴다운,
  첫 프레임 점유. 코드 검증 오류는 고쳐 재제출(최대 3회), 표를 보여주고 수락 대기.
  Use when: "샷 분해", "샷 나눠줘", "브레이크다운", "컷 리스트 만들어", "conti-breakdown", "S41 분해".
allowed-tools: mcp__conti__project_get, mcp__conti__sequence_get, mcp__conti__scene_get, mcp__conti__assets_list, mcp__conti__shots_list, mcp__conti__shots_propose_breakdown, mcp__conti__spec_get, mcp__conti__ui_focus
---

# conti-breakdown — 샷 분해

시퀀스 하나를 샷 리스트 초안으로. **유료 도구를 절대 부르지 않는다.** 결과는 `shots_propose_breakdown` 한 번으로 제출하고, UI에서 사용자가 수락한다(확인 지점 ④).

## Step 1 — 입력 읽기

```json
sequence_get {"seq":"S41"}
scene_get {"seq":"S41"}
assets_list {"ep":"EP01","fields":["tag","kind","state","nameKo"]}
```

- `scene_get`은 줄 단위 `{lineN, kind: action|dialogue|paren|transition|caption, speaker?, text, paren?}`와 `sourceTextHash`를 준다. **`sourceTextHash`는 그대로 제출에 넣는다**(텍스트가 바뀌면 코드가 거부한다).
- `breakdown.status`가 `accepted`면 "이미 수락된 분해가 있습니다 — 다시 분해하면 초안으로 덮습니다" 하고 사용자 확인을 받는다.
- 에셋 태그가 없으면 인물은 이름 그대로 `@이름`으로 쓰고, 비고에 "에셋 미등록"을 적는다.

선택: `spec_get {"spec":"cinedance","sections":["first-frame-occupancy-lock"]}` — 첫 프레임 규칙이 헷갈릴 때만.

## Step 2 — 분해 규칙 (GenConti 규칙 그대로)

1. **대사 한 줄 = 독립 샷. 예외 없음.** 뭉뚱그리거나 지문에 합치지 않는다. 대사가 N줄이면 N샷.
   - 발화 샷: 화자의 MCU/CU. `tag:"대사"`, `dialogue[]`에 그 줄 **하나만**(`speaker`, `text`, `paren`, `lineN`).
   - 상대 반응이 암시되면 바로 다음에 `tag:"반응"` 샷(대사 없음, `actionKo`에 듣는 인물의 근육 일).
   - 괄호 지문 `(잠시)` `(끄덕)` `(쓴웃음)`도 독립 샷(반응 샷으로).
2. **액션 비트**: 주요 행동이 바뀌는 지점마다 새 샷. 지문 한 문장 = 최소 1샷. `(고속)` `(슬로우)`·시선·반응 명시는 별도 샷.
3. **드릴다운**: 시작은 WS/EWS로 장소 설정 → 인물로 좁힘(MWS/MS) → 감정 피크는 CU/ECU.
4. **감정 곡선**: 긴장이 오르면 샷이 좁아지고 짧아진다(`durationSec` 추정: 기본 2.5초, 대사는 글자 수/5초 + 0.8).
5. **첫 프레임 점유**: 인물이 필요한 샷은 첫 프레임부터 인물이 있다. 빈 화면으로 열고 뒤늦게 등장시키지 않는다. 순수 establishing(인물 없음)은 허용.
6. **샷 번호**: `0010, 0020, 0030…` 4자리 10단위.
7. **장소·소품을 채운다** — 생성 단계가 이걸로 레퍼런스 뷰를 고른다. `characters`는 `@태그` 배열, `location`은 `@loc_…` 태그 하나, `props`는 `@prop_…` 배열.
8. **사이즈 코드**: `EWS WS MWS MS MCU CU ECU POV INSERT OTS`만. 용도: EWS 압도적 장소 / WS 공간 맥락 / MWS 그룹·환경 관계 / MS 1~2인 대화 / MCU 표정·발화 / CU 얼굴·반응 / ECU 눈·손·오브젝트 / POV 시점 / INSERT 소품 / OTS 어깨 너머.
9. `sourceLines`: 그 샷이 근거한 시나리오 줄 번호 배열. **모든 dialogue 줄은 정확히 한 샷의 `sourceLines`와 `dialogue[].lineN`에 들어가야 한다**(코드가 커버리지를 검사한다).
10. `angle`은 짧은 영문(`eye level`, `low angle`, `high angle`, `dutch 10°`), `cameraMove`는 `static`/`slow push-in`/`pan right`/`handheld` 등. `fovDeg`는 47/84/107/29/18/8 중 하나(선택).

## Step 3 — 한 번에 제출

```json
shots_propose_breakdown {
  "seq": "S41",
  "sourceTextHash": "<scene_get이 준 값>",
  "shots": [
    {"no":"0010","sizeCode":"EWS","angle":"high angle","cameraMove":"static","fovDeg":84,"durationSec":3,
     "characters":[],"location":"@loc_외곽도로_dawn","props":[],
     "actionKo":"군산 외곽 도로, 새벽 안개. 트럭 한 대가 멀리서 진입.","dialogue":[],"sourceLines":[3,4]},
    {"no":"0020","sizeCode":"MS","angle":"eye level","cameraMove":"static","fovDeg":47,"durationSec":2.5,
     "characters":["@해수"],"location":"@loc_외곽도로_dawn","props":["@prop_권총"],
     "actionKo":"해수, 권총을 쥔 채 트럭 쪽을 본다. 턱이 물려 있다.","dialogue":[],"sourceLines":[5]},
    {"no":"0030","sizeCode":"MCU","angle":"eye level","cameraMove":"static","fovDeg":29,"durationSec":3.2,"tag":"대사",
     "characters":["@해수"],"location":"@loc_외곽도로_dawn","props":[],
     "actionKo":"[대사] 해수: \"거기 서.\"","dialogue":[{"speaker":"해수","text":"거기 서.","lineN":6}],"sourceLines":[6]},
    {"no":"0040","sizeCode":"CU","angle":"eye level","cameraMove":"static","fovDeg":29,"durationSec":2,"tag":"반응",
     "characters":["@민재"],"location":"@loc_외곽도로_dawn","props":[],
     "actionKo":"[반응] 민재, 숨을 멈춘 채 눈만 해수 쪽으로.","dialogue":[],"sourceLines":[6]}
  ]
}
```

- 검증 오류(`대사 줄 N이 어느 샷에도 없음`, `샷 0030에 대사 2줄`, `알 수 없는 태그`, `sizeCode 불일치` 등)가 돌아오면 **지적된 항목만 고쳐 전체를 다시 제출**한다. 최대 3회. 3회 넘으면 오류 내용을 사용자에게 보여주고 지시를 기다린다.
- 유료 도구·`shots_update`로 우회하지 않는다. 분해는 이 도구 하나다.

## Step 4 — 표 요약 후 멈춘다 (확인 지점 ④)

```
📋 S41 샷 분해 초안 — 14샷 (대사 6 · 반응 3 · 액션 5), 추정 38초

| # | 사이즈 | 인물 | 장소 | 소품 | 묘사 |
|---|---|---|---|---|---|
| 0010 | EWS | — | 외곽도로(새벽) | — | 안개 속 트럭 진입 |
| 0030 | MCU | 해수 | 외곽도로 | — | [대사] "거기 서." |
…
표에서 수락하거나, 고칠 샷을 말씀하세요 ("0030 CU로", "0020 뒤에 손 인서트").
```

수락 전엔 생성 단계로 넘어가지 않는다. 사용자가 수정을 말하면 전체를 재제출하지 말고 `conti-edit` 스킬 방식(`shots_update` / `shots_insert`)으로 그 샷만 고친다.
