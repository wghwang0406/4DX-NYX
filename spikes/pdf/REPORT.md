# M0 스파이크 — 한국어 시나리오 PDF 파싱

대상 PDF 3종 (실제 대본):

| 약칭 | 파일 | 페이지 | 생성 도구 | 폰트 |
|---|---|---|---|---|
| 고래별 | `/Users/wongyeong/Desktop/Project/GRB/고래별_1부_260309 (최종).pdf` | 34 | Hancom PDF 1.3 (한글 HWP) | HCRBatang / HCRBatang-Bold / HCRDotum |
| 남벌 | `/Users/wongyeong/Desktop/Project/NB/남벌_시나리오.pdf` | 65 | Hwp 2020 → macOS Quartz PDFContext | HCRBatang / Bold / HCRDotum / H2hdrM |
| AWAKE | `/Users/wongyeong/Downloads/AWAKE_대본_v8.pdf` | 15 | wkhtmltopdf 0.12.6 (Qt) | NotoSerifCJKkr Regular / Bold |

스크립트·산출물 (`/Users/wongyeong/Desktop/build/spikes/pdf/`):

- `extract.mjs` — pdfjs-dist 6.11 legacy 빌드. `getTextContent()` 아이템을 x/y 와 함께 뽑고 y 클러스터링(±2.5pt)으로 줄 복원 → `samples/<name>.lines.json`
- `split.mjs` — 씬 헤딩 감지 + 줄 분류(heading/speaker/dialogue/paren/action/caption/meta) + 씬 묶기 → `samples/<name>.scenes.json`. `--sample 30 --seed 7` 로 눈대중 검증용 무작위 추출.
- `samples/고래별_1부_260309_최종.pypdf.txt` — pypdf 6.11 비교용 추출

실행: `node extract.mjs <pdf...>` → `node split.mjs samples/<name>.lines.json --sample 30`

---

## 1. 결론 먼저

**pdfjs-dist(legacy) + 좌표 기반 줄 복원을 권장한다.** 세 PDF 모두 헤딩 100% 검출(번호 누락 0, 오검출 0), 줄 분류는 30줄 샘플 ×3 = 90줄에서 오분류 0. 전수 검사에서 찾은 실패는 아래 §6 에 적었고 전부 규칙 추가로 잡혔다.

핵심 이유 세 가지:
1. **헤딩은 정규식만으로 부족하고 폰트 높이가 필요하다.** 고래별·남벌 모두 헤딩이 본문보다 1pt 크다(12 vs 11, 11 vs 9.9). `^\d+\.` 는 "1409년. 태종 9년" 같은 자막이나 본문 열거에도 걸리므로 "더 큰 폰트 OR (왼쪽 정렬 + 시간/장소 꼬리)" 로 확정해야 한다. pypdf 는 폰트 크기를 주지 않는다.
2. **화자/대사 구분은 x 좌표가 결정적이다.** 남벌은 화자명과 지문이 같은 x(75)에서 시작해서 텍스트만으로는 못 가른다. pdfjs 에서는 화자명이 **별도 text item** 으로 오고 그 뒤에 폭 250pt 짜리 공백 item, 그다음 대사 item 이 고정 x(125 / 고래별 165)에서 시작한다. 이 item 경계를 쓰면 화자 분리가 거의 결정적이다.
3. **pypdf 기본 모드는 줄 구조를 완전히 잃는다.** (§5)

## 2. 세 PDF 가 실제로 쓰는 형식

