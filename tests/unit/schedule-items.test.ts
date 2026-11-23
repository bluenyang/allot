// spec 013 S-22 (W-18): the user's own monthly dates in a month (the same weekend/holiday shift as the pay days) and on
// the calendar. Synthetic data, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleItemsIn } from '../../src/lib/schedule-items'
import { store } from '../../src/lib/store'
import { calendarEvents } from '../../src/lib/calendar-events'
import type { ScheduleItem } from '../../src/data/types'

const items: ScheduleItem[] = [
  { id: 'i1', name: 'E2E-Rent', day: 31, accountId: 'a1', direction: 'out', note: 'n' },
  { id: 'i2', name: 'E2E-Refund', day: 1, accountId: null, direction: 'in' },
  { id: 'i3', name: 'E2E-Fee', day: 15, accountId: null, direction: 'out' },
]

test('the items of a month: shifted like the pay days, by date', () => {
  // November 2026: the 1st and the 15th are Sundays, the 30th (the last day, for day 31) a Monday
  const none = scheduleItemsIn(items, '2026-11', 'none', new Set())
  assert.deepEqual(none.map((x) => [x.item.id, x.at.date, x.at.shifted]), [['i2', '2026-11-01', null], ['i3', '2026-11-15', null], ['i1', '2026-11-30', null]])
  const after = scheduleItemsIn(items, '2026-11', 'after', new Set(['2026-11-16']))
  assert.deepEqual(after.map((x) => [x.item.id, x.at.date, x.at.shifted]), [['i2', '2026-11-02', 'after'], ['i3', '2026-11-17', 'after'], ['i1', '2026-11-30', null]])
  const before = scheduleItemsIn(items, '2026-11', 'before', new Set())
  // the 1st moves back into October
  assert.deepEqual(before.map((x) => [x.item.id, x.at.date]), [['i2', '2026-10-30'], ['i3', '2026-11-13'], ['i1', '2026-11-30']])
  // a missing shift reads as none
  assert.deepEqual(scheduleItemsIn(items, '2026-02', undefined, new Set()).map((x) => x.at.date), ['2026-02-01', '2026-02-15', '2026-02-28'])
  assert.deepEqual(scheduleItemsIn([], '2026-11', 'after', new Set()), [])
})

test('the calendar shows the items with their name, a kind for in or out, and the shift note', () => {
  store.holidaySets = []
  store.schedules = items
  Object.assign(store.settings, { payDay: 25, transferDay: 26, billingDay: 14, dayShift: 'after' })
  const own = calendarEvents('2026-11-01', '2026-12-01').filter((e) => e.kind === 'in' || e.kind === 'out')
  assert.deepEqual(own.map((e) => [e.date, e.kind, e.name, e.title]), [
    ['2026-11-02', 'in', 'E2E-Refund', 'E2E-Refund (미룸)'],
    // October's 31st is a Saturday: it moves into November, next to November's own dates
    ['2026-11-02', 'out', 'E2E-Rent', 'E2E-Rent (미룸)'],
    ['2026-11-16', 'out', 'E2E-Fee', 'E2E-Fee (미룸)'],
    ['2026-11-30', 'out', 'E2E-Rent', 'E2E-Rent'],
  ])
  // 'before': the October item moved in from November 1st is on October's calendar, not on November's
  Object.assign(store.settings, { dayShift: 'before' })
  assert.ok(calendarEvents('2026-10-01', '2026-11-01').some((e) => e.kind === 'in' && e.date === '2026-10-30'))
  assert.ok(!calendarEvents('2026-11-01', '2026-12-01').some((e) => e.kind === 'in' && e.date.startsWith('2026-11-0')))
  store.schedules = []
  Object.assign(store.settings, { dayShift: 'none' })
})
