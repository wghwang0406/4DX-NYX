# M0 스파이크 — `claude` CLI 임베딩 검증 (Claude Code 2.1.295)

- 2026-10-09 / Node v22.22.3 / macOS / 구독 OAuth 로그인 (`apiKeySource: none`)
- 총 API 턴 17. 구독 5h 창 사용률 0.06→0.16.
- 원문 이벤트: `samples/*.jsonl` (첫 줄 `_spike_meta`에 실행 인자). 스크립트: `00_probe_flags.mjs` … `08_claudemd_env.mjs`, `mcp-server.mjs`, `plugin/`.

## 결과 요약

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| 1 | 한 프로세스 멀티턴 (stream-json stdin) | **GO** | `samples/multiturn.jsonl` — 2턴째 "7319" 회상, 같은 session_id |
| 2 | `--session-id` → 종료 → `--resume` | **GO** | `resume_a/b.jsonl` — 새 프로세스에서 "4482" 회상 |
| 3 | `--plugin-dir` 스킬 로드 | **GO** | `plugin.jsonl` — init `plugins[]`에 `conti@inline`, `skills[]`에 `conti:ping`, 답 `PONG-FROM-PLUGIN` |
| 4 | HTTP MCP + bearer | **GO** | `mcp.jsonl` — 프롬프트 없이 호출, 이미지 수용(`COLOR=red`), slow_wait 20/60/120s 성공 |
| 5 | 사용자 커스터마이즈 숨기기 | **GO (조건부)** | `--setting-sources project`만으로는 CLAUDE.md가 남음 → env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` 필수 |
| 6 | `--json-schema` 구조화 출력 | **GO** | `schema.json` — `result.structured_output={"ok":true,"n":42}` |
| 7 | 토큰/사용량 | 기록 | 아래 |
| 8 | 플래그 사실 확인 | 기록 | 아래 |

## 권장 실행 커맨드 (검증: `samples/final_recommended_env.jsonl`)

```sh
CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
claude -p \
  --input-format stream-json --output-format stream-json --verbose --include-partial-messages \
  --permission-prompts none \
  --setting-sources project \
  --plugin-dir /abs/path/plugin \
  --mcp-config '{"mcpServers":{"conti":{"type":"http","url":"http://127.0.0.1:PORT/mcp","headers":{"Authorization":"Bearer TOKEN"}}}}' \
  --strict-mcp-config \
  --tools Read,Glob,Grep,Skill \
  --allowedTools Skill 'mcp__conti__*' \
  --disallowedTools Bash Write Edit NotebookEdit WebFetch WebSearch \
  --session-id <uuid>        # 재개 필요 시. 아니면 --no-session-persistence
```

init 증거: `tools` = `Glob,Grep,Read,Skill,mcp__conti__*` (Bash/Write/Edit/Web* 없음, ToolSearch 없음) / `mcp_servers` = conti만 / `plugins` = `conti@inline`+빌트인 3 / `skills` = `conti:ping`+빌트인 19 (사용자 Gen*/Lira 없음) / `memory_paths` undefined.

### 격리 플래그 비교

| 플래그 | 플러그인 스킬 | 우리 MCP | 사용자 스킬 | CLAUDE.md | 비고 |
|---|---|---|---|---|---|
| 없음 | — | — | 로드(41) | 로드 | 사용자 MCP 3개도 붙음 |
| `--safe-mode` | **빠짐** | **빠짐** | 없음 | ? | **NO-GO** |
| `--setting-sources project` | 있음 | 있음 | 없음 | **로드** | |
| `--bare` | 있음 | 있음 | 없음 | 없음 | **NO-GO** — OAuth 안 읽음 |
| `--restricted` | 있음 | 있음 | 없음 | ? | Write/Edit/WebSearch 남음 |
| project + `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | 있음 | 있음 | 없음 | **없음** | **권장** |