| | 헤딩 형식 | 씬 수 | 화자 표기 | 들여쓰기 (x, pt) |
|---|---|---|---|---|
| 고래별 | `41. 군산 외곽 도로 -D` — 번호. 장소 -D/-N. en dash `–` 혼용, `(회상)` 접두, `(N or D)` 꼬리도 있음. 폰트 12 (본문 11) | **70** | `수아`, `수아NA`, `여자1E`, `의현E` — 이름 item + 간격 + 대사 item | 지문·헤딩 85 / 화자 100 / 대사 이어짐 165 / 쪽번호 285 |
| 남벌 | `17. 대마도 노예 수용소 노역장 / 외부. 어두운 낮.` — 번호. 장소 / 외부\|내부. 시간어. `플래시백.`·`에필로그.` 접두. 폰트 11 (본문 9.9) | **97** | `임억`, `보경E`, `임억,윤관`(공동), `임억.`(마침표) — 이름 item + 간격 + 대사 item | 지문·헤딩·**화자 모두 75** / 대사 이어짐 125 / 가운데 자막 ~260 / 머리글 460 |
| AWAKE | 3단 계층: `1막 — 인트로` (11.5pt) › `Sequence 4. 바람의 세계 — 준 + 아리` (9.8pt) › `Scene 2. 아리 등장` (본문과 같은 8.6pt). Scene 번호는 Sequence 마다 1부터 다시 시작 | **34** (7 Sequence, 3 막) | `준: (작게) …대사` — 콜론 인라인 | 전부 14.4 / 대사 이어짐만 31.6 |

헤딩 예시 3개씩:

- 고래별: `1. 바닷속 -N` · `11. (회상) 여동수집/ 마당 -D` · `31. 경성역 인근 어딘가 (N or D)`
- 남벌: `1. 숲 / 외부. 푸른 새벽` · `65. 플래시백. 조선 내 왜군 진영 / 외부. 낮` · `96. 에필로그. 푸른 대해 / 외부. 낮`
- AWAKE: `Scene 1.` (제목 없음) · `Scene 4. 차량 Sequence` · `Sequence 6. 소인국 — 준 + 아리 + 땅땅 합류`

씬 번호 연속성 검사: 세 PDF 모두 **누락/중복 없음** (1→70, 1→97, Sequence 내 1→n). 눈으로 본 false positive / negative 도 없음. AWAKE 는 `Scene N.` 이 본문과 같은 폰트라 정규식 하나로만 잡히는데, 본문에 "Scene"으로 시작하는 문장이 없어서 문제가 안 났을 뿐이다.

## 3. 동작한 정규식

```js
// 번호. 장소 [-D|-N | / 외부. 시간]   ← 고래별·남벌 (한국 드라마/영화 표준). (?!\d) 로 "1. 2." 같은 소수 배제
/^\s*(\d{1,3})\s*\.\s*(?!\d)(.+?)\s*$/u
// 꼬리 분해
/\s*[-–—]\s*\(?\s*([DN])\s*(?:or\s*[DN])?\s*\)?\s*\.?$/u            // "-D" "–N" "(N or D)"
/\s*\/\s*(외부|내부|실내|실외|EXT|INT)\s*[.,]?\s*(.*?)\s*\.?$/iu      // "/ 외부. 어두운 낮."
/^\s*\((회상|플래시백)\)\s*/u , /^\s*(플래시백|회상|에필로그|프롤로그)\s*\.\s*/u
// AWAKE 계층
/^\s*Scene\s*(\d{1,3})\s*\.?\s*(.*)$/iu
/^\s*Sequence\s*(\d{1,3})\s*\.?\s*(.*)$/iu
/^\s*(\d{1,2})막\s*(?:[—–-]\s*(.*))?$/u
// 세 PDF 엔 없지만 흔한 변형 (코드에 포함, 미검증)
/^\s*S#?\s*(\d{1,3})\s*[.:]?\s*(.*)$/u , /^\s*(?:씬|신|장면)\s*(\d{1,3})/u , /^\s*#\s*(\d{1,3})/u
// 화자
/^[가-힣A-Za-z0-9·]{1,10}(?:[,/&][가-힣A-Za-z0-9·]{1,10}){0,3}(?:\s?(?:NA|E|V\.?O\.?|O\.?S\.?|F|\(NA\)|\(E\)))?\.?$/u   // item 분리형 이름
/^([가-힣A-Za-z0-9·]{1,8}(?:\s?\((?:NA|E|V\.?O\.?|O\.?S\.?)\))?)\s*[:：]\s*(.*)$/u                                   // "이름: 대사" 형
// 페이지 가구
/^[-–—]\s*\d+\s*[-–—]$/      // "- 3 -"
/^\([^()]*\)$/               // 괄호만으로 된 줄 = 지시문(paren)
```

