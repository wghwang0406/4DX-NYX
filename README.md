# NYX — 콘티 스튜디오

팀 내부용 콘티(storyboard) 제작 데스크톱 앱. 시나리오(PDF/텍스트)나 영상 콘티를 넣으면 에셋 → 샷 분해 → 콘티 이미지 → 레이아웃 → 게시까지 한 흐름으로 만든다.
AI(Claude Code / Codex CLI)와 이미지 생성(Higgsfield CLI)은 각자 PC에 로그인된 공식 CLI 를 그대로 쓰고, 앱은 토큰을 저장하지 않는다.

## 팀원 설치 (dmg)

1. `NYX-<버전>-arm64.dmg` 를 열고 NYX.app 을 Applications 로 끌어다 놓는다.
2. 처음 한 번은 Applications 에서 NYX 를 **우클릭 → 열기**. (팀 내부 배포라 Apple 공증이 없어 더블클릭하면 "열 수 없음"이 뜬다.)
   그래도 막히면 `xattr -dr com.apple.quarantine /Applications/NYX.app`
3. 첫 화면 안내에서 Claude 또는 Codex, Higgsfield 에 로그인하고, 게시 서버 주소·토큰을 넣는다.
4. 새 버전은 게시 서버가 알려준다(상단 알림 → 내려받기 → 1번 반복). 데이터는 `~/Library/Application Support/NYX` 에 남는다.

문제가 생기면 설정 › 도구 진단 › **진단 내보내기** 로 만든 zip(토큰 없음, 이메일 가림)을 보내 주세요.

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

dmg 만들기·사내 배포:

```bash
corepack pnpm exec tsx tools/package-mac.mts                       # release/NYX-<버전>-arm64.dmg (ad-hoc 서명)
NYX_PUBLISH_TOKEN=... corepack pnpm exec tsx tools/package-mac.mts --publish http://nyx.사내:8787   # 올리고 "새 버전" 알림
```

버전은 `apps/studio/package.json` 의 `version`. Developer ID 가 생기면 `tools/package-mac.mts` 의 `identity` 와 공증만 바꾸면 된다.

사내 뷰어 서버는 `apps/viewer/README.md` (Docker / Node).

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
packages/layout     템플릿 폴더(Handlebars) → 시트 HTML, 애니매틱 ffmpeg 인자
packages/media      영상 → 콘티: uv 부트스트랩, 프록시·키프레임, 샷 병합, AI 1·2차
py/media            영상 측정(컷·카메라·키프레임·시트)·음성 인식 — uv 잠금 Python 3.12
apps/viewer         사내 뷰어 서버(node:http + SQLite) + 리뷰어 웹 + Dockerfile
templates/          레이아웃 템플릿 + 번들 폰트(Pretendard, OFL)
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
