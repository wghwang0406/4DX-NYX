# 템플릿 폴더 규격

콘티 시트의 모양은 이 폴더 하나가 정한다. 로직 없는 Handlebars + CSS 라서 디자인은 HTML/CSS 만 고치면 된다.

| 파일 | 역할 |
|---|---|
| `template.json` | `id`(폴더마다 고유) · `name` · `version` · `paper{size: A4\|A3\|Letter, orientation}` · `panelsPerPage` · `panelAspect` |
| `page.hbs` | 문서 본문. `{{#each pages}}<section class="page">…</section>{{/each}}` — 페이지 하나 = `.page` 하나 |
| `partials/*.hbs` | `{{> panel}}` 처럼 부르는 조각 |
| `style.css` | 화면·PDF 공통 스타일. 단위는 mm 권장. 폰트는 Pretendard(번들)가 기본 |
| `sample.json` | Template Lab 의 "샘플 데이터" — 아래 데이터 모양의 예시 |

페이지 크기(`.page` 의 width/height, `@page`)는 앱이 `paper` 로 넣는다. 템플릿은 `.page` 안쪽만 그리면 된다.

## 데이터

- `project{title, code}` · `sequence{seq, ep, heading, place, time, shotCount, duration}` · `meta{date, versionLabel, status}`
- `pages[]{n, total, first, last, panels[]}` — 칸이 모자라면 `{empty: true}` 로 채워져 온다
- 패널: `panelLabel`(0030 / 0030-2) · `image`(URL 또는 null) · `version` · `imageSource` · `chips[]`(사이즈·앵글·카메라·화각·길이) ·
  `size` `angle` `cameraMove` `fov` `duration` `tc` · `characters` `location` `props` · `action` · `dialogue[]{speaker, text, paren}` · `hasDialogue` ·
  `annotationsSvg`(이미지 위에 겹칠 SVG — 반드시 `{{{annotationsSvg}}}` 세 겹 괄호) · `stale`(재생성 필요)
- 헬퍼: `{{#if (eq a b)}}` · `{{join list ", "}}` · `{{inc @index}}`

## 새 템플릿 만들기

앱 › 레이아웃 › Template Lab › [이 템플릿 복제] → 사용자 템플릿 폴더에 복사본이 생기고 Finder 가 열린다.
파일을 저장하면 앱 미리보기가 바로 다시 그려진다. `id` 를 바꾸고 프로젝트 템플릿으로 고르면 끝.
