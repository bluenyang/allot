// spec 013 S-22 (W-18): the user's own monthly dates in a month (moved off weekends and holidays like the pay days) and on
// the calendar and in the MCP get_schedule. Since spec 018 S-1 each item has its own rule (`shift`), where the settings' one
// rule applied before: the cases below give every item the rule the settings had, and expect the same dates.
// Synthetic data, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleItemsIn } from '../../src/lib/schedule-items'
import { store } from '../../src/lib/store'
import { calendarEvents } from '../../src/lib/calendar-events'
import { overview, schedule, type Data } from '../../server/mcp/views'
import type { DayShift, ScheduleItem } from '../../src/data/types'

const items: ScheduleItem[] = [
  { id: 'i1', name: 'E2E-Rent', day: 31, accountId: 'a1', direction: 'out', note: 'n', shift: 'none' },
  { id: 'i2', name: 'E2E-Refund', day: 1, accountId: null, direction: 'in', shift: 'none' },
  { id: 'i3', name: 'E2E-Fee', day: 15, accountId: null, direction: 'out', shift: 'none' },
]
/** The items, each with the rule `shift`. */
const all = (shift: DayShift): ScheduleItem[] => items.map((x) => ({ ...x, shift }))

test('the items of a month: shifted like the pay days, by date', () => {
  // November 2026: the 1st and the 15th are Sundays, the 30th (the last day, for day 31) a Monday
  const none = scheduleItemsIn(all('none'), '2026-11', new Set())
  assert.deepEqual(none.map((x) => [x.item.id, x.at.date, x.at.shifted]), [['i2', '2026-11-01', null], ['i3', '2026-11-15', null], ['i1', '2026-11-30', null]])
  const after = scheduleItemsIn(all('after'), '2026-11', new Set(['2026-11-16']))
  assert.deepEqual(after.map((x) => [x.item.id, x.at.date, x.at.shifted]), [['i2', '2026-11-02', 'after'], ['i3', '2026-11-17', 'after'], ['i1', '2026-11-30', null]])
  const before = scheduleItemsIn(all('before'), '2026-11', new Set())
  // the 1st moves back into October
  assert.deepEqual(before.map((x) => [x.item.id, x.at.date]), [['i2', '2026-10-30'], ['i3', '2026-11-13'], ['i1', '2026-11-30']])
  // a missing shift reads as none
  const unset = items.map(({ shift: _s, ...x }) => x) as ScheduleItem[]
  assert.deepEqual(scheduleItemsIn(unset, '2026-02', new Set()).map((x) => x.at.date), ['2026-02-01', '2026-02-15', '2026-02-28'])
  assert.deepEqual(scheduleItemsIn([], '2026-11', new Set()), [])
})

test('the calendar shows the items with their name, a kind for in or out, and the shift note', () => {
  store.holidaySets = []
  store.schedules = all('after')
  Object.assign(store.settings, { payDay: 25, transferDay: 26, billingDay: 14, payShift: 'after', transferShift: 'after', billingShift: 'after' })
  const own = calendarEvents('2026-11-01', '2026-12-01').filter((e) => e.kind === 'in' || e.kind === 'out')
  assert.deepEqual(own.map((e) => [e.date, e.kind, e.name, e.title]), [
    ['2026-11-02', 'in', 'E2E-Refund', 'E2E-Refund (미룸)'],
    // October's 31st is a Saturday: it moves into November, next to November's own dates
    ['2026-11-02', 'out', 'E2E-Rent', 'E2E-Rent (미룸)'],
    ['2026-11-16', 'out', 'E2E-Fee', 'E2E-Fee (미룸)'],
    ['2026-11-30', 'out', 'E2E-Rent', 'E2E-Rent'],
  ])
  // 'before': the October item moved in from November 1st is on October's calendar, not on November's
  Object.assign(store.settings, { payShift: 'before', transferShift: 'before', billingShift: 'before' })
  store.schedules = all('before')
  assert.ok(calendarEvents('2026-10-01', '2026-11-01').some((e) => e.kind === 'in' && e.date === '2026-10-30'))
  assert.ok(!calendarEvents('2026-11-01', '2026-12-01').some((e) => e.kind === 'in' && e.date.startsWith('2026-11-0')))
  store.schedules = []
  Object.assign(store.settings, { payShift: 'none', transferShift: 'none', billingShift: 'none' })
})

test('get_schedule lists the items of each month with their date after the shift, account and direction', () => {
  const data: Data = {
    settings: { netPay: 0, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, payShift: 'after', transferShift: 'after', billingShift: 'after' },
    living: { food: 0, transit: 0, allowance: 0 },
    targets: [], subscriptions: [], planChanges: [], phases: [], events: [], checks: [], accounts: [], debts: [], remainderSplit: [], holidaySets: [],
    schedules: all('after'),
  }
  const s = schedule(data, '2026-11', 2)
  assert.deepEqual(s.months[0]!.ownDates, [
    { id: 'i2', name: 'E2E-Refund', day: 1, date: '2026-11-02', nominal: '2026-11-01', shifted: 'after', shift: 'after', accountId: null, direction: 'in' },
    { id: 'i3', name: 'E2E-Fee', day: 15, date: '2026-11-16', nominal: '2026-11-15', shifted: 'after', shift: 'after', accountId: null, direction: 'out' },
    { id: 'i1', name: 'E2E-Rent', day: 31, date: '2026-11-30', nominal: '2026-11-30', shifted: null, shift: 'after', accountId: 'a1', direction: 'out', note: 'n' },
  ])
  // December 31st is a Thursday: no shift, the whole day
  assert.equal(s.months[1]!.ownDates.find((x) => x.id === 'i1')!.date, '2026-12-31')
  // no items: an empty list
  assert.deepEqual(schedule({ ...data, schedules: undefined }, '2026-11', 1).months[0]!.ownDates, [])
})

test('spec 018 S-1: get_schedule and get_overview give each date its own rule, and no dayShift', () => {
  const data: Data = {
    // November 2026: the 21st and the 14th are Saturdays, the 22nd a Sunday
    settings: { netPay: 0, fxRate: 1400, fxBuffer: 0, payDay: 21, transferDay: 22, billingDay: 14, subRound: 10_000, payShift: 'before', transferShift: 'after', billingShift: 'none' },
    living: { food: 0, transit: 0, allowance: 0 },
    targets: [], subscriptions: [], planChanges: [], phases: [], events: [], checks: [], accounts: [], debts: [], remainderSplit: [], holidaySets: [],
    schedules: [{ ...items[2]!, day: 14, shift: 'before' }, { ...items[1]!, day: 14, shift: 'none' }],
  }
  const want = {
    pay: { date: '2026-11-20', nominal: '2026-11-21', shifted: 'before', shift: 'before' },
    transfer: { date: '2026-11-23', nominal: '2026-11-22', shifted: 'after', shift: 'after' },
    billing: { date: '2026-11-14', nominal: '2026-11-14', shifted: null, shift: 'none' },
  }
  const month = schedule(data, '2026-11', 1).months[0]!
  assert.deepEqual(month.dates, want)
  assert.deepEqual(month.ownDates.map((x) => [x.id, x.date, x.shifted, x.shift]), [['i3', '2026-11-13', 'before', 'before'], ['i2', '2026-11-14', null, 'none']])
  const o = overview(data, '2026-11')
  assert.deepEqual(o.dates, want)
  assert.deepEqual([o.settings.payShift, o.settings.transferShift, o.settings.billingShift], ['before', 'after', 'none'])
  assert.equal('dayShift' in o.settings, false)
})
