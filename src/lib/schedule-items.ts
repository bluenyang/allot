// The user's own monthly dates in a month (spec 013 S-22, A-36): each item's day moved off weekends and holidays by the
// item's own rule (spec 018 S-1; the settings' one rule up to 0.1.9), as the pay, transfer and billing days are by theirs
// (monthDay). Pure: the screens, the calendar and the MCP tool use it.
import { dayOn, monthDay, type MonthCtx, type MonthDate } from './calc'
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
 * The items of the month named `ym` of a month basis (spec 018 S-3): each item's day inside the month's period (calc
 * `dayOn`, as the pay, transfer and billing days are placed), moved by the item's own rule, by date. With the calendar
 * basis this is `scheduleItemsIn`.
 */
export function scheduleItemsOf(items: readonly ScheduleItem[], ym: string, ctx: MonthCtx): ItemOnDate[] {
  return items
    .map((item, i) => ({ item, at: dayOn(ym, item.day, item.shift ?? 'none', ctx), i }))
    .sort((a, b) => (a.at.date < b.at.date ? -1 : a.at.date > b.at.date ? 1 : a.i - b.i))
    .map(({ item, at }) => ({ item, at }))
}
