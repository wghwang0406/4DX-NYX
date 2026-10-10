# Higgsfield CLI 스파이크 리포트 (M0 de-risking · Part A)

- 실행일: 2026-10-09 (KST 23:2x)
- CLI: `higgsfield 1.1.23 (dd8d00a83d46aa443eaa605a75c246e1226010c1) built 2026-08-08T19:50:15Z`
- **크레딧 소비: 0.** `generate create`는 한 번도 호출하지 않았다. 시작 잔액 0.81 → 종료 잔액 0.81 (`samples/account_status.json` ↔ `samples/account_status_after_cost.json`).
- 원본 JSON/텍스트는 전부 `samples/` 에 있다. 아래 표의 파일명이 그 출처다.

---

## 0. 한눈에 보는 결론 (앱 설계에 직접 영향)

| 항목 | 결론 |
|---|---|
| 잔액/플랜 | `account status --json` → `{credits: number, email, subscription_plan_type}`. **현재 잔액 0.81 크레딧** — 어떤 생성도 실제로는 실패할 수준. 앱은 생성 전 `generate cost`로 견적을 내고 잔액과 비교해야 한다 |
| 업로드 | `upload create` → `{id: uuid, type, url}`. **같은 파일을 두 번 올리면 id가 다르다 (중복 제거 없음)**. `upload list`에 **만료 필드 없음** (`created_at`, `id`, `type`, `url`만). 앱이 로컬 해시→id 캐시를 들고 있어야 재업로드를 피한다 |
| 결과 URL | `result_url` / `min_result_url` / `thumbnail_url` 모두 **서명 없음, 쿼리스트링 없음**. CloudFront + `cache-control: public, max-age=31536000, immutable`. 즉 **만료되지 않는 영구 공개 URL**로 취급해도 된다 (단, URL을 아는 사람은 누구나 볼 수 있다). `thumbnail_url`만 `cdn.higgsfield.ai`(Cloudflare, `cf-cache-status: DYNAMIC`) |
| cost | **무료.** 도움말이 "Estimate credits without creating a job"라고 명시하고, 10여 회 호출 후 잔액 변동 없음. 파라미터 검증(`Unknown params`/`Invalid values`)을 **돈 안 쓰고** 돌릴 수 있는 드라이런 수단이다 |
| 프롬프트 입력 | `--prompt "..."` 는 개행·한글·따옴표·6000자 모두 OK. **`--prompt @file.json`** 은 파일을 **JSON으로 파싱**해 그 값을 쓴다 (JSON 문자열 `"..."` 이어야 함; 평문이면 `Invalid JSON`). **`--prompt`를 생략하고 stdin으로 파이프**하면 stdin이 프롬프트가 된다. `--prompt -`는 stdin이 **아니라** 글자 `-`다. `--prompt-file`·`--from-file`은 generate에 없다 |
| 종료코드 | 0 성공 / **3** = 클라이언트 측 검증 실패·작업 없음(`invalid id`, `작업을 찾을 수 없어요`) / **4** = 서버 파라미터 오류·없는 모델(`No model with job_type`, `Unknown params`, `Invalid values`, `Missing required params`) |
| `--wait` | 성공 시 **stdout에 result_url 한 줄**(배치면 여러 줄). `--json`과 같이 쓰면 job 객체 전체. `--quiet`는 진행 표시만 끈다. 타임아웃 메시지: `Timeout after %s; last status %q.` |
| 상태값 | 실제 관측: `completed`만. 바이너리 문자열에서 `queued`, `running`, `failed`, `cancelled`, `pending`, `canceled`, `completed`, `nsfw` 확인 — 앱은 이 집합으로 switch하되 unknown도 받아야 한다 |
| 모델 별칭 | `nano_banana_2`는 **서버 별칭**이다. `model list`에는 없고 `model get nano_banana_2`는 `job_type: "nano_banana_pro"`를 돌려준다. 작업 기록(`generate list`)의 `job_type`도 `nano_banana_pro`. 앱은 **정규화 테이블**(`nano_banana_2 → nano_banana_pro`)을 들고 있어야 "내가 만든 작업" 필터가 맞는다 |
| Soul ID | `soul-id list --json` → `[]` (빈 배열). 현재 계정에 Soul ID 없음 |
| 바이너리 | `/opt/homebrew/bin/higgsfield` → npm 패키지 `@higgsfield/cli` 의 `bin/higgsfield.js`(런처) → **`vendor/hf` (Go, Mach-O arm64, 17MB)** 가 실제 본체. 설정은 `~/.config/higgsfield/{config.json,credentials.json}` |

