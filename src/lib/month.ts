// What a month is on the screens (spec 018 S-3, S-4): the user's month basis from the store — the settings, the cards
// and the store's holiday dates — and what the screens ask of it: this month, the month of a date, a month's dates and
// the text of its period. The sums take the same basis from the store itself (calc `ctxOf`), so a screen and its numbers
// cannot disagree. With the calendar basis every answer is what the screens showed before: the calendar month, no period.
import { computed } from 'vue'
import { ctxOf, dayOn, monthDatesIn, periodOf, roundYm, ymd, ymLabel, ymOfDate, type MonthCtx } from './calc'
import type { Spending, SpendingRound } from '../data/types'
import { periodText } from './format'
import { localToday } from './now'
import { store } from './store'

/** The basis now. A new value whenever the settings, the cards or the holidays change (it remembers the first days it worked out). */
export const monthBasis = computed<MonthCtx>(() => ctxOf(store))

/**
 * What the basis is, as one word: it changes when "this month" may have changed its name or its dates — the basis, the
 * naming, the first day, or the pay date's weekend rule. 'calendar' for the calendar month.
 */
export const monthKey = computed(() => {
  const c = monthBasis.value
  return c.basis === 'calendar' ? 'calendar' : `${c.basis}-${c.naming}-${c.day}-${c.basis === 'pay' ? c.settings.payShift ?? 'none' : 'none'}`
})

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
