// The user's own monthly dates in a month (spec 013 S-22, A-36): each item's day moved off weekends and holidays with the
// same rule as the pay, transfer and billing days (monthDay). Pure: the screens, the calendar and the MCP tool use it.
import { monthDay, type MonthDate } from './calc'
import type { DayShift, ScheduleItem } from '../data/types'

export interface ItemOnDate { item: ScheduleItem; at: MonthDate }

/** The items of month `ym` (YYYY-MM) with their date after the shift, by date (the saved order on the same date). */
export function scheduleItemsIn(items: readonly ScheduleItem[], ym: string, shift: DayShift | undefined, off: ReadonlySet<string>): ItemOnDate[] {
  return items
    .map((item, i) => ({ item, at: monthDay(ym, item.day, shift ?? 'none', off), i }))
    .sort((a, b) => (a.at.date < b.at.date ? -1 : a.at.date > b.at.date ? 1 : a.i - b.i))
    .map(({ item, at }) => ({ item, at }))
}
