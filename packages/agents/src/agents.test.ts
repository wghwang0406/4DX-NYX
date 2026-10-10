import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, realpath, rm, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent, AgentSession, OpenOptions } from './types'
import { parseJsonlText, LineSplitter, EventQueue } from './jsonl'
import { buildClaudeArgs, parseClaudeEvents, claudeAdapter, userMessageLine, mcpConfigJson } from './claude'
import { buildCodexArgs, parseCodexEvents, codexAdapter, generatedImages, wrapSystemPrompt } from './codex'
import { pickAvailable, adapters } from './index'
import { isAlive } from './spawn'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPIKES = join(HERE, '..', '..', '..', 'spikes')
const sample = async (rel: string) => parseJsonlText(await readFile(join(SPIKES, rel), 'utf8'))

const by = <T extends AgentEvent['t']>(evs: AgentEvent[], t: T) => evs.filter((e): e is Extract<AgentEvent, { t: T }> => e.t === t)

const BASE: OpenOptions = {
  projectRoot: '/proj/root',
  threadId: 'thread-1',
  mcp: { url: 'http://127.0.0.1:4321/mcp', token: 'tok-abc' },
  bundleDir: '/app/agent-bundle',
  systemPromptFile: '/app/agent-bundle/system/studio.md',
  mode: 'chat',
}

// ---------- jsonl ----------

describe('jsonl', () => {
  it('LineSplitter handles partial chunks and CRLF', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\n{"b":')).toEqual(['{"a":1}'])
    expect(s.push('2}\r\n\n{"c"')).toEqual(['{"b":2}'])
    expect(s.push(':3}')).toEqual([])
    expect(s.flush()).toBe('{"c":3}')
  })

  it('EventQueue delivers to on() and to for-await, then ends', async () => {
    const q = new EventQueue<number>()
    const seen: number[] = []
    const off = q.on((n) => seen.push(n))
    q.push(1)
    q.push(2)
    off()
    q.push(3)
    q.end()
    const iterated: number[] = []
    for await (const n of q) iterated.push(n)
    expect(seen).toEqual([1, 2])
    expect(iterated).toEqual([1, 2, 3])
  })
})

// ---------- claude parser ----------

