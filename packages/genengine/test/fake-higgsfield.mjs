#!/usr/bin/env node
// 가짜 higgsfield CLI — 크레딧 0 으로 JobService 전체 흐름을 돌린다 (플랜 §12).
// 상태는 FAKE_HF_DIR 아래 JSON 파일. 환경변수로 동작을 바꾼다:
//   FAKE_HF_POLLS=N      N 번째 get 에서 completed (기본 2)
//   FAKE_HF_RESULT=URL   result_url (기본 FAKE_HF_URL + /result/<id>.png)
//   FAKE_HF_FAIL=create  create 가 exit 4 로 실패 / =status 로 하면 get 이 failed 반환 / =crash 면 create 가 기록만 하고 죽는다
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const dir = process.env.FAKE_HF_DIR
if (!dir) {
  process.stderr.write('FAKE_HF_DIR 필요\n')
  process.exit(2)
}
mkdirSync(join(dir, 'jobs'), { recursive: true })
mkdirSync(join(dir, 'uploads'), { recursive: true })
const argv = process.argv.slice(2).filter((a) => a !== '--json' && a !== '--no-color')
const log = (line) => writeFileSync(join(dir, 'calls.log'), line + '\n', { flag: 'a' })
log(argv.join(' '))

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const readStdin = () => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const [g1, g2, ...rest] = argv
if (g1 === 'account' && g2 === 'status') {
  out({ credits: Number(process.env.FAKE_HF_CREDITS ?? 100), email: 'fake@example.com', subscription_plan_type: 'ultimate' })
} else if (g1 === 'upload' && g2 === 'create') {
  const file = rest[0]
  if (!existsSync(file)) {
    process.stderr.write(`Error: no such file: ${file}\n`)
    process.exit(3)
  }
  const id = randomUUID()
  writeFileSync(join(dir, 'uploads', `${id}.json`), JSON.stringify({ id, file }))
  out({ id, type: 'image', url: `https://uploads.example/${id}.png` })
} else if (g1 === 'generate' && (g2 === 'create' || g2 === 'cost')) {
  const model = rest[0]
  const params = {}
  const refs = []
  for (let i = 1; i < rest.length; i += 2) {
    const k = rest[i].replace(/^--/, '')
    const v = rest[i + 1]
    if (k === 'image-references' || k === 'image') refs.push(v)
    else params[k] = v
  }
  const prompt = params.prompt ?? readStdin()
  if (!prompt) {
    process.stderr.write('Error: Missing required params: prompt\n')
    process.exit(4)
  }
  if (model === 'no_such_model') {
    process.stderr.write(`Error: No model with job_type "${model}".\n`)
    process.exit(4)
  }
  if (g2 === 'cost') {
    out({ credits: 0.25 })
  } else {
    if (process.env.FAKE_HF_FAIL === 'create') {
      process.stderr.write('Error: Invalid values: quality=ultra (allowed: low,medium,high,xhigh,max)\n')
      process.exit(4)
    }
    const id = randomUUID()
    const job = { id, job_type: model, status: 'queued', created_at: new Date().toISOString(), result_url: null, params: { ...params, prompt, input_images: refs.map((r) => ({ id: r })) }, polls: 0 }
    writeFileSync(join(dir, 'jobs', `${id}.json`), JSON.stringify(job))
    if (process.env.FAKE_HF_FAIL === 'crash') process.exit(137)
    out({ id, job_type: model, status: 'queued', created_at: job.created_at, result_url: null, params: job.params })
  }
} else if (g1 === 'generate' && g2 === 'get') {
  const id = rest[0]
  const p = join(dir, 'jobs', `${id}.json`)
  if (!existsSync(p)) {
    process.stderr.write('Error: 작업을 찾을 수 없어요\n')
    process.exit(3)
  }
  const job = JSON.parse(readFileSync(p, 'utf8'))
  job.polls += 1
  const need = Number(process.env.FAKE_HF_POLLS ?? 2)
  if (process.env.FAKE_HF_FAIL === 'status') job.status = 'failed'
  else if (job.polls >= need) {
    job.status = 'completed'
    job.result_url = process.env.FAKE_HF_RESULT ?? `${process.env.FAKE_HF_URL ?? 'http://127.0.0.1:1'}/result/${id}.png`
  } else job.status = 'running'
  writeFileSync(p, JSON.stringify(job))
  const { polls, ...pub } = job
  out(pub)
} else if (g1 === 'generate' && g2 === 'list') {
  const items = readdirSync(join(dir, 'jobs'))
    .map((f) => JSON.parse(readFileSync(join(dir, 'jobs', f), 'utf8')))
    .map(({ polls, ...j }) => j)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  out(items)
} else {
  process.stderr.write(`Error: unknown command ${argv.join(' ')}\n`)
  process.exit(3)
}