---

## 1. 계정 (`account`)

`samples/account_status.json`
```json
{ "credits": 0.81, "email": "4dxproduction@gmail.com", "subscription_plan_type": "ultimate" }
```
- 잔액 필드 이름은 `credits` (소수 허용). 플랜은 `subscription_plan_type` (문자열, 예 `ultimate`).

`samples/account_transactions.json` (`--size 5`, 최대 100, `--cursor`로 페이지네이션)
```json
{ "cursor": "5",
  "items": [ { "action": "spend", "created_at": "2026-10-02T05:54:46.303467Z", "credits": -2, "display_name": "Nano Banana Pro" }, ... ] }
```
- `credits`는 **음수 = 지출**. `action` 값으로 `spend`만 관측. `display_name`은 모델 표시명(job_type이 아님). 작업 id는 **들어 있지 않다** → 거래와 작업을 잇고 싶으면 `created_at`을 ±1초로 매칭하는 수밖에 없다 (`generate list`의 `created_at` 2026-10-02T05:54:46.211 ↔ 거래 05:54:46.303).
- 도움말: `samples/help_account.txt`

## 2. 업로드 (`upload`)

`samples/upload_create_1.json` / `_2.json` (같은 64×64 PNG 두 번)
```json
{ "id": "7c6107ab-3efb-4d1f-9a86-cb56faed17f8", "type": "image", "url": "https://d2ol7oe51mr4n9.cloudfront.net/user_.../7c6107ab-....png" }
{ "id": "1367891d-cc84-4ea0-970a-5e4c726c5f72", "type": "image", "url": "https://d2ol7oe51mr4n9.cloudfront.net/user_.../1367891d-....png" }
```
- **dedupe 없음.** 같은 바이트를 올려도 새 uuid. 앱 쪽에서 `sha256 → upload_id` 캐시를 두는 것이 좋다.
- `samples/upload_list.json` (`upload list --image --size 5`): `{cursor, items[{created_at, id, type, url}]}`. **expiry/expires_at 류 필드 없음.** 방금 올린 두 개가 리스트 최상단에 그대로 보인다 (id 지속됨). 10월 1일 업로드도 남아 있다.
- `upload list`는 `--image/--video/--audio` 필터, `--size`, `--cursor`. `cursor` 값은 epoch 소수(`"1790845988.879362"`).
- 업로드 URL에 `curl -sI`: `200`, `server: AmazonS3` via CloudFront, **cache-control 헤더 없음**, 쿼리스트링 없음 (`samples/curl_headers.txt` 3번째).
- `generate create/cost`의 미디어 플래그는 **uuid 또는 로컬 경로** 모두 받고, 경로는 자동 업로드한다 (도움말). `@file`은 미디어 플래그에는 적용되지 않는다 (`Media "@..." is neither a UUID nor an existing file path`).
- 파일 입력 형식 검증은 안 했다 (jpg/png/webp/mp4/pdf 허용은 도움말에서만 확인).

## 3. 작업 (`generate list` / `get` / `wait`)

`samples/generate_list.json` — 배열(페이지 래퍼 없음, `--size`만 있고 cursor 없음). 각 항목:

| 필드 | 타입 | 비고 |
|---|---|---|
| `id` | uuid | |
| `job_type` | string | **정규 id** (`nano_banana_pro`, `hf_mult_motion_control`). 별칭이 아님 |
| `display_name` | string | 표시명 |
| `status` | string | 관측값 `completed` |
| `created_at` | ISO8601 Z | |
| `result_url` | string\|null | 이미지 `.png`, 영상 `.mp4` |
| `min_result_url` | string\|null | 이미지는 `_min.webp` 축소판. **영상 작업은 null** |
| `thumbnail_url` | string | **영상 작업에만 존재** (`cdn.higgsfield.ai/..._thumbnail.webp`). 이미지 작업엔 키 자체가 없다 |
| `params` | object | 모델별 상이. 이미지: `aspect_ratio, batch_size, height, width, resolution, prompt, input_image, input_images[{id,type:"media_input",url}], application, surface`. 영상(motion control): `medias[{data:{id,type,url}, role}], duration, bitrate_mode, generate_audio, resolution, scene_mode, folder_id` |

