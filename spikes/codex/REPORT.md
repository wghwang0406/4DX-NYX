# M0 스파이크 — `codex` CLI(0.162.0) 임베딩 검증

- 환경: macOS, `codex-cli 0.162.0` (`/opt/homebrew/bin/codex` = node 셔임 → 네이티브 `…/vendor/aarch64-apple-darwin/bin/codex`), Node v22.22.3, ChatGPT 로그인.
- 모델 호출 총 11회. 원본 이벤트는 `samples/*.jsonl`, 콘솔 로그는 `samples/*.console.txt`.
- `~/.codex/config.toml`은 건드리지 않음. 전부 `-c key=value` / `--ignore-user-config`로 처리.

## Go / No-Go

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | HTTP MCP 서버를 `-c` 오버라이드로 붙이기 | **GO** (단, 승인 모드 필수) | `samples/t1-mcp-headers.jsonl`, `t1-mcp-bearer-ignore.jsonl`, `*.server.log` |
| 2 | `AGENTS.md` 픽업 + 절대경로 SKILL.md 읽기 | **GO** | `t2-agents.jsonl` — `CODENAME-ORCHID` / `HELLO-FROM-SKILL-7731`, `cat …/SKILL.md` 실행 확인 |
| 3 | 샌드박스 (read-only / workspace-write) | **GO** | `codex sandbox`(모델 없이) + `t3-sandbox-*.jsonl` |
| 4 | resume + 다른 cwd | **GO** (주의: resume에 `-C`/`-s` 없음) | `t4-resume.jsonl` — 같은 thread_id, `pwd`=프로세스 cwd |
| 5 | `--output-schema` | **GO** | `t5-schema.jsonl` + `samples/t5-last-message.json` |
| 6 | 인터럽트(고아 프로세스) | **GO — SIGINT만** (그룹 SIGTERM은 고아 남김) | `t6-interrupt.*`(실패), `t6b-interrupt.*`(성공) |
| 7 | usage 기준치 | 측정 완료 | 아래 표 |
| 8 | `login status` / `--version` | 확인 | 아래 |

## 권장 실행 인자 (앱에서 쓸 것)

```bash
CONTI_MCP_TOKEN=<랜덤토큰> codex exec \
  --json --skip-git-repo-check --ignore-user-config \
  -s workspace-write \           # 또는 read-only
  -C "<프로젝트 디렉터리>" \
  -c 'mcp_servers.conti.url="http://127.0.0.1:<PORT>/mcp"' \
  -c 'mcp_servers.conti.bearer_token_env_var="CONTI_MCP_TOKEN"' \
  -c 'mcp_servers.conti.default_tools_approval_mode="approve"' \
  -c 'mcp_servers.conti.startup_timeout_sec=20' \
  [--output-schema schema.json -o last.json] \
  -                              # 프롬프트는 stdin
```

- 이어가기: `codex exec resume <thread_id> --all --json --skip-git-repo-check [--ignore-user-config] -`
  - **resume에는 `-C`, `-s`가 없다** (`-s` 넣으면 `unexpected argument` exit 2). 작업 디렉터리는 **프로세스 cwd**로 정해진다 → `spawn(..., { cwd })`로 넘길 것. `--all`은 cwd 필터를 끄는 용도이며 없으면 다른 cwd에서 세션을 못 찾을 수 있다.
  - 샌드박스 모드는 세션에 저장된 값을 이어받는 것으로 보임(명시 불가).
- `--ignore-user-config`: 사용자 config.toml(플러그인·node_repl MCP·notify 훅)을 안 읽어 **기본 입력 토큰 16k**로 내려간다. auth는 그대로 `CODEX_HOME`을 쓴다. `-c` 오버라이드는 이 플래그와 함께 정상 동작(`t1-mcp-bearer-ignore`).
- `--ephemeral`: 세션 파일을 안 남기므로 resume이 필요한 흐름에는 쓰지 말 것.

## MCP 설정 키 (바이너리 문자열 + 실측)

`mcp_servers.<name>.` 아래:

