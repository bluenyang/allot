// The month's basis applied to the accounts (spec 018 S-3, S-4, W-4): the balance projection, the goal and maturity
// months, the next transfer month and the yearly contribution. Every expected number is worked out by hand in the
// comments. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Account, AllocationTarget, Balance, Card, Phase, Settings, Spending } from '../../src/data/types'
import { goalAlerts, goalMonth, maturityAlerts, maturityOf, nextTransferYm, projectAccount, yearContribution, type AccountState } from '../../src/lib/calc'
import { accountMonthIn } from '../../src/lib/accounts'
import { buildNotices } from '../../src/lib/notices'

// Pay day 25 (a month is named by its end: "2026-12" = 11-25 … 12-24), transfer day 26, no weekend rule.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const PAY: Settings = { ...S, monthBasis: 'pay' }
// The basis card's usage period starts on the 12th (named by its start: "2026-12" = 12-12 … 01-11); `pay` pays from the account.
const CARDS: Card[] = [
  { id: 'basis', name: 'Basis', last4: '', accountId: null, billingDay: 25, usageFrom: 12 },
  { id: 'pay', name: 'Pay', last4: '', accountId: 'emergency', billingDay: 14 },
]
const CARD: Settings = { ...S, monthBasis: 'card', monthBasisCardId: 'basis' }
const none: ReadonlySet<string> = new Set()