- `params.prompt`는 **원문 그대로** 돌아온다 (개행 포함, 1000자+). 앱이 프롬프트를 별도로 저장하지 않아도 복구 가능.
- `params.input_images[].url`은 업로드 원본이 아니라 `_resize.jpg`로 바뀐 경우가 있다 → 입력 원본 추적은 `id`로 해야 한다.
- `generate get <id> --json` = 리스트 항목과 **동일한 스키마** 단일 객체 (`samples/generate_get_image.json`, `_video.json`).
- 텍스트 모드(`--json` 없음)는 `ID DATE MODEL STATUS URL` 고정폭 표 (`samples/generate_get_plain.txt`, `generate_list_plain.txt`). 파싱용으로 쓰지 말 것.
- `wait`(완료된 작업에 호출 — 무료): 텍스트 모드는 **URL 한 줄만** stdout (`samples/wait_plain.txt`), `--json`은 job 객체 전체 (`samples/wait_json.txt`), `--quiet`도 URL은 출력. 기본 `--timeout 10m`, `--interval 3s`.
- 없는 id: `generate get no-such-id` → stderr `Error: invalid id: no-such-id`, **exit 3** (uuid 형식 검증, 서버 미호출). 형식은 맞지만 없는 uuid → stderr `Error: 작업을 찾을 수 없어요`, **exit 3** (서버 메시지가 **한국어**로 온다 — 로케일 기반; 문자열 매칭 금지, 종료코드만 믿을 것).

### 결과 URL 수명 (`samples/curl_headers.txt`)
```
result_url (.png)      HTTP/2 200  cache-control: public, max-age=31536000, immutable  x-amz-storage-class: INTELLIGENT_TIERING
min_result_url (.webp) HTTP/2 200  cache-control: public, max-age=31536000, immutable
upload url (.png)      HTTP/2 200  (cache-control 없음)
thumbnail_url          HTTP/2 200  server: cloudflare, cf-cache-status: DYNAMIC
```
- 서명 파라미터·Expires 없음. `x-robots-tag: noindex`. 1년 immutable 캐시 → **URL만 저장해도 되지만**, Intelligent-Tiering이라 오래된 파일은 첫 GET이 느릴 수 있다. 앱 정본은 **로컬 다운로드 사본**으로 두고 URL은 보조로 쓰는 게 안전하다 (계정 삭제·정책 변경 리스크).

## 4. 비용 견적 (`generate cost`) — 무료 확인

도움말 원문: *"Estimate credits without creating a job. For models, params and media flags match generate create. Local file paths are auto-uploaded."* (`samples/help_generate_cost.txt`)

| 호출 | 결과 | 파일 |
|---|---|---|
| `cost gpt_image_2_5 --prompt "test" --json` | `{"credits": 0.25}` exit 0 | `cost_gpt_image_2_5.json` |
| 같은 것, `--json` 없이 | `0.25 credits` | |
| `cost nano_banana_2 --prompt test --image <upload_id> --resolution 2k` | `{"credits": 2}` | `cost_nano_with_image.json` |
| `cost kling3_0 --prompt test --start-image <upload_id>` | `{"credits": 8.75}` | `cost_kling_start_image.json` |
| `cost no_such_model --prompt x` | `Error: No model with job_type "no_such_model".` **exit 4** | `cost_no_such_model.txt` |
| `--quality ultra` | `Error: Invalid values: quality=ultra (allowed: low,medium,high,xhigh,max)` exit 4 | `cost_bad_param.txt` |
| `--bogus 1` | `Error: Unknown params: bogus` exit 4 | `cost_unknown_param.txt` |
| `nano_banana_2 --prompt ""` | `Error: a non-empty prompt or at least one image reference is required` exit 4 (모델 `rules`의 CEL이 그대로 메시지) | |

