# NYX(콘티 스튜디오) QA 보고서 — M1·M2 범위 (2026-10-10)

대상: `/Users/wongyeong/Desktop/build` (Node 22.22, corepack pnpm 12). 기준 문서: `~/.claude/plans/composed-plotting-stallman.md` §1–§5-2, §9-1.
검증 스크립트는 세션 스크래치패드(`/private/tmp/claude-501/…/scratchpad/qa-*.mts`)에 있고 저장소에는 넣지 않았다.
저장소에 추가한 것은 회귀 테스트 5개(core 3, mcp 2)뿐이다.

최종 상태: `tsc`(web·node) 0 오류 / `vitest` **67/67** 통과(수정 전 62) / `corepack pnpm build` 성공 /
`agent-bundle/skills/{Lira,Cinedance,Acting}` 해시 `specs/HASHES.txt` 와 일치(수정 없음).

## 1. 매트릭스

| # | 항목 | 결과 | 증거 | 조치 |
|---|---|---|---|---|
| 1-a | 정적: `tsc -p tsconfig.web.json` / `tsconfig.node.json` | PASS | 둘 다 exit 0 (수정 전·후) | — |
| 1-b | 정적: `vitest run` | PASS | 62/62 → 수정 후 67/67 | 회귀 테스트 5개 추가 |
| 1-c | 정적: `corepack pnpm build` | **FAIL → 수정** | 루트 `build` 스크립트가 맨 `pnpm` 을 부르는데 이 맥엔 `pnpm` 이 PATH 에 없음(`sh: pnpm: command not found`). `corepack pnpm --filter @conti/studio build` 는 성공 | `package.json` 스크립트를 `corepack pnpm …` 으로 |
| 1-d | 정적 grep: `ipcMain.handle` 비-Error throw | PASS | 모든 핸들러가 `Error` 를 던짐. 렌더러는 `Error invoking remote method` 접두를 잘라 표시 | — |
| 1-e | 정적 grep: `window.conti` null 체크 | PASS(정보) | `project.tsx`·`ChatPanel` 은 `?.`, `AssetsView`·`StartScreen`·`MdPendingBar`·`DiagnosticsView` 는 비체크. Electron preload 가 항상 있으므로 실동작 문제 없음 | — |
| 1-f | 정적: effect deps / useState 초기값 | PASS(정보) | `AssetsView` 는 `ep` 만 deps(의도적 eslint-disable), `ChatPanel` 구독 effect 는 `thread` 바뀔 때 재구독 — 문제 없음. props 를 읽는 `useState` 초기값 없음 | — |
| 1-g | 정적: 렌더러 타입 ↔ IPC 반환 불일치 | **FAIL → 수정** | `Api.assets.list(): Promise<Asset[]>` 인데 main 은 `EpisodeAssets`(객체) 반환 → `assets.filter` TypeError 를 catch 해 **에셋 화면이 항상 "없음"** | `ipc.ts:199` `.assets` 반환. 수정 후 캡처 `/tmp/qa-cap-qa-sample-에셋.png` 에 `@해수` 카드 표시 |
| 1-h | 정적: 샷 선택 키 불일치 | **FAIL → 수정** | `ShotTable` 은 shot **id**(uuid) 로, `SheetPreview`·`Timeline`·`ChatPanel` 컨텍스트는 **no**(0010) 로 선택 → 표 클릭이 시트에 반영 안 되고 채팅 컨텍스트에 `[현재 화면: S41 / 샷 <uuid>]` 가 들어감 | `ShotTable.tsx:46` no 로 통일 |
| 2-a | ProjectStore: `\|`·줄바꿈·`—` 가 든 제목/셀 라운드트립 | **FAIL → 수정** | 수정 전 shotlist: `\| 해수, 의현\|형사 \| 카페\|골목 \|` → 열이 밀려 `location="형사"` 로 읽힘. 헤딩 줄바꿈이 H1 을 두 줄로 쪼갬. config.md `project_title:` 도 두 줄 | `shotlist.ts` 모든 셀·헤딩에 `mdCell` 적용, `config.ts`/`projectprompt.ts` 한 줄 정규화. 수정 후 rows=2, `location="카페｜골목"` |
| 2-b | ProjectStore: 다시 열면 JSON 동일 (sequence/project/assets) | PASS | `JSON.stringify` 비교 3건 모두 동일 | — |
| 2-c | Character.md after `upsertAsset` | PASS | `### @해수 / 설명 / 앵커 / 마스터 프로필 / Voice` 생성, views.json 에 해시 기록 | — |
| 2-d | 레거시 GRB(config.md + Projectprompt.md + shotlist_S42.md) 열기 | PASS | 열기만으로는 세 파일 **바이트 동일**(Projectprompt 3543자 보존), 시퀀스 0개(자동 가져오기 안 함). `updateProject` 뒤 Projectprompt 는 사용자 절 전부 보존 + 앵커 절 1회 삽입(3671자). shotlist_S42 는 앱이 S42 를 쓸 때까지 그대로 | — |
| 3-a | MdWatcher: `start()` 경유 shotlist 감지 | **FAIL → 수정 (심각)** | chokidar 5 는 **glob 미지원**(README "v4: remove glob support"). `*/Conti/*/shotlist_*.md` 패턴이 아무것도 안 잡아 **앱에서 shotlist 외부 수정이 전혀 감지되지 않음**. config.md·Projectprompt.md(명시 경로)만 감지됨. 재현 `qa-watch-min.mts`: `shotlist: NOT detected (2551ms)` ×2(realpath 유무) | `watcher.ts:39` 루트를 depth 4 로 감시 + `ignored` 함수로 뷰 파일만 통과. 수정 후 13개 시나리오 전부 PASS, 회귀 테스트 추가 |
| 3-b | 사이즈 변경 / 새 행 / `\|` 가 든 행 | PASS(제한) | 사이즈·새 행 감지·accept OK. 사용자가 셀 안에 `\|` 를 직접 치면 markdown 표 규칙상 열이 밀린다(`문을 연다 \| 그리고 멈춘다` → actionKo `문을 연다`). 전각 `｜` 를 쓰면 됨 — 문서화 대상 | — |
| 3-c | 잘못된 샷사이즈(`ms`, `xx`, `—`) accept | **FAIL → 수정** | `r.size` 를 검증 없이 `sizeCode` 에 넣어 zod 가 **accept 에서 throw**(`—` 인 새 행도 같은 경로) | `watcher.ts:139` `ShotSize.safeParse(upper)`; 대문자 보정, 모르는 값은 요약에 `'xx' 는 알 수 없어 무시` |
| 3-d | config.md 매핑 추가 → accept | PASS | `매핑 S99 → EP02 (신규)` → `episodeMap.S99 === 'EP02'`, md 재생성 후 대기 0 | — |
| 3-e | Projectprompt 앵커 수정 → accept | **FAIL → 수정** | 값이 비어 있을 때 `^- anchor_en:\s*(.*)$` 의 `\s*` 가 줄바꿈을 먹어 **다음 줄을 값으로 읽음** → 요약에 `contiSketchEn: "" → "- conti_cinematic_en:"`, accept 하면 스타일 필드가 오염됨 | `projectprompt.ts:42` `[ \t]*`. 회귀 테스트 추가 |
| 3-f | discard | PASS | JSON 기준으로 md 재작성, 대기 0 | — |
| 3-g | NFD 한글 편집 | **FAIL → 수정** | NFD `해수` ≠ NFC `@해수` 로 `characters 변경` 오탐, accept 시 NFD 가 JSON 에 저장됨 | `watcher.ts:95` 파싱 전 NFC 정규화(해시는 원문으로). 수정 후 오탐 없음, 저장값 NFC |
| 3-h | CRLF | PASS | CRLF 만 바뀐 경우 대기 없음(`readText` 가 LF 정규화), CRLF+변경은 감지·accept OK | — |
| 3-i | 감시 중 파일 삭제 | PASS | 크래시 없음(대기 항목 유지), accept 하면 md 재생성, 재생성된 파일도 계속 감시됨(add 이벤트) | — |
| 4-a | `split-check.mts` 3편 | PASS | 고래별 **70** / 남벌 **97** / AWAKE **34** (보고서 값과 일치), 분류 dialogue 451/725/261 | — |
| 4-b | 헤딩이 EOF / 헤딩 2연속 / `41.   ` | PASS | 빈 본문 씬 생성, `41.   ` 는 헤딩 아님, 크래시 없음 | — |
| 4-c | 본문 `3. 어쩌구`(좌표 없음, 들여쓰기 0) | 제한 | 텍스트 입력 모드는 "들여쓰기 없는 짧은 `N.` 줄" 을 헤딩으로 인정(`confirm()` 설계) → 씬 `3` 생김. UI 에서 체크 해제(앞 씬에 합침)로 복구 가능. 들여쓴 열거는 제외됨 | 미수정 — §3 |
| 4-d | 전환어 닮은 화자(`인수:`), 전각 콜론 `：`, BOM+CRLF | PASS | `인수:` 대사, `자막:`/`INS:` 전환, `해수： 여기서 멈춰.` 대사+괄호, BOM/CRLF 제거 후 2씬 | — |
| 4-e | `seqIdFromSceneNumber` 충돌 | 제한 | `"4.1"→S04_01`, `"41"→S41`, `"41-1"→S41_1`, `"4-1"→S04_1`. 충돌은 `"04"`/`"4"`→`S04` 뿐(한 대본에 둘이 같이 나올 일 없음). `-` 와 `.` 의 하위 번호 패딩 불일치(`_1` vs `_01`) | 미수정 — §3 |
| 5-a | MCP: `shots_update` 10개 병렬(다른 샷) | PASS | 오류 0, 10개 모두 반영, rev 1→11, 디스크 JSON == 메모리, 121ms. `updateShot` 의 read→set 이 첫 await 전에 끝나 유실 없음 | — |
| 5-b | MCP: 병렬 `sequence_update`+`shots_update`+`project_update` | PASS | views.json 3개 키 모두 유지(이번엔 레이스 안 남 — §3 참고) | — |
| 5-c | `shots_insert` 자리 없음(0010,0011) | PASS | isError + `시퀀스 재번호(renumber) 후 다시 시도`; 마지막 뒤는 0021 | — |
| 5-d | `shots_propose_breakdown` 구두점만 다른 대사 | PASS | `여기서 멈춰!`/`왜` 가 원문 `여기서 멈춰.`/`왜?` 에 매칭, lineN 5/6 채움. 같은 대사 두 샷 → `중복` 거절, 빈 배열 → 거절 | — |
| 5-e | `shots_propose_breakdown` 스키마 누락 | **FAIL → 수정** | 스킬(`conti-breakdown`)이 보내는 `fovDeg`·`durationSec` 가 `ShotDraft` 에 없어 zod 가 **조용히 버림** | `breakdown.ts:10` 추가, 테스트 보강 |
| 5-f | `spec_get` 미존재 id | PASS | isError 아님, `missing:["no-such-section"]`, 본문 블록 없음 | — |
| 5-g | `specs/index.json` 사용 여부 | **FAIL → 수정** | `loadSpec` 이 `Array.isArray(idx[spec])` 만 받는데 `build-spec-index.mts` 는 `{file, sha256, lines, sections}` 를 씀 → **색인이 한 번도 쓰이지 않고** 제목 재파싱으로 fallback. id 가 어긋남(`2-dont-bloat…` vs `2-don-t-bloat…`, cinedance `###` 52개 vs 43개 — 스킬이 참조하는 `first-frame-occupancy-lock` 등은 fallback 에 없음) | `specs.ts:73` 두 형태 수용 + sha256·줄 범위 검사(불일치면 fallback). 수정 후 세 spec 모두 색인과 id 완전 일치. 테스트 추가 |
| 5-h | `image_view` 비이미지 | PASS | `.txt`/디렉터리 → `지원하지 않는 이미지 형식`, 텍스트가 든 가짜 `.png` → sharp 오류를 isError 로(`Input buffer contains unsupported image format`), 없는 파일 → `파일 없음`, `../` → `프로젝트 밖` | — |
| 5-i | bearer 없음 / 틀림 / 소문자 `bearer` / PUT / 9MB / 깨진 JSON | PASS | 401 / 401 / 401 / 405 / 400 / 400 | — |
| 5-j | 오류 응답 뒤 keep-alive 소켓 | **FAIL → 수정** | 9MB 거절(400) 직후 같은 origin 의 다음 MCP 호출이 `ECONNRESET`(바디를 안 읽고 끝낸 소켓을 클라이언트가 재사용). 두 번째 호출부터 정상 | `server.ts:59` 4xx/5xx 에 `connection: close`. 수정 후 바로 다음 호출 OK |
| 5-k | `stop()` → `start()` | PASS | stop 후 ECONNREFUSED, 재시작은 새 포트·같은 토큰, 25개 도구·store 정상, 이중 start 는 `이미 시작됨`, 이중 stop 무해 | — |
| 5-l | `jobs_wait` timeoutSec 60 / -1 / 0 | PASS | 60·-1 → `-32602 Input validation error`(zod max 50), 0 → 즉시 `timedOut:true` | — |
| 6-a | agents 테스트 | PASS | 25/25 | — |
| 6-b | claude: 2MB 한 줄 + 20k 줄 stdout | PASS | 20,001 delta / 2.29M 자 / 633ms, turn_end 도착, close 후 자식 없음(`LineSplitter` 가 부분 청크를 버퍼링) | — |
| 6-c | claude: 프로세스가 먼저 죽은 뒤 `close()`/`interrupt()`×2/`send()` | PASS | 턴 중 exit(3) → `error(crash, "…mid-turn: boom")`+`turn_end`+`exit`; close 0ms 반환; interrupt 2회 무해; send 는 `claude session is closed` throw; exit 뒤 이벤트 없음 | — |
| 6-d | claude: 매달린 턴에 `interrupt()` 동시 2회 | PASS | `turn_end(interrupted)` 정확히 1개, 프로세스 사라짐, 이후 for-await 종료 | — |
| 6-e | codex: 3MB `agent_message`, `interrupt()`×2(턴 없음/있음), `close()`×2 | PASS | 3MB text 수신, exit 이벤트 1개, 큐 종료, send 는 throw, 자식 없음 | — |
| 6-f | `pickAvailable` with `PATH=/nonexistent` (HOME 비움) | PASS(정보) | `null`. 단 `findBin` fallback 이 `/opt/homebrew/bin/codex` 를 찾아 `installed:true, auth:'missing'` 로 보고(설계상 Finder 실행 대비). HOME 이 비면 codex 는 `Not logged in` | — |
| 7-a | 헤드리스 캡처: 샘플 × 6 NAV, 빈 프로젝트 × 6 NAV | PASS | `/tmp/qa-cap-qa-{sample,empty}-{소스,에셋,샷_분해,콘티,레이아웃,게시}.png` 12장. 오버플로·빈 패널·한글 클리핑 없음. 빈 프로젝트는 `시퀀스 없음`/EmptyState 가 정상. 레이아웃·게시는 `ComingSoon` | — |
| 7-b | recent.json 에 사라진 폴더 | PASS(개선) | `userData=~/Library/Application Support/@conti/studio/recent.json`. 가짜 항목 넣고 StartScreen 캡처(`/tmp/qa-cap-start.png`) — 목록에 표시, 크래시 없음. 열면 기존엔 `ENOENT: no such file…` 원문이 떴음 | `store.ts:42` `프로젝트 폴더가 없거나 config.md 가 없습니다: <경로>` 로. recent.json 원복 확인 |
| 7-c | AGENTS.md 생성물 | **FAIL → 수정** | 생성된 `AGENTS.md` 첫 8줄이 Handlebars 주석 `{{!-- … --}}` 그대로, `생성: {{generatedAt}}` · `종류: {{project.type}}` 미치환 | `agent-host.ts:80-84` 주석 제거·두 자리 치환 |
| 8-a | 실 AI E2E 1: `shots_update` 로 0020 → MS | PASS | `/tmp/qa-e2e.json`: user → assistant → **tool 카드 `mcp__conti__shots_update` ok** `{"ok":true,"rev":2,"shotNo":"0020"}` → assistant → usage(in 34 / out 194 / cache 21,750 / 5h 33%) → turn_end. `S41.json` 0020 CU→MS, rev 1→2; `shotlist_S41.md` 9행 `CU`→`MS`. 캡처 `/tmp/qa2.png` 에 말풍선·도구 카드·사용량 표시 | — |
| 8-b | 실 AI E2E 2: 스킬 읽고 대사 줄 수만 | PASS | `/tmp/qa-e2e2.json`: `Skill` tool_start 1회(`Launching skill: conti:conti-breakdown`) → `scene_get` → 답 "S41 대사 줄은 4줄입니다 … 분해는 제출하지 않았습니다"(정답 4). `shots_propose_breakdown` 호출 0, `S41.json` 바이트 동일. 캡처 `/tmp/qa3.png` | 샘플 생성기에 `sourceId/textHash` 를 넣어 `scene_get` 이 동작하게 함(이전 샘플은 `원문(source)이 없습니다` 오류) |
| 9 | 종료 위생 | PASS | 15회 electron 실행(캡처 13 + E2E 2) 뒤 `pgrep -fl "claude -p\|codex exec\|Desktop/build/…/electron"` 에 앱 유래 프로세스 0. (pid 80529–80532 Electron 4개는 세션 시작 **전부터** 있던 사용자 측 프로세스, ChatGPT.app 의 codex 들도 무관) | — |