앱 지시문은 `--append-system-prompt` / `--append-system-prompt-file`(숨은 옵션, 존재함).

## 이벤트 형태

턴당: `system/init` → `system/status` → `stream_event/message_start` → `content_block_*` → `assistant` → `message_delta/stop` → `rate_limit_event` → `result`.
- `session_id`는 모든 이벤트 top-level. 멀티턴에서 `system/init`은 턴마다 다시 방출.
- 툴 결과는 `type:"user"` 이벤트: `message.content[0]={type:"tool_result",…}` + `tool_result_meta[{permission_decision:{decision:"accept",source:"config"}}]`.
- MCP 이미지 블록은 `{type:"image",source:{type:"base64",media_type,data}}`로 변환.
- `result`: `subtype, result, structured_output, session_id, usage{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}, total_cost_usd, permission_denials[], num_turns, duration_ms, is_error`.
- `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}.utilization` — 구독 게이지 UI용. 이 계정은 `overageStatus:"rejected"`.
- Skill: 자연어 "use conti:ping" → `tool_use Skill` (num_turns 3). 유저 텍스트가 `/conti:ping`이면 인라인 확장(num_turns 1).

## 턴당 오버헤드

| 설정 | cache_read | cache_create | 컨텍스트 |
|---|---|---|---|
| 플래그 없음 1턴 | 10,482 | 23,188 | ~33.7k |
| 같은 프로세스 2턴 | 33,670 | 6,285 | ~40k |
| `--resume` 새 프로세스 | 14,141 | 19,579 | 캐시 재생성 (cost 0.39→0.79) |
| **권장 + DISABLE_CLAUDE_MDS** | 13,841 | 6,046 | **~20k** |
| `--tools ""` + schema | 0 | 17,740 | ~17.7k (바닥) |

바닥 시스템 프롬프트 ≈ 17–20k. 프로세스를 살려둔 멀티턴이 `--resume`보다 캐시 효율 2배 — 재개는 복구용으로만.

## MCP 상세

- SDK `StreamableHTTPServerTransport` stateless + express. 클라이언트 순서: `POST server/discover` → `initialize` → `notifications/initialized` → `GET /mcp`(SSE) → `tools/list` → `tools/call`. 엔드포인트는 GET도 받아야 함(`app.all`). bearer 불일치 401 정상.
- `slow_wait` 120s 타임아웃 없음. 더 길면 env `MCP_TOOL_TIMEOUT` / `MCP_TIMEOUT`.
- 기본 툴셋(28개)에서는 MCP 툴이 deferred → 모델이 `ToolSearch`를 먼저 호출(API 1턴 추가). `--tools Read,Glob,Grep,Skill`로 줄이면 직접 호출.

## 플래그 사실 확인

| 가정 | 실제 |
|---|---|
| `--append-system-prompt-file` 없음 | **있다** (숨은 옵션). `--system-prompt-file`도 존재 |
| `--safe-mode` | 플러그인·`--mcp-config`까지 끔 → 부적합 |
| `--bare` | OAuth 미사용 → 구독으로 불가 |
| `--setting-sources project` | settings/스킬/사용자 MCP 제거, CLAUDE.md는 미제거 |

## 함정

1. variadic 옵션(`--tools`, `--allowedTools`, `--mcp-config`, `--plugin-dir`)이 뒤의 positional 프롬프트를 삼킴 → 프롬프트는 stdin으로.
2. stdin을 즉시 닫으면 `system/init`도 안 나옴 — init은 첫 user 메시지 이후.
3. `--session-id`는 `~/.claude/projects/<cwd-hash>/`에 세션 파일 생성.
4. 빌트인 플러그인 3개·스킬 19개는 어떤 플래그로도 안 빠짐.
5. `Task`(서브에이전트)는 `--tools` allowlist에 없으면 사라짐.
6. `result.num_turns`는 해당 user 메시지 이후 모델 턴 수, 누적 아님.