- 응답 스키마는 `{credits: number}` 하나뿐. 모델 `rules`(CEL)까지 서버에서 검증되므로 **cost = 완전한 드라이런**이다. 앱은 생성 직전 cost를 호출해 (a) 파라미터 검증 (b) 잔액 비교를 한 번에 처리할 수 있다.
- 주의: 로컬 경로를 미디어 플래그에 넘기면 cost도 **업로드는 실제로 한다** (크레딧은 안 들지만 스토리지에 남는다). 드라이런엔 uuid를 넘기는 편이 깔끔하다.

## 5. 모델 정의 (`model get`) vs `models.py` CAPS

원본: `samples/model_<id>.json` (gpt_image_2_5, nano_banana_2, text2image_soul_v2, soul_cinematic, kling3_0, seedance_2_0 + 추가로 gpt_image_2, cinematic_studio_2_5, seedream_v4_5, seedance_2_5, bytedance_video_upscale, topaz_video, nano_banana_pro, soul_cast, video_upscale) 및 `samples/workflow_<id>.json` (soul_cinema_studio, cinematic_studio_soul_cast/_location, cinematic_studio_3_0, cinematic_studio_video_3_5/_4_0). 전체 목록 `samples/model_list.json` (105개, `{display_name, job_type, type}`).

`model get --json` 스키마: `{display_name, job_type, type: image|video|3d|..., params: [{name, type, default, required, enum?}], rules: [{cel, message}]}`.
`type`은 `"string|null"`, `"object|null"`, `"integer"`, `"boolean"`, `"array"` 같은 유니언 문자열. `start_image`/`end_image`는 `object|null`(미디어 객체). **`duration`은 enum 없이 integer** — 허용 범위는 CLI가 말해 주지 않는다 (kling/seedance 모두).

### `python3 models.py --check` 결과
```
CAPS가 CLI와 일치합니다.   (exit 0)   → samples/models_py_check.txt
```
단, `_check()`는 **`quality`·`resolution` 두 필드만, 그것도 텍스트 표를 파싱해서** 비교한다. 그래서 통과했지만 JSON으로 전 필드를 대조하면 (`samples/caps_vs_live.txt`, 아래는 노이즈 제거한 **실제 불일치**) :

| 모델 | 필드 | CAPS | CLI (live) | 영향 |
|---|---|---|---|---|
| `gpt_image_2` | aspect | `_A_NARROW` (21:9 없음) | `auto, 1:1, 4:3, 3:4, 16:9, **21:9**, 9:16, 3:2, 2:3, 4:5, 5:4` | **CLAUDE.md의 "21:9가 없는 모델: gpt_image_2" 는 현재 틀렸다.** 마스킹 편집을 21:9로 할 수 있다 |
| `gpt_image_2_5` | aspect | `auto` 없음 | `auto` 있음 | 경미 |
| `cinematic_studio_soul_cast` | aspect | 9:21까지 | + `5:4, 4:5` | 경미 |
| `seedance_2_0` | mode | 미정의 | `std, fast` + 규칙 *"fast는 480p/720p만"* | 앱이 mode를 노출하면 규칙 필요 |
| `seedance_2_5` | mode | 미정의(`needs_omni_mode` 플래그만) | `t2v`(기본), `omni_reference`, `video_edit`, `video_extension` | **기본값이 t2v라 start/end/refs를 주면 서버 규칙 위반** → `--mode omni_reference`를 반드시 붙여야 한다. CAPS 주석은 맞지만 enum이 없다 |
| `seedance_2_5` | 상한 | `max_images: 30` | 이미지 30 (start/end 포함) **+ 전체 미디어 50** | CAPS에 총상한 없음 |
| `cinematic_studio_video_4_0` | mode | 미정의 | seedance_2_5와 동일 4종 | 위와 동일 |
| `video_upscale` | 출처 | 주석상 "workflow get" | `workflow get` 실패(exit 4), **`model get`으로만** 조회됨. 파라미터 `duration, folder_id, input_video` | `--check`는 model→workflow 순이라 통과하지만 주석이 틀림 |
| `nano_banana_2` | 정체 | `CANONICAL`로 `nano_banana_pro` 매핑 — **정확함** | `model get nano_banana_2` → `job_type: nano_banana_pro` | OK. 다만 `model list`엔 `nano_banana_2`가 없으니 리스트 기반 검증은 실패한다 |
| `bytedance_video_upscale`, `topaz_video` | refs | `True` | `image_references` 없음, `video_references`만 | CAPS의 `refs`는 영상 모델에서 "video refs"로 읽어야 한다 — 의미 혼용 |