const T: AllocationTarget[] = [
  { id: 'tl', name: 'Living', kind: 'living' },
  { id: 'tf', name: 'Fixed', kind: 'fixed', accountId: 'emergency' },
  { id: 'ts', name: 'Saving', kind: 'saving' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
// the fixed target sends 200,000 in the months NAMED 2026-01 … 2026-12 and 300,000 from the month named 2027-01
const phases: Phase[] = [
  { id: 'p1', label: '', name: 'one', from: '2026-01', to: '2026-12', amounts: { tf: 200_000 } },
  { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { tf: 300_000 } },
]
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const emergency = acc('emergency')
const bal = (date: string, amount: number, over: Partial<Balance> = {}): Balance => ({ id: date, accountId: 'emergency', date, amount, ...over })
const spending = (id: string, date: string, amount: number): Spending => ({
  id, name: id, category: '', bought: '2026-11-01', amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null,
  cancelled: false, cardId: 'pay', rounds: [{ no: 1, date, amount, state: 'left', edited: false }],
})
const state = (settings: Settings, over: Partial<AccountState> = {}): AccountState => ({
  settings, phases, targets: T, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
  spendings: [], accounts: [emergency], balances: [bal('2026-11-25', 1_000_000)], cards: CARDS, ...over,
})
const ends = (st: AccountState, from: string, months: number, a: Account = emergency) => projectAccount(a, st, none, from, months)!.map((r) => r.end)

test('projectAccount: the transfers of a month are dated inside its period, and their amount is the one of the month\'s name', () => {
  // calendar: the record of 11-25 is in 2026-11; the transfers of 11-26 and 12-26 are 200,000 each (2026), 01-26 and 02-26 300,000
  assert.deepEqual(ends(state(S), '2026-12', 3), [1_400_000, 1_700_000, 2_000_000])
  // pay basis: the record is in "2026-12" (11-25 … 12-24). Its transfer is 11-26 (200,000, the phase of the name 2026-12);
  // the transfer of 12-26 belongs to "2027-01" and is 300,000 already; 01-26 to "2027-02"
  assert.deepEqual(projectAccount(emergency, state(PAY), none, '2026-12', 3), [
    { ym: '2026-12', inflow: 200_000, outflow: 0, end: 1_200_000 },
    { ym: '2027-01', inflow: 300_000, outflow: 0, end: 1_500_000 },
    { ym: '2027-02', inflow: 300_000, outflow: 0, end: 1_800_000 },
  ])
  // the month before the record's: asked for, it shows the record's amount with nothing moving
  assert.deepEqual(projectAccount(emergency, state(PAY), none, '2026-11', 2), [
    { ym: '2026-11', inflow: 0, outflow: 0, end: 1_000_000 },
    { ym: '2026-12', inflow: 200_000, outflow: 0, end: 1_200_000 },
  ])
  // card basis (12-12 … 01-11 is "2026-12"): the record of 11-25 is in "2026-11" (11-12 … 12-11), the 26th lies in the
  // period's first calendar month, so the dates and names are the calendar's
  assert.deepEqual(ends(state(CARD), '2026-12', 3), [1_400_000, 1_700_000, 2_000_000])
  // card basis with the transfer on the 5th: the transfer of the month named M is on the 5th of M+1.
  // "2026-11": 12-05 (200,000) → 1,200,000 before the months asked for; "2026-12": 01-05 (200,000); "2027-01": 02-05 (300,000)
  assert.deepEqual(ends(state({ ...CARD, transferDay: 5 }), '2026-12', 2), [1_400_000, 1_700_000])
})

test('projectAccount: a card bill leaves in the month whose period holds its date', () => {
  const spendings = [spending('a', '2026-12-14', 50_000), spending('b', '2026-12-25', 30_000)]
  // calendar: both bills are December's: 1,200,000 + 200,000 − 80,000; then +300,000 twice
  assert.deepEqual(ends(state(S, { spendings }), '2026-12', 3), [1_320_000, 1_620_000, 1_920_000])
  // pay basis: 12-14 is in "2026-12" (1,000,000 + 200,000 − 50,000), 12-25 opens "2027-01" (+300,000 − 30,000)
  assert.deepEqual(projectAccount(emergency, state(PAY, { spendings }), none, '2026-12', 3), [
    { ym: '2026-12', inflow: 200_000, outflow: 50_000, end: 1_150_000 },
    { ym: '2027-01', inflow: 300_000, outflow: 30_000, end: 1_420_000 },
    { ym: '2027-02', inflow: 300_000, outflow: 0, end: 1_720_000 },
  ])
  // a bill dated on or before the record is in the record already, on every basis
  const early = [spending('c', '2026-11-25', 70_000)]
  assert.deepEqual(ends(state(PAY, { spendings: early }), '2026-12', 1), [1_200_000])
  assert.deepEqual(ends(state(S, { spendings: early }), '2026-12', 1), [1_400_000])
})

test('projectAccount: a buffer use leaves on its bill date and comes back on its refill dates, each in its own month', () => {
  // bought 11-20 with the paying card (billed the 14th of the month after: 12-14), 60,000; refilled 12-25 and 01-25
  const buffer: Spending = {
    ...spending('buf', '2026-12-25', 60_000), bought: '2026-11-20', how: 'buffer', count: 2,
    rounds: [{ no: 1, date: '2026-12-25', amount: 30_000, state: 'left', edited: false }, { no: 2, date: '2027-01-25', amount: 30_000, state: 'left', edited: false }],
  }
  // pay basis: "2026-12" −60,000 (12-14) +200,000; "2027-01" +30,000 (12-25) +300,000; "2027-02" +30,000 (01-25) +300,000
  assert.deepEqual(projectAccount(emergency, state(PAY, { spendings: [buffer] }), none, '2026-12', 3), [
    { ym: '2026-12', inflow: 200_000, outflow: 60_000, end: 1_140_000 },
    { ym: '2027-01', inflow: 330_000, outflow: 0, end: 1_470_000 },
    { ym: '2027-02', inflow: 330_000, outflow: 0, end: 1_800_000 },
  ])
  // calendar: 2026-11 +200,000; 2026-12 −60,000 +30,000 +200,000; 2027-01 +30,000 +300,000
  assert.deepEqual(ends(state(S, { spendings: [buffer] }), '2026-12', 2), [1_370_000, 1_700_000])
  // the accounts table's "this month" column counts the same refills in the same months
  const st = state(PAY, { spendings: [buffer] })
  assert.equal(accountMonthIn(emergency, st, '2026-12'), 200_000)
  assert.equal(accountMonthIn(emergency, st, '2027-01'), 330_000)
  assert.equal(accountMonthIn(emergency, state(S, { spendings: [buffer] }), '2026-12'), 230_000)
})

test('goalMonth: the first month, by its name, whose projected balance reaches the goal', () => {
  const goal = { ...emergency, goal: 1_400_000 }
  // calendar: 2026-11 1,200,000, 2026-12 1,400,000
  assert.equal(goalMonth(goal, state(S, { accounts: [goal] }), none), '2026-12')
  // pay basis: "2026-12" 1,200,000, "2027-01" 1,500,000
  assert.equal(goalMonth(goal, state(PAY, { accounts: [goal] }), none), '2027-01')
  // already there: the month of the record — 11-25 is in "2026-12" by the pay basis, in 2026-11 on the calendar
  const reached = { ...emergency, goal: 900_000 }
  assert.equal(goalMonth(reached, state(PAY, { accounts: [reached] }), none), '2026-12')
  assert.equal(goalMonth(reached, state(S, { accounts: [reached] }), none), '2026-11')
})

test('nextTransferYm: the month of the basis that holds today, or the next one when its transfer date has passed', () => {
  // calendar, as before
  assert.equal(nextTransferYm('2026-11-24', S, none), '2026-11')
  assert.equal(nextTransferYm('2026-11-26', S, none), '2026-12')
  // pay basis: 11-24 is the last day of "2026-11" (transfer 10-26, passed) → "2026-12", whose transfer is 11-26
  assert.equal(nextTransferYm('2026-11-24', PAY, none), '2026-12')
  // 11-25 opens "2026-12": its transfer (11-26) is still to come
  assert.equal(nextTransferYm('2026-11-25', PAY, none), '2026-12')
  // on the transfer date itself it has passed: the month named 2027-01 (transfer 12-26)
  assert.equal(nextTransferYm('2026-11-26', PAY, none), '2027-01')
  // card basis: 12-05 is in "2026-11" (11-12 … 12-11), whose transfer was 11-26 → "2026-12" (12-26)
  assert.equal(nextTransferYm('2026-12-05', CARD, none, CARDS), '2026-12')
  assert.equal(nextTransferYm('2026-12-20', CARD, none, CARDS), '2026-12')
  assert.equal(nextTransferYm('2026-12-26', CARD, none, CARDS), '2027-01')
  // without the cards a card basis is the calendar month
  assert.equal(nextTransferYm('2026-12-05', CARD, none), '2026-12')
  assert.equal(nextTransferYm('2026-12-05', CARD, none, []), nextTransferYm('2026-12-05', S, none))
  // a transfer date that comes before its own period: pay day 25 moved to Monday 09-27 (2027-09-25 is a Saturday),
  // transfer day 26 not moved. "2027-10" starts 09-27 and its transfer is 09-26. On 09-26 ("2027-09", transfer 08-26)
  // the next month's transfer is today, so the first one still to come is "2027-11" (10-26)
  const after: Settings = { ...PAY, payShift: 'after' }
  assert.equal(nextTransferYm('2027-09-25', after, none), '2027-10')
  assert.equal(nextTransferYm('2027-09-26', after, none), '2027-11')
  assert.equal(nextTransferYm('2027-09-27', after, none), '2027-11')
})

test('goalAlerts and maturityAlerts: this month is the month of the basis that holds today', () => {
  const goal = { ...emergency, goal: 1_400_000 }
  // calendar: reached in 2026-12; on 12-24 the stop starts this month (transfer 12-26 still to come)
  assert.deepEqual(goalAlerts(state(S, { accounts: [goal] }), '2026-12-24', none).map((a) => [a.month, a.stopFrom]), [['2026-12', '2026-12']])
  // pay basis: reached in "2027-01" (12-25 … 01-24). On 12-24 (still "2026-12") there is no card yet
  assert.deepEqual(goalAlerts(state(PAY, { accounts: [goal] }), '2026-12-24', none), [])
  // on 12-25 "2027-01" has begun: its transfer (12-26) is still to come, so the stop starts with it
  assert.deepEqual(goalAlerts(state(PAY, { accounts: [goal] }), '2026-12-25', none).map((a) => [a.month, a.stopFrom]), [['2027-01', '2027-01']])
  assert.deepEqual(goalAlerts(state(PAY, { accounts: [goal] }), '2026-12-26', none).map((a) => [a.month, a.stopFrom]), [['2027-01', '2027-02']])

  // a Savings item from the month named 2026-01 for 12 months matures in the month NAMED 2027-01
  const item = acc('sv', { group: 'saving', amount: 100_000, from: '2026-01', term: '12 months' })
  assert.equal(maturityOf(item)!.ym, '2027-01')
  const due = (s: Settings, today: string) => maturityAlerts(state(s, { accounts: [item] }), today, none).map((a) => [a.month, a.stopFrom])
  assert.deepEqual(due(S, '2026-12-31'), [])
  assert.deepEqual(due(S, '2027-01-01'), [['2027-01', '2027-01']])
  // pay basis: the month named 2027-01 begins on 12-25
  assert.deepEqual(due(PAY, '2026-12-24'), [])
  assert.deepEqual(due(PAY, '2026-12-25'), [['2027-01', '2027-01']])
})

test('yearContribution: the year is the calendar year of each movement\'s date, on every basis', () => {
  const limit = { ...emergency, annualLimit: 20_000_000 }
  const st = (s: Settings, over: Partial<AccountState> = {}) => state(s, { accounts: [limit], balances: [], ...over })
  // calendar: the twelve transfers of 2026, 200,000 each
  assert.equal(yearContribution(limit, st(S), none, 2026), 2_400_000)
  assert.equal(yearContribution(limit, st(S), none, 2025), 0)
  assert.equal(yearContribution(limit, st(S), none, 2027), 3_600_000)
  // pay basis: the transfer of the month named M is on the 26th of the month before. Dated in 2026: the months named
  // 2026-02 … 2026-12 (11 × 200,000) and 2027-01 (12-26, 300,000) = 2,500,000
  assert.equal(yearContribution(limit, st(PAY), none, 2026), 2_500_000)
  // the transfer of the month named 2026-01 is dated 2025-12-26: it is 2025's
  assert.equal(yearContribution(limit, st(PAY), none, 2025), 200_000)
  // 2027: the months named 2027-02 … 2028-01, 300,000 each
  assert.equal(yearContribution(limit, st(PAY), none, 2027), 3_600_000)
  // card basis: the 26th lies in the month of the name → the calendar's dates
  assert.equal(yearContribution(limit, st(CARD), none, 2026), 2_400_000)
  // card basis, transfer on the 5th: the month named M is paid on the 5th of M+1. Dated in 2026: the months named
  // 2025-12 (no phase: 0) and 2026-01 … 2026-11 (11 × 200,000); the month named 2026-12 is paid on 2027-01-05
  const early: Settings = { ...CARD, transferDay: 5 }
  assert.equal(yearContribution(limit, st(early), none, 2026), 2_200_000)
  assert.equal(yearContribution(limit, st(early), none, 2027), 200_000 + 11 * 300_000)
  // money put in at once counts by the date of its balance record, as before
  const deposits = [bal('2026-03-10', 0, { deposit: 500_000 }), bal('2025-12-30', 0, { deposit: 70_000 })]
  assert.equal(yearContribution(limit, st(PAY, { balances: deposits }), none, 2026), 3_000_000)
  assert.equal(yearContribution(limit, st(S, { balances: deposits }), none, 2026), 2_900_000)
  assert.equal(yearContribution(limit, st(PAY, { balances: deposits }), none, 2025), 270_000)
})

test('yearContribution, calendar basis: the twelve months named in the year, also when a rule moves a transfer across the new year', () => {
  // transfer day 1 with the rule "before": the transfer of 2027-01 is paid on Thursday 2026-12-31 (01-01 is a holiday)
  const moved: Settings = { ...S, transferDay: 1, transferShift: 'before' }
  const limit = { ...emergency, annualLimit: 20_000_000 }
  const st = state(moved, { accounts: [limit], balances: [] })
  const off: ReadonlySet<string> = new Set(['2026-01-01', '2027-01-01'])
  // as before 0.1.10: by the month's name — twelve times 200,000 in 2026, the one of 2027-01 (300,000) with 2027
  assert.equal(yearContribution(limit, st, off, 2026), 2_400_000)
  assert.equal(yearContribution(limit, st, off, 2027), 3_600_000)
  // the same with the month keys left out, and with a card basis that has no usable card
  const { monthBasis: _b, monthBasisCardId: _i, monthNaming: _n, ...old } = moved
  assert.equal(yearContribution(limit, { ...st, settings: old as Settings }, off, 2026), 2_400_000)
  assert.equal(yearContribution(limit, { ...st, settings: { ...moved, monthBasis: 'card', monthBasisCardId: 'gone' } }, off, 2026), 2_400_000)
})

test('the calendar basis gives what the same call gave without the month keys', () => {
  const spendings = [spending('a', '2026-12-14', 50_000), spending('b', '2026-12-25', 30_000)]
  const goal = { ...emergency, goal: 1_400_000, annualLimit: 1 }
  const off: ReadonlySet<string> = new Set(['2026-12-25', '2027-01-01'])
  for (const shifts of [{}, { payShift: 'before', transferShift: 'after', billingShift: 'before' }] as Partial<Settings>[]) {
    const withKeys: Settings = { ...S, ...shifts, monthBasis: 'calendar', monthBasisCardId: 'basis', monthNaming: 'end' }
    const { monthBasis: _b, monthBasisCardId: _i, monthNaming: _n, ...old } = withKeys
    const a = state(withKeys, { spendings, accounts: [goal] })
    const b = { ...a, settings: old as Settings, cards: CARDS.filter((c) => c.id === 'pay') }
    assert.deepEqual(projectAccount(goal, a, off, '2026-10', 18), projectAccount(goal, b, off, '2026-10', 18))
    assert.equal(goalMonth(goal, a, off), goalMonth(goal, b, off))
    for (const year of [2025, 2026, 2027]) assert.equal(yearContribution(goal, a, off, year), yearContribution(goal, b, off, year))
    for (const today of ['2026-11-24', '2026-11-26', '2026-12-31', '2027-01-01']) {
      assert.deepEqual(goalAlerts(a, today, off), goalAlerts(b, today, off), today)
      assert.equal(nextTransferYm(today, withKeys, off, CARDS), nextTransferYm(today, old as Settings, off), today)
    }
  }
})

test('buildNotices: this month\'s left over is the one of the month of the basis that holds today; the yearly limit stays the calendar year\'s', () => {
  // the fixed target takes 3,500,000 from the month NAMED 2027-01: that month is 500,000 short (pay 3,000,000)
  const short: Phase[] = [phases[0]!, { ...phases[1]!, amounts: { tf: 3_500_000 } }]
  const limit = { ...emergency, annualLimit: 2_500_000 }
  const st = (s: Settings) => state(s, { phases: short, accounts: [limit], balances: [] })
  const pending = { proposals: 0, goalAccounts: [] }
  const kinds = (s: Settings, today: string) => buildNotices(st(s), today, none, pending).map((n) => (n.kind === 'remainderShort' ? `${n.kind} ${n.month} ${n.remainder}` : n.kind === 'yearLimit' ? `${n.kind} ${n.year} ${n.contribution}` : n.kind))
  // calendar: 12-25 is in 2026-12 (left over 2,800,000); the year 2026 holds 2,400,000 (96% of the limit)
  assert.deepEqual(kinds(S, '2026-12-25'), ['yearLimit 2026 2400000'])
  // 2027-01 is short, and the year 2027 holds twelve times 3,500,000
  assert.deepEqual(kinds(S, '2027-01-01'), ['remainderShort 2027-01 -500000', 'yearLimit 2027 42000000'])
  // pay basis: 12-24 is the last day of "2026-12"; 12-25 opens "2027-01", which is short. The year is still 2026, and
  // by date it holds 2,200,000 + the transfer of 12-26 (the month named 2027-01: 3,500,000) = 5,700,000
  assert.deepEqual(kinds(PAY, '2026-12-24'), ['yearLimit 2026 5700000'])
  assert.deepEqual(kinds(PAY, '2026-12-25'), ['remainderShort 2027-01 -500000', 'yearLimit 2026 5700000'])
})
