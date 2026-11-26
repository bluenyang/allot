// The month's basis in what the MCP tools say (spec 018 S-3, S-10, W-4): the default month, the period of a monthly
// answer, the three dates inside it, and what is listed under a month. Synthetic data; no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Settings, Spending, Subscription } from '../../src/data/types'
import { accountList, budget, incomeView, moneyOf, monthOfDate, notificationList, overview, planChangeList, schedule, spendingList, subscriptionList, thisMonth, type Data } from '../../server/mcp/views'
import { instructionsFor } from '../../server/mcp/instructions'
import { incomeLine } from '../../server/preview'

// Pay day 25 (a month is named by its end: "2026-12" = 11-25 … 12-24), transfer day 26, billing day 14.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const PAY: Settings = { ...S, monthBasis: 'pay' }
const sub: Subscription = { id: 's1', name: 'Sub', category: 'tool', plan: 'Basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-11-05', path: 'direct', verified: false }
const spending = (id: string, payBy: Spending['payBy'], date: string, amount: number): Spending => ({
  id, name: id, category: '', bought: date, amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy, count: 1, fee: 0, interval: null,
  cancelled: false, rounds: [{ no: 1, date, amount, state: 'left', edited: false }],
})
const data = (settings: Settings, over: Partial<Data> = {}): Data => ({
  settings, living: { food: 500_000, transit: 0, allowance: 0 },
  targets: [{ id: 't-l', name: 'Living', kind: 'living' }, { id: 't-s', name: 'Subs', kind: 'subscriptions' }, { id: 't-f', name: 'Fixed', kind: 'fixed', accountId: 'a1' }, { id: 't-r', name: 'Rest', kind: 'remainder' }],
  subscriptions: [sub],
  planChanges: [{ id: 'pc', subId: 's1', effective: '2026-11-28', to: { amount: 15_000, plan: 'Plus' }, note: '' }],
  phases: [{ id: 'p1', label: '', name: 'one', from: '2026-01', to: null, amounts: { 't-f': 200_000 } }],
  events: [{ id: 'e1', when: '2026-12', kind: '저축', title: 'Event', state: 'todo' }],
  checks: [], debts: [], remainderSplit: [], holidaySets: [],
  accounts: [{ id: 'a1', name: 'Main', role: '', inflow: '', outflow: '' }],
  balances: [{ id: 'b1', accountId: 'a1', date: '2026-11-25', amount: 1_000_000 }],
  cards: [{ id: 'c1', name: 'Card', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }],
  spendings: [spending('a', 'salary', '2026-11-30', 120_000), spending('b', 'subs', '2026-12-24', 3_000), spending('c', 'salary', '2026-12-25', 40_000)],
  incomeExtras: [{ id: 'x1', date: '2026-11-25', name: 'First day', amount: 200_000 }, { id: 'x2', date: '2026-12-25', name: 'Next', amount: 70_000 }],
  incomeReceipts: [{ id: 'r1', itemId: null, ym: '2026-12', amount: 3_100_000 }],
  schedules: [{ id: 'own', name: 'Rent', day: 28, accountId: null, direction: 'out', shift: 'none' }, { id: 'own2', name: 'Early', day: 3, accountId: null, direction: 'in', shift: 'none' }],
  ...over,
})
const day = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }

