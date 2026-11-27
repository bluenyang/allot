// spec 018 S-8, S-9, S-12 (W-7, V-4): how a subscription is paid — a card, an account, or neither — and its charges in
// the balance projection. Synthetic data, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { payRow, subscription as subBody } from '../../server/validation'
import { issueMessage } from '../../server/messages'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Account, AllocationTarget, Balance, Card, DayShift, ForeignCurrency, Phase, PlanChange, Settings, Spending, SpendingRound, Subscription } from '../../src/data/types'
import { monthMoney, parseDate, projectAccount, type AccountState } from '../../src/lib/calc'
import { accountList, subscriptionList, type Data } from '../../server/mcp/views'

// ── the request body (S-12) ──
const OLD = { name: 'Stream', category: 'content', plan: 'Basic', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-12-05', path: 'direct', verified: false }

test('subscription body: the 0.1.9 shape passes and names no way of paying, so the saved one stays', () => {
  const parsed = subBody.safeParse(OLD)
  assert.equal(parsed.success, true)
  // a key the body leaves out is not in the parsed row: the update writes no value for it
  assert.equal('cardId' in parsed.data!, false)
  assert.equal('accountId' in parsed.data!, false)
})

test('subscription body: a card, an account, null for either or both; never both set', () => {
  for (const pay of [{ cardId: 'c1' }, { accountId: 'a1' }, { cardId: null }, { accountId: null }, { cardId: null, accountId: null }, { cardId: 'c1', accountId: null }, { cardId: null, accountId: 'a1' }]) {
    const r = subBody.safeParse({ ...OLD, ...pay })
    assert.equal(r.success, true, JSON.stringify(pay))
    assert.deepEqual({ cardId: r.data!.cardId, accountId: r.data!.accountId }, { cardId: undefined, accountId: undefined, ...pay }, JSON.stringify(pay))
  }
  const both = subBody.safeParse({ ...OLD, cardId: 'c1', accountId: 'a1' })
  assert.equal(both.success, false)
  assert.equal(both.error!.issues[0]!.message, 'payOneOf')
  assert.equal(issueMessage('ko', both.error!.issues[0]), '구독의 결제 수단은 카드와 통장 중 하나만 고를 수 있어요.')
  assert.equal(issueMessage('en', both.error!.issues[0]), 'A subscription is paid with a card or from an account, not both.')
  // W-7's report, spec 018 A-37: a body that names one of the two with a value clears the other in the row that is
  // written (the way of paying is one of the two), so a saved other one never makes the save a refusal
  const way = (pay: Record<string, unknown>) => { const r = payRow(subBody.parse({ ...OLD, ...pay })); return ['cardId' in r ? r.cardId : 'kept', 'accountId' in r ? r.accountId : 'kept'] }
  assert.deepEqual(way({ cardId: 'c1' }), ['c1', null])
  assert.deepEqual(way({ accountId: 'a1' }), [null, 'a1'])
  assert.deepEqual(way({ cardId: 'c1', accountId: null }), ['c1', null])
  assert.deepEqual(way({ cardId: null, accountId: 'a1' }), [null, 'a1'])
  // naming neither keeps both saved; clearing one alone keeps the other
  assert.deepEqual(way({}), ['kept', 'kept'])
  assert.deepEqual(way({ cardId: null }), [null, 'kept'])
  assert.deepEqual(way({ accountId: null }), ['kept', null])
  assert.deepEqual(way({ cardId: null, accountId: null }), [null, null])
  // the rest of the body is written as it is
  assert.deepEqual(payRow(subBody.parse({ ...OLD, cardId: 'c1' })), { ...subBody.parse(OLD), cardId: 'c1', accountId: null })
  // an id is a text of at least one character, like a spending's card
  for (const bad of ['', 12, true, {}]) {
    assert.equal(subBody.safeParse({ ...OLD, cardId: bad }).success, false, `cardId ${JSON.stringify(bad)}`)
    assert.equal(subBody.safeParse({ ...OLD, accountId: bad }).success, false, `accountId ${JSON.stringify(bad)}`)
  }
})

// ── the balance projection (S-9) ──
// Pay day 25, transfer day 26, card billing day 14, calendar months, no weekend rule; USD 1,400 with a 10% transfer buffer.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, fxRate: 1400, fxBuffer: 10 }
const none: ReadonlySet<string> = new Set()
const acc = (id: string): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {} })
// subs-acc gets the subscription transfer, rest-acc the left over, plain-acc nothing
const ACCOUNTS = [acc('subs-acc'), acc('rest-acc'), acc('plain-acc')]
const TARGETS: AllocationTarget[] = [
  { id: 't-s', name: 'Subs', kind: 'subscriptions', accountId: 'subs-acc' },
  { id: 't-r', name: 'Rest', kind: 'remainder', accountId: 'rest-acc' },
]
const PHASES: Phase[] = [{ id: 'p1', label: '', name: 'one', from: '2026-01', to: null, amounts: {} }]
const CARDS: Card[] = [
  { id: 'c-subs', name: 'Subs card', last4: '', accountId: 'subs-acc', billingDay: null },
  { id: 'c-rest', name: 'Rest card', last4: '', accountId: 'rest-acc', billingDay: null },
  { id: 'c-plain', name: 'Plain card', last4: '', accountId: 'plain-acc', billingDay: null },
  { id: 'c-none', name: 'No account', last4: '', accountId: null, billingDay: null },
  // billing day 25, usage period from the 12th to the 11th
  { id: 'c-usage', name: 'Usage', last4: '', accountId: 'plain-acc', billingDay: 25, usageFrom: 12 },
]
const sub = (id: string, amount: number, nextDate: string, over: Partial<Subscription> = {}): Subscription =>
  ({ id, name: id, category: 'tool', plan: 'Basic', amount, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate, path: 'direct', verified: false, ...over })