| 키 | 동작 확인 |
|---|---|
| `url` | ✅ Streamable HTTP. `initialize`/`tools/list` 등 POST 3회 후 턴 중 tool마다 POST |
| `bearer_token_env_var` | ✅ `Authorization: Bearer $ENV` (`t1-mcp-bearer*`) |
| `http_headers` (inline table) | ✅ `-c 'mcp_servers.conti.http_headers={Authorization="Bearer x", X-Conti-Test="1"}'` — 커스텀 헤더 서버에 도착 |
| `bearer_token` | ❌ 바이너리에 "uses unsupported `bearer_token`; set `bearer_token_env_var`" |
| `default_tools_approval_mode` | ✅ enum `auto \| prompt \| writes \| approve`. **exec 모드 기본값에서는 MCP tool call이 승인 요청을 띄우고 `approval_policy=never`라 즉시 실패** → `"approve"` 필수 |
| `tools.<tool>.approval_mode` / `tools.<tool>.output_token_limit` | 키 존재(미실측) |
| 기타 존재하는 키 | `env_http_headers`, `http_headers_helper`, `startup_timeout_sec`, `startup_timeout_ms`, `tool_timeout_sec`, `enabled_tools`, `disabled_tools`, `required`, `startup_readiness`, `supports_parallel_tool_calls`, `tool_input_schema_max_bytes`, `omit_tools_from`, `scopes`, `oauth`, `oauth_resource` |

- 이미지 content block(`{type:"image", data, mimeType}`)은 거부 없이 수락되어 `item.result.content`에 그대로 실린다. 모델이 실제로 픽셀을 봤는지는 이 스파이크에서 검증하지 않음(1x1 PNG).
- 승인 실패 시 이벤트: `item.completed{item:{type:"mcp_tool_call", status:"failed", error:{message:"MCP tool call requires approval, but approval policy is never"}}}` (`t1-mcp-bearer.jsonl`).

## 이벤트 모양 (`--json`)

```jsonl
{"type":"thread.started","thread_id":"<uuid>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc '...'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"...","exit_code":0,"status":"completed"}}
{"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"conti","tool":"shots_list","arguments":{"seq":"S41"},"result":null,"error":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"conti","tool":"image_view","arguments":{"shot":"0010"},"result":{"content":[{"type":"text","text":"..."},{"type":"image","data":"<b64>","mimeType":"image/png"}],"structured_content":null},"error":null,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Code Mode is unavailable because ..."}}
{"type":"turn.completed","usage":{"input_tokens":16068,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":19,"reasoning_output_tokens":0}}
```

- `agent_message`는 `item.started` 없이 `item.completed`만 온다 (스트리밍 델타 없음).
- `--output-schema`: 최종 JSON이 **마지막 `agent_message.text`에 문자열로** 들어오고, `-o` 파일에는 같은 JSON이 그대로 써진다 (`{"ok":true,"n":42}`). 별도 이벤트 타입은 없다.
- 인터럽트로 죽이면 `turn.completed`/`turn.failed` 없이 스트림이 그냥 끊긴다 → 앱은 프로세스 exit로 종료를 판단해야 한다.
- stderr에는 가끔 `ERROR codex_core::tools::router: ...` 로그가 섞인다(무해). JSONL은 stdout만 파싱.

## Gotcha