## 2. 수정 목록

| 파일:줄 | 내용 |
|---|---|
| `packages/core/src/watcher.ts:39` | chokidar 5 글롭 미지원 → 루트 depth 4 감시 + `ignored` 로 뷰 파일만 (shotlist 외부 수정 감지 복구) |
| `packages/core/src/watcher.ts:11` | `isViewRel()` 추가, `check()` 도 뷰 파일 아니면 무시 |
| `packages/core/src/watcher.ts:95` | 파싱 전 NFC 정규화(해시 비교는 원문) |
| `packages/core/src/watcher.ts:131-145` | 셀 비교를 `mdCell` 규칙으로(`\|`·줄바꿈 오탐 제거), `sizeOf()` 로 샷사이즈 검증 — accept 에서 zod throw 방지 |
| `packages/core/src/watcher.ts` (config/projectprompt diff) | 제목·앵커 비교를 한 줄 정규화 뒤에 |
| `packages/core/src/md/shotlist.ts:20,55-62` | `mdCell` export, 인물·장소·소품·헤딩에도 적용 |
| `packages/core/src/md/config.ts:11` | 제목 줄바꿈 → 공백 |
| `packages/core/src/md/projectprompt.ts:9,42` | `mdLine` export(앵커 값·제목 한 줄), 파서 `\s*`→`[ \t]*`(빈 값이 다음 줄을 먹던 버그) |
| `packages/core/src/store.ts:42` | config.md 없는 폴더 열기 → 한국어 오류 |
| `packages/mcp/src/specs.ts:57-80` | `index.json` 두 형태 수용 + sha256/줄 범위 검사 후 사용 |
| `packages/mcp/src/breakdown.ts:10-11` | `ShotDraft` 에 `fovDeg`·`durationSec` |
| `packages/mcp/src/server.ts:59` | 4xx/5xx 응답에 `connection: close` |
| `apps/studio/src/main/ipc.ts:199` | `assets:list` 가 `Asset[]` 반환 |
| `apps/studio/src/main/agent-host.ts:80-84` | AGENTS.md 템플릿 주석 제거, `generatedAt`·`project.type` 치환 |
| `apps/studio/src/renderer/src/components/ShotTable.tsx:46` | 샷 선택 키를 `no` 로 통일 |
| `package.json:7-11` | `pnpm` → `corepack pnpm` |
| `tools/make-sample-project.mts` | 소스 파일 복사 + `sourceId/textHash/sourceLines/lineN` + 에셋 1개 (MCP `scene_get`·에셋 화면 검증 가능) |
| `packages/core/src/core.test.ts` | 테스트 3개: 셀 이스케이프, 빈 앵커 파싱, NFD/잘못된 사이즈 accept, chokidar 실감지 |
| `packages/mcp/src/mcp.test.ts` | 테스트: index.json 객체 형태/해시 불일치 fallback, `fovDeg/durationSec` 보존 |