const change = (subId: string, effective: string, to: PlanChange['to']): PlanChange => ({ id: `${subId}@${effective}`, subId, effective, to, note: '' })
const round = (no: number, date: string, amount: number): SpendingRound => ({ no, date, amount, state: 'left', edited: false })
const lump = (id: string, cardId: string, bought: string, date: string, amount: number): Spending => ({
  id, name: id, category: '', bought, amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'card', count: 1, fee: 0,
  interval: null, cancelled: false, cardId, rounds: [round(1, date, amount)],
})
const bal = (accountId: string, date: string, amount: number): Balance => ({ id: `${accountId}@${date}`, accountId, date, amount })
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: PHASES, targets: TARGETS, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
  spendings: [], accounts: ACCOUNTS, balances: [], cards: CARDS, ...over,
})
/** `[inflow, outflow, end]` of each projected month of account `id`. */
const rows = (st: AccountState, id: string, from: string, months: number, off: ReadonlySet<string> = none) =>
  projectAccount(st.accounts.find((a) => a.id === id)!, st, off, from, months)!.map((r) => [r.inflow, r.outflow, r.end])
const outs = (st: AccountState, id: string, from: string, months: number) => rows(st, id, from, months).map((r) => r[1])

test('the request: two subscriptions and a one-off card spending leave the account together on the billing date, and the balance stops growing', () => {
  // Two subscriptions of 100,000 (charged on the 5th) and 50,000 (on the 20th), both paid with the card of the account
  // the subscriptions target sends to; a card lump sum of 30,000 bought on 10-10 with the same card, billed on 11-14.
  // The transfer: 150,000 a month → needed 150,000 → 150,000 (rounded up to 10,000), in on the 26th.
  const subs = [sub('s1', 100_000, '2026-11-05', { cardId: 'c-subs' }), sub('s2', 50_000, '2026-11-20', { cardId: 'c-subs' })]
  const spendings = [lump('one-off', 'c-subs', '2026-10-10', '2026-11-14', 30_000)]
  const st = state({ subscriptions: subs, spendings, balances: [bal('subs-acc', '2026-11-01', 200_000)] })
  assert.equal(monthMoney(st, '2026-11').dist.subscriptions, 150_000)
  // November: on 11-14 the charges of October (10-05: 100,000, 10-20: 50,000) and the one-off (30,000) leave: 180,000.
  //           On 11-26 the transfer comes in: 150,000. End 200,000 + 150,000 − 180,000 = 170,000.
  // December: 12-14 the charges of November (150,000) out, 12-26 150,000 in → 170,000. January the same.
  assert.deepEqual(rows(st, 'subs-acc', '2026-11', 3), [[150_000, 180_000, 170_000], [150_000, 150_000, 170_000], [150_000, 150_000, 170_000]])
  // the three leave on the billing date itself: a record of the day before still has them to come, one of that day has them out
  assert.equal(outs({ ...st, balances: [bal('subs-acc', '2026-11-13', 200_000)] }, 'subs-acc', '2026-11', 1)[0], 180_000)
  assert.equal(outs({ ...st, balances: [bal('subs-acc', '2026-11-14', 200_000)] }, 'subs-acc', '2026-11', 1)[0], 0)
  // as it was (no way of paying): only the one-off leaves and the balance grows by a transfer every month
  const before = state({ subscriptions: subs.map(({ cardId: _c, ...x }) => x), spendings, balances: st.balances })
  assert.deepEqual(rows(before, 'subs-acc', '2026-11', 3), [[150_000, 30_000, 320_000], [150_000, 0, 470_000], [150_000, 0, 620_000]])
  // the distribution and the left over are the same either way: the subscriptions are still funded by the transfer
  for (const ym of ['2026-11', '2026-12', '2027-01']) assert.deepEqual(monthMoney(st, ym).dist, monthMoney(before, ym).dist, ym)
})