CAPS가 추적하지 않는 유용한 live 파라미터: `gpt_image_2_5.variant (flare|sunburst)`, `gpt_image_2_5/2.background (auto|opaque|transparent)`, `kling3_0.sound (on|off, 기본 on)`, `seedance_2_0.generate_audio (기본 true)`, `seedance_2_0.genre`, `seedance_2_0.bitrate_mode`, `text2image_soul_v2.seed`, `style_id`(image_references와 배타).

CLAUDE.md 표와의 대조 (품질 플래그): 전부 **일치** — gpt_image_2 `quality low|medium|high`+`resolution 1k|2k|4k`, gpt_image_2_5 `+xhigh|max`, nano/cinema `resolution`만, soul 계열 `quality 1.5k|2k`만, seedream `basic|high`만. `seedance_2_5` 1080p 상한, `kling3_0` 21:9 없음, `text2image_soul_v2` 21:9 없음도 일치. **틀린 건 gpt_image_2 21:9 한 건.**

## 6. 플래그·입력 방식·종료코드

- `generate create --help` (`samples/help_generate_create.txt`): `--prompt-file`·stdin 언급 없음. 파라미터는 전부 `--name value` 동적 플래그. `--wait`, `--wait-timeout`, `--wait-interval` 는 예시에만 등장 (플래그 목록엔 안 찍힘).
- 실측 (cost 경유, 무료):

| 방식 | 동작 |
|---|---|
| `--prompt "$P"` 개행+한글+따옴표+`&` | OK |
| `--prompt` 6000자 | OK (argv 한계는 macOS 256KB쯤이니 실무에선 문제 없음) |
| `--prompt @file` (평문) | `Error: Invalid JSON in <file>.` exit 4 |
| `--prompt @file` (내용이 JSON 문자열 `"..."`) | **OK** — 값은 디코드된 문자열 |
| `--prompt @file` (내용이 JSON 객체) | `Invalid types: prompt should be string, got object` → 객체 전개는 안 됨 |
| `--prompt -` | 글자 `-`로 취급 (stdin 안 읽음) |
| `--prompt` 생략 + stdin 파이프 | **OK — stdin이 프롬프트** (`printf 'x' \| higgsfield generate cost gpt_image_2_5`) |
| `--prompt` 생략 + stdin 없음/빈 stdin | `Missing required params: prompt` exit 4 |
| `--prompt-file`, `--from-file` | `Unknown params` exit 4 (`--from-file`은 marketing-studio 쪽 플래그) |

  **권장:** 앱은 긴 12섹션 프롬프트를 **임시 `.json` 파일에 JSON 문자열로 써서 `--prompt @path`** 로 넘긴다 (셸 인용 문제 없음, 길이 무관, 로그에 프롬프트가 안 남음). 대안은 `spawn`에 stdin 파이프.
- 종료코드 (실측): `0` 성공 · `3` 클라이언트 검증(`invalid id`) 및 작업 없음(`작업을 찾을 수 없어요`) · `4` 서버 파라미터/모델 오류. 로그인 안 됨·네트워크 오류 코드는 미측정.
- 에러는 모두 **stderr**, `--json`을 줘도 에러는 JSON이 아니라 `Error: ...` 평문이다. 두 번째 줄에 `Hint: Run: hf model get <job_type>`이 붙을 수 있다 (hint의 job_type은 **정규 id**, 예 `nano_banana_pro`).

