# agent-bundle — NYX 번들 스킬

앱에 함께 배포되는 AI 지시문 묶음이다. Claude와 Codex가 **같은 파일**을 읽는다.
상태 변경은 전부 앱의 MCP 서버(`conti`)를 거치므로, 여기엔 코드가 없고 지시문·색인·능력표만 있다.

## 구성

```
agent-bundle/
  .claude-plugin/plugin.json   플러그인 매니페스트 (name: conti) → 스킬은 conti:<name>으로 불린다
  system/studio.md             앱 시스템 프롬프트 (--append-system-prompt-file). 규칙 10개·라우팅·확인 지점
  skills/
    conti-setup/SKILL.md       세계관·에셋 추출 → assets_upsert → 표 확인 → (승인 후) assets_generate
    conti-breakdown/SKILL.md   샷 분해 → shots_propose_breakdown 한 번 → 수락 대기
    conti-generate/SKILL.md    prompts_set 슬롯 → conti_generate 파일럿 → 배치 / stale만 재생성
    conti-edit/SKILL.md        "0030 로우앵글로" 류 수정 → shots_update/insert/delete, image_edit(NBP 우선)
    feedback-apply/SKILL.md    뷰어 코멘트 → 변경안 → 반영 → feedback_update (M6 이후)
    Lira/SKILL.md              ┐ 힉스필드 원문 규격 — 바이트 그대로. 수정 금지
    Cinedance/SKILL.md         │ (이미지 / 영상 / 연기)
    Acting/SKILL.md            ┘
  specs/index.json             원문 제목 → 줄 구간 색인. spec_toc / spec_get이 읽는다
  specs/HASHES.txt             원문 3종 sha256 (CI에서 대조)
  models.json                  models.py CAPS 이식 + M0 수정분 (모델별 허용 파라미터)
  agents-md.hbs                프로젝트 루트 AGENTS.md 템플릿 (Codex용)
  claude-md.hbs                프로젝트 루트 CLAUDE.md 템플릿 (`@AGENTS.md` 한 줄)
  ATTRIBUTION.md               원문 3종 출처
```

## Claude가 읽는 법

앱이 `claude -p … --plugin-dir <app>/agent-bundle --append-system-prompt-file <app>/agent-bundle/system/studio.md`로 띄운다.
플러그인 이름이 `conti`라서 스킬은 `conti:conti-setup`, `conti:conti-breakdown`처럼 보이고, 사용자 CLAUDE.md·개인 스킬은
`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 --setting-sources project`로 빠진다. 도구는 `Read, Glob, Grep, Skill` + `mcp__conti__*`뿐이다
(Bash·Write·Edit 없음). 전체 실행 커맨드는 플랜 §2 / `spikes/claude/REPORT.md`.

## Codex가 읽는 법

앱이 프로젝트를 열 때 `agents-md.hbs`로 프로젝트 루트에 `AGENTS.md`를 생성한다. 안에는 프로젝트 사실, `system/studio.md` 절대경로,
스킬별 `SKILL.md` 절대경로 인덱스가 들어 있고 Codex는 그걸 읽고 따른다. `CLAUDE.md`는 `@AGENTS.md` 한 줄이라 터미널 Claude도 같은 내용을 본다.
Codex는 `-s read-only` 샌드박스 + `-c mcp_servers.conti.*`로 붙는다.

## 원문 규격 읽기 규칙

Lira/Cinedance/Acting은 합쳐서 90KB라 통째로 읽지 않는다. 에이전트는 `spec_toc{spec}`으로 제목을 보고
`spec_get{spec, sections:[id…]}`로 필요한 구간만 받는다. 구간 id는 `specs/index.json`에 있다(예: `lira#character-sheet-photoreal-3-panel-soul-2-0`,
`acting#6-the-character-acting-master-profile`, `cinedance#character-description-rule`).

색인 재생성: `corepack pnpm exec tsx tools/build-spec-index.mts` (저장소 루트에서). 생성된 JSON은 커밋한다.

## 수정 금지 — Lira / Cinedance / Acting

세 파일은 힉스필드 배포본이며 **한 글자도 고치지 않는다**(`ATTRIBUTION.md`). `specs/HASHES.txt`의 sha256과 다르면 CI가 실패해야 한다.

```sh
cd agent-bundle && shasum -a 256 -c specs/HASHES.txt
```

고칠 게 있으면 원문이 아니라 `system/studio.md`나 각 `conti-*` 스킬에 쓴다. 원문이 서로 어긋나는 지점(렌즈 표기·정체성·부정문·rule of thirds)은
`studio.md`의 "매체 분기"가 중재한다: 이미지=Lira, 영상=Cinedance.

## 수정할 때

- 도구 이름·인자는 `packages/mcp`의 레지스트리가 정본이다. 바뀌면 스킬의 JSON 예시도 같이 고친다.
- `models.json`은 `higgsfield model get`으로 확인한 값만 넣는다. 앱의 `doctor --models`가 라이브 CLI와 대조한다.
- `studio.md`는 2,500자 안에 둔다 — 시스템 프롬프트 앞부분이 고정돼야 프롬프트 캐시가 유지된다.
