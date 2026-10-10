# NYX — 콘티 스튜디오

팀 내부용 콘티(storyboard) 제작 데스크톱 앱. 시나리오(PDF/텍스트)나 영상 콘티를 넣으면 에셋 → 샷 분해 → 콘티 이미지 → 레이아웃 → 게시까지 한 흐름으로 만든다.
AI(Claude Code / Codex CLI)와 이미지 생성(Higgsfield CLI)은 각자 PC에 로그인된 공식 CLI 를 그대로 쓰고, 앱은 토큰을 저장하지 않는다.

## 요구 사항

- macOS (윈도우 포팅을 막지 않게 설계), Node 22+, corepack(pnpm 12)
- `claude` 또는 `codex` CLI 로그인, `higgsfield` CLI 로그인 — 앱 **설정 › 계정**에서 할 수 있다
- 선택: `ffmpeg`(영상 입력), `uv`(영상 분석, 앱이 설치)

## 실행

```bash
corepack pnpm install
corepack pnpm dev          # 개발 실행
corepack pnpm build        # 빌드 (apps/studio/out)
corepack pnpm test         # 전체 테스트
corepack pnpm typecheck
```

빌드된 앱을 특정 프로젝트로 바로 열기: `CONTI_OPEN=<프로젝트 폴더> apps/studio/node_modules/.bin/electron apps/studio`

## 구조

```
apps/studio/        Electron 앱 (main / preload / renderer)
packages/domain     zod 스키마·파일명·샷 번호·뷰 표 (단일 출처)
packages/core       ProjectStore(.conti JSON 이 진실, md 는 생성 뷰) + 외부 수정 감시
packages/screenplay PDF/텍스트 추출, 씬 분리, 대사 분류
packages/mcp        앱 MCP 서버 — UI·Claude·Codex 가 같은 도구로 상태를 바꾼다
packages/agents     claude / codex CLI 어댑터
packages/genengine  JobService(승인→업로드→생성→다운로드→버전), Higgsfield CLI 래퍼, 프롬프트 조립·린트
agent-bundle/       앱에 번들된 스킬 + 원문 규격(Lira/Cinedance/Acting, 바이트 그대로 — 고치지 않는다)
tools/              샘플 프로젝트 생성기, 검증 스크립트
spikes/             M0 검증 기록과 녹화 샘플
design/app-layout/  화면 시안·빌드 캡처
```

## 문서

- `QA_REPORT.md` — 마일스톤별 QA 매트릭스·수정·미수정 항목
- `agent-bundle/README.md` — 번들 스킬과 원문 규격 출처(`ATTRIBUTION.md`)

## 규칙

- 모든 유료 생성은 승인 카드를 거친다. 크레딧 숫자는 UI 에 표시하지 않는다.
- `agent-bundle/skills/{Lira,Cinedance,Acting}` 은 Higgsfield 원문 — 수정 금지 (`cd agent-bundle && shasum -a 256 -c specs/HASHES.txt`)
- `.conti/*.json` 이 진실, `config.md`·`shotlist_*.md`·`Projectprompt.md` 앵커 절은 앱이 생성한다. 직접 고치면 앱이 감지해 반영 여부를 묻는다.