**헤딩 확정 조건** (num-dot 에만 적용): `폰트높이 > 본문최빈값+0.5` **또는** `(|x − 본문좌측여백| < 12 && 꼬리(-D/-N | / 외부.)가 있음)`. 이걸 빼면 남벌의 `1409년. 태종 9년` 은 `년` 때문에 안 걸리지만, 일반적으로 "3. 어쩌구" 식 본문 열거가 씬으로 들어온다.

## 4. 줄 분류 알고리즘 (split.mjs `analyze`)

1. **문서 통계**: 본문 폰트 높이 = 최빈값, 지문 x = 본문 폰트 줄의 x 최빈값.
2. **meta**: 쪽번호 정규식 / 페이지 수의 50% 이상 반복되는 동일 문자열(남벌 `하이브미디어코프` 머리글, `4D PLEX` 워터마크 — 페이지 **한가운데** y=471 에 29.9pt 로 찍혀 있어 좌표 없이 텍스트만 보면 본문 사이에 끼어든다) / 본문의 2.2배 넘는 글자.
3. **heading**: §3 정규식 + 확정 조건.
4. **speaker**: (a) 첫 헤딩 이후에만 `이름: 대사` 콜론형 (b) 공백 아닌 item 이 2개 이상이고 첫 item 이 화자명 패턴이며 다음 item 과의 간격 ≥ 8pt. 대사 item 의 x 최빈값을 `xDialogue` 로 저장 (고래별 165, 남벌 125).
5. **dialogue**(이어짐): `|x − xDialogue| < 6`. xDialogue 가 없는 문서(AWAKE)는 "지문보다 12pt 이상 들여쓰기 + 직전 줄이 화자/대사".
6. **paren**: 괄호 하나로만 된 줄.
7. **caption**: 지문 x 보다 들여쓰기 되어 있고 페이지 중앙 ±40 에 정렬된 줄 (남벌 `1409년. 태종 9년`, `1년 뒤.`, 엔딩 자막 — 영상에서 자막으로 뜨는 텍스트라 지문과 구분할 가치가 있다).
8. 나머지 **action**.

분류 결과 (줄 수):

| | heading | speaker | dialogue(이어짐) | paren | action | caption | meta |
|---|---|---|---|---|---|---|---|
| 고래별 | 70 | 359 | 94 | 2 | 422 | 5 (표지) | 33 |
| 남벌 | 97 | 595 | 136 | 0 | 981 | 17 | 195 (65×3) |
| AWAKE | 44 | 257 | 5 | 0 | 284 | 0 | 0 |

**샘플 정확도** (`--sample 30 --seed 7`, 눈으로 확인): 고래별 30/30, 남벌 30/30, AWAKE 30/30. 화자명 집합도 깨끗하다 — 고래별 38명(`수아`·`수아NA`·`수아E` 가 별도 키로 남는 건 의도: NA/E 는 후처리에서 `mode` 로 분리하면 된다), 남벌 37명, AWAKE 6명(`준`·`아리`·`땅땅`·`시스템`·`동료`·`부대원들`).

## 5. pypdf 비교 (고래별)

