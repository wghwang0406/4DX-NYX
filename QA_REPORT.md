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
