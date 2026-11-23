// The period filter of 변경 내역 (spec 013 S-18): what `GET /api/changes?since=&until=` gets. `since` is inclusive,
// `until` exclusive, both ISO times at the start of a day in the user's time zone (spec 013 S-22, review rc3-1 F-4;
// Asia/Seoul when it is not set, as before). Pure; no UI.
import { addYm, DEFAULT_TIMEZONE, isTimeZone } from './calc'

export type PeriodKind = 'month' | 'months3' | 'all' | 'custom'
export const PERIOD_KINDS: PeriodKind[] = ['month', 'months3', 'all', 'custom']

const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const zoneOf = (tz: string | null | undefined) => (tz && isTimeZone(tz) ? tz : DEFAULT_TIMEZONE)

/** The wall-clock fields of the moment `ms` in the zone `tz`, read as if they were UTC (ms). */
function wallMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms))
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
}

/** The day (YYYY-MM-DD) in the zone `tz` at the given moment. */
export const dayIn = (at: Date, tz?: string | null) => new Date(wallMs(at.getTime(), zoneOf(tz))).toISOString().slice(0, 10)

/**
 * The moment a day (YYYY-MM-DD) starts in the zone `tz`, as an ISO time: its local midnight, or, where a clock
 * change skips or repeats midnight, the first moment of that day.
 */
export function dayStart(day: string, tz?: string | null): string {
  const zone = zoneOf(tz)
  const wall = Date.parse(`${day}T00:00:00Z`)
  let at = wall - (wallMs(wall, zone) - wall) // first guess: the offset at that wall time read as UTC
  for (let i = 0; i < 2; i++) at = wall - (wallMs(at, zone) - at) // the offset at the guess itself (a clock change)
  // a skipped midnight lands in the day before: move on to the day's first moment; a repeated one, back to the first
  while (dayIn(new Date(at), zone) < day) at += 60_000
  while (dayIn(new Date(at - 60_000), zone) === day) at -= 60_000
  return new Date(at).toISOString()
}

/** The moment the day after `day` starts in the zone `tz`: the exclusive end of a period that ends on `day`. */
export const dayAfter = (day: string, tz?: string | null) => dayStart(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), tz)

/**
 * The query bounds of a period in the zone `tz`. 이번 달 = from the 1st of this month; 지난 3달 = this month and the
 * two before it; 전체 = none; 직접 = from the start day (inclusive) to the end day (inclusive), either may be left empty.
 */
export function periodBounds(kind: PeriodKind, now: Date, from = '', to = '', tz?: string | null): { since?: string; until?: string } {
  const ym = dayIn(now, tz).slice(0, 7)
  if (kind === 'month') return { since: dayStart(`${ym}-01`, tz) }
  if (kind === 'months3') return { since: dayStart(`${addYm(ym, -2)}-01`, tz) }
  if (kind === 'custom') return { ...(isYmd(from) ? { since: dayStart(from, tz) } : {}), ...(isYmd(to) ? { until: dayAfter(to, tz) } : {}) }
  return {}
}

/** The bounds as query parameters (`&since=…&until=…`), '' for none. */
export function periodQuery(b: { since?: string; until?: string }): string {
  return (b.since ? `&since=${encodeURIComponent(b.since)}` : '') + (b.until ? `&until=${encodeURIComponent(b.until)}` : '')
}
