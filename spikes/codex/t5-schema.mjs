// Test 5: --output-schema + -o, with --ignore-user-config to measure base overhead
import { runCodex, BASE_ARGS } from './run-codex.mjs';
import fs from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
const schema = `${here}fixtures/schema.json`;
fs.writeFileSync(schema, JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'integer' } }, required: ['ok','n'], additionalProperties: false }));
const outFile = `${here}samples/t5-last-message.json`;
fs.rmSync(outFile, { force: true });
const r = await runCodex({
  name: 't5-schema',
  prompt: 'Reply with ok set to true and n set to 42.',
  args: [...BASE_ARGS, '--ignore-user-config', '-s', 'read-only', '-C', here, '--output-schema', schema, '-o', outFile],
});
console.log('-o file:', fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '(missing)');
process.exit(r.code ?? 1);
