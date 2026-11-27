// What the MCP tools say about the month a round counts in and the transfers to the paying accounts (spec 018 S-5,
// S-6, S-10, W-5): get_overview and get_allocation `payouts`, `countsIn` on the rounds. Synthetic data; no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Settings, Spending, SpendingRound, Subscription } from '../../src/data/types'
import { allocation, overview, schedule, spendingList, type Data } from '../../server/mcp/views'

// Pay day 25, transfer day 26, billing day 14, calendar months, no weekend rule.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
// 12,300 a month: needed 13,000, transfer 20,000
const sub: Subscription = { id: 's1', name: 'Sub', category: 'tool', plan: 'Basic', amount: 12_300, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-11-05', path: 'direct', verified: false }
const round = (no: number, date: string, amount: number, state: SpendingRound['state'] = 'left'): SpendingRound => ({ no, date, amount, state, edited: false })
const spending = (id: string, over: Partial<Spending>): Spending => ({
  id, name: id, category: '', bought: '2026-11-01', amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'card', count: 1, fee: 0,
  interval: null, cancelled: false, cardId: 'c1', rounds: [], ...over,
})
const data = (over: Partial<Data> = {}): Data => ({
  settings: S, living: { food: 0, transit: 0, allowance: 0 },
  targets: [{ id: 't-s', name: 'Subs', kind: 'subscriptions', accountId: 'a-subs' }, { id: 't-r', name: 'Rest', kind: 'remainder' }],
  subscriptions: [sub], planChanges: [], phases: [], events: [], checks: [], debts: [], remainderSplit: [], holidaySets: [],
  accounts: [{ id: 'a-subs', name: 'Subs account', role: '', inflow: '', outflow: '' }, { id: 'a-pay', name: 'Card account', role: '', inflow: '', outflow: '' }],
  balances: [],
  cards: [{ id: 'c1', name: 'Card', last4: '', accountId: 'a-pay', billingDay: null }],
  spendings: [
    // a card bill of 12-14: paid with the pay of 11-25 → November
    spending('bill', { rounds: [round(1, '2026-12-14', 100_000)] }),
    // an installment: 12-14 → November, 2027-01-14 → December; a merged round counts nowhere
    spending('inst', { how: 'installment', count: 2, rounds: [round(1, '2026-12-14', 30_000), round(2, '2027-01-14', 30_000), round(3, '2027-02-14', 999, 'merged')] }),
    // a buffer use: the refills of 11-25 and 12-25 count by their own dates
    spending('buf', { how: 'buffer', count: 2, refillFrom: '2026-11-25', rounds: [round(1, '2026-11-25', 20_000), round(2, '2026-12-25', 20_000)] }),
    // cancelled: its left round counts nowhere
    spending('gone', { cancelled: true, rounds: [round(1, '2026-12-14', 7_000)] }),
  ],
  ...over,
})
const day = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!) }

const NOV = [
  { accountId: 'a-subs', account: 'Subs account', subscriptionsKrw: 20_000, cardKrw: 0, refillKrw: 0, totalKrw: 20_000 },
  // the bills of 12-14 (100,000 + 30,000) and the refill of 11-25
  { accountId: 'a-pay', account: 'Card account', subscriptionsKrw: 0, cardKrw: 130_000, refillKrw: 20_000, totalKrw: 150_000 },
]

test('get_overview: distribution.payouts names what goes to each paying account, and agrees with the month\'s spendings', () => {
  const nov = overview(data(), '2026-11')
  assert.deepEqual(nov.distribution.payouts, NOV)
  assert.equal(nov.distribution.spendingKrw, 150_000)
  assert.equal(nov.distribution.remainderKrw, 3_000_000 - 20_000 - 150_000)
  // December: the bill of 01-14 (30,000) and the refill of 12-25
  const dec = overview(data(), '2026-12')
  assert.deepEqual(dec.distribution.payouts[1], { accountId: 'a-pay', account: 'Card account', subscriptionsKrw: 0, cardKrw: 30_000, refillKrw: 20_000, totalKrw: 50_000 })
  assert.equal(dec.distribution.spendingKrw, 50_000)
  // a month with no spending: only the subscription account
  assert.deepEqual(overview(data(), '2027-03').distribution.payouts, [NOV[0]])
  assert.deepEqual(overview(data({ spendings: [], targets: [{ id: 't-s', name: 'Subs', kind: 'subscriptions' }] }), '2026-11').distribution.payouts, [])
})

