// What a proposal shows before it is confirmed (spec 009 S-3): the fingerprint of the user's data
// and the months' transfer and distribution before and after. Pure over the rows readState()
// returns (no database), computed with the same overview() the read tools use, so the preview
// and the screens agree.
import { createHash } from 'node:crypto'
import { overview } from './mcp/views'
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

/** SHA-256 of the user's whole data as readState() returns it. */
export const hashState = (state: unknown) => createHash('sha256').update(canonical(state)).digest('hex')

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
