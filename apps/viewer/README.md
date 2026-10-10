# NYX 사내 뷰어 서버

스튜디오가 게시한 콘티(시트 PNG·PDF·컷 이미지·영상)를 링크로 보여주고, 리뷰어가 컷·영역·영상 시각에 코멘트를 남기면 스튜디오가 가져가 반영한다.
게시본은 불변이고, 서버가 Dropbox 팀 폴더(`/NYX/{프로젝트}/{시퀀스}/{vN}/`)에 보관한다. 팀원 PC 에는 Dropbox 설정이 필요 없다.

## 띄우기

Docker (사내 서버):

```bash
export NYX_PUBLISH_TOKEN=$(openssl rand -hex 24)   # 스튜디오 설정 › 게시 서버에 같은 값
export NYX_PUBLIC_URL=http://nyx.사내주소:8787      # 링크에 찍힐 주소
export DROPBOX_TOKEN=...                           # 선택 (또는 REFRESH_TOKEN + APP_KEY + APP_SECRET)
docker compose -f apps/viewer/docker-compose.yml up -d
```

Docker 없이 (Node 22+):

```bash
corepack pnpm --filter @conti/viewer build
NYX_PUBLISH_TOKEN=... NYX_DATA=/srv/nyx node apps/viewer/dist/server.mjs
```

## 접근과 보안

- 사내망/VPN 안에서만 연다. 리뷰 링크 `/r/{토큰}` 은 추측 불가 토큰(144비트)이고, 스튜디오에서 언제든 닫을 수 있다(410).
- 게시·피드백 API 는 팀 게시 토큰(Bearer) 이 필요하다. 리뷰어 이름은 표시용(인증 아님).
- 데이터: `NYX_DATA/nyx.db`(SQLite — 코멘트·게시 기록) + `NYX_DATA/blobs/`(해시 주소 파일). 백업은 이 폴더 하나.

## API 요약

| | 경로 | |
|---|---|---|
| 스튜디오 | `HEAD/PUT /api/blobs/{sha256}?offset&size` | 이어올리기 (같은 파일은 다시 안 올림) |
| | `POST /api/projects/{id}/publications` | 게시 (manifest) → 링크 |
| | `GET /api/projects/{id}/changes?cursor=N` | 새·바뀐 코멘트 |
| | `PATCH /api/comments/{id}` | 반영 회신 (`resolvedIn: "v4"`) |
| | `PATCH /api/publications/{id}` | 링크 닫기·기간 |
| 리뷰어 | `GET /r/{token}` · `GET /api/r/{token}` · `.../file/{path}` | 화면·데이터·파일(Range) |
| | `POST /api/r/{token}/comments` · `/verdict` | 코멘트(패널·영역·시각)·승인/수정 요청 |
