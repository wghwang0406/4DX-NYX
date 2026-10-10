// stdout JSONL 처리 — 부분 청크를 견디는 줄 분리기, JSON 파서, AsyncIterable 이벤트 큐.

/** 청크 경계가 줄 중간에 와도 되는 줄 분리기. `\r\n` 도 받는다. */
export class LineSplitter {
  private buf = ''

  push(chunk: string | Buffer): string[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const out: string[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')
      this.buf = this.buf.slice(i + 1)
      if (line.trim()) out.push(line)
    }
    return out
  }

  /** 스트림이 끝났을 때 남은 꼬리 (개행 없이 끝난 마지막 줄). */
  flush(): string | undefined {
    const rest = this.buf.trim()
    this.buf = ''
    return rest || undefined
  }
}

/** JSON 한 줄을 객체로. JSON 이 아니면 undefined (stderr 섞임·배너 등은 버린다). */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
  const s = line.trim()
  if (!s.startsWith('{')) return undefined
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 파일/문자열 전체를 이벤트 객체 배열로 (테스트·샘플 재생용). `_spike_meta` 줄은 건너뛴다. */
export function parseJsonlText(text: string): Record<string, unknown>[] {
  const sp = new LineSplitter()
  const lines = sp.push(text)
  const tail = sp.flush()
  if (tail) lines.push(tail)
  const out: Record<string, unknown>[] = []
  for (const l of lines) {
    const o = parseJsonLine(l)
    if (o && o.type !== '_spike_meta') out.push(o)
  }
  return out
}

/**
 * push 기반 이벤트 큐. `on()` 구독자는 즉시 받고, `for await` 소비자는 버퍼에서 순서대로 받는다.
 * `end()` 뒤에는 반복이 끝난다. 반복자는 하나만 두는 걸 전제로 한다 (두 개 이상이면 번갈아 나눠 받는다).
 */
export class EventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private waiters: Array<(r: IteratorResult<T>) => void> = []
  private listeners = new Set<(e: T) => void>()
  private ended = false

  push(e: T): void {
    if (this.ended) return
    for (const fn of this.listeners) {
      try {
        fn(e)
      } catch {
        /* 구독자 오류는 큐를 멈추지 않는다 */
      }
    }
    const w = this.waiters.shift()
    if (w) w({ value: e, done: false })
    else this.buffer.push(e)
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as T, done: true })
  }

  get isEnded(): boolean {
    return this.ended
  }

  on(fn: (e: T) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift() as T, done: false })
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
      return: (): Promise<IteratorResult<T>> => Promise.resolve({ value: undefined as unknown as T, done: true }),
    }
  }
}
