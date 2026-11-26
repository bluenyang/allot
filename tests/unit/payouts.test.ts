// The paying-account block of the allocation table and the one list behind the month's numbers (spec 018 S-6, W-5):
// Distribution.payouts, and — further down — the balance projection of a paying account. Every expected number is
// worked out by hand in the comments. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Account, AllocationTarget, Card, Phase, Settings, Spending, SpendingRound, Subscription } from '../../src/data/types'
import { distributionAt, monthMoney, priced, type AccountState } from '../../src/lib/calc'

// Pay day 25, transfer day 26, card billing day 14, calendar months, no weekend rule.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const ACCOUNTS = [acc('subs-acc'), acc('pay-acc', { buffer: 500_000 }), acc('fix-acc'), acc('rest-acc')]
const TARGETS: AllocationTarget[] = [
  { id: 't-s', name: 'Subs', kind: 'subscriptions', accountId: 'subs-acc' },
  { id: 't-f', name: 'Fixed', kind: 'fixed', accountId: 'fix-acc' },
  { id: 't-r', name: 'Rest', kind: 'remainder', accountId: 'rest-acc' },
]
const PHASES: Phase[] = [{ id: 'p1', label: '', name: 'one', from: '2026-01', to: null, amounts: { 't-f': 500_000 } }]
// c1 is paid from pay-acc, c2 from the account that takes the left over, c3 from no account
const CARDS: Card[] = [
  { id: 'c1', name: 'One', last4: '', accountId: 'pay-acc', billingDay: null },
  { id: 'c2', name: 'Two', last4: '', accountId: 'rest-acc', billingDay: null },
  { id: 'c3', name: 'Three', last4: '', accountId: null, billingDay: null },
]
// one subscription of 12,300 a month: needed 13,000, transfer 20,000 (rounded up to 10,000)
const SUBS: Subscription[] = [{
  id: 's1', name: 'Sub', category: 'tool', plan: 'Basic', amount: 12_300, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active',
  nextDate: '2026-11-05', path: 'direct', verified: false,
} as Subscription]
const round = (no: number, date: string, amount: number, state: SpendingRound['state'] = 'left'): SpendingRound => ({ no, date, amount, state, edited: false })
const spending = (id: string, over: Partial<Spending>): Spending => ({
  id, name: id, category: '', bought: '2026-11-01', amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'card', count: 1, fee: 0,
  interval: null, cancelled: false, rounds: [], ...over,
})
const SPENDINGS: Spending[] = [
  // a card bill of 12-14 through c1: paid with the pay of 11-25 → November
  spending('lump', { cardId: 'c1', rounds: [round(1, '2026-12-14', 100_000)] }),
  // an installment through the card of the left-over account: 12-14 → November, 2027-01-14 → December
  spending('inst', { how: 'installment', count: 2, cardId: 'c2', rounds: [round(1, '2026-12-14', 40_000), round(2, '2027-01-14', 40_000)] }),
  // a buffer use through c1, bought 11-01 (its bill leaves the buffer on 12-14): refills on the pay days 11-25 and 12-25
  spending('buf', { how: 'buffer', count: 2, cardId: 'c1', refillFrom: '2026-11-25', rounds: [round(1, '2026-11-25', 30_000), round(2, '2026-12-25', 30_000)] }),
  // paid from the subscription account on 11-20
  spending('bysubs', { payBy: 'subs', rounds: [round(1, '2026-11-20', 9_000)] }),
]
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: PHASES, targets: TARGETS, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: SUBS, planChanges: [],
  spendings: SPENDINGS, accounts: ACCOUNTS, balances: [], cards: CARDS, ...over,
})

