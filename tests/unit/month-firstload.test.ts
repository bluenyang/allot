// Review 2 F-1 (spec 018 S-3): the holiday code is loaded after the first screen, so the first "this month" of a pay
// basis is worked out without the holidays. When they arrive and a holiday moves the pay date across today, this month
// is another month: the month looked at follows it unless the user moved it, and the key that remakes the kept pages
// changes. Its own file: the holiday code must not be loaded before the test (each test file is its own process).
// Synthetic; no browser, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTick } from 'vue'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import { todayIn, ymd } from '../../src/lib/calc'
import { loadHolidays } from '../../src/lib/holidays-lazy'
import { monthKey, periodOfYm, thisMonthKey, thisYm } from '../../src/lib/month'
import { status, store } from '../../src/lib/store'
import { view } from '../../src/lib/view'

const TZ = 'Asia/Seoul'
const today = todayIn(TZ)
// The next weekday after today, made a holiday: a pay day on it with the rule "before" is paid today or on the weekday
// before the weekend — so with the holiday a new pay month has begun, and without it today is still in the month before.
let next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
while (next.getDay() === 0 || next.getDay() === 6) next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1)
const HOLIDAY = [{ id: 'h', name: 'Made-up', enabled: true, builtin: null, rules: [{ name: 'Made-up day', rdate: [ymd(next)] }] }]
const PAY = { ...DEFAULT_SETTINGS, payDay: next.getDate(), payShift: 'before' as const, monthBasis: 'pay' as const, monthNaming: 'auto' as const }

test('this month is worked out again when the holiday dates arrive: the month looked at follows it, a month the user moved to stays, and the page key changes', async () => {
  store.preferences.timezone = TZ
  store.holidaySets = HOLIDAY as typeof store.holidaySets
  store.settings = { ...PAY }
  status.loaded = true // the session's state has arrived; the holiday code has not
  const first = view.ym
  const key1 = thisMonthKey.value
  const basis1 = monthKey.value
  assert.equal(first, thisYm(), 'the first this month, without the holidays')
  assert.equal(key1, `${first}:${periodOfYm(first).start}:${periodOfYm(first).end}`)

  await loadHolidays()
  await nextTick()
  const after = thisYm()
  assert.notEqual(after, first, 'with the holiday the pay date has passed: another month')
  assert.equal(periodOfYm(after).start <= ymd(today) && ymd(today) <= periodOfYm(after).end, true, 'today is inside it')
  assert.equal(view.ym, after, 'the month looked at was this month, so it follows')
  assert.equal(monthKey.value, basis1, 'the basis is what it was')
  assert.notEqual(thisMonthKey.value, key1, 'the key of this month changed, so the kept pages are made again')
  assert.equal(thisMonthKey.value.slice(0, 7), after)

  // a holiday set edited later: the same, but a month the user moved to stays
  view.ym = '2030-05'
  store.holidaySets = []
  assert.equal(thisYm(), first, 'without the holiday this month is the earlier one again')
  assert.equal(view.ym, '2030-05', 'the user\'s month is left alone')
  assert.equal(thisMonthKey.value, key1)
  view.ym = first
  store.holidaySets = HOLIDAY as typeof store.holidaySets
  assert.equal(view.ym, after, 'back on this month, it follows again')

  // the calendar basis has no such key: nothing a holiday could move
  store.settings = { ...DEFAULT_SETTINGS, payDay: next.getDate(), payShift: 'before' }
  assert.equal(thisMonthKey.value, 'calendar')
  status.loaded = false
  store.settings = { ...DEFAULT_SETTINGS }
  store.holidaySets = []
})