## 3. 미수정 버그·제한 (심각도순)

| 심각도 | 항목 | 재현 | 비고 |
|---|---|---|---|
| 중 | **`shots_update` 가 stale 을 표시하지 않음** | 콘티 버전이 있는 샷에 `shots_update{sizeCode}` → `stages.conti.status` 그대로. E2E 1 에서 모델이 "재생성 필요(stale)로 표시된다" 고 **사실과 다르게** 답함(`studio.md` 규칙을 보고 추정) | 플랜 §5-2 "코드가 inputHash 로 판정" 은 M3 범위. 그때까지 `shots_update` 설명에 "stale 표시는 안 함" 을 적거나, `prompts_set` 처럼 `currentVersionId` 가 있으면 stale 로 바꾸는 게 맞음 |
| 중 | 텍스트 입력에서 본문 열거 `3. 어쩌구`(들여쓰기 0, 꼬리 없음) 가 씬으로 분리됨 | `qa-screenplay.mts` 4번: `41 / 3 / 42` | `split.ts confirm()` 의 텍스트 모드 규칙. 좌표 있는 PDF 는 영향 없음. 가져오기 UI 에서 체크 해제로 합칠 수 있음 |
| 하 | `views.json` 읽기-수정-쓰기 레이스 | `writeView()` 가 파일을 읽고 쓰는 사이 다른 뷰 쓰기가 끼면 항목 유실 가능(이번 병렬 테스트에선 재현 안 됨) | 유실돼도 `diff()` 가 차이 없음 → 대기 항목 없음이라 체감 영향 작음. 메모리 캐시 + 직렬화로 고치면 됨 |
| 하 | 사용자가 shotlist 셀 안에 `\|` 를 직접 치면 열이 밀림 | 3-b | markdown 표 한계. 전각 `｜` 안내를 shotlist 머리말에 추가 권장 |
| 하 | `seqIdFromSceneNumber`: `"4-1"→S04_1` vs `"4.1"→S04_01` 패딩 불일치, `"04"`/`"4"` 충돌 | 4-e | 현재 대본들엔 영향 없음 |
| 하 | `matchHeading('S#41')`(제목 없음) → null | `S\s*#?\s*(\d+)…\s+(.*?)` 가 공백 하나를 요구 | 제목 없는 헤딩은 드묾 |
| 하 | `findBin` fallback 이 PATH 에 없는 CLI 도 `/opt/homebrew/bin` 등에서 찾음 | 6-f | 의도된 설계(Finder 실행). 진단 화면의 "경로" 가 사용자의 셸 PATH 와 다를 수 있음을 알아둘 것 |
| 하 | `ChatPanel`: `text` 이벤트 없이 `error` 로 끝난 스트리밍 말풍선은 `streaming` 커서가 남음 | `turn_end` 에서만 `streaming:false` 로 정리. error 뒤엔 보통 turn_end 가 따라오므로 드묾 | `error` 분기에서도 정리하면 됨 |
| 정보 | `LineSplitter.push` 는 개행 없는 매우 긴 줄(수십 MB)에서 O(n²) | 6-b 2MB 는 633ms 로 문제 없음 | 검색 시작 위치를 기억하면 해결 |
| 정보 | `AgentHost.runTask` 가 `pickAvailable('claude') ?? pickAvailable('codex')` 로 detect 를 두 번(최대 `auth status` 15초×2) | — | `pickAvailable` 이 이미 fallback 함 |

## 4. 다음 마일스톤 전 권고

1. **M1 완료 기준 재확인**: "md 외부 수정 감지" 가 shotlist 에 대해서는 이번 수정 전까지 동작하지 않았다. 감시는 실제 chokidar 경로로 테스트(이번에 추가한 `start()` 테스트)를 유지하고, chokidar 메이저 업그레이드 시 글롭/`ignored` 시그니처를 다시 본다.
2. **M3 전 stale 규칙을 코드에**: `shots_update`·`sequence_update` 가 `inputHash` 를 다시 계산해 stale 을 찍게 하고, 도구 설명을 실제 동작과 맞춘다(모델이 추정으로 답하는 걸 막는다).
3. **`specs/index.json` 를 빌드 단계에 포함**: `tools/build-spec-index.mts` 를 `build` 스크립트 앞에 두고, 원문 변경 시 해시 불일치로 fallback 되는 상황을 CI 에서 실패시킨다.
4. **샘플 프로젝트를 테스트 픽스처로 승격**: 이제 `make-sample-project.mts` 가 `source`·에셋까지 채우므로, E2E 스모크(`CONTI_E2E_*`)를 반복 가능한 스크립트로 묶어 M3 JobService 붙일 때 회귀 확인에 쓴다. 비용: 실 AI 2턴 ≈ in 68 / out 435 토큰(캐시 60k).
5. **md 뷰 규칙 문서화**: 셀의 `\|` → `｜`, 줄바꿈 → 공백, 샷사이즈는 enum 10개(대문자), NFD 는 자동 정규화 — shotlist 머리말 두 번째 줄에 한 줄 추가하면 터미널 Claude 가 지킨다.
6. **동시성**: 현재 단일 프로세스 안에서는 유실이 없지만, M3 에서 JobService 가 다른 프로세스/워커에서 `.conti` 를 쓰기 시작하면 `.conti/lock`(플랜 §1 디스크 트리) 이 실제로 필요하다. `views.json` 도 그때 메모리 캐시+직렬 쓰기로 바꾼다.

---

# M3 생성 — 구현·QA 기록 (2026-10-10)

범위: `packages/genengine`(JobService·Higgsfield CLI 래퍼·업로드 캐시·다운로더·프롬프트 조립/린트·모델 표·플래너), MCP 유료 도구 연결,
AgentHost 승인→생성, 렌더러(승인 카드 진행·미리보기, 타임라인/시트/플레이어 이미지, 버전 바, 샷 표·에셋 화면 생성 버튼).
**실제 크레딧 소비 0** — 생성 흐름은 가짜 CLI(`packages/genengine/test/fake-higgsfield.mjs` + `tools/fake-result-server.mjs`)로,
파라미터 조합은 실제 `higgsfield generate cost`(무료 드라이런, `tools/cost-check.mts`)로 검증했다.

최종 상태: `tsc` 0 오류 / `vitest` **91/91** (genengine 24 신규) / `corepack pnpm build` 성공 / 원문 규격 해시 3/3 일치 / 앱 유래 잔존 프로세스 0.

## 5. M3 매트릭스

