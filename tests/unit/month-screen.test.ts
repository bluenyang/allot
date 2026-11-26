// The month on the screens (spec 018 S-3, W-4; src/lib/month.ts): this month, a month's dates and the period text come
// from the store's settings and cards, and the month the dashboard opens on is this month of the basis. Synthetic; no
// browser, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import { monthMoney, todayIn, ymd, ymOf, ymOfDate, monthCtx } from '../../src/lib/calc'
import { hasPeriod, monthBasis, monthDatesOf, monthLabel, periodLabel, periodOfYm, thisYm, withPeriod, ymOfDay } from '../../src/lib/month'
import { status, store } from '../../src/lib/store'
import { view } from '../../src/lib/view'

const none: ReadonlySet<string> = new Set()

test('the calendar basis: this month is the calendar month and a month has no period text', () => {
  store.settings = { ...DEFAULT_SETTINGS, payDay: 25, transferDay: 26, billingDay: 14 }
  store.preferences.timezone = 'Asia/Seoul'
  assert.equal(hasPeriod.value, false)
  assert.equal(thisYm(), ymOf(todayIn('Asia/Seoul')))
  assert.equal(ymOfDay('2026-11-25'), '2026-11')
  assert.equal(periodLabel('2026-12'), '')
  assert.equal(monthLabel('2026-12'), '2026.12')
  assert.equal(withPeriod('December 2026', '2026-12'), 'December 2026')
  assert.deepEqual(periodOfYm('2026-12'), { ym: '2026-12', start: '2026-12-01', end: '2026-12-31' })
  assert.deepEqual([monthDatesOf('2026-12').pay.date, monthDatesOf('2026-12').transfer.date, monthDatesOf('2026-12').billing.date], ['2026-12-25', '2026-12-26', '2026-12-14'])
})

test('a pay basis: the month of a date, the dates of a month and the period text in the user\'s date format', () => {
  store.settings = { ...DEFAULT_SETTINGS, payDay: 25, transferDay: 26, billingDay: 14, monthBasis: 'pay' }
  assert.equal(hasPeriod.value, true)
  assert.equal(monthBasis.value.basis, 'pay')
  assert.equal(ymOfDay('2026-11-24'), '2026-11')
  assert.equal(ymOfDay('2026-11-25'), '2026-12')
  assert.deepEqual(periodOfYm('2026-12'), { ym: '2026-12', start: '2026-11-25', end: '2026-12-24' })
  assert.deepEqual([monthDatesOf('2026-12').pay.date, monthDatesOf('2026-12').transfer.date, monthDatesOf('2026-12').billing.date], ['2026-11-25', '2026-11-26', '2026-12-14'])
  store.preferences.dateFormat = 'iso'
  assert.equal(periodLabel('2026-12'), '11-25~12-24')
  assert.equal(monthLabel('2026-12'), '2026.12 · 11-25~12-24')
  store.preferences.dateFormat = 'us'
  assert.equal(monthLabel('2026-12'), '2026.12 · 11/25~12/24')
  assert.equal(withPeriod('December 2026', '2026-12'), 'December 2026 · 11/25~12/24')
  store.preferences.dateFormat = 'dot'
  assert.equal(periodLabel('2026-12'), '11. 25.~12. 24.')
  // this month is the month whose period holds today
  const today = ymd(todayIn(store.preferences.timezone))
  assert.equal(thisYm(), ymOfDate(today, monthCtx(store.settings, [], none)))
})

test('a card basis reads the store\'s cards; without the card it is the calendar month', () => {
  store.settings = { ...DEFAULT_SETTINGS, monthBasis: 'card', monthBasisCardId: 'c1' }
  store.cards = []
  assert.equal(hasPeriod.value, false)
  store.cards = [{ id: 'c1', name: 'Card', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }]
  assert.equal(hasPeriod.value, true)
  assert.deepEqual(periodOfYm('2026-12'), { ym: '2026-12', start: '2026-12-12', end: '2027-01-11' })
  store.cards = [{ id: 'c1', name: 'Card', last4: '', accountId: null, billingDay: 25, usageFrom: null }]
  assert.equal(hasPeriod.value, false)
  store.cards = []
})

test('the sums that are handed the store count by the same basis as the screen', () => {
  store.settings = { ...DEFAULT_SETTINGS, netPay: 1_000_000, payDay: 25, monthBasis: 'pay' }
  store.incomeExtras = [{ id: 'x', date: '2026-11-25', name: 'Once', amount: 50_000 }]
  assert.equal(monthMoney(store, '2026-12').income.total, 1_050_000)
  assert.equal(monthMoney({ ...store, spendings: [] }, '2026-12').income.total, 1_050_000)
  assert.equal(monthMoney(store, '2026-11').income.total, 1_000_000)
  store.settings = { ...store.settings, monthBasis: 'calendar' }
  assert.equal(monthMoney(store, '2026-11').income.total, 1_050_000)
  store.incomeExtras = []
})

test('view.ym starts on this month of the basis once the state has loaded', () => {
  store.settings = { ...DEFAULT_SETTINGS, payDay: 25, monthBasis: 'pay' }
  store.preferences.timezone = 'Asia/Seoul'
  view.ym = '1999-01'
  status.loaded = true
  assert.equal(view.ym, thisYm())
  assert.equal(view.ym, ymOfDate(ymd(todayIn('Asia/Seoul')), monthCtx(store.settings, [], none)))
  status.loaded = false
  store.settings = { ...DEFAULT_SETTINGS }
})