test('paid from an account: each charge leaves that account on its own date', () => {
  // 20,000 on the 5th, from an account nothing is sent to
  const st = (date: string) => state({ subscriptions: [sub('s1', 20_000, '2026-11-05', { accountId: 'plain-acc' })], balances: [bal('plain-acc', date, 100_000)] })
  assert.deepEqual(rows(st('2026-11-04'), 'plain-acc', '2026-11', 3), [[0, 20_000, 80_000], [0, 20_000, 60_000], [0, 20_000, 40_000]])
  // a record of the charge date already has that charge out
  assert.deepEqual(rows(st('2026-11-05'), 'plain-acc', '2026-11', 3), [[0, 0, 100_000], [0, 20_000, 80_000], [0, 20_000, 60_000]])
  // the other accounts are not touched
  assert.deepEqual(outs({ ...st('2026-11-04'), balances: [bal('subs-acc', '2026-11-04', 0)] }, 'subs-acc', '2026-11', 2), [0, 0])
  // a cancelled or company-paid subscription is not charged; a cancellation dated after a charge leaves that charge (S-7)
  const off = (over: Partial<Subscription>, changes: PlanChange[] = []) =>
    outs(state({ subscriptions: [sub('s1', 20_000, '2026-11-05', { accountId: 'plain-acc', ...over })], planChanges: changes, balances: [bal('plain-acc', '2026-11-04', 100_000)] }), 'plain-acc', '2026-11', 3)
  assert.deepEqual(off({ status: 'cancelled' }), [0, 0, 0])
  assert.deepEqual(off({ status: 'company' }), [0, 0, 0])
  assert.deepEqual(off({}, [change('s1', '2026-12-06', { status: 'cancelled' })]), [20_000, 20_000, 0])
  assert.deepEqual(off({}, [change('s1', '2026-12-05', { status: 'cancelled' })]), [20_000, 0, 0])
})