describe('claude parser (recorded samples)', () => {
  it('mcp.jsonl: session once, tool pairs, usage per turn, utilization folded in', async () => {
    const evs = parseClaudeEvents(await sample('claude/samples/mcp.jsonl'))

    const sessions = by(evs, 'session')
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ nativeSessionId: 'a834f804-a338-4c48-9804-711cd6ee50c0', model: 'claude-fable-5-1', mcpOk: true })
    expect(sessions[0].tools).toContain('mcp__conti__shots_list')

    expect(by(evs, 'turn_start')).toHaveLength(4)
    expect(by(evs, 'turn_end').map((e) => e.stop)).toEqual(['success', 'success', 'success', 'success'])
    expect(by(evs, 'error')).toEqual([])

    const starts = by(evs, 'tool_start')
    expect(starts.map((s) => s.name)).toEqual([
      'ToolSearch', 'mcp__conti__shots_list', 'mcp__conti__image_view', 'ToolSearch',
      'mcp__conti__slow_wait', 'mcp__conti__slow_wait', 'mcp__conti__slow_wait',
    ])
    expect(starts[2].input).toEqual({ shot: '0010' })
    const ends = by(evs, 'tool_end')
    expect(ends).toHaveLength(starts.length)
    for (const s of starts) {
      const e = ends.find((x) => x.id === s.id)
      expect(e, s.id).toBeDefined()
      expect(e!.ok).toBe(true)
      expect(evs.indexOf(e!)).toBeGreaterThan(evs.indexOf(s))
    }
    expect(ends.find((e) => e.id === starts[1].id)!.summary.startsWith('{"seq":"S01"')).toBe(true)
    expect(ends.find((e) => e.id === starts[2].id)!.summary).toBe('[image]')

    // 스트리밍 델타를 이어 붙이면 완성 텍스트와 같다
    const deltas = by(evs, 'text_delta').map((e) => e.text).join('')
    const texts = by(evs, 'text').map((e) => e.text)
    expect(deltas).toBe(texts.join(''))
    expect(texts).toContain('COUNT=3 COLOR=red')

    expect(by(evs, 'usage')).toEqual([
      { t: 'usage', inTok: 66, outTok: 263, cacheRead: 81644, cacheWrite: 20088, costUsd: 0.435981, utilization: { fiveHour: 0.1, sevenDay: 0.03 } },
      { t: 'usage', inTok: 66, outTok: 177, cacheRead: 103165, cacheWrite: 478, costUsd: 0.48084225, utilization: { fiveHour: 0.11, sevenDay: 0.03 } },
      { t: 'usage', inTok: 34, outTok: 66, cacheRead: 69500, cacheWrite: 179, costUsd: 0.5054372500000001, utilization: undefined },
      { t: 'usage', inTok: 34, outTok: 66, cacheRead: 69858, cacheWrite: 179, costUsd: 0.5301217500000001, utilization: { fiveHour: 0.12, sevenDay: 0.03 } },
    ])
    // 순서: usage 가 turn_end 바로 앞
    for (const te of by(evs, 'turn_end')) expect(evs[evs.indexOf(te) - 1].t).toBe('usage')
  })

  it('multiturn.jsonl: one session, two turns, exact usage numbers', async () => {
    const evs = parseClaudeEvents(await sample('claude/samples/multiturn.jsonl'))
    expect(by(evs, 'session')).toHaveLength(1)
    expect(by(evs, 'turn_start')).toHaveLength(2)
    expect(by(evs, 'text').map((e) => e.text)).toEqual(['ok', '7319'])
    expect(by(evs, 'text_delta').map((e) => e.text)).toEqual(['ok', '7319'])
    expect(by(evs, 'usage')).toEqual([
      { t: 'usage', inTok: 2, outTok: 4, cacheRead: 10482, cacheWrite: 23188, costUsd: 0.46660050000000003, utilization: { fiveHour: 0.06, sevenDay: 0.02 } },
      { t: 'usage', inTok: 2, outTok: 4, cacheRead: 33670, cacheWrite: 6285, costUsd: 0.600938, utilization: { fiveHour: 0.07, sevenDay: 0.02 } },
    ])
    expect(by(evs, 'turn_end')).toEqual([{ t: 'turn_end', stop: 'success', structured: undefined }, { t: 'turn_end', stop: 'success', structured: undefined }])
  })

  it('schema.json: structured output lands on turn_end', async () => {
    const evs = parseClaudeEvents(await sample('claude/samples/schema.json'))
    const ends = by(evs, 'turn_end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toEqual({ t: 'turn_end', stop: 'success', structured: { ok: true, n: 42 } })
    expect(by(evs, 'usage')[0]).toMatchObject({ inTok: 2, outTok: 82, cacheRead: 0, cacheWrite: 17740, costUsd: 0.35892 })
  })

  it('maps error results and auth / limit text', () => {
    const run = (r: Record<string, unknown>) => parseClaudeEvents([{ type: 'result', usage: {}, ...r }])
    expect(by(run({ subtype: 'error_max_turns', is_error: true, result: 'max turns' }), 'error')).toEqual([{ t: 'error', kind: 'other', message: 'max turns' }])
    expect(by(run({ subtype: 'error', is_error: true, result: 'Not logged in. Please run claude login' }), 'error')[0].kind).toBe('auth')
    expect(by(run({ subtype: 'error', is_error: true, result: 'Invalid API key' }), 'error')[0].kind).toBe('auth')
    expect(by(run({ subtype: 'error', is_error: true, result: 'API error 429: overage not allowed' }), 'error')[0].kind).toBe('usage_limit')
    expect(by(run({ subtype: 'error', is_error: true, result: 'x' }), 'turn_end')).toEqual([{ t: 'turn_end', stop: 'error', structured: undefined }])
    const mcpDown = parseClaudeEvents([{ type: 'system', subtype: 'init', session_id: 's', mcp_servers: [{ name: 'conti', status: 'failed' }] }])
    expect(mcpDown.map((e) => e.t)).toEqual(['session', 'error', 'turn_start'])
    expect((mcpDown[0] as { mcpOk?: boolean }).mcpOk).toBe(false)
  })
})

// ---------- codex parser ----------