| # | 항목 | 결과 | 증거 |
|---|---|---|---|
| 5-a | 모델 표: 단축명·정규 id·모델별 품질 플래그(`models.py image_flags` 이식)·21:9 클램프·Soul ID·레퍼런스 상한 | PASS | 유닛 3건. `gpt_image_2` 21:9 허용(M0 교정) 반영 |
| 5-b | **실제 서버 드라이런**: 플래너가 내는 6개 모델·파라미터 조합 (`gpt_image_2_5 16:9 high 2k`, `text2image_soul_v2 16:9 2k`, `nano_banana_2 3:4 2k`, `soul_cinematic 21:9 2k`, `gpt_image_2_5` 뷰변경, `nano_banana_2 1:1 2k`) | PASS | `generate cost` 전부 exit 0. 잔액 0.81 → 0.81 (소비 0). 참고 단가: 콘티 1장(gpt 2.5 high/2k) **2.75**, 시트(soul) 0.12, NBP 2 |
| 5-c | CLI 래퍼: `--json --no-color`, 프롬프트 stdin, 플래그 반복(`--image-references a --image-references b`), 종료코드 3/4 분류(한국어 메시지 매칭 없음), 진행 표시 섞인 stdout 파싱 | PASS | 유닛 4건 + 가짜 CLI 실행 |
| 5-d | 승인 → 업로드(캐시) → `generate create`(wait 없이) → 폴링 → 다운로드 → `{SEQ}_{SHOT}_v{N}.png` → Version → `stages.conti=review`+`inputHash`+shotlist 갱신 | PASS | 유닛(2샷, 레퍼런스 1장 공유 시 업로드 1회) + **앱 E2E** `CONTI_E2E_GEN=S41`: 3샷 done, 1280×720, 카드 "완료 3/3", 타임라인·시트·플레이어에 이미지 (`design/app-layout/build_v3_generation.png`) |
| 5-e | 에셋 체인: char 시트(soul) → front/back/face(NBP, 시트 결과를 레퍼런스) / loc wide → 34·top·detail / prop 3뷰 독립 / 정본 있으면 재사용·없으면 끼워 넣기 / Soul ID → `custom_reference_id` | PASS | 유닛 2건 + 앱 E2E `CONTI_E2E_KIND=assets`: 4장 done, `upload create` 1회, `nano_banana_2 … --image-references` 3회, 에셋 화면 썸네일 (`build_v3_assets.png`) |
| 5-f | 파일럿: "1장만 먼저" → 1장 생성 → **후속 카드 "N장 추가 생성 (파일럿 뒤 나머지)"** 자동 (승인 전까지 대기) | PASS | 앱 E2E `CONTI_E2E_DECISION=pilot` (4샷 요청 → 1 done, followUp count 3, `build_v3_pilot_card.png`) |
| 5-g | 앞뒤 컷 포함 체크 → 대상 확장(순서 유지·중복 제거), 파일럿이면 확장 뒤 첫 컷만 | PASS | 유닛 (`['0030']` → `0020,0030,0040`) |
| 5-h | **크래시 복구**: 생성 중 앱 종료 → 재시작 → 기록된 원격 id 로 폴링 재개·다운로드 (재제출 없음) / `submitting` 중 죽음 → `generate list` 의 `params.prompt` 로 대조해 id 회수 / 제출 전 `queued` → 재실행 / 대조 실패 → `unknown` + "크레딧 확인" 안내 + [다시] 재제출 | PASS | 유닛 2건 + 앱 E2E 2단계 (`FAKE_HF_POLLS=1000` 로 running 상태에서 종료 → 재시작 `CONTI_E2E_N=0`: 2건 done, `generate create` 총 2회) |
| 5-i | 실패 경로: 서버 거절(exit 4) → failed + **자동 재시도 없음**(create 1회) / 원격 status failed → failed + 샷 stage failed / 정본 실패 시 파생은 건너뜀 | PASS | 유닛 |
| 5-j | 하루 장수 상한(`project.defaults.dailyCap`) — 제출 전에 막힘, 기록 0 | PASS | 유닛 |
| 5-k | 레거시 파일(`_v1`,`_v2` 가 디스크에만 있음) 덮어쓰지 않음 → `_v3` | PASS | 유닛 |
| 5-l | 증분 재생성: `shots_update`/`prompts_set` 시각 필드 변경 → stale(M2) + **에셋 외형 변경 → 그 에셋이 나오는 콘티 전부 stale**(`assets_upsert` → `markStaleByAsset`) | PASS | 유닛 (2샷 stale, 재호출 0) |
| 5-m | 프롬프트 조립: 스타일 문장은 project.style 만 / 슬롯 비면 한국어 폴백 + 린트 경고 / 레퍼런스는 번호로만(본문에 한글 이름·외형 프로즈 없음) / 대사 컷은 화자 수로 인원 / 화면비·해상도 본문 금지 | PASS | 유닛 3건. 시트 프롬프트에 `character reference sheet`·`painterly`·`rule of thirds` 없음 |
| 5-n | 린트: 감정어·브랜드·전환 동사·플랫폼 파라미터·키워드 스택·막연한 근접어·부정문 과다·렌즈 수치·길이·한글 | PASS | 유닛 2건 |
| 5-o | MCP: `jobs_wait` 가 승인 뒤 작업 완료까지 롱폴 + `jobs[]`·`progress` / `image_view{seq,shotNo}` / `image_edit`·`panel_restyle` 은 현재 이미지 필수 / `assets_generate` 장수 = 종류별 뷰 수 | PASS | mcp 테스트 18/18 (1건 갱신) |
| 5-p | 렌더러: `conti-file://project/…` 프로토콜(루트 밖 403, CSP img-src 추가) / 승인 카드 진행바·작업 목록·[다시] / "모델·프롬프트 보기" 미리보기(무료, 크레딧 없음) / 샷 표 [콘티 생성]·[필요한 컷만]·행별 재생성 / 버전 바(버전 전환은 크레딧 0) | PASS(캡처) | `build_v3_*.png` 4장. 버전 바는 컷 선택 시 표시 |
| 5-q | 종료 위생 | PASS | E2E 6회 뒤 앱 유래 프로세스 0 (pgrep 에 잡히는 Electron 4개는 QA §1-9 와 같은 사용자 측 기존 프로세스) |

## 6. M3 에서 고친 것 (구현 중 발견)

1. `AssetKind`·`VersionSource` 가 값만 export 돼 타입으로 못 씀 → `z.infer` 타입 추가 (`packages/domain/src/schemas.ts`).
2. 프롬프트 본문에 `nameKo`(한글)가 들어가던 것 → 레퍼런스 번호/영문 앵커로만 가리키고, 이름 없을 때만 한글 폴백 + 경고.
3. 린트 부정문 카운트가 `Set` 으로 중복 제거돼 `no hat, no scarf, no gloves` 를 못 잡던 것 → 출현 횟수로.
4. 영상 모델 `refs:false` 인데 `max_images` 가 있으면 0 을 돌려주던 것 → `max_images` 우선.
5. 태그 없는 대사 컷이 "empty frame" 으로 조립되던 것 → 화자 수로 인원 산정.
6. UI 에서 만든 에셋 요청 카드의 장수가 에셋 수로 나오던 것 → MCP 와 같은 규칙(종류별 뷰 수).
7. 샷 표 선택 키 `id`→`no` 통일(M2 QA) 뒤 남아 있던 `SheetPreview` 6컷 고정 → 선택 컷이 든 페이지로 넘김.

## 7. 미수정·제한 (M3)

| 심각도 | 항목 | 비고 |
|---|---|---|
| 중 | **실제 `generate create --json`(wait 없이)의 응답 형태는 미검증** — M0 에서 호출한 적이 없다(크레딧 0). 래퍼는 `{id,status}` 객체·배열·진행 표시 섞인 stdout 을 모두 받게 했고, 응답에 id 가 없으면 `submitting` 으로 남겨 재시작 시 `generate list` 로 대조한다 | 크레딧 충전 후 **저품질 1장**으로 확인 필요 (`tools/cost-check.mts` 에 create 1회를 붙이면 된다) |
| 중 | 콘티 단가가 높다: `gpt_image_2_5 --quality high --resolution 2k` = **2.75 크레딧/장** (드라이런 실측). 30샷 시퀀스 ≈ 82 크레딧, 파일럿 포함 재생성까지 고려하면 더 | 기본 품질을 `medium`/`1k` 로 낮추거나(GenConti 는 high/2k 가 기본) 프로젝트 설정 `defaults.quality` 로 조정. UI 에는 크레딧을 보이지 않기로 했으므로 설정 화면에서 품질 선택만 노출 권고 |
| 낮 | `conti-edit` 스킬이 부르는 `panels_update`·`panels_annotate`, `conti-setup` 의 `soulid_create` 는 **MCP 에 아직 없다** (allowed-tools 에만 있음). AI 가 부르면 도구 없음 오류 | 주석은 M4(레이아웃), Soul ID 는 크레딧 확보 뒤 |
| 낮 | 생성 중 샷을 삭제하면 완료 시 "샷이 사라졌습니다" 로 failed, 파일은 남는다 | 의도된 동작. 버전 기록엔 안 들어감 |
| 낮 | 샘플 프로젝트(`tools/make-sample-project.mts`)는 샷에 `characters` 태그가 없어 E2E 에서 시트가 레퍼런스로 붙지 않았다 | 유닛 테스트는 붙는 경로를 검증. 실제로는 AI 분해(conti-breakdown)가 태그를 채운다 |
| 낮 | 업로드 캐시는 서버 삭제를 모른다 (`upload list` 대조 미구현) | 서버가 id 를 거부하면 작업이 failed → [다시] 로 재업로드되진 않음 → `UploadCache.forget` 호출 경로 필요 |


