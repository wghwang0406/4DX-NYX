// 실제 higgsfield `generate cost` (무료 드라이런) 로 플래너가 내는 모델·파라미터 조합을 검증한다. 레퍼런스 없음 → 업로드 없음.
import { RealHiggsfieldCli, ModelTable, ROUTE } from '../packages/genengine/src/index.ts'
const models = await ModelTable.load(new URL('../agent-bundle', import.meta.url).pathname)
const cli = new RealHiggsfieldCli({ timeoutMs: 60000 })
console.log('account', await cli.accountStatus())
const combos: Array<[string, Record<string,string>]> = [
  [ROUTE.conti, { aspect_ratio: '16:9', ...models.imageParams(ROUTE.conti, 'high', '2k') }],
  [ROUTE.charSheet, { aspect_ratio: '16:9', ...models.imageParams(ROUTE.charSheet, '2k') }],
  [ROUTE.charPlate, { aspect_ratio: '3:4', ...models.imageParams(ROUTE.charPlate, 'high', '2k') }],
  [ROUTE.locMaster, { aspect_ratio: models.clampAspect(ROUTE.locMaster, '21:9'), ...models.imageParams(ROUTE.locMaster, '2k') }],
  [ROUTE.locView, { aspect_ratio: '16:9', ...models.imageParams(ROUTE.locView, 'high', '2k') }],
  [ROUTE.prop, { aspect_ratio: '1:1', ...models.imageParams(ROUTE.prop, 'high', '2k') }],
]
for (const [m, p] of combos) {
  try { console.log('OK ', m, JSON.stringify(p), await cli.cost(m, p, 'dry run prompt\n둘째 줄 한글')) }
  catch (e) { console.log('ERR', m, JSON.stringify(p), (e as any).message, (e as any).kind, (e as any).code) }
}
console.log('account after', await cli.accountStatus())