test('the default month is the month of the basis that holds today', () => {
  assert.equal(thisMonth(data(S), day('2026-11-25')), '2026-11')
  assert.equal(thisMonth(data(PAY), day('2026-11-24')), '2026-11')
  assert.equal(thisMonth(data(PAY), day('2026-11-25')), '2026-12')
  assert.equal(thisMonth(data(PAY), day('2026-12-24')), '2026-12')
  assert.equal(thisMonth(data(PAY), day('2026-12-25')), '2027-01')
  // card basis (usage period from the 12th, named by its start)
  const card = data({ ...S, monthBasis: 'card', monthBasisCardId: 'c1' })
  assert.equal(thisMonth(card, day('2026-12-11')), '2026-11')
  assert.equal(thisMonth(card, day('2026-12-12')), '2026-12')
  // a card basis whose card is gone counts by the calendar month
  assert.equal(thisMonth(data({ ...S, monthBasis: 'card', monthBasisCardId: 'gone' }), day('2026-12-11')), '2026-12')
  assert.equal(monthOfDate(data(PAY), '2026-11-25'), '2026-12')
  // the pay date moved by a holiday of the user's sets: 2026-12-25 is a holiday of the built-in set, so with the rule
  // "before" the pay date is 12-24 and "2027-01" starts that day
  const before = data({ ...PAY, payShift: 'before' })
  assert.equal(thisMonth(before, day('2026-12-24')), '2027-01')
  assert.equal(thisMonth(before, day('2026-12-23')), '2026-12')
})

