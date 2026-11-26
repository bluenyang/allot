// The user's own monthly dates in a month (spec 013 S-22, A-36): each item's day moved off weekends and holidays by the
// item's own rule (spec 018 S-1; the settings' one rule up to 0.1.9), as the pay, transfer and billing days are by theirs
// (monthDay). Pure: the screens, the calendar and the MCP tool use it.
import { addYm, monthDay, periodOf, type MonthCtx, type MonthDate } from './calc'
import type { ScheduleItem } from '../data/types'

export interface ItemOnDate { item: ScheduleItem; at: MonthDate }

/** The items of month `ym` (YYYY-MM) with their date after their own shift, by date (the saved order on the same date). */
export function scheduleItemsIn(items: readonly ScheduleItem[], ym: string, off: ReadonlySet<string>): ItemOnDate[] {
  return items
    .map((item, i) => ({ item, at: monthDay(ym, item.day, item.shift ?? 'none', off), i }))
    .sort((a, b) => (a.at.date < b.at.date ? -1 : a.at.date > b.at.date ? 1 : a.i - b.i))
    .map(({ item, at }) => ({ item, at }))
}

/**
 * The items of the month named `ym` of a month basis (spec 018 S-3). Calendar: `scheduleItemsIn`. A card or pay basis:
 * the occurrences whose day as set lies in the month's period (a period touches two calendar months), by date; like the
 * three dates, one that its rule moves off a weekend stays with its month.
 */
export function scheduleItemsOf(items: readonly ScheduleItem[], ym: string, ctx: MonthCtx): ItemOnDate[] {
  if (ctx.basis === 'calendar') return scheduleItemsIn(items, ym, ctx.off)
  const { start, end } = periodOf(ym, ctx)
  const out: (ItemOnDate & { i: number })[] = []
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = addYm(m, 1)) {
    scheduleItemsIn(items, m, ctx.off).forEach((x) => { if (x.at.nominal >= start && x.at.nominal <= end) out.push({ ...x, i: out.length }) })
  }
  return out.sort((a, b) => (a.at.date < b.at.date ? -1 : a.at.date > b.at.date ? 1 : a.i - b.i)).map(({ item, at }) => ({ item, at }))
}
