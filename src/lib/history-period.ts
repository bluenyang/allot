// The period filter of 변경 내역 (spec 013 S-18): what `GET /api/changes?since=&until=` gets. `since` is inclusive,
// `until` exclusive, both ISO times at the start of a day in Korea time (KST, UTC+9: the app's day). Pure; no UI.
import { addYm } from './calc'

export type PeriodKind = 'month' | 'months3' | 'all' | 'custom'
export const PERIOD_KINDS: PeriodKind[] = ['month', 'months3', 'all', 'custom']

const KST_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** The day (YYYY-MM-DD) in Korea time at the given moment. */
export const kstDay = (at: Date) => new Date(at.getTime() + KST_MS).toISOString().slice(0, 10)

/** The moment a KST day (YYYY-MM-DD) starts, as an ISO time. */
export const kstStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - KST_MS).toISOString()

/** The moment the KST day after `day` starts: the exclusive end of a period that ends on `day`. */
export const kstAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - KST_MS + DAY_MS).toISOString()

/**
 * The query bounds of a period. 이번 달 = from the 1st of this month; 지난 3달 = this month and the two before it;
 * 전체 = none; 직접 = from the start day (inclusive) to the end day (inclusive), either may be left empty.
 */
export function periodBounds(kind: PeriodKind, now: Date, from = '', to = ''): { since?: string; until?: string } {
  const ym = kstDay(now).slice(0, 7)
  if (kind === 'month') return { since: kstStart(`${ym}-01`) }
  if (kind === 'months3') return { since: kstStart(`${addYm(ym, -2)}-01`) }
  if (kind === 'custom') return { ...(isYmd(from) ? { since: kstStart(from) } : {}), ...(isYmd(to) ? { until: kstAfter(to) } : {}) }
  return {}
}

/** The bounds as query parameters (`&since=…&until=…`), '' for none. */
export function periodQuery(b: { since?: string; until?: string }): string {
  return (b.since ? `&since=${encodeURIComponent(b.since)}` : '') + (b.until ? `&until=${encodeURIComponent(b.until)}` : '')
}
