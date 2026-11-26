// The paying-account block of the allocation table and the one list behind the month's numbers (spec 018 S-6, W-5):
// Distribution.payouts, and — further down — the balance projection of a paying account. Every expected number is
// worked out by hand in the comments. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Account, AllocationTarget, Balance, Card, Phase, Settings, Spending, SpendingRound, Subscription } from '../../src/data/types'
import { distributionAt, monthMoney, priced, projectAccount, type AccountState } from '../../src/lib/calc'
import { accountMonthIn } from '../../src/lib/accounts'

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

// ---------- the balance projection reads the same list (S-6) ----------
const none: ReadonlySet<string> = new Set()
const bal = (accountId: string, date: string, amount: number): Balance => ({ id: `${accountId}-${date}`, accountId, date, amount })
const project = (st: AccountState, id: string, from: string, months: number) => projectAccount(st.accounts.find((a) => a.id === id)!, st, none, from, months)!
// Everything here goes through c1, the card of pay-acc (which no target sends to):
// an installment billed 12-14, 01-14 and 02-14 (60,000 each), a lump sum billed 01-14 (25,000), and a buffer use of
// 40,000 bought 11-01 (its bill leaves the buffer on 12-14) refilled on 11-25 and 12-25 (20,000 each).
const ONE: Spending[] = [
  spending('inst3', { how: 'installment', count: 3, cardId: 'c1', rounds: [round(1, '2026-12-14', 60_000), round(2, '2027-01-14', 60_000), round(3, '2027-02-14', 60_000)] }),
  spending('lumpx', { cardId: 'c1', bought: '2026-12-03', rounds: [round(1, '2027-01-14', 25_000)] }),
  spending('buf', { how: 'buffer', count: 2, cardId: 'c1', amount: 40_000, refillFrom: '2026-11-25', rounds: [round(1, '2026-11-25', 20_000), round(2, '2026-12-25', 20_000)] }),
]

test('one number: the spendings off the left over, the paying account\'s card and refill parts and the projection\'s money in agree, three months running', () => {
  const st = state({ spendings: ONE, balances: [bal('pay-acc', '2026-11-01', 500_000)] })
  const rows = project(st, 'pay-acc', '2026-11', 4)
  // November counts the bill of 12-14 (60,000) and the refill of 11-25 (20,000); December the bills of 01-14
  // (60,000 + 25,000) and the refill of 12-25; January the bill of 02-14
  const expected = [['2026-11', 60_000, 20_000], ['2026-12', 85_000, 20_000], ['2027-01', 60_000, 0]] as const
  expected.forEach(([ym, card, refill], i) => {
    const m = monthMoney(st, ym)
    const p = m.dist.payouts.find((x) => x.accountId === 'pay-acc')!
    assert.deepEqual([p.card, p.refill], [card, refill], ym)
    // the spendings part of the left over
    assert.equal(m.spend.remainder, card + refill, ym)
    assert.equal(m.dist.remainder, m.income.total - m.dist.subscriptions - 500_000 - (card + refill), ym)
    // what the projection brings into the paying account that month, and the accounts table's column
    assert.equal(rows[i]!.inflow, card + refill, ym)
    assert.equal(accountMonthIn(st.accounts.find((a) => a.id === 'pay-acc')!, st, ym), card + refill, ym)
  })
  // the money leaves on the bills' dates: December 60,000 (12-14) + the buffer use's bill 40,000 (12-14); January
  // 60,000 + 25,000 (01-14); February 60,000 (02-14)
  assert.deepEqual(rows, [
    { ym: '2026-11', inflow: 80_000, outflow: 0, end: 580_000 },
    { ym: '2026-12', inflow: 105_000, outflow: 100_000, end: 585_000 },
    { ym: '2027-01', inflow: 60_000, outflow: 85_000, end: 560_000 },
    { ym: '2027-02', inflow: 0, outflow: 60_000, end: 500_000 },
  ])
  // all in all what came in for the cards has left for the cards: the balance is back where it started
  assert.equal(rows.reduce((a, r) => a + r.inflow - r.outflow, 0), 0)
})

test('one number on a pay and a card basis: the same three agree in every month', () => {
  const basisCard: Card = { id: 'basis', name: 'Basis', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }
  for (const settings of [{ ...S, monthBasis: 'pay' as const }, { ...S, monthBasis: 'card' as const, monthBasisCardId: 'basis' }]) {
    const st = state({ settings, spendings: ONE, cards: [...CARDS, basisCard], balances: [bal('pay-acc', '2026-10-01', 500_000)] })
    const rows = project(st, 'pay-acc', '2026-10', 6)
    let counted = 0
    for (const r of rows) {
      const m = monthMoney(st, r.ym)
      const p = m.dist.payouts.find((x) => x.accountId === 'pay-acc')
      assert.equal(m.spend.remainder, (p?.card ?? 0) + (p?.refill ?? 0), `${settings.monthBasis} ${r.ym}`)
      assert.equal(r.inflow, m.spend.remainder, `${settings.monthBasis} ${r.ym}`)
      counted += m.spend.remainder
    }
    // every round is counted once (3 × 60,000 + 25,000 + 2 × 20,000), and the balance ends where it started
    assert.equal(counted, 245_000, settings.monthBasis)
    assert.equal(rows[rows.length - 1]!.end, 500_000, settings.monthBasis)
  }
  // pay basis by hand: "2026-12" = 11-25 … 12-24 counts the bill of 12-14 and the refill of 11-25 (its first day), and
  // both the bill (60,000) and the buffer use's bill (40,000) leave inside it
  const pay = state({ settings: { ...S, monthBasis: 'pay' }, spendings: ONE, balances: [bal('pay-acc', '2026-10-01', 500_000)] })
  assert.deepEqual(project(pay, 'pay-acc', '2026-12', 1), [{ ym: '2026-12', inflow: 80_000, outflow: 100_000, end: 480_000 }])
})