- **기본 `extract_text()`**: 줄바꿈이 거의 사라진다. `1.바닷속 -N한 남자의 그림자가…` 처럼 **헤딩과 본문이 붙고**, `수아NA물속에 몸을…`, `사내1붕어하셨다..수아붕어요?` 처럼 **화자명과 대사, 대사와 다음 화자가 붙는다.** 띄어쓰기도 사라진다(`1.바닷속`). 씬 분리·화자 분리 둘 다 불가능.
- **`extraction_mode="layout"`**: 줄과 들여쓰기는 살아난다(화자 열 2칸, 대사 열 12칸 들여쓰기로 보임). 대신 단어 사이에 공백이 2~4개씩 과잉 삽입되고(`수아의  떨리는   시선이`), 폰트 크기 정보가 없어서 헤딩은 정규식만으로 판단해야 한다. 폴백으로는 쓸 수 있는 수준.
- 판정: **pdfjs 가 줄 구조·들여쓰기·폰트 크기·item 경계를 모두 보존해서 우위.** pypdf 는 Python 사이드에서 빠른 텍스트 덤프가 필요할 때 layout 모드로만.

## 6. 발견한 실패 사례와 대응

| 사례 | 어디 | 원인 | 대응 |
|---|---|---|---|
| `임억,윤관  (눈빛으로 묻는)...` 가 action 으로 | 남벌 p11 | 공동 화자, 쉼표 | 화자 정규식에 `[,/&]` 연결 허용 → 해결 |
| `임억.  억지로 데려갈…` 가 action 으로 | 남벌 p15 | 이름 뒤 마침표 오타 | 끝 `\.?` 허용 후 제거 → 해결 |
| `(소화 째려보는…) 먹어라. (우물우물)` 가 paren 으로 | 남벌 p46 | `^\(.*\)$` 가 양끝 괄호에 걸림 | `^\([^()]*\)$` → 해결 (dialogue 로) |
| 표지의 `장르: 판타지…`, `로그라인: …` 이 화자로 | AWAKE p1 | 콜론형 규칙 | 첫 헤딩 이전엔 콜론형 비활성 → 해결. **본문 안에 "주의: …" 같은 줄이 있으면 여전히 걸린다** — 등장인물 섹션/빈도(≥2회)로 화자 화이트리스트를 만들면 막을 수 있다 |
| `/INS 뉘엿뉘엿 해가 지는 군산 전경/` | 고래별 p22 | INS(인서트) 표기, 화자 열(x=100)에 있음 | 현재 action 으로 정상 분류되지만 `INS`/`cut to.`/`cut to /` 같은 편집 지시는 별도 타입으로 뽑는 게 샷리스트에 유리 |
| AWAKE `Scene 1.` 제목 없음 | AWAKE | 장소/시간 정보가 헤딩에 전혀 없음 — Sequence 제목(`바람의 세계`)을 장소로 상속해야 함 | 계층 ID `seq.scene` 로 저장했고 `sequence` 객체를 씬에 첨부함 |
| 남벌 지문이 **어절 중간에서** 줄바꿈 | 남벌 전체 | HWP 양쪽정렬 하드랩 (`…병사 앞` / `에 임억의 걸음이…`) | 줄 간격으로 문단 복원 필요: 줄 피치 16pt(고래별 17.6), 문단 사이는 32pt(35). y 간격 > 1.5×피치면 문단 경계. 어절 단위 합치기는 **공백 없이** 이어붙여야 한다(고래별은 어절 끝에서 끊으므로 공백 필요) — 문서별 판정 필요 |
| 남벌 `4D PLEX` 워터마크가 페이지 중간 | 남벌 전체 | y=471 에 본문과 섞임 | 반복 문자열 + 큰 폰트로 meta 처리 → 해결. 텍스트 순서만 쓰는 추출기는 본문 한복판에 끼운다 |
| 가운데 정렬 자막과 표지 글이 같은 규칙 | 남벌 p1/p65 | 표지는 preamble, 엔딩 크레딧은 마지막 씬 안 | 현재는 caption 으로만 표시. 마지막 씬의 꼬리 caption 묶음은 엔딩 자막으로 따로 다룰 수 있음 |

## 7. 한국어 폰트/인코딩

