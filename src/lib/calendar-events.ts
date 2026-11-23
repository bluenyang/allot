// What the month calendar shows (spec 007 S-11): our own dates, handed to FullCalendar as events.
// Monthly dates after the weekend/holiday shift, subscription payments, scheduled plan changes and
// the holidays of the sets that are on. Month-only events (PlanEvent.when = YYYY-MM, a range) are not
// put on the grid: putting them on the 1st would claim a date they do not have. The agenda lists them
// apart, for every month of their range (`inMonth` in event-when.ts; spec 013 S-18).
import { addYm, monthDates, parseDate, upcomingPayments, upcomingSpendRounds, ymd, ymOf, DAY } from './calc'
import { enabledSets, holidaysIn } from './holidays'
import { fmtMoney } from './display'
import { store, subName } from './store'
import type { HolidaySet } from '../data/types'
import { t, type MessageKey } from '../i18n'
import { roundSuffix } from './labels'
import { holidayName } from './holiday-names'

export type CalKind = 'pay' | 'transfer' | 'billing' | 'sub' | 'spend' | 'change' | 'holiday'
/** `name` and `krw` are set for subscription payments and spending rounds (the agenda shows the amount apart from the name). */
export interface CalEvent { date: string; title: string; kind: CalKind; name?: string; krw?: number }

export const kindLabel = (kind: CalKind) => t(`calendar.kind.${kind}` as MessageKey)

/** Holidays of the given sets (those that are on), between two YYYY-MM-DD dates (inclusive). */
export const holidaysBetween = (sets: HolidaySet[], from: string, to: string) => holidaysIn(enabledSets(sets), from, to)

/** Only the holidays, for the settings preview: from inclusive, to exclusive. */
export function holidayEvents(sets: HolidaySet[], from: string, to: string): CalEvent[] {
  const last = ymd(new Date(parseDate(to).getTime() - DAY))
  return holidaysBetween(sets, from, last).map((h) => ({ date: h.date, title: holidayName(h.name), kind: 'holiday' }))
}

/** Every event between from (inclusive) and to (exclusive), YYYY-MM-DD. */
export function calendarEvents(from: string, to: string): CalEvent[] {
  const last = ymd(new Date(parseDate(to).getTime() - DAY))
  // A monthly date moves at most SHIFT_LIMIT (31) days, so it can come from up to two months away
  // (Jan 31 → Mar 3; review 1 R3, review 2 F1), and its move needs the holidays one month further:
  // compute those months, then keep the range.
  const firstYm = addYm(ymOf(parseDate(from)), -2)
  const lastYm = addYm(ymOf(parseDate(last)), 2)
  const wide = holidaysBetween(store.holidaySets, `${addYm(firstYm, -1)}-01`, ymd(new Date(parseDate(`${addYm(lastYm, 2)}-01`).getTime() - DAY)))
  const off = new Set(wide.map((h) => h.date))
  const out: CalEvent[] = wide.filter((h) => h.date >= from && h.date <= last).map((h) => ({ date: h.date, title: holidayName(h.name), kind: 'holiday' }))

  for (let ym = firstYm; ym <= lastYm; ym = addYm(ym, 1)) {
    const d = monthDates(ym, store.settings, off)
    const moved = (x: { shifted: string | null; unresolved?: true }) =>
      x.unresolved ? ` (${t('calendar.noBizDay')})` : x.shifted === 'before' ? ` (${t('calendar.before')})` : x.shifted === 'after' ? ` (${t('calendar.after')})` : ''
    for (const [kind, x] of [['pay', d.pay], ['transfer', d.transfer], ['billing', d.billing]] as const) {
      if (x.date >= from && x.date <= last) out.push({ date: x.date, title: kindLabel(kind) + moved(x), kind })
    }
  }

  const start = parseDate(from)
  const days = Math.round((parseDate(to).getTime() - start.getTime()) / DAY) - 1
  for (const p of upcomingPayments(store.subscriptions, store.planChanges, store.settings, start, days)) {
    out.push({ date: ymd(p.date), title: `${p.sub.name} ${fmtMoney(p.krw)}`, kind: 'sub', name: p.sub.name, krw: p.krw })
  }
  // A round still to pay of a one-off spending, with its name and "n/N회" (spec 011 S-8).
  for (const d of upcomingSpendRounds(store.spendings, start, days)) {
    const name = `${d.spending.name} ${roundSuffix(d.spending, d.round)}`.trim()
    out.push({ date: ymd(d.date), title: `${name} ${fmtMoney(d.krw)}`, kind: 'spend', name, krw: d.krw })
  }
  for (const c of store.planChanges) {
    if (c.effective && c.effective >= from && c.effective <= last) out.push({ date: c.effective, title: t('calendar.changeOf', { name: subName(c.subId) }), kind: 'change' })
  }
  const order: CalKind[] = ['holiday', 'pay', 'transfer', 'billing', 'change', 'sub', 'spend']
  return out.sort((a, b) => (a.date === b.date ? order.indexOf(a.kind) - order.indexOf(b.kind) : a.date < b.date ? -1 : 1))
}