---

# M4 레이아웃 v0 — 구현·QA 기록 (2026-10-10)

범위: `packages/layout`(템플릿 폴더 로더·Handlebars 렌더·LayoutDataBuilder·애니매틱 ffmpeg 인자·PNG 인코더), `templates/placeholder-a4-6up` + 번들 폰트(Pretendard 3종, OFL),
main `LayoutService`(미리보기 렌더, 숨은 창 PDF·2x PNG, ffmpeg 애니매틱 mp4, 출력 버전·재사용, 템플릿 감시·복제), `conti-file://font|tpl` 호스트(CORS),
렌더러(실제 템플릿 미리보기 iframe·패널 클릭 선택, 레이아웃 화면, Template Lab, 플레이어 재생·자막·주석 편집, 타임라인 길이 끌기), MCP `panels_annotate`·`panels_update`.

최종 상태: `tsc` 0 / `vitest` **101/101** (layout 8 + mcp 1 신규) / `build` OK / 원문 규격 해시 3/3.

## 8. M4 매트릭스

| # | 항목 | 결과 | 증거 |
|---|---|---|---|
| 8-a | 템플릿 로드·목록: `_fonts` 건너뜀, 깨진 template.json 은 오류로 표시(앱은 안 죽음), 같은 id 는 번들 우선 | PASS | 유닛 |
| 8-b | 빌더: 6칸 페이지·빈 칸 채움, 현재 버전(최신 아님) 우선, durationSec > 추정, 칩, 재생성 필요, 하위 패널 라벨, 기록엔 있으나 파일이 없으면 "v1 파일 없음" | PASS | 유닛 |
| 8-c | 렌더: 사용자 텍스트 이스케이프(`<b>` → `&lt;b&gt;`), 주석 SVG 는 그대로, 폰트 @font-face, `@page` 크기, 같은 내용이면 같은 키(날짜 무관) | PASS | 유닛 |
| 8-d | **PDF 한글**: 번들 Pretendard 로 출력, sips 로 PDF 1쪽 래스터화해 육안 확인 | PASS | 캡처 |
| 8-e | **완료 기준 — 30컷 PDF 30초 이내**: 30컷(이미지 30장) PDF 5쪽 **0.45초**, PNG 5장 0.9초, 애니매틱 110초 분량 mp4 1.6초 | PASS | `/tmp/conti-30` 측정 |
| 8-f | 출력 재사용: 내용이 같으면 새로 안 만듦(1ms) / 상태 표기만 바꿔도 새 버전 / **동시 2회 출력 → 버전 겹치지 않음**(시퀀스별 직렬화) | PASS | QA 훅 |
| 8-g | 애니매틱 길이: concat 마지막 반복 때문에 17.6초로 늘던 것 → `-t` 로 정확히 자름 | **FAIL → 수정** | ffprobe |
| 8-h | 프로토콜: `conti-file://project/../../etc/passwd` 403, 모르는 템플릿 404, 폰트 200 + `access-control-allow-origin: *` + `font/woff2` | PASS | QA 훅 (session.fetch) |
| 8-i | 타임라인 길이 끌기(실제 DOM 이벤트): 0010 오른쪽 끝 +120px → durationSec 미설정 → 5.5 → 8.1, 뒤 컷이 밀려서 다시 그려짐 | PASS | QA 훅 |
| 8-j | **주석 그리기**(실제 DOM 이벤트): 빠른 획이 state 갱신 전에 끝나 저장 안 되던 것 → ref 로 / 점 6개 이하 화살표가 점 1개로 저장되던 삼항 버그 → 수정. 수정 후 move 화살표 4점 저장, 플레이어·시트에 표시 | **FAIL → 수정 ×2** | QA 훅 + `build_v4_qa.png` |
| 8-k | 재생: Space → 1.2초 뒤 시간 표시 진행, 다시 Space 로 멈춤. 대사 자막 표시 | PASS | QA 훅 |
| 8-l | 미리보기 iframe: 실제 템플릿 7칸 렌더, 선택 컷 테두리·해당 페이지로 이동, 패널 클릭 → 샷 선택 | PASS | QA 훅 + 캡처 |
| 8-m | Template Lab: 복제 → style.css 수정 → `layout:changed` 1회 → 다음 렌더에 반영 | PASS | QA 훅 |
| 8-n | MCP `panels_annotate`(덧붙이기·교체·검증)·`panels_update`(제거·캡션), 주석은 stale 를 만들지 않음 | PASS | mcp 테스트 |
| 8-o | 라벨 외곽선이 확대 시 글자를 뭉갬 → 외곽선 0.55 로 | **FAIL → 수정** | 캡처 |

## 9. M4 미수정·제한

| 심각도 | 항목 | 비고 |
|---|---|---|
| 중 | **두 맥에서 동일 결과**는 이 맥에서만 확인 — 폰트를 번들해 차이 요인은 줄였지만 다른 기기 대조는 팀원 맥 설치(M7) 때 | |
| 낮 | 애니매틱 mp4 에 샷 번호·자막이 안 들어간다 (앱 안 재생에는 자막 있음). ffmpeg drawtext 는 TTF 가 필요한데 번들은 woff2 | 필요하면 Pretendard TTF 를 추가 |
| 낮 | 하위 패널(롱테이크 -1/-2)은 데이터 모양만 지원 — 실제 생성은 M5 영상 입력부터 | |
| 낮 | 템플릿은 로직 없는 Handlebars 라 페이지당 칸 수가 다른 혼합 레이아웃(첫 장 표지 등)은 `first`/`last` 플래그로만 | |
| 정보 | QA 가 사용자 데이터 폴더에 만든 템플릿 복제본 2개는 지웠고, 이후 QA 는 복제본을 스스로 지우고 Finder 를 열지 않는다 | |

---

# M5 영상 → 콘티 — 구현·QA 기록 (2026-10-10)

범위: `py/media`(Python 3.12 · uv 잠금 — 컷 후보 Content∪Adaptive, LK+RANSAC 컷 검증, 8fps 샘플(선명도·모션·pHash·Lab), 카메라 라벨·경로·끝 프레임, 롱테이크/그림 전환 패널 분할, 키프레임, 컨택트 시트·3프레임 스트립, faster-whisper 대사 인식),
`packages/media`(uv 부트스트랩·ffmpeg 프록시/키프레임·샷 병합(대사=독립 샷, 반응, 셋업 그룹, 카메라 주석)·AI 1·2차·단계 캐시·샷별 클립·대사 음성), `packages/agents` 1회성 구조화 호출(`runStructured`, Claude/Codex),
앱 `VideoService` + 소스 화면 "영상 가져오기"(4종, 진행 표시), 플레이어 원본 영상 재생, 버전 바·샷 표 "다시 그리기", 타임라인 확대·스크롤, 프로토콜 Range(206).
**Higgsfield 크레딧 소비 0.** 실제 AI 호출은 Claude 구조화 호출 6회(EP04 1·2차, EP04 재가져오기 3패널 1·2차, PRISM 1·2차).

최종 상태: `tsc` 0 / `vitest` **107/107** (media 6 신규, 9회 중 1회 간헐 실패 → 원인 후보 수정) / Python `unittest` 6/6 / `build` OK / 원문 규격 해시 3/3.

## 10. M5 매트릭스