- 세 PDF 모두 **Type0 / CIDFontType2 / Identity-H / 폰트 임베드 / ToUnicode 있음**. ToUnicode 가 있어서 pdfjs·pypdf 모두 정상 유니코드가 나온다. (ToUnicode 없는 HWP 출력물은 깨지는데, 이번 샘플엔 없었다. 앱에서는 "추출 결과에 한글 비율이 낮으면 OCR 폴백" 정도의 가드만 두면 됨.)
- **NFD 없음**: 전부 NFC. (macOS 파일명은 NFD 일 수 있으니 파일명 처리만 `normalize('NFC')`.)
- **공백 누락**: pdfjs 는 item 사이 간격을 보고 공백을 넣어야 한다(`extract.mjs` 의 `GAP_SPACE`, 폰트높이의 25%). 한글은 자간으로 어절을 띄우는 경우가 있어 이 임계값이 중요. 세 PDF 에선 pdfjs 가 공백을 문자열에 포함해 줘서 문제가 없었고, pypdf 기본 모드는 공백·줄바꿈을 잃는다.
- **빈 item**: 고래별 175개, 남벌 265개, AWAKE 27개 — `str === ''` 이고 `hasEOL` 만 있는 줄바꿈 마커. 버려도 된다.
- **특수 문자**: AWAKE 는 여는 따옴표로 `ʻ`(U+02BB) 를 쓴다(HTML 변환 과정 산물). `'`/`‘` 로 정규화 권장. 한자 소량(`李王殿下`, `佐須浦`) 은 그대로 보존됨. 사설영역(PUA) 문자 없음.
- 고래별 헤딩의 대시는 `-`(U+002D) 와 `–`(U+2013) 가 섞여 있다 → `[-–—]`.

## 8. 레거시 GRB 프로젝트의 실제 디스크 레이아웃 (앱이 호환해야 할 것)

`/Users/wongyeong/Desktop/Project/GRB/`

```
GRB/
├─ config.md                      # project_code: GRB / project_title / project_type: drama + Episode Mapping 표
├─ Projectprompt.md               # "# 고래별 — Master Projectprompt" / Project Identity / Universal Rules / 주요 공간 #N (Color&Light / Texture / Motion Style / Mood)
├─ readme.md                      # 설치 안내 (InstallWizard, SkillManager, new-project.command)
├─ 고래별_1부_260309 (최종).pdf    # 원본 대본이 프로젝트 루트에 같이 있음
├─ new-project.command            # 기본 폴더 트리 생성
├─ grb_runner.py / grb_cache.py   # 러너 + 캐시 (캐시 파일명 ROOT/.grb_cache.json, 스키마 "grb-cache-v1" — 현재 디스크엔 아직 없음)
├─ gen_helper.py / genconti2img_minimal.py / extract_motion_frames.py / split_shot_cuts.py / transition_to_single_frame.py
├─ .claude/settings.local.json    # 다른 사용자(/Users/grace/…) 경로로 된 allow 목록 — 경로 하드코딩됨
└─ EP01/
   ├─ character/
   │   ├─ Character.md            # "이름 (별칭) : 나이·역할·외형·의상" 한 줄 한 명, 한국어 프로즈
   │   ├─ 의현_Character.png
   │   └─ 해수_Character.png       # {이름}_Character.png  (CLAUDE.md 의 char/loc/prop 하위폴더 구조는 아직 아님)
   ├─ Conti/
   │   ├─ S41/
   │   │   ├─ shotlist_S41.md      # "# 시퀀스 41 — 군산 외곽 도로 -D" + 상태 범례 + | # | 샷사이즈 | 인물 | 묘사 | 상태 | 표, 0010 단위, 50샷
   │   │   ├─ urls_S41.md          # | 01 | <https://d8j0ntlcm91z4.cloudfront.net/user_…/hf_….png> |  꺾쇠 URL
   │   │   ├─ S41_0010_v1.png … S41_0050_v1.png
   │   │   └─ S41_storyboard_1-5.jpg
   │   └─ S42/shotlist_S42.md
   ├─ Image/
   │   ├─ S41/
   │   │   ├─ Sceneprompt.md       # 한국어 산문 4~5문단 (스타일·장소·행동·카메라·고증)
   │   │   ├─ Shotprompt.md        # "0010. 고공 부감 EWS — …" 샷당 한 줄, 캐릭터 외형이 인라인으로 들어가 있음(레거시)
   │   │   ├─ S41_Background.png
   │   │   ├─ S41_0010_v1.png … S41_0040_v1.png
   │   │   └─ S41_0050-1_v1.png, S41_0050-2_v1.png   # 키프레임 `-1`,`-2` 규약
   │   └─ S42/Sceneprompt.md, Shotprompt.md
   └─ Video/S41/S41_0010_v1.mp4
```