test('an account that takes the left over pays its subscription charges, and its one-off card bills like any paying account', () => {
  // 10,000 on the 5th with the left-over account's card, 5,000 on the 10th straight from it, and a card lump sum of
  // 40,000 billed on 12-14 with that card (counted in November: the pay of 11-25 pays it).
  // Transfer: 15,000 → 20,000. Left over: November 3,000,000 − 20,000 − 40,000 = 2,940,000; December 2,980,000.
  const st = state({
    subscriptions: [sub('s1', 10_000, '2026-11-05', { cardId: 'c-rest' }), sub('s2', 5_000, '2026-11-10', { accountId: 'rest-acc' })],
    spendings: [lump('one-off', 'c-rest', '2026-11-03', '2026-12-14', 40_000)],
    balances: [bal('rest-acc', '2026-11-01', 0)],
  })
  assert.equal(monthMoney(st, '2026-11').dist.remainder, 2_940_000)
  assert.equal(monthMoney(st, '2026-12').dist.remainder, 2_980_000)
  // November: in 2,940,000 + the 40,000 for the one-off's bill (11-26); out 5,000 (11-10) + 10,000 (11-14, the charge of 10-05) = 15,000.
  // December: in 2,980,000; out 5,000 + 10,000 + the one-off's bill of 12-14 (review 3 F-1, spec 018 A-31: the card
  // money comes in beside the left over and the bill leaves on its date; the end of December is what it was).
  assert.deepEqual(rows(st, 'rest-acc', '2026-11', 2), [[2_980_000, 15_000, 2_965_000], [2_980_000, 55_000, 5_890_000]])
})

test('a card without a paying account moves nothing', () => {
  const subs = [sub('s1', 10_000, '2026-11-05', { cardId: 'c-none' })]
  const balances = ACCOUNTS.map((a) => bal(a.id, '2026-11-01', 1_000))
  for (const a of ACCOUNTS) {
    assert.deepEqual(rows(state({ subscriptions: subs, balances }), a.id, '2026-11', 3), rows(state({ subscriptions: [sub('s1', 10_000, '2026-11-05')], balances }), a.id, '2026-11', 3), a.id)
  }
  // a card id that no card has (it cannot be saved) moves nothing either
  assert.deepEqual(outs(state({ subscriptions: [sub('s1', 10_000, '2026-11-05', { cardId: 'gone' })], balances }), 'plain-acc', '2026-11', 2), [0, 0])
})

test('a yearly plan leaves once a year: on its date from an account, on the bill after it with a card', () => {
  const st = (pay: Partial<Subscription>) => state({ subscriptions: [sub('y', 120_000, '2027-03-10', { cycle: 'yearly', ...pay })], balances: [bal('plain-acc', '2026-11-01', 500_000)] })
  // 2026-11 … 2027-04, then a year on
  assert.deepEqual(outs(st({ accountId: 'plain-acc' }), 'plain-acc', '2026-11', 6), [0, 0, 0, 0, 120_000, 0])
  assert.deepEqual(outs(st({ cardId: 'c-plain' }), 'plain-acc', '2026-11', 6), [0, 0, 0, 0, 0, 120_000])
  assert.deepEqual(outs(st({ accountId: 'plain-acc' }), 'plain-acc', '2028-02', 3), [0, 120_000, 0])
  assert.deepEqual(outs(st({ cardId: 'c-plain' }), 'plain-acc', '2028-02', 3), [0, 0, 120_000])
})

test('a plan change in mid-month: a charge is priced by the plan of its own date, also when its bill comes later', () => {
  // 10,000 on the 10th; from 12-20 the plan costs 30,000
  const st = (pay: Partial<Subscription>, effective: string) => state({
    subscriptions: [sub('s1', 10_000, '2026-11-10', pay)], planChanges: [change('s1', effective, { plan: 'Pro', amount: 30_000 })], balances: [bal('plain-acc', '2026-11-01', 500_000)],
  })
  // from the account: 11-10 and 12-10 at the old price (the change is dated after 12-10), 01-10 at the new one
  assert.deepEqual(outs(st({ accountId: 'plain-acc' }, '2026-12-20'), 'plain-acc', '2026-11', 4), [10_000, 10_000, 30_000, 30_000])
  // a change dated on the charge date prices that charge
  assert.deepEqual(outs(st({ accountId: 'plain-acc' }, '2026-12-10'), 'plain-acc', '2026-11', 4), [10_000, 30_000, 30_000, 30_000])
  // with a card the bill of 01-14 carries the charge of 12-10 at the price of 12-10 (10,000), not of the bill's date;
  // the bills: 11-14 (10-10), 12-14 (11-10), 01-14 (12-10), 02-14 (01-10: 30,000)
  assert.deepEqual(outs(st({ cardId: 'c-plain' }, '2026-12-20'), 'plain-acc', '2026-11', 4), [10_000, 10_000, 10_000, 30_000])
  // the monthly sums stay by month: December's transfer already has the new plan
  assert.equal(monthMoney(st({ accountId: 'plain-acc' }, '2026-12-20'), '2026-12').transfer.monthlySum, 30_000)
})