| # | 항목 | 결과 | 증거 |
|---|---|---|---|
| 10-a | 합성 영상(컷 3 + 줌 + 팬): 컷 [3,6,8]초 정확, ZOOM IN·STATIC·PAN → 라벨, 긴 팬 → 패널 2개(view), 키프레임이 패널 안 | PASS | Python 테스트 + 시스템 3.9 / uv 3.12 결과 동일 |
| 10-b | **실영상 PRISM 92초**: 후보 83 → 컷 53 + 불확실 13 → 67샷·74패널. 프록시 2초, 측정 6.5초 | PASS | `/tmp/vtest/prism.json` |
| 10-c | 블러·빠른 피사체를 카메라 WHIP 으로 오판(15컷, 인라이어 3–20%) | **FAIL → 수정** | 인라이어 35% 미만은 카메라 이동으로 세지 않고 "카메라 확인" 표시 → WHIP 1, 불확실 24 |
| 10-d | 딥 투 블랙에서 검은 프레임이 키프레임·패널이 됨 | **FAIL → 수정** | 평균 L<6 프레임은 후보 제외, 전부 검은 패널은 이웃에 병합 |
| 10-e | 샷 병합: 대사 N줄 → 침묵 가운데서 N샷, 0.15초 미만 간격은 `tight_split`, 다른 컷으로 0.7초 넘친 대사 → `[반응]`, ASR 낮은 신뢰 `asr_low`, 셋업 그룹 G#, 카메라·피사체 화살표 주석 | PASS | media 유닛 |
| 10-f | 샷별 클립: 파일 번호(S02_0010_v1) 유지, 안쪽 컷은 0011·0012, 타임라인 오프셋, 재생용 프록시 연결 | PASS | media 통합(시스템 Python) |
| 10-g | 재실행 캐시: 같은 파일 → 프록시·측정·AI 전부 캐시(AI 호출 0), 덮어쓰기는 프레임 파일 번호를 밀어 씀(v1 보존) | PASS | media 통합 |
| 10-h | uv: 앱 데이터 폴더에 uv 0.13.0 내려받기(sha256 검증) → 관리형 CPython 3.12.15 → 잠금 환경(첫 준비 15초, 이후 즉시). 시스템에 아무것도 설치 안 함 | PASS | `~/Library/Application Support/@conti/studio/{tools,uv-python,py-env,uv-cache}` |
| 10-i | faster-whisper 1.2.1 이 PyAV 19 에서 `open(metadata_errors=)` 로 실패 | **FAIL → 수정** | asr extra 에 `av>=12,<14` 고정 → 실행 OK |
| 10-j | **대사 언어 강제의 함정**: EP04 는 일본어 대사인데 `ko` 강제 시 한국어로 "번역"해 버림(잠시만요!), 인물 이름 힌트가 들어가면 일본어로 되돌아가면서 언어는 `ko` 로 보고 | **FAIL → 수정** | 기본을 언어 자동 감지로(ja 0.979), UI 에 언어 선택, 언어별 캐시 |
| 10-k | **실제 Claude 1·2차 (EP04 27초)**: 12패널, 사이즈·앵글(OTS/high/low)·인물·상태형 지문·화자 채움, 2차 2패널. 입력 7,065 / 출력 2,734 토큰 | PASS | `build_v5_ep04_ai.png` |
| 10-l | **완료 기준 — 토큰**: PRISM 92초 74패널, 시트 4장 + 2차 14패널 스트립 4장 → 입력 **19,936** / 출력 10,777. 플랜 기준(3분·56패널) 환산 입력 ≈1.5만 ≤ 3만. AI 가 카메라 확인 28 → 17 로 정리 | PASS | `/tmp/conti-e2e-prism-ai.json` |
| 10-m | 부분 캐시: 대사 인식이 바뀐 뒤 재가져오기 → AI 는 바뀐 3패널만(8개 캐시) | PASS | QA 훅 |
| 10-n | **완료 기준 — 영상 → 이미지 콘티 PDF**: S10(92초) → 13쪽 PDF 5.8초, 2x PNG, 애니매틱 mp4. 원본 프레임·AI 지문·타임코드 | PASS | PDF 래스터 확인 |
| 10-o | **영상 탐색 안 됨**: `net.fetch(file://)` 가 Range 를 무시하고 200 → `<video>` 탐색 불가(컷 클릭해도 0초), 캡처에서 검은 화면 | **FAIL → 수정** | 프로토콜이 직접 206 + Content-Range 로 응답 → 9초 탐색·재생 진행 확인 |
| 10-p | 다시 그리기: 원본 프레임 컷에서 요청 → 레퍼런스 = 원본 프레임(이미 그린 버전이 현재여도 원본에서), 승인 카드에서 거절 → 생성 없음 | PASS | QA 훅 |
| 10-q | 타임라인 67컷 판독 불가(확대 자리만 있음), 좁은 컷에서 확인 배지가 번호를 가림 | **FAIL → 수정** | 확대 1–16×(버튼·⌘+휠, 커서 기준), 가로 스크롤 + 트랙 이름 고정, 선택 컷 따라가기, 폭 기준 번호·배지 축약 |
| 10-r | 전체 테스트 9회 중 1회 간헐 실패(재현 안 됨) | 원인 후보 수정 | 크래시 복구 테스트의 고정 800ms 대기 → 폴링 |

## 11. M5 미수정·제한

| 심각도 | 항목 | 비고 |
|---|---|---|
| 중 | 컷 정밀도/재현율을 **EDL 과 대조하지 못함** — 정답 EDL 이 있는 영상이 없다. 실영상은 시트 육안 확인만 | 편집본 EDL/FCPXML 을 주시면 측정 |
| 중 | 출력 토큰이 플랜 추정보다 많다(패널당 ≈145, 추정 134) — 한국어 지문이 길다 | 지문을 40자 안으로 줄이도록 프롬프트 조정 여지 |
| 낮 | 2차 분석은 3프레임 스트립만 — 플랜의 "1차 bbox 로 원본 크롭"은 안 함 | |
| 낮 | EDL/FCPXML 이 있으면 컷 탐지를 건너뛰는 지름길 미구현 | |
| 낮 | 무음 영상의 번인 자막 판독 미구현 | |
| 낮 | 다시 그리기·편집은 하위 패널(롱테이크 -2, -3)이 아니라 첫 패널만 | JobService 가 패널 0 에 버전을 쓴다 |
| 낮 | AI 인물 이름: 프로젝트 에셋 후보가 있으면 무관한 인물에도 그 태그를 붙이는 경우(EP04 에 샘플의 @해수) | 사용자가 표에서 고치면 됨 |
| 정보 | 음성 모델 1.5GB·파이썬 환경 0.3GB 가 앱 데이터 폴더에 생긴다. 패키징(M7)에서 uv 를 번들 | |

---

# M6 뷰어·게시·피드백 — 구현·QA 기록 (2026-10-10)

범위: `apps/viewer` — node:http + node:sqlite 서버(의존성 0: 해시 주소 이어올리기, 게시본·토큰 링크·닫기/기간, 코멘트(패널·영역·영상 시각·전체)·판정, 변경 커서, Range 서빙, Dropbox 보관(upload / upload_session, 리프레시 토큰, 임시 링크 폴백)) + React 리뷰어 웹(시트 클릭·영역 끌기, 컷 격자, 영상 + EDL 띠·시각 코멘트, 코멘트 목록·해결·"vN에서 반영됨", 승인/수정 요청, 최신본 알림) + Dockerfile/compose.
스튜디오 — `LayoutService.exportBundle`(2x 페이지 PNG + 칸 위치, PDF, 컷 JPEG, 영상 프록시 + EDL + 실제 fps), `PublishService`(서버 기준 판 번호, 이어올리기·재시도, 토큰 키체인 암호화, 60초 피드백 폴링·인박스, 반영함 = 다음 게시 때 회신 / 반영 안 함 = 즉시), MCP `feedback_list`·`feedback_update`(스킬 계약, 코멘트 = 외부 입력 표시), 게시 화면, 설정 › 게시 서버, AI로 반영(feedback-apply 스킬, 코멘트 본문은 프롬프트가 아니라 도구로).

최종 상태: `tsc` 0 / `vitest` **114/114** (viewer 6 + mcp 1 신규) / Python 6/6 / 스튜디오·뷰어 빌드 OK / 원문 규격 해시 3/3. 검증 E2E 는 별도 앱 데이터 폴더(`CONTI_USER_DATA`)로 돌려 실제 설정을 건드리지 않았다.

## 12. M6 매트릭스

