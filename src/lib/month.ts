// What a month is on the screens (spec 018 S-3, S-4): the user's month basis from the store — the settings, the cards
// and the store's holiday dates — and what the screens ask of it: this month, the month of a date, a month's dates and
// the text of its period. The sums take the same basis from the store itself (calc `ctxOf`), so a screen and its numbers
// cannot disagree. With the calendar basis every answer is what the screens showed before: the calendar month, no period.
import { computed } from 'vue'
import { ctxOf, dayOn, monthCtx, monthDatesIn, periodOf, roundYm, ymd, ymLabel, ymOfDate, type MonthCtx } from './calc'
import type { Card, Settings, Spending, SpendingRound } from '../data/types'
import { periodText } from './format'
import { localToday } from './now'
import { store } from './store'

/** The basis now. A new value whenever the settings, the cards or the holidays change (it remembers the first days it worked out). */
export const monthBasis = computed<MonthCtx>(() => ctxOf(store))

/**
 * What the basis is, as one word: it changes when "this month" may have changed its name or its dates — the basis, the
 * naming, the first day, or the pay date's weekend rule. 'calendar' for the calendar month.
 */
export const monthKey = computed(() => basisKey(monthBasis.value))
/** The same word for any basis: two bases with the same word give every month the same name and the same dates. */
export const basisKey = (c: MonthCtx): string =>
  (c.basis === 'calendar' ? 'calendar' : `${c.basis}-${c.naming}-${c.day}-${c.basis === 'pay' ? c.settings.payShift ?? 'none' : 'none'}`)

/** Is a month something else than the calendar month (a card or pay basis in use)? */
export const hasPeriod = computed(() => monthBasis.value.basis !== 'calendar')

/** The month that holds `date` (YYYY-MM-DD). */
export const ymOfDay = (date: string): string => ymOfDate(date, monthBasis.value)

/**
 * The month a spending round counts in (calc `roundYm`, spec 018 S-5): a card bill in the month of the last pay date
 * before it, every other round in the month that holds its date.
 */
export const roundYmOf = (s: Pick<Spending, 'how' | 'payBy'>, r: Pick<SpendingRound, 'date'>): string => roundYm(s, r, monthBasis.value)

/** This month: the month that holds today in the user's time zone. */
export const thisYm = (): string => ymOfDay(ymd(localToday()))

/** The dates of month `ym`, both included. */
export const periodOfYm = (ym: string) => periodOf(ym, monthBasis.value)

/**
 * This month as the basis has it now, as one word: its name and its dates ('calendar' for the calendar month). It
 * changes with `monthKey`, and also when the holiday dates change under a basis that reads them — they arrive after the
 * first screen (the holiday code is loaded lazily, `store.off` is empty until then), and a holiday set can be edited.
 * A pay date moved by a holiday can make "this month" another month than the one a screen fixed before (review 2 F-1).
 */
export const thisMonthKey = computed(() => {
  if (monthKey.value === 'calendar') return 'calendar'
  const p = periodOfYm(thisYm())
  return `${p.ym}:${p.start}:${p.end}`
})

/** Pay, transfer and card billing date of month `ym`: the ones inside its period, each moved by its own rule. */
export const monthDatesOf = (ym: string) => monthDatesIn(ym, store.settings, monthBasis.value)

/** Day `day` of month `ym` as set (no weekend rule): the one inside its period — an income's day, an item's day. */
export const dayOfYm = (ym: string, day: number): string => dayOn(ym, day, 'none', monthBasis.value).date

/** The period of month `ym` in the user's date format ("11/25~12/24"); empty with the calendar basis. */
export function periodLabel(ym: string): string {
  if (!hasPeriod.value) return ''
  const p = periodOfYm(ym)
  return periodText(p.start, p.end, store.preferences)
}

/** `text` (a month's name as a screen words it) with the month's period after it: "2026.12 · 11/25~12/24"; as it is with the calendar basis. */
export function withPeriod(text: string, ym: string): string {
  const period = periodLabel(ym)
  return period ? `${text} · ${period}` : text
}

/** A month's name with its period: "2026.12 · 11/25~12/24"; "2026.12" with the calendar basis. */
export const monthLabel = (ym: string): string => withPeriod(ymLabel(ym), ym)

/** This month with a basis: its name and its dates, "2026.12 · 11-25~12-24". */
export function monthLine(ctx: MonthCtx): string {
  const p = periodOf(ymOfDate(ymd(localToday()), ctx), ctx)
  return `${ymLabel(p.ym)} · ${periodText(p.start, p.end, store.preferences)}`
}

/**
 * Does this basis give every month the calendar month's name and dates? The calendar basis, and a card basis whose
 * card's usage period starts on the 1st with the month named after its start (`usagePeriod`: a first day of 1 is the
 * calendar month). Named after its end, the same dates carry the next month's name, so that one is not the calendar.
 */
const calendarMonths = (c: MonthCtx): boolean => c.basis === 'calendar' || (c.basis === 'card' && c.day === 1 && c.naming === 'start')

/**
 * What a save would do to the months (spec 018 S-4): null when every month keeps its name and its dates, else this
 * month before and after, for the question that is asked first. `next` is what the save changes: keys of the settings
 * (the pay day and its rule under a pay basis), or the cards as they would be (the basis card's first day of use, or
 * the list without it) — review 2 F-2. Two bases with different words can still be the same months — the basis card's
 * first day of use empty ↔ 1 under a naming by the start: not asked either (review 6 finding 4).
 */
export function monthChange(next: { settings?: Partial<Settings>; cards?: readonly Pick<Card, 'id' | 'usageFrom'>[] }): { before: string; after: string } | null {
  const now = monthBasis.value
  const then = monthCtx({ ...store.settings, ...next.settings }, next.cards ?? store.cards, store.off ?? new Set())
  if (basisKey(now) === basisKey(then) || (calendarMonths(now) && calendarMonths(then))) return null
  return { before: monthLine(now), after: monthLine(then) }
}