test('a foreign-currency plan leaves at the exchange rate, without the transfer buffer', () => {
  // USD 10 + 10% VAT at 1,400 = 15,400; the transfer adds the 10% buffer (1,540) and rounds up: 16,940 → 17,000 → 20,000.
  const usd = state({ subscriptions: [sub('s1', 10, '2026-11-05', { currency: 'USD', vat: 10, accountId: 'plain-acc' })], balances: [bal('plain-acc', '2026-11-01', 100_000)] })
  assert.equal(monthMoney(usd, '2026-11').transfer.buffer, 1_540)
  assert.equal(monthMoney(usd, '2026-11').dist.subscriptions, 20_000)
  assert.deepEqual(outs(usd, 'plain-acc', '2026-11', 2), [15_400, 15_400])
  // a currency of the user's list: EUR 10 at 1,500 with a 5% buffer = 15,000, with a card on the bill after it
  const eur = state({
    subscriptions: [sub('s1', 10, '2026-11-05', { currency: 'EUR', cardId: 'c-plain' })], currencies: [{ id: 'eur', code: 'EUR', rate: 1500, buffer: 5 } as ForeignCurrency],
    balances: [bal('plain-acc', '2026-11-01', 100_000)],
  })
  assert.deepEqual(outs(eur, 'plain-acc', '2026-11', 2), [15_000, 15_000])
})

test('with a card the charge leaves on the first billing date after the usage period that holds it, moved by the billing rule', () => {
  // billing day 25, usage period from the 12th: a charge on the 11th closes the period and is billed on the 25th of the
  // same month; one on the 12th opens the next period and is billed on the 25th of the month after.
  const st = (nextDate: string, date: string) => state({ subscriptions: [sub('s1', 7_000, nextDate, { cardId: 'c-usage' })], balances: [bal('plain-acc', date, 100_000)] })
  // charged on the 11th: 11-11 → 11-25. A record of 11-24 has it to come, one of 11-25 has it out.
  assert.deepEqual(outs(st('2026-11-11', '2026-11-24'), 'plain-acc', '2026-11', 2), [7_000, 7_000])
  assert.deepEqual(outs(st('2026-11-11', '2026-11-25'), 'plain-acc', '2026-11', 2), [0, 7_000])
  // charged on the 12th: the bill of 11-25 is the charge of 10-12 (period 10-12 … 11-11), that of 12-25 the charge of 11-12
  assert.deepEqual(outs(st('2026-11-12', '2026-11-24'), 'plain-acc', '2026-11', 2), [7_000, 7_000])
  // a first charge on 12-12 (nothing before 11-12 is charged): the charge of 11-12 → 12-25, none on 11-25
  assert.deepEqual(outs(st('2026-12-12', '2026-11-24'), 'plain-acc', '2026-11', 3), [0, 7_000, 7_000])
  // the billing rule: 2026-11-14 is a Saturday. 'after' pays on Monday the 16th, 'before' on Friday the 13th.
  const moved = (billingShift: DayShift, date: string) =>
    outs(state({ settings: { ...S, billingShift }, subscriptions: [sub('s1', 7_000, '2026-11-05', { cardId: 'c-plain' })], balances: [bal('plain-acc', date, 100_000)] }), 'plain-acc', '2026-11', 1)[0]
  assert.equal(moved('none', '2026-11-14'), 0)
  assert.equal(moved('after', '2026-11-14'), 7_000)
  assert.equal(moved('after', '2026-11-16'), 0)
  assert.equal(moved('before', '2026-11-12'), 7_000)
  assert.equal(moved('before', '2026-11-13'), 0)
})