describe('codex parser (recorded samples)', () => {
  it('t1-mcp-headers.jsonl: thread → session, mcp_tool_call pairs, usage, turn_end', async () => {
    const evs = parseCodexEvents(await sample('codex/samples/t1-mcp-headers.jsonl'))
    expect(by(evs, 'session')).toEqual([{ t: 'session', nativeSessionId: '01a12110-926a-7cb1-8229-23db470e6bb1' }])
    expect(by(evs, 'turn_start')).toHaveLength(1)
    const starts = by(evs, 'tool_start')
    expect(starts).toEqual([
      { t: 'tool_start', id: 'item_1', name: 'mcp__conti__shots_list', input: { seq: 'S41' } },
      { t: 'tool_start', id: 'item_2', name: 'mcp__conti__image_view', input: { shot: '0010' } },
    ])
    const ends = by(evs, 'tool_end')
    expect(ends.map((e) => [e.id, e.ok])).toEqual([['item_1', true], ['item_2', true]])
    expect(ends[0].summary.startsWith('{"shots":[')).toBe(true)
    expect(ends[1].summary).toBe('image for shot 0010 (1x1 red png) [image]')
    expect(by(evs, 'text').map((e) => e.text)).toEqual(['I’ll call shots_list for S41, then image_view for shot 0010.', 'ok'])
    expect(by(evs, 'text_delta').map((e) => e.text)).toEqual(by(evs, 'text').map((e) => e.text))
    expect(by(evs, 'usage')).toEqual([{ t: 'usage', inTok: 71525, outTok: 151, cacheRead: 61440, cacheWrite: 0 }])
    expect(evs.at(-1)).toEqual({ t: 'turn_end', stop: 'completed' })
    expect(by(evs, 'error')).toEqual([])
  })

  it('t1-mcp-bearer.jsonl: failed MCP calls → tool_end ok=false with the error message', async () => {
    const evs = parseCodexEvents(await sample('codex/samples/t1-mcp-bearer.jsonl'))
    expect(by(evs, 'tool_end')).toEqual([
      { t: 'tool_end', id: 'item_1', ok: false, summary: 'MCP tool call requires approval, but approval policy is never' },
      { t: 'tool_end', id: 'item_2', ok: false, summary: 'MCP tool call requires approval, but approval policy is never' },
    ])
  })

  it('t5-schema.jsonl: exact sequence', async () => {
    const evs = parseCodexEvents(await sample('codex/samples/t5-schema.jsonl'))
    expect(evs).toEqual([
      { t: 'session', nativeSessionId: '01a12111-8c5d-79a1-bc49-1d01f3322508' },
      { t: 'turn_start' },
      { t: 'text_delta', text: '{"ok":true,"n":42}' },
      { t: 'text', text: '{"ok":true,"n":42}' },
      { t: 'usage', inTok: 16068, outTok: 19, cacheRead: 0, cacheWrite: 0 },
      { t: 'turn_end', stop: 'completed' },
    ])
  })

  it('t4-resume.jsonl: command_execution → shell tool pair', async () => {
    const evs = parseCodexEvents(await sample('codex/samples/t4-resume.jsonl'))
    expect(by(evs, 'tool_start')).toEqual([{ t: 'tool_start', id: 'item_0', name: 'shell', input: { command: '/bin/zsh -lc pwd' } }])
    const end = by(evs, 'tool_end')[0]
    expect(end.ok).toBe(true)
    expect(end.summary).toContain('fixtures/projB')
  })

  it('turn.failed / error items become error events', () => {
    const evs = parseCodexEvents([
      { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Code Mode is unavailable' } },
      { type: 'turn.failed', error: { message: 'Not logged in' } },
    ])
    expect(evs).toEqual([
      { t: 'error', kind: 'other', message: 'Code Mode is unavailable' },
      { t: 'error', kind: 'auth', message: 'Not logged in' },
      { t: 'turn_end', stop: 'failed' },
    ])
  })

  it('generatedImages finds files created during the turn', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conti-codex-home-'))
    const dir = join(home, 'generated_images', 'thr-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'old.png'), 'x')
    await utimes(join(dir, 'old.png'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    await writeFile(join(dir, 'new.png'), 'x')
    await writeFile(join(dir, 'note.txt'), 'x')
    expect(generatedImages('thr-1', Date.now() - 5000, home)).toEqual([join(dir, 'new.png')])
    expect(generatedImages(undefined, 0, home)).toEqual([])
    await rm(home, { recursive: true, force: true })
  })
})

// ---------- arg builders ----------

describe('arg builders', () => {
  const MCP_JSON = '{"mcpServers":{"conti":{"type":"http","url":"http://127.0.0.1:4321/mcp","headers":{"Authorization":"Bearer tok-abc"}}}}'

  it('mcpConfigJson matches the verified shape', () => {
    expect(mcpConfigJson(BASE.mcp)).toBe(MCP_JSON)
  })

  it('claude chat args (exact)', () => {
    const args = buildClaudeArgs({ ...BASE, model: 'opus', effort: 'high' }, { sessionId: '0000-uuid' })
    expect(args).toEqual([
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompts', 'none',
      '--setting-sources', 'project',
      '--plugin-dir', '/app/agent-bundle',
      '--mcp-config', MCP_JSON,
      '--strict-mcp-config',
      '--tools', 'Read,Glob,Grep,Skill',
      '--allowedTools', 'Skill', 'mcp__conti__*',
      '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch',
      '--append-system-prompt-file', '/app/agent-bundle/system/studio.md',
      '--model', 'opus',
      '--effort', 'high',
      '--session-id', '0000-uuid',
    ])
  })

  it('claude task / resume variants, and a generated v4 uuid', () => {
    const task = buildClaudeArgs({ ...BASE, mode: 'task', systemPromptFile: undefined })
    expect(task.at(-1)).toBe('--no-session-persistence')
    expect(task).not.toContain('--session-id')
    expect(task).not.toContain('--append-system-prompt-file')
    const resumed = buildClaudeArgs({ ...BASE, resume: 'abc-123' })
    expect(resumed.slice(-2)).toEqual(['--resume', 'abc-123'])
    expect(resumed).not.toContain('--session-id')
    const fresh = buildClaudeArgs(BASE)
    expect(fresh.at(-1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('claude: the prompt goes over stdin as a user message, never argv', async () => {
    const args = buildClaudeArgs(BASE)
    expect(args.join(' ')).not.toMatch(/hello/)
    const line = await userMessageLine({ text: 'hello', images: ['data:image/png;base64,AAAA'] })
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'hello' }],
      },
    })
  })

  it('codex first-turn args (exact)', () => {
    const args = buildCodexArgs({ ...BASE, sandbox: 'workspace-write', model: 'gpt-5.5', effort: 'high' }, { images: ['/tmp/a.png'] })
    expect(args).toEqual([
      'exec', '--json', '-i', '/tmp/a.png',
      '--skip-git-repo-check', '--ignore-user-config',
      '-s', 'workspace-write',
      '-C', '/proj/root',
      '-c', 'mcp_servers.conti.url="http://127.0.0.1:4321/mcp"',
      '-c', 'mcp_servers.conti.bearer_token_env_var="CONTI_MCP_TOKEN"',
      '-c', 'mcp_servers.conti.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.conti.startup_timeout_sec=20',
      '-m', 'gpt-5.5',
      '-c', 'model_reasoning_effort="high"',
      '-',
    ])
    expect(buildCodexArgs(BASE).slice(0, 6)).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only'])
  })

  it('codex resume args (exact; no -C / -s)', () => {
    const args = buildCodexArgs(BASE, { resume: 'thr-9' })
    expect(args).toEqual([
      'exec', 'resume', 'thr-9', '--all', '--json',
      '--skip-git-repo-check', '--ignore-user-config',
      '-c', 'mcp_servers.conti.url="http://127.0.0.1:4321/mcp"',
      '-c', 'mcp_servers.conti.bearer_token_env_var="CONTI_MCP_TOKEN"',
      '-c', 'mcp_servers.conti.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.conti.startup_timeout_sec=20',
      '-',
    ])
    expect(args).not.toContain('-C')
    expect(args).not.toContain('-s')
    expect(args.join(' ')).not.toMatch(/tok-abc/) // 토큰은 env 로만
  })

  it('wrapSystemPrompt', () => {
    expect(wrapSystemPrompt('rule A\n', 'hi')).toBe('<studio_rules>\nrule A\n</studio_rules>\n\nhi')
  })
})

// ---------- fake-binary integration ----------

const FAKE_CLAUDE = `
const fs = require('fs');
const rl = require('readline').createInterface({ input: process.stdin });
const sid = '11111111-1111-4111-8111-111111111111';
const emit = (o) => process.stdout.write(JSON.stringify({ session_id: sid, ...o }) + '\\n');
if (process.env.FAKE_ARGV_OUT) fs.writeFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: { a: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, b: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY } }));
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const text = msg.message.content.find((c) => c.type === 'text').text;
  emit({ type: 'system', subtype: 'init', model: 'fake-model', tools: ['Read', 'mcp__conti__ping'], mcp_servers: [{ name: 'conti', status: 'connected' }] });
  if (text === 'hang') return; // 턴을 끝내지 않고 매달린다 (interrupt 테스트)
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'echo:' } } });
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }).slice(0, 20)); // 부분 청크
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }).slice(20) + '\\n');
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__conti__ping', input: { x: 1 } }] } });
    emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'pong' }] }] } });
    emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'echo:' + text }] } });
    emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.5 }, seven_day: { utilization: 0.2 } } } });
    emit({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 }, total_cost_usd: 0.01, result: 'echo:' + text });
  }, 20);
});
rl.on('close', () => setTimeout(() => process.exit(0), 50));
`

const FAKE_CODEX = `
const fs = require('fs');
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const argv = process.argv.slice(2);
  if (process.env.FAKE_ARGV_OUT) fs.writeFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify({ argv, input, cwd: process.cwd(), token: process.env.CONTI_MCP_TOKEN }));
  const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  emit({ type: 'thread.started', thread_id: 'thread-fake-1' });
  emit({ type: 'turn.started' });
  if (input === 'sleep') { // 턴을 끝내지 않고 매달린다 (interrupt 테스트)
    emit({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'sleep 30', aggregated_output: '', exit_code: null, status: 'in_progress' } });
    setTimeout(() => {}, 30000);
    return;
  }
  emit({ type: 'item.started', item: { id: 'item_1', type: 'mcp_tool_call', server: 'conti', tool: 'ping', arguments: { x: 1 }, result: null, error: null, status: 'in_progress' } });
  emit({ type: 'item.completed', item: { id: 'item_1', type: 'mcp_tool_call', server: 'conti', tool: 'ping', arguments: { x: 1 }, result: { content: [{ type: 'text', text: 'pong' }] }, error: null, status: 'completed' } });
  emit({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'echo:' + input } });
  emit({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 0, output_tokens: 7, reasoning_output_tokens: 0 } });
});
`

function collect(session: AgentSession): { events: AgentEvent[]; waitFor: (pred: (e: AgentEvent) => boolean, ms?: number) => Promise<AgentEvent> } {
  const events: AgentEvent[] = []
  const waiters: Array<{ pred: (e: AgentEvent) => boolean; resolve: (e: AgentEvent) => void }> = []
  session.on((e) => {
    events.push(e)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(e)) waiters.splice(i, 1)[0].resolve(e)
    }
  })
  return {
    events,
    waitFor: (pred, ms = 5000) =>
      new Promise((resolve, reject) => {
        const hit = events.find(pred)
        if (hit) return resolve(hit)
        const t = setTimeout(() => reject(new Error(`timeout; got ${events.map((e) => e.t).join(',')}`)), ms)
        waiters.push({ pred, resolve: (e) => (clearTimeout(t), resolve(e)) })
      }),
  }
}