test('get_allocation: payouts of the month that holds today, with its period; without a date none', () => {
  const a = allocation(data(), day('2026-11-27'))
  assert.deepEqual(a.payouts, { month: '2026-11', period: { from: '2026-11-01', to: '2026-11-30' }, accounts: NOV })
  // with the pay basis, 11-27 is in "2026-12" (11-25 … 12-24), which counts the same bills (pay of 11-25) and the refill of 11-25
  const pay = allocation(data({ settings: { ...S, monthBasis: 'pay' } }), day('2026-11-27'))
  assert.deepEqual(pay.payouts, { month: '2026-12', period: { from: '2026-11-25', to: '2026-12-24' }, accounts: NOV })
  // the definition itself is what it was
  assert.equal('payouts' in allocation(data()), false)
  const { payouts: _p, ...rest } = a
  assert.deepEqual(rest, allocation(data()))
})

test('list_spendings: every round says the month that counts it; the month filter and totals go by it', () => {
  const l = spendingList(data(), day('2026-11-27'))
  const counts = Object.fromEntries(l.spendings.map((s) => [s.id, s.rounds.map((r) => r.countsIn)]))
  assert.deepEqual(counts, {
    bill: ['2026-11'],
    inst: ['2026-11', '2026-12', null], // the merged round counts nowhere
    buf: ['2026-11', '2026-12'],
    gone: [null], // left on a cancelled spending
  })
  const nov = spendingList(data(), day('2026-11-27'), { month: '2026-11' })
  assert.deepEqual(nov.spendings.map((s) => s.id), ['bill', 'inst', 'buf', 'gone'])
  assert.deepEqual(nov.monthTotals, { subscriptionAccountKrw: 0, remainderKrw: 150_000 })
  // December counts the installment's bill of 01-14 and the refill of 12-25; the bills dated in December are November's
  const dec = spendingList(data(), day('2026-11-27'), { month: '2026-12' })
  assert.deepEqual(dec.spendings.map((s) => s.id), ['inst', 'buf'])
  assert.deepEqual(dec.monthTotals, { subscriptionAccountKrw: 0, remainderKrw: 50_000 })
  // a paid round of a cancelled spending still counts
  const paid = spendingList(data({ spendings: [spending('gone', { cancelled: true, rounds: [round(1, '2026-12-14', 7_000, 'paid')] })] }), day('2026-11-27'))
  assert.deepEqual(paid.spendings[0]!.rounds.map((r) => r.countsIn), ['2026-11'])
  // the pay date before a card bill is the actual one: 2026-10-25 is a Sunday, moved after to Monday 10-26, so a bill of 10-26 is September's
  const moved = spendingList(data({ settings: { ...S, payShift: 'after' }, spendings: [spending('m', { rounds: [round(1, '2026-10-26', 1_000)] }), spending('n', { rounds: [round(1, '2026-10-27', 1_000)] })] }), day('2026-11-27'))
  assert.deepEqual(moved.spendings.map((s) => s.rounds[0]!.countsIn), ['2026-09', '2026-10'])
})

test('get_overview lists the rounds a month counts, get_schedule the rounds dated in it; both say countsIn', () => {
  const row = (r: { date: string; spendingId: string; round: number; countsIn: string }) => [r.date, r.spendingId, r.round, r.countsIn]
  // November counts the refill of 11-25 and the two bills of 12-14
  assert.deepEqual(overview(data(), '2026-11').spendingRounds.map(row), [
    ['2026-11-25', 'buf', 1, '2026-11'], ['2026-12-14', 'bill', 1, '2026-11'], ['2026-12-14', 'inst', 1, '2026-11'],
  ])
  assert.deepEqual(overview(data(), '2026-12').spendingRounds.map(row), [['2026-12-25', 'buf', 2, '2026-12'], ['2027-01-14', 'inst', 2, '2026-12']])
  // the schedule is dates: December lists the bills of 12-14 (counted in November) and the refill of 12-25
  const s = schedule(data(), '2026-11', 3)
  assert.deepEqual(s.months.map((m) => m.spendingRounds.map(row)), [
    [['2026-11-25', 'buf', 1, '2026-11']],
    [['2026-12-14', 'bill', 1, '2026-11'], ['2026-12-14', 'inst', 1, '2026-11'], ['2026-12-25', 'buf', 2, '2026-12']],
    [['2027-01-14', 'inst', 2, '2026-12']],
  ])
})
