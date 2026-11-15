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