PDF ↔ 레이아웃 매핑에서 중요한 점:
- **SEQ ID = `S` + PDF 씬 번호(2자리 제로패딩)** — `41. 군산 외곽 도로 -D` → `S41`, shotlist 제목 `# 시퀀스 41 — 군산 외곽 도로 -D` 는 헤딩의 `번호`와 `장소 -D` 를 그대로 옮긴 것. 즉 §3 의 `parseHeading` 출력(`num`, `location`, `time`)이 곧 shotlist 머리말이다.
- `config.md` 의 Episode Mapping 은 `S41→EP01, S42→EP01, S01→EP02` 처럼 **씬 번호가 에피소드 순서와 무관**하게 매핑된다 — 앱이 임의 매핑을 허용해야 한다.
- 샷 번호는 `0010` 단위 4자리, 파일명 `{SEQ}_{SHOT}_v{N}.png`, 키프레임 `{SEQ}_{SHOT}-{k}_v{N}.png`.
- shotlist 의 대사 샷은 `[대사] "뭐해 계속 가!"` 로 표기 — GenConti 규칙 "대사 있는 줄은 독립 샷" 과 맞물리므로 파서의 `speaker` 줄 하나 = 샷 후보 하나로 바로 쓸 수 있다.
- 캐릭터 시트는 `EP01/character/{이름}_Character.png` 평면 구조이고, CLAUDE.md 가 말하는 `character/{char,loc,prop}/` 하위 구조·`loc_wide` 등 4뷰는 이 프로젝트엔 아직 없다. 둘 다 읽을 수 있게 하는 게 안전.
- `.claude/settings.local.json` 의 허용 경로가 `/Users/grace/...` 로 박혀 있다 — 프로젝트 폴더가 사용자 간에 복사되고 있다는 뜻이므로 앱은 절대경로를 저장하지 말 것.

## 9. 앱에 넣을 때 권장 구조

1. `extract.mjs` 의 `extractPdf()` 를 그대로 — 출력은 페이지별 `{y, x, x1, h, text, segs[]}`. `segs` (원본 item) 를 버리지 말 것: 남벌 화자 분리의 유일한 근거다.
2. `split.mjs` 의 `analyze()` — 문서 통계(본문 폰트/여백/대사 열)를 먼저 잡고 규칙을 적용. 세 문서에서 수동 튜닝 없이 같은 코드가 돌았다.
3. 문단 복원(§6 하드랩) 을 action 에 추가: y 간격 > 1.5× 줄피치 → 문단 경계.
4. 결과 스키마 (현재 `*.scenes.json`): `scenes[] = {id, num, heading, page, location, time, inout, flashback, act?, sequence?, lines[] = {type, speaker?, text, page, x}}` + `preamble[]` (표지·시놉시스·등장인물). AWAKE 처럼 PDF 앞머리의 "등장인물" 섹션은 preamble 에 들어오므로 Character.md 초안 소스로 쓸 수 있다.
5. UI 에서 헤딩 신뢰도를 보여줄 것: `regexHits` 중 `confirmed=false` 인 줄(이번 샘플에선 0) 을 "씬으로 승격?" 후보로 노출하면 미검출을 사용자가 바로 고친다.
