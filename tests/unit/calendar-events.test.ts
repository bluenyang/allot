// spec 007 S-11, review 1 R3: the calendar's monthly dates include those moved in from the next month.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { store } from '../../src/lib/store'
import { calendarEvents } from '../../src/lib/calendar-events'

test('a pay day moved back into the shown month is on the calendar', () => {
  Object.assign(store.settings, { payDay: 1, transferDay: 26, billingDay: 14, dayShift: 'before' })
  // 2026-08-01 is a Saturday: 'before' moves it to Friday 2026-07-31, inside July.
  const pay = calendarEvents('2026-07-01', '2026-08-01').filter((e) => e.kind === 'pay').map((e) => [e.date, e.title])
  assert.deepEqual(pay, [['2026-07-01', '월급'], ['2026-07-31', '월급 (앞당김)']])
  Object.assign(store.settings, { dayShift: 'none' })
  assert.deepEqual(calendarEvents('2026-07-01', '2026-08-01').filter((e) => e.kind === 'pay').map((e) => e.date), ['2026-07-01'])
})

test('review 2 (F1): a date moved from two months away is there once, whatever range is asked', () => {
  // February 2027 is all holidays (a user set) and the built-in set is off. Pay day 31, 'after':
  // January 31 (Sunday) and February 28 (its last day) both move to Monday March 1.
  const feb = Array.from({ length: 28 }, (_, i) => `2027-02-${String(i + 1).padStart(2, '0')}`)
  store.holidaySets = [{ id: 'kr-off', name: 'kr', enabled: false, builtin: 'kr', rules: [] }, { id: 'mine', name: 'feb', enabled: true, builtin: null, rules: [{ name: 'feb', rdate: feb }] }]
  Object.assign(store.settings, { payDay: 31, transferDay: 26, billingDay: 14, dayShift: 'after' })
  const march = calendarEvents('2027-03-01', '2027-04-01').filter((e) => e.kind === 'pay').map((e) => e.date)
  const q1 = calendarEvents('2027-01-01', '2027-04-01').filter((e) => e.kind === 'pay').map((e) => e.date).filter((d) => d.startsWith('2027-03'))
  assert.deepEqual(march, q1)
  assert.deepEqual(march, ['2027-03-01', '2027-03-01', '2027-03-31'], "January's and February's pay both on March 1, March's on the 31st")
  store.holidaySets = []
  Object.assign(store.settings, { dayShift: 'none' })
})
