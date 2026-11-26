// What a proposal shows before it is confirmed (spec 009 S-3): the fingerprint of the user's data
// and the months' transfer and distribution before and after. Pure over the rows readState()
// returns (no database), computed with the same overview() the read tools use, so the preview
// and the screens agree. The income rows (spec 014 S-10) also get a line in words, with the left over of their month.
import { createHash } from 'node:crypto'
import { moneyOf, monthOfDate, overview } from './mcp/views'
import type { Data } from './mcp/views'

/** JSON with object keys in sorted order, so the same data always gives the same text. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(x) ?? 'null'
}

/**
 * Fields only the server writes when it refreshes exchange rates (spec 013 S-23): when the last refresh ran and why it
 * failed. They are not the user's data, so a refresh that changes no rate leaves a pending proposal valid.
 */
const REFRESH_ONLY = ['fxAutoAt', 'fxAutoError', 'autoAt', 'autoError']
const withoutRefreshMarks = (state: unknown): unknown => {
  const s = state as { settings?: Record<string, unknown>; currencies?: Record<string, unknown>[] } | null
  if (!s || typeof s !== 'object') return state
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !REFRESH_ONLY.includes(k)))
  return {
    ...s,
    ...(s.settings ? { settings: drop(s.settings) } : {}),
    ...(Array.isArray(s.currencies) ? { currencies: s.currencies.map(drop) } : {}),
  }
}

/** SHA-256 of the user's whole data as readState() returns it (without the rate refresh marks). */
export const hashState = (state: unknown) => createHash('sha256').update(canonical(withoutRefreshMarks(state))).digest('hex')

export interface Delta<T> { before: T; after: T }
export interface MonthPreview {
  month: string
  /** What goes to the subscription account that month. */
  transferKrw: Delta<number>
  neededKrw: Delta<number>
  /** One entry per allocation target that either side has; null where the target did not exist. */
  distribution: { targetId: string; name: string; kind: string; amountKrw: Delta<number | null> }[]
  remainderKrw: Delta<number>
}

/** One month's transfer and distribution computed from the data before and after the changes. */
export function monthPreview(before: Data, after: Data, ym: string): MonthPreview {
  const b = overview(before, ym)
  const a = overview(after, ym)
  const rows = new Map<string, { name: string; kind: string; b: number | null; a: number | null }>()
  for (const r of b.distribution.rows) rows.set(r.targetId, { name: r.name, kind: r.kind, b: r.amountKrw, a: null })
  for (const r of a.distribution.rows) {
    const x = rows.get(r.targetId)
    if (x) { x.a = r.amountKrw; x.name = r.name; x.kind = r.kind } else rows.set(r.targetId, { name: r.name, kind: r.kind, b: null, a: r.amountKrw })
  }
  return {
    month: ym,
    transferKrw: { before: b.subscriptionTransfer.transferKrw, after: a.subscriptionTransfer.transferKrw },
    neededKrw: { before: b.subscriptionTransfer.neededKrw, after: a.subscriptionTransfer.neededKrw },
    distribution: [...rows].map(([targetId, x]) => ({ targetId, name: x.name, kind: x.kind, amountKrw: { before: x.b, after: x.a } })),
    remainderKrw: { before: b.distribution.remainderKrw, after: a.distribution.remainderKrw },
  }
}

// ── Income rows in words (spec 014 S-10) ──
type Row = Record<string, unknown>
/** A changed row as the preview keeps it (table name, op, the row before and after). */
export interface PreviewRow { table: string; op: 'insert' | 'update' | 'delete'; before: Row | null; after: Row | null }

const won = (n: unknown) => `${Math.round(Number(n)).toLocaleString('en-US')} KRW`
/** "a" when both sides say the same, else "a → b"; one side only: that side. */
const both = (b: Row | null, a: Row | null, f: (r: Row) => string) => {
  const x = b ? f(b) : null
  const y = a ? f(a) : null
  return x === null ? y! : y === null || x === y ? x : `${x} → ${y}`
}
const verb = (op: PreviewRow['op']) => (op === 'insert' ? 'New' : op === 'delete' ? 'Deleted' : 'Changed')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The month's left over (여유: the remainder after the distribution), before and after, as words. */
function leftOver(before: Data, after: Data, ym: string) {
  const b = Math.round(moneyOf(before, ym).dist.remainder)
  const a = Math.round(moneyOf(after, ym).dist.remainder)
  return `left over of ${ym}: ${b === a ? won(a) : `${won(b)} → ${won(a)}`}`
}

/** The months a receipt or an extra counts in, from both sides, once each. */
const monthsOf = (b: Row | null, a: Row | null, f: (r: Row) => string) => [...new Set([b, a].filter((r): r is Row => !!r).map(f))].sort()

/**
 * One line in words for a changed income row: an income (name, amount, when), money received for one (whose, the month,
 * amount) or money that came in once (name, date, amount); for the last two also the left over of their month before
 * and after the whole proposal. Any other table: null (the screens word those rows themselves).
 */
export function incomeLine(row: PreviewRow, before: Data, after: Data): string | null {
  const { table, op, before: b, after: a } = row
  if (table === 'income_item') {
    const when = (r: Row) => (r.cycle === 'yearly' ? `every ${MONTHS[Number(r.month) - 1] ?? `month ${String(r.month)}`}` : 'every month') + ` on day ${String(r.day)}`
    return `${verb(op)} income "${both(b, a, (r) => String(r.name))}": ${both(b, a, (r) => won(r.amount))}, ${both(b, a, when)}.`
  }
  if (table === 'income_receipt') {
    const whose = (r: Row) => {
      if (r.itemId === null || r.itemId === undefined) return 'salary'
      const id = String(r.itemId)
      const item = (after.incomes ?? []).find((i) => i.id === id) ?? (before.incomes ?? []).find((i) => i.id === id)
      return item ? `"${item.name}"` : `income ${id}`
    }
    const months = monthsOf(b, a, (r) => String(r.ym))
    const on = (r: Row) => (r.date ? ` on ${String(r.date)}` : '')
    return `${verb(op)} money received for ${both(b, a, whose)} in ${both(b, a, (r) => String(r.ym))}: ${both(b, a, (r) => won(r.amount) + on(r))}; `
      + `${months.map((m) => leftOver(before, after, m)).join('; ')}.`
  }
  if (table === 'income_extra') {
    // the month each side counts it in: the one whose period holds its date, by that side's month basis (spec 018 S-3)
    const months = [...new Set([b ? monthOfDate(before, String(b.date)) : null, a ? monthOfDate(after, String(a.date)) : null].filter((m): m is string => !!m))].sort()
    return `${verb(op)} money that came in once "${both(b, a, (r) => String(r.name))}" on ${both(b, a, (r) => String(r.date))}: ${both(b, a, (r) => won(r.amount))}; `
      + `${months.map((m) => leftOver(before, after, m)).join('; ')}.`
  }
  return null
}