| # | 항목 | 결과 | 증거 |
|---|---|---|---|
| 12-a | 인증: 상태 확인은 공개, 스튜디오 API 는 팀 토큰(상수 시간 비교) | PASS | viewer 테스트 |
| 12-b | 이어올리기: HEAD 가 받은 크기(206 + x-received), 오프셋 어긋나면 409 + 현재 크기, 다 받으면 sha256 검증(불일치면 버림) | PASS | viewer 테스트 |
| 12-c | 게시: 안 올라온 파일이 있으면 409 + 목록, `../` 경로 거부, 판 번호는 서버가 시퀀스별로 | PASS | viewer 테스트 |
| 12-d | Dropbox 보관(가짜 Dropbox): 작은 파일 `/files/upload`, 큰 파일 start → append_v2 → finish(오프셋 4000), 경로 `/NYX/{코드}/{시퀀스}/{vN}/…`, 한글 경로는 `Dropbox-API-Arg` 에서 \uXXXX | PASS | viewer 테스트. **실제 Dropbox 계정으로는 미검증** |
| 12-e | 리뷰어: 데이터에 파일 해시 없음, 파일 Range 206, 번들 밖 경로 404, 영역 코멘트 → 칸 매핑, 시각 코멘트 → EDL 샷 + 프레임, 없는 샷 번호는 버림, 판정 | PASS | viewer 테스트 |
| 12-f | 피드백 루프 API: 커서로 새 코멘트, 반영 회신 → 커서에 다시 나옴, v2 링크에서 v1 코멘트가 "v2에서 반영됨", 링크 닫기 → 410 (다른 판은 열림) | PASS | viewer 테스트 |
| 12-g | **완료 기준 E2E** (실제 서버 프로세스 + 앱 + 별도 브라우저 창): 게시 v2(6파일 1MB 0.7초) → 리뷰어가 시트의 0030 칸 클릭·코멘트 → 스튜디오가 가져옴(0030 매핑) → 0030 MS→MCU 반영 표시 → v3 게시 → 서버 resolvedIn=v3 → 리뷰어 화면 "v3에서 반영됨 — 0030 → 바스트(MCU)", 시트 칩 MCU | PASS | `qa6_reviewer_v1.png`, `qa6_reviewer_v2.png` |
| 12-h | 리뷰어 칸 클릭이 코멘트 창을 못 엶 — 누른 위치를 state 에 두어 빠른 누름·뗌에서 사라짐(주석 편집과 같은 유형) | **FAIL → 수정** | ref 로 바꾼 뒤 E2E 통과 |
| 12-i | 영상 게시: S11(27초) 15파일 56MB 2.4초, EDL 9샷, 17.9초 코멘트 → 0050 · 430f, 영상 Range 206 | PASS | E2E |
| 12-j | MCP `feedback_list`(open 에서 판정 제외, 외부 입력 표시, tc 변환)·`feedback_update`(반영 안 함은 이유 필수), 서버 미설정이면 안내 오류 | PASS | mcp 테스트 |
| 12-k | 게시 화면·설정 › 게시 서버(연결 확인: 토큰 틀림 / 서버 없음 구분) | PASS(캡처) | `build_v6_publish.png` |

## 13. M6 미수정·제한

| 심각도 | 항목 | 비고 |
|---|---|---|
| 중 | **Docker 빌드 미검증** — 이 맥에 Docker 가 없다. 같은 서버 번들(`dist/server.mjs`)을 node 로 직접 띄워 E2E 했다 | 사내 서버에서 `docker compose up` 한 번 확인 필요 |
| 중 | **실제 Dropbox 계정 미검증** — 가짜 Dropbox 로 API 순서·경로만 확인 | 서비스 계정 토큰을 받으면 게시 1회로 확인 |
| 중 | 판마다 페이지 PNG·PDF 는 머리말의 판 번호가 달라 매번 새로 올라간다(컷 JPEG·영상만 재사용). 영상이 있는 시퀀스는 PDF 가 크다(EP04 56MB, 대부분 원본 해상도 프레임이 든 PDF) | PDF 에 넣는 이미지 해상도 상한 검토 |
| 낮 | 스튜디오 쪽 "중간에 끊긴 업로드 이어서"는 서버 테스트로만 검증(HEAD 206 → 이어서 PUT 경로를 실제로 끊어 보진 않음) | |
| 낮 | 리뷰어는 이름만 입력(인증 없음) — 사내망 전제. 서버 앞에 사내 SSO 프록시를 두면 됨 | 플랜 §10 미룬 것 |
| 낮 | AI로 반영은 채팅 스레드를 열어 feedback-apply 로 넘긴다 — 실제 AI 턴은 E2E 에서 돌리지 않았다(스킬이 변경안 표에서 사용자 확인을 기다리는 구조) | 반영 단계는 같은 결과(샷 수정 + applied)로 대체 검증 |

---

# M7 마무리 — 구현·QA 기록 (2026-10-10)

범위: 앱 이름 NYX(데이터 폴더 `~/Library/Application Support/NYX`, 예전 개발 폴더는 옮기지 않고 그대로 사용), 한 대 한 실행(검증 실행 제외), 메인 로그(`logs/main.log`, 토큰 가림, 5MB 회전),
첫 실행 안내(환영 → AI 계정 로그인 → ffmpeg·분석 도구 → 게시 서버 → 시작), 새 버전 알림(사내 뷰어 서버 `GET /api/app/latest` → 상단 배너 → 내려받기), 진단 내보내기(zip: 버전·도구·로그인 상태(이메일 가림)·프로젝트 요약·미완료 작업·로그, 토큰·프롬프트 없음),
뷰어 서버 배포 호스팅(`PUT /api/admin/releases/*`, `/releases/*`)·매일 DB 백업(`VACUUM INTO`, 14개, Dropbox `_backups`), `tools/package-mac.mts`(스테이징 → electron-builder --dir → ad-hoc 서명 → hdiutil dmg → 선택적 사내 배포).

최종 상태: `tsc` 0 / `vitest` **115/115** (viewer 7) / Python 6/6 / 빌드 OK / 원문 규격 해시 3/3 / `NYX-0.1.0-arm64.dmg` 160MB(앱 341MB), 마운트·서명 검증 OK.

## 14. M7 매트릭스

| # | 항목 | 결과 | 증거 |
|---|---|---|---|
| 14-a | 패키징: 실행 시 require 되는 모듈(handlebars·cross-spawn·ajv·ajv-formats)만 스테이징 → asar 에 12개 모듈, 리소스 agent-bundle·templates(+폰트)·py/media(+uv.lock)·bin/uv | PASS | asar 목록·Resources |
| 14-b | electron-builder 설치가 Electron 을 새 스토어 경로로 다시 연결하며 바이너리가 빠짐(`pnpm dev` 도 깨짐) | **FAIL → 수정** | 같은 버전 바이너리를 ditto 로 복사(재다운로드 없음) |
| 14-c | `pnpm exec` 아래에서 electron-builder 가 `pnpm list` 를 부르다 실패 | **FAIL → 수정** | pnpm 환경변수를 지운 환경으로 실행 |
| 14-d | **패키징 앱 스모크**(새 데이터 폴더 = 팀원 첫 실행): 레이아웃 출력(번들 템플릿 해시가 개발본과 같아 재사용), 영상 가져오기 — 번들 uv 가 Python 3.12·환경을 새로 만들고 측정(35초, 대부분 첫 준비) | PASS | `/tmp/nyx-pkg-*.json` |
| 14-e | 첫 준비 30초가 "측정 0%"로 보임 | **FAIL → 수정** | 가상환경이 없으면 "분석 도구 준비" 단계로 알림 |
| 14-f | 첫 실행 안내 화면(패키징 앱) | PASS | `build_v7_onboarding.png` |
| 14-g | 새 버전 알림: 서버에 0.2.0 등록 → 앱(0.1.0)이 확인 → 배너 + 내려받기 URL | PASS | `build_v7_update.png` |
| 14-h | 진단 zip: diagnostics.json + main.log, 게시 토큰 0건, 이메일 전체 0건(가림) | PASS | 압축 해제 확인 |
| 14-i | 진단의 uv "없음" 오표시(앱이 번들·앱 데이터에 가진 uv 를 못 봄) | **FAIL → 수정** | 번들 → 앱 데이터 → PATH 순으로 확인 + 분석 환경 준비 여부 |
| 14-j | 검증이 사용자 바탕화면에 진단 zip 을 쓰고 Finder 를 여는 문제(검증 설계 실수) | 수정 | 대상 폴더 인자, 검증은 /tmp |
| 14-k | 뷰어: 배포 파일 올리기(토큰 필요)·최신 등록(파일 없으면 409)·내려받기, DB 백업(14개 보관, Dropbox `_backups`, 백업이 열리는 SQLite) | PASS | viewer 테스트 |
| 14-l | dmg: NYX.app + Applications 링크 + "처음 설치할 때 읽어 주세요.txt", ad-hoc 서명 검증 | PASS | hdiutil attach |

## 15. M7 미수정·제한

| 심각도 | 항목 | 비고 |
|---|---|---|
| 중 | **Developer ID 서명·공증 없음** → 팀원은 처음 한 번 "우클릭 → 열기"(dmg 안내문에 적음). macOS 자동 설치(Squirrel)는 서명이 필요해 쓰지 않고 "새 버전 알림 → 내려받기"로 대신 | 인증서가 생기면 `tools/package-mac.mts` 의 identity·공증만 바꾸면 된다 |
| 중 | **다른 맥 설치는 미검증** — 이 맥에서 새 데이터 폴더로 첫 실행을 흉내냈다. 시스템 도구(claude/codex/higgsfield CLI, ffmpeg)가 없는 맥에서의 안내 흐름은 화면으로만 확인 | 팀원 맥 1대에서 dmg 설치 → 한 시퀀스 완성(플랜 완료 기준) |
| 낮 | Apple Silicon(arm64) dmg 만 — Intel 맥용은 `--x64` 로 다시 패키징 | |
| 낮 | 앱 아이콘이 기본 Electron 아이콘 | 디자인 받으면 `icon.icns` 추가 |
| 낮 | 진단의 claude 상세에 조직 id 가 남는다(이메일은 가림) | 사내 지원용이라 둠 |

---

# 출시 후 수정 (2026-10-11)