1. **코드 모드 명령은 이벤트에 안 나온다.** 모델이 `shell` 대신 code-mode `exec` 툴(`tools.exec_command(...)`)로 명령을 돌리면 `command_execution` 아이템이 **전혀 안 찍힌다** (`t3-sandbox-read-only.jsonl`: 차단된 `printf > out.txt`가 이벤트에 없고 모델 텍스트에만 "operation not permitted"가 보임). 롤아웃 파일(`~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl`)에는 `custom_tool_call`로 기록된다. `--disable code_mode_host`는 **fail-closed**(`item.type:"error"`, 모든 exec 실패)라 쓰면 안 된다. → 앱의 "실행된 명령" 표시는 best-effort로 두거나 롤아웃 파일을 보조로 읽을 것.
2. **MCP 승인.** `default_tools_approval_mode="approve"` 없으면 모든 MCP 호출이 실패한다 (위 참조).
3. **resume은 `-C`/`-s`를 안 받는다.** cwd는 spawn cwd. `-c` 오버라이드(MCP 등)는 resume에도 매번 다시 넘겨야 한다.
4. **인터럽트.** 샌드박스 명령은 **별도 프로세스 그룹**(setsid)으로 뜬다. 그룹 SIGTERM(`kill(-pid)`)은 codex만 죽이고 `sleep 30`이 고아로 남았다(`t6`). **codex pid에 SIGINT**를 보내면 codex가 자식을 직접 정리하고 ~1.3초 내 exit 1로 종료, 자손 전부 소멸(`t6b`). 권장 절차: 신호 전 `pgrep -P` 재귀로 자손 pid 스냅샷 → SIGINT → ≤3초 대기 → 살아있는 자손 SIGKILL → 그래도 안 죽으면 codex SIGKILL. 셔임(node) pid에 SIGINT 보내도 네이티브로 전달됨. 셔임을 건너뛰려면 네이티브 바이너리를 직접 spawn해도 된다.
5. **네트워크.** read-only·workspace-write 둘 다 **DNS부터 차단**(`curl: (6) Could not resolve host`). `curl -s … | head`처럼 파이프를 걸면 exit 0 + 빈 출력이라 모델이 "ok"로 오판한다. 네트워크를 열려면 `sandbox_workspace_write.network_access=true`(키 존재, 미실측).
6. **TOML 값.** `-c`의 값은 TOML로 파싱된다 — 문자열은 반드시 `"…"`로 감싸고, inline table은 `{k="v"}`.
7. **usage는 턴 누적.** `turn.completed.usage.input_tokens`는 턴 안의 모든 모델 요청 합이다. 툴 호출 1회마다 컨텍스트가 다시 들어간다.
8. 사용자 config가 있으면 CrowdStrike 경고·플러그인·`node_repl` MCP(ChatGPT.app 내부 node)까지 뜬다 → `--ignore-user-config` 권장. 단 사용자가 config에 넣어둔 model/provider도 같이 무시되므로 필요하면 `-m`으로 명시.
9. 모델: 롤아웃 `turn_context.model = "gpt-6.1-sol"` (기본값).

## Usage (turn.completed.usage)

| 샘플 | 조건 | 모델 요청 수(추정) | input | cached | output |
|---|---|---|---|---|---|
| t5-schema | `--ignore-user-config`, 툴 없음 | 1 | **16,068** | 0 | 19 |
| t3c-ro-nocodemode | `--ignore-user-config`, 1 tool(실패) | 2 | 32,261 | 28,160 | 66 |
| t2-agents | user config, cat 1회 | 2 | 35,559 | 30,720 | 77 |
| t3-sandbox-read-only | user config, 2 cmd | 2–3 | 53,438 | 30,848 | 187 (+76 reasoning) |
| t3-sandbox-workspace-write | user config, 2 cmd | 3 | 54,250 | 44,160 | 100 |
| t1-mcp-bearer-ignore | `--ignore-user-config`, MCP 2 tool | 3 | 65,259 | 56,576 | 153 |
| t1-mcp-headers | user config, MCP 2 tool | 3 | 71,525 | 61,440 | 151 |
| t4-resume | user config, resume + pwd | 2 | 71,755 | 66,304 | 139 |
| t1-mcp-bearer | user config, MCP 2 tool(실패) | 3 | 82,637 | 74,496 | 150 |

요약: 요청당 기본 ≈16k(ignore-user-config) / ≈18k(user config). MCP 툴 2개 정의 추가 시 요청당 ≈21k. 캐시 적중률은 두 번째 요청부터 85–90%.

## 샌드박스 실측 (`codex sandbox -c 'sandbox_mode="…"' -- /bin/sh -c …`, 모델 호출 없음)

| 모드 | `curl https://example.com` | `printf hi > out.txt` (cwd 안) |
|---|---|---|
| read-only | ❌ `Could not resolve host` | ❌ `Operation not permitted` (exit 1) |
| workspace-write | ❌ `Could not resolve host` | ✅ |

