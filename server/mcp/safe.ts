// What a tool may say about a failure (spec 008 S-8): the SDK sends an exception's message to the
// client as it is, and a database error's message holds the SQL and its values. Every tool callback
// runs inside `guarded`, so the client gets one generic answer and the cause stays in the server log.
import type { CallToolResult } from '@modelcontextprotocol/server'

export const INTERNAL_ERROR = 'Internal error'

/** Run a tool; whatever it throws becomes a generic error result. The log has the tool and the error's name and code, never its message (SQL, values). */
export function guarded<A>(tool: string, fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args)
    } catch (e) {
      const err = e as { name?: string; code?: string; cause?: { code?: string } }
      console.warn(`mcp: tool ${tool} failed: ${err?.name ?? 'Error'} ${err?.code ?? err?.cause?.code ?? ''}`.trim())
      return { isError: true, content: [{ type: 'text', text: INTERNAL_ERROR }] }
    }
  }
}

/** A real point in time in the form the history returns (`2026-11-16 09:30:00.123456+00`): the calendar date and clock exist, the offset is one PostgreSQL takes. */
export function isTimestamp(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2})(?::?(\d{2}))?)$/.exec(s)
  if (!m) return false
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  if (y < 1 || h > 23 || mi > 59 || se > 59) return false
  const t = new Date(Date.UTC(2000, mo - 1, d, h, mi, se))
  t.setUTCFullYear(y)
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return false
  if (m[8] !== undefined && (Number(m[8]) > 15 || Number(m[9] ?? 0) > 59)) return false
  return true
}