describe('fake-binary integration', () => {
  let dir: string
  let fakeClaude: string
  let fakeCodex: string
  let rulesFile: string

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'conti-agents-')))
    fakeClaude = join(dir, 'fake-claude')
    fakeCodex = join(dir, 'fake-codex')
    rulesFile = join(dir, 'studio.md')
    await writeFile(fakeClaude, `#!${process.execPath}\n${FAKE_CLAUDE}`)
    await writeFile(fakeCodex, `#!${process.execPath}\n${FAKE_CODEX}`)
    await chmod(fakeClaude, 0o755)
    await chmod(fakeCodex, 0o755)
    await writeFile(rulesFile, 'RULE-ONE\n')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('claude: live session streams events over two turns, close() leaves no child', async () => {
    const argvOut = join(dir, 'claude-argv.json')
    const session = await claudeAdapter.open({ ...BASE, projectRoot: dir, systemPromptFile: rulesFile, exe: fakeClaude, env: { FAKE_ARGV_OUT: argvOut } })
    const pid = (session as unknown as { pid: number }).pid
    expect(pid).toBeGreaterThan(0)

    const iterated: AgentEvent[] = []
    const iterDone = (async () => {
      for await (const e of session.events) iterated.push(e)
    })()
    const c = collect(session)

    await session.send({ text: 'hello' })
    await c.waitFor((e) => e.t === 'turn_end')
    expect(c.events.map((e) => e.t)).toEqual(['session', 'turn_start', 'text_delta', 'text_delta', 'tool_start', 'tool_end', 'text', 'usage', 'turn_end'])
    expect(c.events[0]).toEqual({ t: 'session', nativeSessionId: '11111111-1111-4111-8111-111111111111', model: 'fake-model', mcpOk: true, tools: ['Read', 'mcp__conti__ping'] })
    expect(session.nativeSessionId).toBe('11111111-1111-4111-8111-111111111111')
    expect(by(c.events, 'text_delta').map((e) => e.text).join('')).toBe('echo:hello')
    expect(by(c.events, 'tool_end')[0]).toEqual({ t: 'tool_end', id: 'toolu_1', ok: true, summary: 'pong' })
    expect(by(c.events, 'usage')[0]).toEqual({ t: 'usage', inTok: 10, outTok: 5, cacheRead: 1, cacheWrite: 2, costUsd: 0.01, utilization: { fiveHour: 0.5, sevenDay: 0.2 } })

    await session.send({ text: 'again' })
    await c.waitFor((e) => e.t === 'text' && e.text === 'echo:again')
    await c.waitFor((e) => e.t === 'turn_end' && c.events.filter((x) => x.t === 'turn_end').length >= 2)
    expect(by(c.events, 'session')).toHaveLength(1) // init 이 다시 와도 세션은 한 번
    expect(by(c.events, 'turn_start')).toHaveLength(2)

    const recorded = JSON.parse(await readFile(argvOut, 'utf8'))
    expect(recorded.argv).toEqual(buildClaudeArgs({ ...BASE, projectRoot: dir, systemPromptFile: rulesFile }, { sessionId: recorded.argv.at(-1) }))
    expect(recorded.argv.join(' ')).not.toMatch(/hello|again/)
    expect(recorded.cwd).toBe(dir)
    expect(recorded.env).toEqual({ a: '1', b: '1' })

    await session.close()
    await iterDone
    expect(iterated.at(-1)).toEqual({ t: 'exit', code: 0 })
    expect(iterated.map((e) => e.t)).toEqual(c.events.map((e) => e.t))
    expect(isAlive(pid)).toBe(false)
    await expect(session.send({ text: 'x' })).rejects.toThrow(/closed/)
  })

  it('claude: interrupt() kills the process and ends the open turn', async () => {
    const session = await claudeAdapter.open({ ...BASE, projectRoot: dir, exe: fakeClaude })
    const pid = (session as unknown as { pid: number }).pid
    const c = collect(session)
    await session.send({ text: 'hang' })
    await c.waitFor((e) => e.t === 'turn_start')
    await session.interrupt()
    await c.waitFor((e) => e.t === 'exit')
    expect(by(c.events, 'turn_end').at(-1)).toEqual({ t: 'turn_end', stop: 'interrupted' })
    expect(isAlive(pid)).toBe(false)
  })

  it('codex: one process per turn, rules prepended once, resume on the second turn', async () => {
    const argvOut = join(dir, 'codex-argv.json')
    const session = await codexAdapter.open({ ...BASE, projectRoot: dir, systemPromptFile: rulesFile, exe: fakeCodex, env: { FAKE_ARGV_OUT: argvOut } })
    const c = collect(session)

    await session.send({ text: 'hello' })
    const pid1 = (session as unknown as { pid: number }).pid
    await c.waitFor((e) => e.t === 'turn_end')
    expect(c.events).toEqual([
      { t: 'session', nativeSessionId: 'thread-fake-1' },
      { t: 'turn_start' },
      { t: 'tool_start', id: 'item_1', name: 'mcp__conti__ping', input: { x: 1 } },
      { t: 'tool_end', id: 'item_1', ok: true, summary: 'pong' },
      { t: 'text_delta', text: 'echo:<studio_rules>\nRULE-ONE\n</studio_rules>\n\nhello' },
      { t: 'text', text: 'echo:<studio_rules>\nRULE-ONE\n</studio_rules>\n\nhello' },
      { t: 'usage', inTok: 100, outTok: 7, cacheRead: 40, cacheWrite: 0 },
      { t: 'turn_end', stop: 'completed' },
    ])
    expect(session.nativeSessionId).toBe('thread-fake-1')
    let rec = JSON.parse(await readFile(argvOut, 'utf8'))
    expect(rec.argv).toEqual(buildCodexArgs({ ...BASE, projectRoot: dir }))
    expect(rec.argv.join(' ')).not.toMatch(/hello|RULE-ONE/)
    expect(rec.token).toBe('tok-abc')
    expect(rec.cwd).toBe(dir)
    expect(isAlive(pid1)).toBe(false) // 턴 프로세스는 턴 끝에 사라진다

    await session.send({ text: 'again', images: ['data:image/png;base64,iVBORw0KGgo='] })
    await c.waitFor((e) => e.t === 'text' && e.text === 'echo:again')
    await c.waitFor((e) => e.t === 'turn_end' && c.events.filter((x) => x.t === 'turn_end').length >= 2)
    expect(by(c.events, 'session')).toHaveLength(1)
    rec = JSON.parse(await readFile(argvOut, 'utf8'))
    expect(rec.argv.slice(0, 5)).toEqual(['exec', 'resume', 'thread-fake-1', '--all', '--json'])
    expect(rec.argv[5]).toBe('-i')
    expect(rec.argv[6]).toMatch(/img0\.png$/)
    expect(rec.input).toBe('again')

    await session.close()
    expect(c.events.at(-1)).toEqual({ t: 'exit', code: 0 })
    await expect(session.send({ text: 'x' })).rejects.toThrow(/closed/)
  })

  it('codex: interrupt() sends SIGINT, the turn ends as interrupted, no child survives', async () => {
    const session = await codexAdapter.open({ ...BASE, projectRoot: dir, systemPromptFile: undefined, exe: fakeCodex })
    const c = collect(session)
    await session.send({ text: 'sleep' })
    const pid = (session as unknown as { pid: number }).pid
    await c.waitFor((e) => e.t === 'tool_start')
    await session.interrupt()
    await c.waitFor((e) => e.t === 'turn_end')
    expect(by(c.events, 'turn_end')).toEqual([{ t: 'turn_end', stop: 'interrupted' }])
    expect(by(c.events, 'error')).toEqual([])
    expect(isAlive(pid)).toBe(false)
    await session.send({ text: 'next' }) // 인터럽트 뒤에도 세션은 살아 있어 다음 턴을 보낼 수 있다
    await c.waitFor((e) => e.t === 'turn_end' && c.events.filter((x) => x.t === 'turn_end').length >= 2)
    await session.close()
  })

  it('codex: a process that dies without turn.completed → crash error', async () => {
    const dead = join(dir, 'fake-dead')
    await writeFile(dead, `#!${process.execPath}\nprocess.stderr.write('boom\\n'); process.exit(3)\n`)
    await chmod(dead, 0o755)
    const session = await codexAdapter.open({ ...BASE, projectRoot: dir, systemPromptFile: undefined, exe: dead })
    const c = collect(session)
    await session.send({ text: 'x' })
    await c.waitFor((e) => e.t === 'turn_end')
    expect(by(c.events, 'error')[0]).toMatchObject({ kind: 'crash' })
    expect(by(c.events, 'error')[0].message).toContain('boom')
    expect(by(c.events, 'turn_end')[0]).toEqual({ t: 'turn_end', stop: 'crash' })
    await session.close()
  })

  it('adapters map + pickAvailable returns null when nothing is logged in', async () => {
    expect(Object.keys(adapters).sort()).toEqual(['claude', 'codex'])
    const orig = { c: adapters.claude.detect, x: adapters.codex.detect }
    adapters.claude.detect = async () => ({ installed: true, auth: 'missing' })
    adapters.codex.detect = async () => ({ installed: false, auth: 'unknown' })
    try {
      expect(await pickAvailable('codex')).toBeNull()
      adapters.codex.detect = async () => ({ installed: true, auth: 'ok' })
      expect(await pickAvailable('claude')).toBe('codex')
      adapters.claude.detect = async () => ({ installed: true, auth: 'ok' })
      expect(await pickAvailable('codex')).toBe('codex')
      expect(await pickAvailable()).toBe('claude')
    } finally {
      adapters.claude.detect = orig.c
      adapters.codex.detect = orig.x
    }
  })
})
