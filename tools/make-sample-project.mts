// 개발용: 픽스처 시나리오로 임시 프로젝트를 만든다 (ProjectStore + screenplay 패키지 실사용 검증).
//   corepack pnpm exec tsx tools/make-sample-project.mts [출력폴더]
// 앱의 가져오기(ipc screenplay:commit)와 같은 모양으로 source(sourceId·textHash)를 채워
// MCP scene_get / shots_propose_breakdown 이 그대로 동작한다. 에셋 하나도 넣는다 (에셋 화면 확인용).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectStore, sha256 } from '../packages/core/src/index.ts'
import { splitScenes, textToLines, classifyLines, seqIdFromSceneNumber } from '../packages/screenplay/src/index.ts'

const root = process.argv[2] ?? '/tmp/conti-sample'
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })

const store = await ProjectStore.create(root, { code: 'PRISM', title: '프리즘' })
const text = await readFile(new URL('../spikes/fixtures/sample_screenplay.txt', import.meta.url), 'utf8')
const sourceRel = `sources/${sha256(text).slice(0, 8)}_sample_screenplay.txt`
await writeFile(join(root, sourceRel), text)
const lines = textToLines(text)
const scenes = splitScenes(lines)

for (const sc of scenes) {
  const classified = classifyLines(sc.lines)
  // 아주 단순한 임시 분해: 대사 줄마다 샷 하나, 지문 문단마다 샷 하나 (AI 분해 전까지의 자리)
  type S = { id: string; no: string; sizeCode?: 'WS' | 'MS' | 'CU'; actionKo: string; dialogue: Array<{ speaker?: string; text: string; paren?: string; lineN?: number }>; tag?: '대사'; cameraMove?: string; sourceLines: number[] }
  const shots: S[] = []
  let n = 10
  let pendingAction: Array<{ text: string; n: number }> = []
  const flush = () => {
    if (!pendingAction.length) return
    shots.push({
      id: `s${n}`,
      no: String(n).padStart(4, '0'),
      sizeCode: shots.length === 0 ? 'WS' : 'MS',
      actionKo: pendingAction.map((a) => a.text).join(' '),
      dialogue: [],
      cameraMove: shots.length === 0 ? 'PAN' : 'STATIC',
      sourceLines: pendingAction.map((a) => a.n),
    })
    n += 10
    pendingAction = []
  }
  for (const l of classified) {
    if (l.kind === 'action') pendingAction.push({ text: l.text.trim(), n: l.n })
    else if (l.kind === 'dialogue') {
      flush()
      shots.push({ id: `s${n}`, no: String(n).padStart(4, '0'), sizeCode: 'CU', actionKo: '', dialogue: [{ speaker: l.speaker, text: l.text, paren: l.paren, lineN: l.n }], tag: '대사', cameraMove: 'STATIC', sourceLines: [l.n] })
      n += 10
    }
  }
  flush()
  await store.upsertSequence({
    seq: seqIdFromSceneNumber(sc.number, sc.index),
    ep: 'EP01',
    headingKo: `${sc.title}${sc.timeOfDay ? ` - ${sc.timeOfDay === 'D' ? '낮' : '밤'}` : ''}`,
    // ipc screenplay:commit 과 같은 해시 규칙(본문 줄을 \n 으로 이어 붙인 것)
    source: { sourceId: sourceRel, lineStart: sc.lineStart, lineEnd: sc.lineEnd, textHash: sha256(sc.lines.map((l) => l.text).join('\n')), kind: 'screenplay' },
    shots,
  })
}

await store.upsertAsset('EP01', {
  id: 'asset-haesu',
  tag: '@해수',
  kind: 'char',
  subkind: 'human',
  state: 'base',
  nameKo: '해수',
  descriptionKo: '20대 후반 여성. 검은 단발, 낡은 네이비 야상, 운전석에서 내리는 쪽',
  anchorEn: '28yo lean Korean woman, black bob, worn navy field jacket. 100% matches the reference.',
  views: {},
  usedIn: ['S41', 'S42'],
})

console.log(`OK ${root}`)
for (const s of store.listSequences()) console.log(` ${s.seq} ${s.headingKo} — 샷 ${s.shots.length} (source ${s.source.sourceId} L${s.source.lineStart}-${s.source.lineEnd})`)