test('an account that takes the left over: its card bills neither come in nor go out, the left over has them off already', () => {
  // rest-acc takes the left over and pays c2: the installment's bills of 12-14 and 01-14 (40,000 each)
  const st = state({ balances: [bal('rest-acc', '2026-11-01', 0)] })
  // November: left over 2,300,000 (40,000 of it already off for the bill of 12-14); December 2,410,000; January 3,000,000 − 20,000 − 500,000
  assert.deepEqual(project(st, 'rest-acc', '2026-11', 3), [
    { ym: '2026-11', inflow: 2_300_000, outflow: 0, end: 2_300_000 },
    { ym: '2026-12', inflow: 2_410_000, outflow: 0, end: 4_710_000 },
    { ym: '2027-01', inflow: 2_480_000, outflow: 0, end: 7_190_000 },
  ])
  // the allocation table still names what the account's card takes that month
  assert.equal(monthMoney(st, '2026-11').dist.payouts.find((p) => p.accountId === 'rest-acc')!.card, 40_000)
  assert.equal(accountMonthIn(st.accounts.find((a) => a.id === 'rest-acc')!, st, '2026-11'), 2_300_000)
  // its buffer use is not off the left over twice: the refills come in and the bill goes out, as before (review 2 F-2)
  const buf = spending('rbuf', { how: 'buffer', count: 1, cardId: 'c2', amount: 50_000, refillFrom: '2026-12-25', rounds: [round(1, '2026-12-25', 50_000)] })
  const withBuf = state({ spendings: [buf], balances: [bal('rest-acc', '2026-11-30', 0)] })
  // December: left over 3,000,000 − 20,000 − 500,000 − 50,000 = 2,430,000, + the refill 50,000; the bill of 12-14 leaves
  assert.deepEqual(project(withBuf, 'rest-acc', '2026-12', 1), [{ ym: '2026-12', inflow: 2_480_000, outflow: 50_000, end: 2_430_000 }])
})

test('a round paid from the subscription account leaves the account linked to the subscriptions target on its date', () => {
  // November: the transfer of 30,000 (12,300 + the round of 9,000, rounded up) comes in on 11-26; the round left on 11-20
  const st = state({ balances: [bal('subs-acc', '2026-11-01', 100_000)] })
  assert.deepEqual(project(st, 'subs-acc', '2026-11', 2), [
    { ym: '2026-11', inflow: 30_000, outflow: 9_000, end: 121_000 },
    { ym: '2026-12', inflow: 20_000, outflow: 0, end: 141_000 },
  ])
  // a record after the round's date has it already
  assert.deepEqual(project(state({ balances: [bal('subs-acc', '2026-11-20', 100_000)] }), 'subs-acc', '2026-11', 1), [{ ym: '2026-11', inflow: 30_000, outflow: 0, end: 130_000 }])
  // also when that account takes the left over: the round is in the transfer, not off the left over
  const targets = TARGETS.map((t) => (t.kind === 'remainder' ? { ...t, accountId: 'subs-acc' } : t))
  const both = project(state({ targets, spendings: SPENDINGS.filter((x) => x.id === 'bysubs'), balances: [bal('subs-acc', '2026-11-01', 0)] }), 'subs-acc', '2026-11', 1)[0]!
  // in: the transfer 30,000 + the left over 3,000,000 − 30,000 − 500,000; out: the round
  assert.deepEqual([both.inflow, both.outflow], [30_000 + 2_470_000, 9_000])
  // without an account on the subscriptions target the round leaves no account
  const loose = TARGETS.map((t) => (t.kind === 'subscriptions' ? { ...t, accountId: null } : t))
  for (const a of ACCOUNTS) {
    const rows = project(state({ targets: loose, spendings: SPENDINGS.filter((x) => x.id === 'bysubs'), balances: ACCOUNTS.map((x) => bal(x.id, '2026-11-01', 0)) }), a.id, '2026-11', 1)
    assert.equal(rows[0]!.outflow, 0, a.id)
  }
})

test('a split paid by card goes through the card\'s paying account by its own dates', () => {
  // paid by c1 on 11-10 and 12-10 (4,000 each); the record is of 10-31
  const split = spending('split', { how: 'split', count: 2, interval: 'monthly', cardId: 'c1', rounds: [round(1, '2026-11-10', 4_000), round(2, '2026-12-10', 4_000)] })
  const st = state({ spendings: [split], balances: [bal('pay-acc', '2026-10-31', 10_000)] })
  // November counts the round of 11-10: 4,000 comes in with the transfer of 11-26 and left on 11-10; the same in December
  assert.deepEqual(project(st, 'pay-acc', '2026-11', 2), [
    { ym: '2026-11', inflow: 4_000, outflow: 4_000, end: 10_000 },
    { ym: '2026-12', inflow: 4_000, outflow: 4_000, end: 10_000 },
  ])
  assert.deepEqual(monthMoney(st, '2026-11').dist.payouts.find((p) => p.accountId === 'pay-acc'), { accountId: 'pay-acc', subscriptions: 0, card: 4_000, refill: 0, total: 4_000 })
})
