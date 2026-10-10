import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** 데이터는 항상 text JSON 한 블록. */
export function ok(data: unknown, extra: CallToolResult['content'] = []): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }, ...extra] }
}

/** 실패는 isError + 한국어 메시지. 보고서(report)가 있으면 JSON 으로 같이 싣는다. */
export function fail(message: string, report?: unknown): CallToolResult {
  const text = report === undefined ? message : `${message}\n${JSON.stringify(report)}`
  return { content: [{ type: 'text', text }], isError: true }
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly report?: unknown,
  ) {
    super(message)
  }
}

/** fields 가 주어지면 그 키만 남긴다. 배열이면 원소마다. */
export function project<T extends object>(value: T, fields?: string[]): Partial<T>
export function project<T extends object>(value: T[], fields?: string[]): Partial<T>[]
export function project(value: object | object[], fields?: string[]): unknown {
  if (!fields?.length) return value
  const pick = (o: object) => Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, (o as Record<string, unknown>)[f]]))
  return Array.isArray(value) ? value.map(pick) : pick(value)
}

/** 기본 응답에서 무거운 키를 뺀다 (fields 가 없을 때만). */
export function omit<T extends object>(value: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (!keys.includes(k)) out[k] = v
  return out as Partial<T>
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