test('a charge belongs to the month whose period holds its date, on the pay basis too', () => {
  // pay basis, pay day 25, named by the end: "2026-12" is 11-25 … 12-24
  const pay: Settings = { ...S, monthBasis: 'pay', monthNaming: 'auto' }
  const st = (over: Partial<Subscription>) => state({ settings: pay, subscriptions: [sub('s1', 20_000, '2026-11-28', over)], balances: [bal('plain-acc', '2026-11-24', 100_000)] })
  // from the account: 11-28 lies in "2026-12", 12-28 in "2027-01"; nothing in "2026-11" after the record of 11-24
  assert.deepEqual(rows(st({ accountId: 'plain-acc' }), 'plain-acc', '2026-11', 3), [[0, 0, 100_000], [0, 20_000, 80_000], [0, 20_000, 60_000]])
  // with a card (billing day 14): the charge of 10-28 was billed on 11-14, before the record; 11-28 → 12-14 in "2026-12",
  // 12-28 → 01-14 in "2027-01"
  assert.deepEqual(rows(st({ cardId: 'c-plain' }), 'plain-acc', '2026-11', 3), [[0, 0, 100_000], [0, 20_000, 80_000], [0, 20_000, 60_000]])
  // a charge on the period's first day (the pay day) is that month's: nextDate 11-25
  const first = state({ settings: pay, subscriptions: [sub('s1', 20_000, '2026-11-25', { accountId: 'plain-acc' })], balances: [bal('plain-acc', '2026-11-24', 100_000)] })
  assert.deepEqual(outs(first, 'plain-acc', '2026-11', 2), [0, 20_000])
})

// ── the MCP answers (S-10) ──
test('MCP: list_subscriptions names the card or the account, and list_accounts takes the charges out of the projection', () => {
  const subs = [
    sub('by-card', 100_000, '2026-11-05', { cardId: 'c-subs' }), sub('by-acc', 20_000, '2026-11-10', { accountId: 'plain-acc' }),
    sub('not-said', 1_000, '2026-11-10'), sub('nulls', 1_000, '2026-11-10', { cardId: null, accountId: null }), sub('loose', 1_000, '2026-11-10', { cardId: 'c-none' }),
  ]
  const d: Data = {
    ...state({ subscriptions: subs, balances: [bal('subs-acc', '2026-11-01', 0), bal('plain-acc', '2026-11-01', 50_000)] }),
    events: [], checks: [], debts: [], remainderSplit: [], holidaySets: [],
  }
  const now = parseDate('2026-11-02')
  const pay = Object.fromEntries(subscriptionList(d, now).subscriptions.map((x) => [x.id, [x.cardId, x.card, x.accountId, x.account, x.payPath]]))
  assert.deepEqual(pay, {
    'by-card': ['c-subs', 'Subs card', null, null, 'direct'],
    'by-acc': [null, null, 'plain-acc', 'plain-acc', 'direct'],
    'not-said': [null, null, null, null, 'direct'],
    nulls: [null, null, null, null, 'direct'],
    loose: ['c-none', 'No account', null, null, 'direct'],
  })
  // the transfer: 123,000 a month → 130,000 into subs-acc on 11-26; the card's bill of 11-14 (the charge of 10-05) leaves it
  const proj = (id: string) => accountList(d, now, 2).accounts.find((a) => a.id === id)!.projection!.map((r) => [r.inflowKrw, r.outflowKrw, r.endKrw])
  assert.deepEqual(proj('subs-acc'), [[130_000, 100_000, 30_000], [130_000, 100_000, 60_000]])
  // the account the 20,000 is paid from: out on 11-10 and 12-10
  assert.deepEqual(proj('plain-acc'), [[0, 20_000, 30_000], [0, 20_000, 10_000]])
})