test('get_overview: period, the three dates inside it, and what is dated in it', () => {
  const cal = overview(data(S), '2026-12')
  assert.deepEqual(cal.period, { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual([cal.dates.pay.date, cal.dates.transfer.date, cal.dates.billing.date], ['2026-12-25', '2026-12-26', '2026-12-14'])
  assert.deepEqual(cal.payments.map((p) => p.date), ['2026-12-05'])
  assert.deepEqual(cal.spendingRounds.map((r) => r.date), ['2026-12-24', '2026-12-25'])
  assert.deepEqual(cal.planChanges.map((c) => c.id), [])
  assert.equal(cal.income.totalKrw, 3_170_000)

  const pay = overview(data(PAY), '2026-12')
  assert.deepEqual(pay.period, { from: '2026-11-25', to: '2026-12-24' })
  // the pay day is the period's first day; the 26th follows it in November; the 14th is December's
  assert.deepEqual([pay.dates.pay.date, pay.dates.transfer.date, pay.dates.billing.date], ['2026-11-25', '2026-11-26', '2026-12-14'])
  assert.deepEqual(pay.payments.map((p) => p.date), ['2026-12-05'])
  assert.deepEqual(pay.spendingRounds.map((r) => r.date), ['2026-11-30', '2026-12-24'])
  assert.deepEqual(pay.planChanges.map((c) => c.id), ['pc'])
  // the receipt of the month named 2026-12 (3,100,000) + the extra dated on the period's first day (200,000)
  assert.equal(pay.income.totalKrw, 3_300_000)
  // transfer: 15,000 + the round of 12-24 (3,000) → 20,000; left over 3,300,000 − 500,000 − 20,000 − 200,000 − 120,000
  assert.equal(pay.subscriptionTransfer.transferKrw, 20_000)
  assert.equal(pay.leftOverKrw, 2_460_000)
  assert.equal(pay.leftOverKrw, Math.round(moneyOf(data(PAY), '2026-12').dist.remainder))
  // the month before: 10-25 … 11-24, nothing dated in it but the charge of 11-05
  const nov = overview(data(PAY), '2026-11')
  assert.deepEqual(nov.period, { from: '2026-10-25', to: '2026-11-24' })
  assert.deepEqual(nov.payments.map((p) => p.date), ['2026-11-05'])
  assert.deepEqual([nov.spendingRounds.length, nov.planChanges.length, nov.income.totalKrw], [0, 0, 3_000_000])
})

test('get_income, get_budget, list_subscriptions, list_spendings: the month and its period', () => {
  const d = data(PAY)
  const inc = incomeView(d, '2026-12')
  assert.deepEqual(inc.period, { from: '2026-11-25', to: '2026-12-24' })
  assert.deepEqual(inc.extras.map((x) => x.id), ['x1'])
  assert.equal(inc.totalKrw, 3_300_000)
  assert.deepEqual(incomeView(d, '2027-01').extras.map((x) => x.id), ['x2'])
  assert.deepEqual(budget(d, '2026-12').period, { from: '2026-11-25', to: '2026-12-24' })
  assert.equal(budget(d, '2026-12').remainderKrw, 2_460_000)

  // on 11-25 it is "2026-12": the change of 11-28 lies in it, so its plan is the one in force this month
  const subs = subscriptionList(d, day('2026-11-25'))
  assert.deepEqual([subs.month, subs.period, subs.subscriptions[0]!.plan], ['2026-12', { from: '2026-11-25', to: '2026-12-24' }, 'Plus'])
  // a day earlier it is still "2026-11" (10-25 … 11-24)
  assert.deepEqual([subscriptionList(d, day('2026-11-24')).month, subscriptionList(d, day('2026-11-24')).subscriptions[0]!.plan], ['2026-11', 'Basic'])
  // the calendar: 11-24 is in 2026-11, where the change of 11-28 already counts
  assert.deepEqual([subscriptionList(data(S), day('2026-11-24')).month, subscriptionList(data(S), day('2026-11-24')).subscriptions[0]!.plan], ['2026-11', 'Plus'])

  const list = spendingList(d, day('2026-11-25'), { month: '2026-12' })
  assert.deepEqual(list.period, { from: '2026-11-25', to: '2026-12-24' })
  assert.deepEqual(list.spendings.map((s) => s.id), ['a', 'b'])
  assert.deepEqual(list.monthTotals, { subscriptionAccountKrw: 3_000, remainderKrw: 120_000 })
  assert.deepEqual(spendingList(data(S), day('2026-11-25'), { month: '2026-12' }).spendings.map((s) => s.id), ['b', 'c'])
  assert.equal('period' in spendingList(d, day('2026-11-25')), false)
  // a plan change moves the monthly total in the month whose period holds its date: "2026-12" (15,000 − 10,000)
  assert.equal(planChangeList(d).planChanges[0]!.monthlyDeltaKrw, 5_000)
})

test('get_schedule: each month has its period, its three dates and the own dates whose day lies in it', () => {
  const s = schedule(data(PAY), '2026-12', 2)
  assert.deepEqual(s.months.map((m) => [m.month, m.period.from, m.period.to]), [['2026-12', '2026-11-25', '2026-12-24'], ['2027-01', '2026-12-25', '2027-01-24']])
  assert.deepEqual(s.months.map((m) => [m.dates.pay.date, m.dates.transfer.date, m.dates.billing.date]), [['2026-11-25', '2026-11-26', '2026-12-14'], ['2026-12-25', '2026-12-26', '2027-01-14']])
  // the own dates: the 28th in the period's first calendar month, the 3rd in its second
  assert.deepEqual(s.months.map((m) => m.ownDates.map((o) => `${o.id} ${o.date}`)), [['own 2026-11-28', 'own2 2026-12-03'], ['own 2026-12-28', 'own2 2027-01-03']])
  assert.deepEqual(s.months.map((m) => m.spendingRounds.map((r) => r.date)), [['2026-11-30', '2026-12-24'], ['2026-12-25']])
  assert.deepEqual(s.months.map((m) => m.payments.map((p) => p.date)), [['2026-12-05'], ['2027-01-05']])
  assert.deepEqual(s.months.map((m) => m.planChanges.map((c) => c.id)), [['pc'], []])
  // a plan event is saved by month name and stays under that name
  assert.deepEqual(s.months.map((m) => m.planEvents.map((e) => e.id)), [['e1'], []])
  // the holidays run from the first month's first date to the last month's last date (the built-in set: 12-25 and 01-01)
  assert.deepEqual(s.holidays.map((h) => h.date), ['2026-12-25', '2027-01-01'])

  // the calendar basis: as before — the calendar month, its dates, its own dates
  const c = schedule(data(S), '2026-12', 1).months[0]!
  assert.deepEqual(c.period, { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual([c.dates.pay.date, c.dates.transfer.date, c.dates.billing.date], ['2026-12-25', '2026-12-26', '2026-12-14'])
  assert.deepEqual(c.ownDates.map((o) => `${o.id} ${o.date}`), ['own2 2026-12-03', 'own 2026-12-28'])
})

test('list_accounts: the projection starts with this month of the basis and names the dates of each month; the year is the calendar year', () => {
  const pay = accountList(data(PAY), day('2026-11-25'), 2)
  assert.equal(pay.month, '2026-12')
  assert.deepEqual(pay.period, { from: '2026-11-25', to: '2026-12-24' })
  assert.deepEqual(pay.projectionMonths, [{ month: '2026-12', from: '2026-11-25', to: '2026-12-24' }, { month: '2027-01', from: '2026-12-25', to: '2027-01-24' }])
  // the record of 11-25 (1,000,000) + the transfers of 11-26 and 12-26 (200,000 each)
  assert.deepEqual(pay.accounts[0]!.projection!.map((r) => [r.month, r.endKrw]), [['2026-12', 1_200_000], ['2027-01', 1_400_000]])
  // the year 2026 by date: the transfers of 01-26 … 12-26 (the months named 2026-02 … 2027-01)
  assert.deepEqual([pay.accounts[0]!.year.year, pay.accounts[0]!.year.contributionKrw], [2026, 2_400_000])
  const cal = accountList(data(S), day('2026-11-25'), 2)
  assert.equal(cal.month, '2026-11')
  assert.deepEqual(cal.projectionMonths, [{ month: '2026-11', from: '2026-11-01', to: '2026-11-30' }, { month: '2026-12', from: '2026-12-01', to: '2026-12-31' }])
  assert.deepEqual(cal.accounts[0]!.projection!.map((r) => [r.month, r.endKrw]), [['2026-11', 1_200_000], ['2026-12', 1_400_000]])
})

test('list_notifications: this month\'s left over is the one of the month of the basis that holds today', () => {
  // the fixed target takes 3,500,000 from the month named 2027-01
  const short = (s: Settings) => data(s, { phases: [{ id: 'p1', label: '', name: 'one', from: '2026-01', to: '2026-12', amounts: { 't-f': 200_000 } }, { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { 't-f': 3_500_000 } }] })
  const kinds = (s: Settings, today: string) => notificationList(short(s), day(today), 0).notifications.filter((n) => n.kind === 'remainderShort').map((n) => (n.kind === 'remainderShort' ? n.month : ''))
  assert.deepEqual(kinds(S, '2026-12-25'), [])
  assert.deepEqual(kinds(PAY, '2026-12-24'), [])
  assert.deepEqual(kinds(PAY, '2026-12-25'), ['2027-01'])
})

test('a proposal\'s income line names the month each side counts the money in', () => {
  const row = { id: 'x1', date: '2026-11-25', name: 'First day', amount: 200_000 }
  // the same row before and after a proposal that changes the basis from the calendar to pay: 2026-11, then "2026-12"
  const line = incomeLine({ table: 'income_extra', op: 'update', before: row, after: row }, data(S), data(PAY))!
  assert.match(line, /left over of 2026-11: /)
  assert.match(line, /left over of 2026-12: /)
  const same = incomeLine({ table: 'income_extra', op: 'insert', before: null, after: row }, data(PAY), data(PAY))!
  assert.match(same, /left over of 2026-12: 2,460,000 KRW\.$/)
  assert.doesNotMatch(same, /2026-11:/)
})

test('the server instructions say what a month is inside the first 512 characters, for each permission', () => {
  for (const key of [null, { id: 'k', name: 'n', confirm: 'ui' as const }, { id: 'k', name: 'n', confirm: 'chat' as const }]) {
    const head = instructionsFor(key).slice(0, 512)
    assert.match(head, /A month is the period of the user's chosen basis \(calendar month, a card's usage period or pay date to pay date\): see period in the answers\./)
    assert.match(head, /get_overview/)
  }
})