## 7. Soul ID
`samples/soul_id_list.json` → `[]`. 비어 있어 항목 스키마는 못 봤다. `soul-id create --name X --soul-2|--soul-cinematic --image ... ×5`, `get`, `wait` 서브커맨드 존재 (`samples/help_soul_id.txt`). 앱의 Soul ID 기능은 **빈 배열을 정상으로** 처리해야 한다.

## 8. 진단 페이지용 정보
- `higgsfield --version` / `version --json`(둘 다 같은 한 줄 텍스트, `--json`이어도 JSON 아님): `higgsfield 1.1.23 (dd8d00a8…) built 2026-08-08T19:50:15Z` — 파싱 정규식 `^higgsfield (\S+) \(([0-9a-f]+)\) built (\S+)$`
- 경로: `/opt/homebrew/bin/higgsfield` → symlink → `/opt/homebrew/lib/node_modules/@higgsfield/cli/bin/higgsfield.js` (Node 런처, `bin/run.js`가 `vendor/hf` 를 spawn) → **`vendor/hf` Mach-O arm64 17MB Go 바이너리**. 별칭 `higgs`, `hf`.
- 설정 디렉토리 `~/.config/higgsfield/`: `config.json` = `{"workspace_id": "..."}` (워크스페이스 선택 중 → 작업이 개인 계정이 아닌 워크스페이스 컨텍스트로 간다. `workspace status/unset` 참고), `credentials.json` = `{auth_version, access_token, refresh_token, expires_at(epoch), token_type, scope}` (OAuth PKCE via `clerk.higgsfield.ai`), `credentials.json.lock`.
- 환경변수 (바이너리 strings): `HIGGSFIELD_API_URL`, `HIGGSFIELD_APP_URL`, `HIGGSFIELD_CONFIG_PATH`, `HIGGSFIELD_CREDENTIALS_PATH`, `HIGGSFIELD_WORKSPACE_ID`, `HIGGSFIELD_USER_ID`, `HIGGSFIELD_DISABLE_TELEMETRY`, `HIGGSFIELD_TELEMETRY`, `HIGGSFIELD_NO_UPDATE_CHECK`, `HIGGSFIELD_SENTRY_DSN`, `HIGGSFIELD_INSTALL_METHOD`, `HIGGSFIELD_PACKAGE_MANAGER`, `HIGGSFIELD_SURFACE`, OAuth 계열 다수. 앱에서 spawn할 때 **`HIGGSFIELD_NO_UPDATE_CHECK=1`** 과 `--no-color` 를 붙이는 게 안전.
- API 베이스: `https://fnf-api-gw.higgsfield.ai/fnf` (dev: `dev-fnf-api-gw`). 미디어 CDN: 업로드 `d2ol7oe51mr4n9.cloudfront.net`, 결과 `d8j0ntlcm91z4.cloudfront.net`, 썸네일 `cdn.higgsfield.ai`.

---

## 9. 앱 어댑터 권고 (요약)
1. 모든 호출에 `--json --no-color`, stdout만 JSON으로 파싱, stderr는 에러 메시지로 보관. **에러 판정은 exit code(3/4)로**, 메시지 문자열은 로케일(한국어 서버 메시지)에 따라 바뀐다.
2. 생성 전 `generate cost` 로 드라이런 → `{credits}` 를 `account status.credits` 와 비교 → 부족하면 UI에서 막는다.
3. 프롬프트는 `--prompt @tmp.json` (JSON 문자열) 로 전달.
4. 업로드는 `sha256 → upload_id` 로컬 캐시 (서버 dedupe 없음, 만료 필드 없음 → 캐시 무효화는 `upload list` 대조로).
5. job_type 정규화 테이블 (`nano_banana_2 → nano_banana_pro`) 유지; `generate list`의 job_type으로 필터할 때 적용.
6. 결과는 `result_url` 을 로컬로 받아 `{SEQ}_{SHOT}_v{N}.{ext}` 로 저장하고 URL은 메타데이터로만.
7. `seedance_2_5`/`cinematic_studio_video_4_0` 은 참조 이미지를 주려면 `--mode omni_reference` 필수. `models.py` CAPS에 `mode` enum과 `gpt_image_2` 21:9 를 반영할 것 (CLAUDE.md 표도 함께).
