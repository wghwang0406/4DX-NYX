// 실제 대본 PDF 로 씬 분리를 검증한다: node tsx tools/split-check.mts <pdf...>
import { readFile } from 'node:fs/promises'
import { extractPdfLines, splitScenes, classifyLines } from '../packages/screenplay/src/index.ts'
for (const f of process.argv.slice(2)) {
  const lines = await extractPdfLines(new Uint8Array(await readFile(f)))
  const scenes = splitScenes(lines)
  const nums = scenes.map((s) => s.number)
  const kinds: Record<string, number> = {}
  for (const sc of scenes) for (const l of classifyLines(sc.lines)) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1
  console.log(`\n== ${f.split('/').pop()} — 줄 ${lines.length}, 씬 ${scenes.length}`)
  console.log('  번호:', nums.slice(0, 8).join(','), '…', nums.slice(-3).join(','))
  console.log('  예시:', scenes.slice(0, 3).map((s) => `${s.number}|${s.title}|${s.timeOfDay ?? '-'}`).join('  ·  '))
  console.log('  분류:', JSON.stringify(kinds))
  const sample = classifyLines(scenes[Math.min(5, scenes.length - 1)].lines).filter((l) => l.kind !== 'blank').slice(0, 8)
  for (const l of sample) console.log(`   [${l.kind}${l.speaker ? ':' + l.speaker : ''}] ${l.text.trim().slice(0, 60)}`)
}