`codex sandbox`는 `-C`, `--log-denials`, `--allow-unix-socket` 옵션이 있어 앱의 자가진단(사전 점검)에 쓸 수 있다.

## 진단 페이지용 출력

- `codex --version` → `codex-cli 0.162.0` (stdout, exit 0)
- `codex login status` → 로그인 시 `Logged in using ChatGPT` exit 0 / 비로그인(`CODEX_HOME`=빈 디렉터리로 확인) `Not logged in` exit 1. `--json` 없음 → exit code + 문자열 매칭.
- `codex doctor` → 사람이 읽는 리포트(섹션: Notes / Environment / runtime / install / search / git / terminal …), exit 0. JSON 옵션 없음. 전문은 `samples/sandbox-doctor.txt`.
- `codex features list` → `name  stage  enabled` 3열 텍스트.
- `codex mcp list --json` → 사용자 config의 MCP 서버 배열(JSON) — `-c`로 넘긴 서버는 안 보임.

## 파일

- `mcp-server.mjs` — Streamable HTTP MCP(127.0.0.1, Bearer, stateless) `shots_list`/`image_view`
- `run-codex.mjs` — spawn 헬퍼(stdin 프롬프트, JSONL 저장, 이벤트 트리거 kill)
- `t1-mcp.mjs [bearer|headers] [approve|auto|…] [ignore]`, `t2-agents.mjs`, `t3-sandbox.mjs <mode>`, `t3c-codemode.mjs`, `t4-resume.mjs`, `t5-schema.mjs`, `t6-interrupt.mjs`(그룹 SIGTERM, 실패 사례), `t6b-interrupt.mjs`(SIGINT, 성공 사례)
- `fixtures/projA/AGENTS.md`, `fixtures/skills/greet/SKILL.md`, `fixtures/schema.json`
- `samples/` — 원본 JSONL · stderr · MCP 서버 로그 · doctor/sandbox 출력

---

## 이미지 생성 (2026-10-11, Codex 로그인으로 GPT 이미지 — 앱 이미지 엔진 후보)

**실행:** `codex exec --json --skip-git-repo-check -s read-only -c features.image_generation=true -` (프롬프트 stdin).
`codex features list` → `image_generation  stable  true` (0.162.0).

**결과: 이 맥은 지금 Codex 로그아웃 상태** (`codex login status` → `Not logged in`, `~/.codex/auth.json` 없음).
실행하면 `thread.started` 뒤 401 재연결 10회 → `turn.failed {error.message: "unexpected status 401 Unauthorized: Missing bearer…"}`, 종료코드 1, 약 17초.
샘플 `samples/imagegen_401_not_logged_in.jsonl`. → 앱은 401/Unauthorized 를 "Codex 로그인 필요"로 분류한다.

**과거 세션 기록에서 확인한 형태** (`~/.codex/sessions/2026/10/09/rollout-…-01a120f7….jsonl`, 사용자가 9일에 만든 이미지):
- 도구: `image_gen__imagegen({ prompt, referenced_image_paths?: [절대경로…] })` — 레퍼런스 이미지를 경로로 넘긴다(편집·일관성).
- 완료 항목: `item_completed.item = { type: "Extension", kind: "image_gen.generation", id: "exec-<uuid>", status: "completed", revisedPrompt }`.
- 파일: `~/.codex/generated_images/<thread_id>/<item id>.png` (`thread_id` 는 `thread.started` 의 값과 같은 UUIDv7).
- 크기: 프롬프트로 정한다 — "1536x1024" 요청 → 1536×1024, 16:9 요청 → 1672×941. 한 장 42–106초.

**앱 설계 반영:** thread id 를 받자마자 작업 기록에 남기고(`codex:<thread>`), 끝나면 그 폴더의 png 를 회수한다.
앱이 꺼져도 폴더에 결과가 남으므로 재시작 때 회수 가능. 로그인 후 실제 1장으로 `exec --json` 의 이미지 항목 형태를 다시 확인할 것.