test('payouts: per paying account the subscription transfer, the month\'s card rounds and its buffer refills, and their sum', () => {
  // November. Spendings off the left over: 100,000 (lump) + 40,000 (inst 1) + 30,000 (refill) = 170,000; to the transfer: 9,000.
  // Transfer: 12,300 + 9,000 = 21,300 → needed 22,000 → 30,000. Left over = 3,000,000 − 30,000 − 500,000 − 170,000 = 2,300,000.
  const nov = monthMoney(state(), '2026-11')
  assert.equal(nov.spend.remainder, 170_000)
  assert.equal(nov.dist.subscriptions, 30_000)
  assert.equal(nov.dist.remainder, 2_300_000)
  assert.deepEqual(nov.dist.payouts, [
    { accountId: 'subs-acc', subscriptions: 30_000, card: 0, refill: 0, total: 30_000 },
    { accountId: 'pay-acc', subscriptions: 0, card: 100_000, refill: 30_000, total: 130_000 },
    { accountId: 'rest-acc', subscriptions: 0, card: 40_000, refill: 0, total: 40_000 },
  ])
  // December: the installment's bill of 01-14 (40,000) and the refill of 12-25 (30,000); the transfer is back at 20,000
  const dec = monthMoney(state(), '2026-12')
  assert.equal(dec.spend.remainder, 70_000)
  assert.equal(dec.dist.remainder, 3_000_000 - 20_000 - 500_000 - 70_000)
  assert.deepEqual(dec.dist.payouts, [
    { accountId: 'subs-acc', subscriptions: 20_000, card: 0, refill: 0, total: 20_000 },
    { accountId: 'pay-acc', subscriptions: 0, card: 0, refill: 30_000, total: 30_000 },
    { accountId: 'rest-acc', subscriptions: 0, card: 40_000, refill: 0, total: 40_000 },
  ])
  // January: no spending counts; only the subscription account gets something
  assert.deepEqual(monthMoney(state(), '2027-01').dist.payouts, [{ accountId: 'subs-acc', subscriptions: 20_000, card: 0, refill: 0, total: 20_000 }])
})

test('payouts: the card and refill parts add up to the spendings taken off the left over, less what no account pays', () => {
  for (const ym of ['2026-10', '2026-11', '2026-12', '2027-01']) {
    const m = monthMoney(state(), ym)
    assert.equal(m.dist.payouts.reduce((a, p) => a + p.card + p.refill, 0), m.spend.remainder, ym)
  }
  // a card without a paying account, a card spending without a card and a salary round come off the left over and go to no account
  const loose = [
    ...SPENDINGS,
    spending('nocard', { rounds: [round(1, '2026-12-14', 5_000)] }),
    spending('noacc', { cardId: 'c3', rounds: [round(1, '2026-12-14', 6_000)] }),
    spending('salary', { payBy: 'salary', rounds: [round(1, '2026-11-10', 7_000)] }),
  ]
  const m = monthMoney(state({ spendings: loose }), '2026-11')
  assert.equal(m.spend.remainder, 170_000 + 18_000)
  assert.equal(m.dist.payouts.reduce((a, p) => a + p.card + p.refill, 0), 170_000)
  assert.deepEqual(m.dist.payouts.map((p) => p.accountId), ['subs-acc', 'pay-acc', 'rest-acc'])
})

test('payouts: the rows and the left over keep their formula; one account may be both the subscription and a paying account', () => {
  const s = priced(S, [])
  const m = monthMoney(state(), '2026-11')
  // the same call without the paying-account input: the same rows, left over and sums, and no card part
  const plain = distributionAt('2026-11', 3_000_000, PHASES, TARGETS, [], SUBS, [], s, m.spend.remainder, m.spend.subs, ACCOUNTS, [])
  assert.deepEqual({ ...m.dist, payouts: [] }, { ...plain, payouts: [] })
  assert.deepEqual(plain.payouts, [{ accountId: 'subs-acc', subscriptions: 30_000, card: 0, refill: 0, total: 30_000 }])
  // left over = what comes in − the targets − the month's spendings
  assert.equal(m.dist.remainder, m.income.total - 30_000 - 500_000 - m.spend.remainder)
  // the subscriptions target and the card on one account: one entry with all three parts
  const cards = CARDS.map((c) => (c.id === 'c1' ? { ...c, accountId: 'subs-acc' } : c))
  assert.deepEqual(monthMoney(state({ cards }), '2026-11').dist.payouts, [
    { accountId: 'subs-acc', subscriptions: 30_000, card: 100_000, refill: 30_000, total: 160_000 },
    { accountId: 'rest-acc', subscriptions: 0, card: 40_000, refill: 0, total: 40_000 },
  ])
})

test('payouts: nothing when no account is named and nothing is paid through a card', () => {
  const targets = TARGETS.map((t) => ({ ...t, accountId: null }))
  assert.deepEqual(monthMoney(state({ targets, spendings: [], cards: [] }), '2026-11').dist.payouts, [])
  // a subscriptions target with an account but no subscription and no spending: the transfer is 0, so no entry
  assert.deepEqual(monthMoney(state({ subscriptions: [], spendings: [] }), '2026-11').dist.payouts, [])
})
