// The month on the screens (spec 018 S-3, W-4; src/lib/month.ts): this month, a month's dates and the period text come
// from the store's settings and cards, and the month the dashboard opens on is this month of the basis. Synthetic; no
// browser, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Card, Settings } from '../../src/data/types'
import { monthMoney, todayIn, ymd, ymOf, ymOfDate, monthCtx } from '../../src/lib/calc'
import { hasPeriod, monthBasis, monthChange, monthDatesOf, monthLabel, monthLine, periodLabel, periodOfYm, thisYm, withPeriod, ymOfDay } from '../../src/lib/month'
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

test('when the user changes what a month is, the month looked at goes back to this month', async () => {
  const { monthKey } = await import('../../src/lib/month')
  store.settings = { ...DEFAULT_SETTINGS, payDay: 25 }
  store.preferences.timezone = 'Asia/Seoul'
  status.loaded = true
  assert.equal(monthKey.value, 'calendar')
  view.ym = '2030-05' // the user moved the month
  // a save that leaves the basis alone leaves the month alone
  store.settings = { ...store.settings, netPay: 1 }
  assert.equal(view.ym, '2030-05')
  store.settings = { ...store.settings, monthBasis: 'pay' }
  assert.equal(monthKey.value, 'pay-end-25-none')
  assert.equal(view.ym, thisYm())
  view.ym = '2030-05'
  store.settings = { ...store.settings, monthNaming: 'start' }
  assert.equal(monthKey.value, 'pay-start-25-none')
  assert.equal(view.ym, thisYm())
  // before a session's state has loaded nothing is reset
  status.loaded = false
  view.ym = '2030-05'
  store.settings = { ...DEFAULT_SETTINGS }
  assert.equal(view.ym, '2030-05')
})

// Review 2 F-2 (spec 018 S-4): the saves that move a month's dates without touching the three picks of 달의 기준 — the
// pay day or its rule under a pay basis, the basis card's first day of use, deleting the basis card. `monthChange` says
// whether such a save is asked first, and with which two lines.
test('monthChange: a save that changes what a month is gives this month before and after; any other save gives null', () => {
  store.preferences.timezone = 'Asia/Seoul'
  store.preferences.dateFormat = 'iso'
  const line = (s: Settings, cards: Card[] = store.cards) => monthLine(monthCtx(s, cards, none))
  // ── a pay basis: the pay day and its rule are the basis
  store.settings = { ...DEFAULT_SETTINGS, payDay: 15, transferDay: 16, billingDay: 14, monthBasis: 'pay' }
  store.cards = []
  assert.equal(monthChange({ settings: {} }), null, 'nothing changed')
  assert.equal(monthChange({ settings: { payDay: 15, transferDay: 20, billingDay: 3, transferShift: 'after', billingShift: 'before' } }), null, 'the other two dates and their rules are not the basis')
  // 15 → 16 with the naming on auto: every saved month name moves a whole month
  const moved = monthChange({ settings: { payDay: 16 } })
  assert.deepEqual(moved, { before: line(store.settings), after: line({ ...store.settings, payDay: 16 }) })
  assert.notEqual(moved!.before, moved!.after)
  assert.match(moved!.before, /^\d{4}\.\d{2} · \d{2}-15~\d{2}-14$/)
  assert.match(moved!.after, /^\d{4}\.\d{2} · \d{2}-16~\d{2}-15$/)
  // the pay date's rule alone is asked too (it moves the first day on a weekend), even when this month reads the same
  assert.notEqual(monthChange({ settings: { payShift: 'before' } }), null)
  // ── the calendar basis: the pay day is no part of a month
  store.settings = { ...DEFAULT_SETTINGS, payDay: 15 }
  assert.equal(monthChange({ settings: { payDay: 16, payShift: 'before' } }), null)
  // ── a card basis: the basis card's first day of use
  const card: Card = { id: 'c1', name: 'Card', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }
  const other: Card = { id: 'c2', name: 'Other', last4: '', accountId: null, billingDay: 25, usageFrom: 5 }
  store.cards = [card, other]
  store.settings = { ...DEFAULT_SETTINGS, payDay: 15, monthBasis: 'card', monthBasisCardId: 'c1' }
  assert.equal(monthChange({ settings: { payDay: 16, payShift: 'after' } }), null, 'the pay day is not the basis here')
  assert.equal(monthChange({ cards: [{ ...card, billingDay: 3 }, other] }), null, 'the billing day is no part of the usage period')
  assert.equal(monthChange({ cards: [card, { ...other, usageFrom: 20 }] }), null, 'another card')
  assert.equal(monthChange({ cards: [card] }), null, 'another card deleted')
  const used = monthChange({ cards: [{ ...card, usageFrom: 20 }, other] })
  assert.deepEqual(used, { before: line(store.settings), after: line(store.settings, [{ ...card, usageFrom: 20 }, other]) })
  assert.match(used!.after, /-20~\d{2}-19$/)
  // cleared, or the card deleted: the calendar month
  const calendar = line({ ...DEFAULT_SETTINGS })
  assert.equal(monthChange({ cards: [{ ...card, usageFrom: null }, other] })!.after, calendar)
  assert.deepEqual(monthChange({ cards: [other] }), { before: line(store.settings), after: calendar })
  // a basis card without a first day already is the calendar month: deleting it changes nothing
  store.cards = [{ ...card, usageFrom: null }, other]
  assert.equal(monthChange({ cards: [other] }), null)
  // the card id is kept under a pay basis: the card is not what a month is
  store.cards = [card, other]
  store.settings = { ...DEFAULT_SETTINGS, payDay: 15, monthBasis: 'pay', monthBasisCardId: 'c1' }
  assert.equal(monthChange({ cards: [other] }), null)
  assert.equal(monthChange({ cards: [{ ...card, usageFrom: 20 }, other] }), null)
  store.cards = []
  store.settings = { ...DEFAULT_SETTINGS }
})