| 항목 | 원인 | 조치·검증 |
|---|---|---|
| **빌드된 앱에서 시나리오 PDF 가져오기 실패** — `Setting up fake worker failed: Cannot find module …/out/main/pdf.worker.mjs` | pdf.js 가 메인 번들에 묶이면서 옆에서 불러오는 `pdf.worker.mjs` 가 빌드 결과에 복사되지 않았다. PDF 테스트는 번들 전 코드(tsx)로만 돌았고, 빌드된 앱에서 실제 PDF 를 넣는 검증이 없었다(QA 공백) | `electron.vite.config.ts` 에서 빌드 때 worker 를 `out/main` 에 복사. 검증 훅 `CONTI_E2E_PDF` 로 **개발 빌드·패키징 앱 둘 다** 고래별 70씬·남벌 97씬 확인. pdf.js 의 `@napi-rs/canvas`·DOMMatrix 경고는 페이지 렌더링용이라 무시(텍스트 추출만 씀) |
| Sources 화면 제목이 "소스"로 남음 | 메뉴 이름 변경 때 화면 안 제목을 빠뜨림 | "Sources" 로 |
| **가져오기 표: 체크 해제가 "앞 씬에 합침"으로 동작** — "선택한 씬 70개 만들기"인데 S42~S48 을 끄면 그 본문이 S41 에 붙었다 | M1 때 씬 경계 조정을 체크 해제에 얹은 설계 실수. 사용자는 "고른 씬만 만든다"로 읽는다 | 체크 = 가져오기, 해제 = 제외. 합치기는 행마다 별도 ⤴ 토글(바로 앞 씬이 포함돼 있어야 켜짐). 전체 선택·전체 해제·반전, 머리 체크박스(일부 선택 표시), Shift+클릭 범위, SEQ 중복 경고, 0개면 버튼 비활성. 선택 → 커밋 변환은 `@conti/domain` `buildImportPicks`(유닛 5). E2E `CONTI_E2E_IMPORT`: 개발 빌드 고래별·패키징 앱 남벌에서 전체 해제 → 0/2/Shift+4 → 1 합치기 → 시퀀스 정확히 4개, 합친 씬 lineEnd 확장, 해제된 씬은 어디에도 안 붙음. 캡처 `build_v8_import_table.png` |
| **Conti 화면의 애니매틱 플레이어** — 이미지가 없는 단계에서 재생기는 쓸모가 적다는 사용자 의견 | — | Conti 왼쪽 위를 **컷 상세**로 교체: 선택 컷 크게 보기 + 주석 그리기 + 사이즈·앵글·카메라·길이·지문·대사 바로 수정, 컷 미선택이면 첫 컷 자동 선택. 영상 입력 시퀀스만 [컷 상세 / 원본 영상] 탭. 애니매틱은 **Conti Export › 애니매틱 미리보기** 탭으로(콘티 이미지를 컷 길이대로, Space 재생). 주석 그리기는 `AnnotatedFrame` 하나로 합침. QA4(주석·상세 수정 저장·Export 재생)·QA5(원본 영상 탭·Range·탐색·재생) 다시 통과. 캡처 `build_v8_conti_detail.png`·`build_v8_conti_video.png`·`build_v8_export_animatic.png` |
| **씬을 골라 만들면 가져오기 목록이 사라짐** — 나머지 씬을 다시 고를 수 없었다 | 커밋 뒤 표를 닫고 Shots 로 이동, 펼친 상태는 화면 메모리에만 있었다 | 표를 닫지 않고 같은 파일(`sources/` 사본)을 다시 읽어 **만든 씬(합친 씬 포함)은 ✓·"S41 만들어짐"** 으로 고정, 띠 "S01 외 3개를 만들었습니다 [Shots 에서 보기]". 이미 만든 씬이 있는 파일을 다시 펼치면 아무것도 체크하지 않는다(실수로 63개 생성 방지 — 첫 E2E 에서 발견). 표를 닫으면 "가져온 시나리오" 목록(만든 씬 6 / 70)에서 다시 펼치고, 다른 화면에 갔다 와도 마지막 파일이 다시 열린다. 새 IPC `screenplay:sources`·`screenplay:open`. E2E `CONTI_E2E_IMPORT` 확장: 개발 빌드(고래별)·패키징 앱(남벌) 모두 4개 → 표 유지·만든 행 5 → 화면 이동 후 재열림(체크 0) → 2개 추가 = 6. 캡처 `build_v9_import_kept.png` |
| **GPT 로 이미지를 못 만든다** — 앱 AI 가 "에셋 시트는 GPT 로 지정할 수 없다"고 멈춤 | 이미지 경로가 Higgsfield 하나뿐이고 에셋 모델이 고정(soul/soulcine/nano) | **GPT · Codex 엔진** 추가: 로그인한 Codex(ChatGPT)의 `image_gen` 으로 1장씩(`codex exec --json -s read-only`), 결과는 `~/.codex/generated_images/<thread>/` 에서 회수. 프롬프트·레퍼런스 체인(시트 → 파생 뷰)은 그대로, 레퍼런스는 `referenced_image_paths`. thread id 를 즉시 기록해 앱이 꺼져도 재시작 때 회수, 결과가 없으면 unknown(이중 사용 방지). 동시 2개. 프로젝트 기본값(설정 › 계정 › 이미지 생성 엔진)·**승인 카드의 엔진 전환**·MCP 유료 도구 `engine` 인자, 시스템 프롬프트에 "GPT 로 가능" 명시. 유닛 5(계획 변환·지시문·가짜 codex 체인·로그인/한도 오류·재시작 회수+동시 2). 앱 E2E(카드에서 GPT 클릭 → 승인 → 에셋 4장, 개발·패키징 둘 다). 캡처 `build_v9_card_engine.png`·`build_v9_gpt_assets.png` |
| **실제 Codex 이미지 생성 — 확인됨 (21:08)** | 사용자 요청으로 `codex login` 실행 → 브라우저 로그인 완료(`Logged in using ChatGPT`) | 실제 1장: 35초, `exec --json` 엔 이미지 항목이 없고 thread 폴더에 png → 앱의 폴더 회수 방식으로 동작. 16:9 요청이 1536×1024(3:2)로 나옴(표시엔 문제없음). `spikes/codex/REPORT.md` |
| **에셋 카드 내용이 잘려 안 보임** — 설명 2줄·영문 앵커 1줄에서 잘림 | 카드가 요약용 line-clamp 만 있었다 | 이름 줄·앵커를 누르면 펼쳐 설명 전체 + 외형·카메라 앵커, 연기 마스터 프로필, Voice, 나오는 씬을 보여준다. 머리 줄 [모두 펼치기/접기], 접힌 상태는 마우스를 올리면 전체 툴팁. 사용자 프로젝트(고래별) 사본으로 캡처 `build_v10_assets_expanded.png` |
| **승인 카드에서 GPT 를 고를 수 없음** | Codex 로그아웃 상태라 GPT 버튼을 막았는데, 그 자리에서 로그인할 방법이 없었다(설정 › 계정에만 있음) | 카드와 설정 › 이미지 생성 엔진에 **[Codex 로그인]** — 설정의 로그인 흐름 그대로(`codex login` → 브라우저), 진행 중 표시·[로그인 창 다시 열기]·취소, 끝나면 GPT 가 바로 풀린다. 가짜 codex 에 로그인 흉내(`FAKE_CODEX_REQUIRE_LOGIN`). E2E: 로그아웃 → 카드에 GPT 비활성 + 로그인 버튼 → 클릭 → 로그인 완료 → GPT 선택 → 승인 → 4장 (개발·패키징). 캡처 `build_v10_card_codex_login.png`. **실제 로그인은 사용자 브라우저에서만 끝나므로 미실행** |
| **채팅이 답 없이 멈춤** ("의현,군산외곽,의현의 트럭만 어셋 이미지 만들어줘") | Claude 세션 기록에 사용자 메시지만 있고 응답·오류 없이 프로세스가 사라짐. 앱은 프로세스 종료를 로그에 남기지 않아 원인 불명 | 같은 문장을 고래별 사본으로 재현하면 정상(16초, 에셋 11장 승인 카드). 일시적 실패로 보고, 앞으로 원인을 알 수 있게 채팅 프로세스 오류·종료를 `main.log` 에 기록(진단 내보내기에 포함) |
| **에셋 이미지를 크게 볼 수 없음** — 썸네일을 누르면 오히려 그 뷰 재생성 요청이 떴다 | 썸네일 클릭이 생성 버튼이었다 | 썸네일 클릭 = **크게 보기**(`AssetViewer`): 뷰 탭·←/→ 전환, 버전 목록(↑/↓, 사용 중 표시), 이미지 클릭 실제 크기, Finder 에서 보기, Esc 닫기. 다시 생성은 뷰어 안의 버튼으로만(누르면 뷰어가 닫히고 채팅에 승인 카드). 사용자 프로젝트 사본(GPT 로 만든 의현·트럭)으로 개발·패키징 앱 캡처 `build_v11_asset_viewer.png` |
