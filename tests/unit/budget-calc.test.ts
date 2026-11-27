// spec 013 V-6: the budget core calculations (W-2), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bufferGauge, distributionAt, goalAlerts, goalMonth, groupAt, groupValue, itemSent, livingAt, monthMoney, nextTransferYm, planRounds, projectAccount, spendingIn, spreadOver, yearContribution,
  type AccountState,
} from '../../src/lib/calc'
import type { Account, AllocationTarget, Card, LivingItem, Phase, Priced, Settings, Spending } from '../../src/data/types'
import { accountMonthIn } from '../../src/lib/accounts'

const S: Priced = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, payShift: 'none', transferShift: 'none', billingShift: 'none', currencies: [] }
const none: ReadonlySet<string> = new Set()
const P1: Phase = { id: 'p1', label: '', name: 'one', from: '2026-01', to: '2026-12', amounts: { tf: 200_000, ts: 1_000_000, ti: 1_000_000 } }
const P2: Phase = { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { tf: 300_000, ts: 600_000, ti: 1_200_000 } }
const T: AllocationTarget[] = [
  { id: 'tl', name: 'Living', kind: 'living' },
  { id: 'tf', name: 'Fixed', kind: 'fixed', accountId: 'emergency' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
const item = (id: string, amount: number, over: Partial<LivingItem> = {}): LivingItem =>
  ({ id, name: id, kind: '', payMethod: '', amount, from: null, code: null, amounts: {}, ...over })
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: [P1, P2], targets: T, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
  spendings: [], accounts: [], balances: [], cards: [], ...over,
})

test('the three moved living items give the old living sum: every month and every row as before (S-11)', () => {
  const old = { food: 300_000, transit: 60_000, allowance: 200_000 }
  const items = [item('f', 300_000, { code: 'food' }), item('t', 60_000, { code: 'transit' }), item('a', 200_000, { code: 'allowance' })]
  for (const ym of ['2026-06', '2026-12', '2027-01', '2030-01']) {
    const a = distributionAt(ym, S.netPay, [P1, P2], T, old, [], [], S)
    const b = distributionAt(ym, S.netPay, [P1, P2], T, items, [], [], S)
    assert.deepEqual(b, a)
  }
  const st = state({ livingItems: items, living: old })
  assert.deepEqual(monthMoney(st, '2026-06'), monthMoney({ ...st, livingItems: undefined }, '2026-06'))
})

test('living items: from month and phase amounts (S-2, S-4)', () => {
  const items = [item('a', 100_000), item('b', 50_000, { from: '2026-08' }), item('c', 30_000, { amounts: { p2: 80_000 } })]
  assert.equal(livingAt(items, [P1, P2], '2026-07').sum, 130_000)
  assert.equal(livingAt(items, [P1, P2], '2026-08').sum, 180_000)
  assert.equal(livingAt(items, [P1, P2], '2027-01').sum, 230_000)
})

test('ratio split: total × ratio rounded to 1,000; a ratio sum under 100% leaves the rest (S-3, V-6)', () => {
  const targets: AllocationTarget[] = [...T, { id: 'ti', name: 'Invest', kind: 'invest' }]
  const accounts = ['x', 'y', 'z'].map((id) => acc(id, { group: 'invest', ratio: 0.3333 }))
  const g = groupAt('invest', accounts, [P1, P2], targets, S, '2026-06')
  assert.equal(g.mode, 'ratio')
  assert.deepEqual(g.rows.map((r) => r.amount), [333_000, 333_000, 333_000])
  assert.equal(g.sum, 999_000)
  assert.equal(g.total, 1_000_000)
  const d = distributionAt('2026-06', S.netPay, [P1, P2], targets, [], [], [], S, 0, 0, accounts)
  assert.equal(d.rows.find((r) => r.key === 'ti')!.amount, 999_000)
  // 3,000,000 − fixed 200,000 − invest 999,000
  assert.equal(d.remainder, 1_801_000)
  // the next phase's total
  assert.equal(groupAt('invest', accounts, [P1, P2], targets, S, '2027-01').sum, 1_200_000)
})

test('amount split: monthly amounts with phase amounts, from and stop months (S-3, S-4, S-7)', () => {
  const targets: AllocationTarget[] = [...T, { id: 'ts', name: 'Savings', kind: 'saving' }]
  const accounts = [
    acc('cma', { group: 'saving', amount: 300_000, amounts: { p2: 100_000 } }),
    acc('isa', { group: 'saving', amount: 200_000, from: '2026-09', stopFrom: '2027-03' }),
  ]
  const at = (ym: string) => groupAt('saving', accounts, [P1, P2], targets, S, ym).sum
  assert.equal(at('2026-08'), 300_000)
  assert.equal(at('2026-09'), 500_000)
  assert.equal(at('2027-01'), 300_000)
  assert.equal(at('2027-03'), 100_000)
  // the phase total is not used by an amount split
  assert.equal(groupAt('saving', accounts, [P1, P2], targets, S, '2026-09').total, 500_000)
})

test('a stopped account ends its fixed target from that month', () => {
  const accounts = [acc('emergency', { stopFrom: '2026-10' })]
  const at = (ym: string) => distributionAt(ym, S.netPay, [P1, P2], T, [], [], [], S, 0, 0, accounts).rows.find((r) => r.key === 'tf')?.amount ?? 0
  assert.equal(at('2026-09'), 200_000)
  assert.equal(at('2026-10'), 0)
})

const CARD: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'living-acc', billingDay: 12 }

test('a card spending with a card is billed on the card billing day; without one on the settings day (S-13)', () => {
  const withCard = planRounds({ bought: '2026-11-18', how: 'installment', payBy: 'card', count: 2, principal: 100_000, billingDay: 12 }, S, none)
  assert.deepEqual(withCard.map((r) => r.date), ['2026-12-12', '2027-01-12'])
  const without = planRounds({ bought: '2026-11-18', how: 'installment', payBy: 'card', count: 2, principal: 100_000 }, S, none)
  assert.deepEqual(without.map((r) => r.date), ['2026-12-16', '2027-01-16'])
})

test('buffer use: refills on pay days, ⌊1,000,000 ÷ 3 ÷ 10⌋ × 10 and the rest last; they come off the remainder (S-8, V-6)', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'buffer', payBy: 'card', count: 3, principal: 1_000_000, refillFrom: '2026-12-25' }, S, none)
  assert.deepEqual(r.map((x) => x.amount), [333_330, 333_330, 333_340])
  assert.deepEqual(r.map((x) => x.date), ['2026-12-25', '2027-01-25', '2027-02-25'])
  const sp: Spending = {
    id: 's1', name: 'Mini PC', category: 'home', bought: '2026-11-18', amount: 1_000_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-12-25', rounds: r,
  }
  const dec = spendingIn([sp], '2026-12')
  assert.equal(dec.remainder, 333_330)
  assert.equal(dec.installment, 333_330)
  // the card bill itself (2026-12-12) is not taken off the remainder: only the refill is
  assert.equal(spendingIn([sp], '2026-11').remainder, 0)
})

test('projection: from the last record, transfers in on the transfer day, the buffer bill out and refills in (S-6, S-8)', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'buffer', payBy: 'card', count: 2, principal: 400_000, refillFrom: '2026-12-25' }, S, none)
  const sp: Spending = {
    id: 's1', name: 'PC', category: 'home', bought: '2026-11-18', amount: 400_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'buffer', payBy: 'card', count: 2, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-12-25', rounds: r,
  }
  const living = acc('living-acc', { buffer: 1_000_000 })
  const targets: AllocationTarget[] = [{ id: 'tl', name: 'Living', kind: 'living', accountId: 'living-acc' }, { id: 'tr', name: 'Rest', kind: 'remainder' }]
  const st = state({
    targets, livingItems: [item('food', 500_000)], accounts: [living], cards: [CARD], spendings: [sp],
    balances: [{ id: 'b1', accountId: 'living-acc', date: '2026-11-20', amount: 1_200_000 }],
  })
  const rows = projectAccount(living, st, none, '2026-11', 4)!
  // Nov: transfer 26th +500,000. Dec: bill 12th −400,000, transfer +500,000, refill 25th +200,000.
  assert.deepEqual(rows.map((x) => [x.ym, x.inflow, x.outflow, x.end]), [
    ['2026-11', 500_000, 0, 1_700_000],
    ['2026-12', 700_000, 400_000, 2_000_000],
    ['2027-01', 700_000, 0, 2_700_000],
    ['2027-02', 500_000, 0, 3_200_000],
  ])
  assert.equal(projectAccount(acc('other'), st, none, '2026-11'), null)
  // the gauge: before any refill, the whole bill is used; after the first, half
  assert.deepEqual(bufferGauge(living, st, '2026-12-01'), { buffer: 1_000_000, used: 400_000, left: 600_000 })
  assert.deepEqual(bufferGauge(living, st, '2026-12-25'), { buffer: 1_000_000, used: 200_000, left: 800_000 })
})

test('goal month, the goal card and the annual contribution (S-7)', () => {
  const targets: AllocationTarget[] = [...T, { id: 'ts', name: 'Savings', kind: 'saving' }]
  const cma = acc('cma', { group: 'saving', amount: 500_000, goal: 11_000_000 })
  const st = state({ targets, accounts: [cma], balances: [{ id: 'b1', accountId: 'cma', date: '2026-11-01', amount: 10_000_000 }] })
  // Nov 26 +500,000 → 10.5M, Dec 26 → 11.0M
  assert.equal(goalMonth(cma, st, none), '2026-12')
  assert.deepEqual(goalAlerts(st, '2026-11-30', none), [])
  const alerts = goalAlerts(st, '2026-12-27', none)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]!.month, '2026-12')
  assert.equal(alerts[0]!.stopFrom, '2027-01') // the December transfer has happened
  assert.equal(nextTransferYm('2026-12-20', S, none), '2026-12')
  // keep sending past this goal: no card; a stopped account: no card
  assert.deepEqual(goalAlerts(state({ ...st, accounts: [{ ...cma, goalAck: 11_000_000 }] }), '2026-12-27', none), [])
  assert.deepEqual(goalAlerts(state({ ...st, accounts: [{ ...cma, stopFrom: '2027-01' }] }), '2026-12-27', none), [])
  // a record already above the goal: its own month
  assert.equal(goalMonth({ ...cma, goal: 5_000_000 }, st, none), '2026-11')
  // a balance alone is not paid in: 2026 counts every planned transfer of the year (12 × 500,000)
  assert.equal(yearContribution(cma, st, none, 2026), 12 * 500_000)
  // a record naming money put in at once adds it to its year (review 1 F-12)
  const two = state({ ...st, balances: [...st.balances, { id: 'b2', accountId: 'cma', date: '2027-02-01', amount: 13_000_000, deposit: 1_500_000 }] })
  assert.equal(yearContribution(cma, two, none, 2027), 1_500_000 + 12 * 500_000)
})

test('review 1 F-4: without the menu target nothing is sent to its items, so the forecast adds nothing', () => {
  const cma = acc('cma', { group: 'saving', amount: 500_000, goal: 11_000_000 })
  const st = state({ accounts: [cma], balances: [{ id: 'b1', accountId: 'cma', date: '2026-11-01', amount: 10_000_000 }] })
  const rows = projectAccount(cma, st, none, '2026-11', 2)!
  assert.deepEqual(rows.map((r) => r.end), [10_000_000, 10_000_000])
  assert.deepEqual(goalAlerts(st, '2027-06-01', none), [])
})

test('review 1 F-9: a savings total linked to an account is not counted there; a remainder account pays its card bill once, on the bill\'s date', () => {
  const targets: AllocationTarget[] = [
    { id: 'ts', name: 'Savings', kind: 'saving', accountId: 'pay' },
    { id: 'tr', name: 'Rest', kind: 'remainder', accountId: 'pay' },
  ]
  const pay = acc('pay')
  const item = acc('cma', { group: 'saving', amount: 400_000 })
  const card: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'pay', billingDay: 16 }
  const sp: Spending = {
    id: 's1', name: 'TV', category: 'home', bought: '2026-11-02', amount: 100_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: null,
    rounds: [{ no: 1, date: '2026-12-16', amount: 100_000, state: 'left', edited: false }],
  }
  const st = state({ targets, accounts: [pay, item], cards: [card], spendings: [sp], balances: [{ id: 'b', accountId: 'pay', date: '2026-11-30', amount: 0 }] })
  // the card bill of 12-16 is paid with the pay of 11-25, so it comes off November's remainder (spec 018 S-5):
  // 3,000,000 − 400,000 (savings) − 100,000 (card bill) = 2,500,000
  assert.equal(monthMoney(st, '2026-11').dist.remainder, 2_500_000)
  // December: the remainder 3,000,000 − 400,000 (savings) = 2,600,000 comes in on 12-26, and the bill leaves on
  // 12-16 — the record of 11-30 is a real balance and still holds that money (review 3 F-1; spec 018 A-31, A-7 ①).
  // The money for the bill came in beside November's remainder on 11-26, before the record.
  const dec = projectAccount(pay, st, none, '2026-12', 1)![0]!
  assert.deepEqual([dec.inflow, dec.outflow, dec.end], [2_600_000, 100_000, 2_500_000])
  // a record before November's transfer sees both: 2,500,000 + 100,000 in on 11-26, 100,000 out on 12-16
  const early = state({ ...st, balances: [{ id: 'b', accountId: 'pay', date: '2026-11-20', amount: 0 }] })
  assert.deepEqual(projectAccount(pay, early, none, '2026-11', 2)!.map((r) => [r.inflow, r.outflow, r.end]), [[2_600_000, 0, 2_600_000], [2_600_000, 100_000, 5_100_000]])
})

// Review 3 F-1 (the reviewer's probe): the account that takes the left over pays a card. One bill of 100,000 dated
// 12-14 (pay day 25, transfer day 26, the calendar basis; nothing else is allocated, so the account gets 3,000,000 a
// month in all). A balance record is a real balance: it holds every transfer and bill dated on or before it. Whatever
// the record's date, the end of January is the transfers after the record minus the bill if it comes after the record.
test('review 3 F-1: a remainder account that pays a card ends where the real balance does, for every date of the record', () => {
  const targets: AllocationTarget[] = [{ id: 'tr', name: 'Rest', kind: 'remainder', accountId: 'rest' }]
  const rest = acc('rest')
  const card: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'rest', billingDay: 14 }
  const sp: Spending = {
    id: 's1', name: 'TV', category: 'home', bought: '2026-11-02', amount: 100_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: null,
    rounds: [{ no: 1, date: '2026-12-14', amount: 100_000, state: 'left', edited: false }],
  }
  const at = (rec: string) => state({ targets, accounts: [rest], cards: [card], spendings: [sp], balances: [{ id: 'b', accountId: 'rest', date: rec, amount: 0 }] })
  const truth = (rec: string) => ['2026-11-26', '2026-12-26', '2027-01-26'].filter((d) => d > rec).length * 3_000_000 - ('2026-12-14' > rec ? 100_000 : 0)
  for (const rec of ['2026-11-10', '2026-11-25', '2026-11-26', '2026-11-30', '2026-12-05', '2026-12-13', '2026-12-14', '2026-12-20', '2026-12-25', '2026-12-26', '2026-12-30']) {
    assert.equal(projectAccount(rest, at(rec), none, '2026-11', 3)![2]!.end, truth(rec), `record ${rec}`)
  }
  // the left over itself, the allocation rows and the paying-account block are what they were: only the projection moved
  const nov = monthMoney(at('2026-11-10'), '2026-11').dist
  assert.equal(nov.remainder, 2_900_000)
  assert.deepEqual(nov.payouts, [{ accountId: 'rest', subscriptions: 0, card: 100_000, refill: 0, total: 100_000 }])
  assert.deepEqual(monthMoney(at('2026-11-10'), '2026-12').dist.payouts, [])
  // and the accounts table's "this month" is the same money as the projection's inflow: 2,900,000 + 100,000
  assert.equal(accountMonthIn(rest, at('2026-11-10'), '2026-11'), 3_000_000)
  assert.equal(projectAccount(rest, at('2026-11-10'), none, '2026-11', 1)![0]!.inflow, 3_000_000)
})

// Review 3 F-4: the money that comes into a paying account for its cards' bills (spec 018 S-6) passes through — it is
// no money put in, so the yearly limit does not count it. The reviewer's case: a bill of 100,000 on the 14th of every
// month of 2027, paid from an account with a yearly limit; nothing is allocated to the account.
test('review 3 F-4: the yearly contribution does not count the card money that passes through a paying account', () => {
  const payer = acc('payer', { annualLimit: 1_000_000, goal: 1_050_000 })
  const card: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'payer', billingDay: 14 }
  const bills: Spending = {
    id: 's1', name: 'Year', category: 'home', bought: '2026-12-02', amount: 1_200_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'installment', payBy: 'card', count: 12, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: null,
    rounds: Array.from({ length: 12 }, (_, i) => ({ no: i + 1, date: `2027-${String(i + 1).padStart(2, '0')}-14`, amount: 100_000, state: 'left' as const, edited: false })),
  }
  const st = state({ accounts: [payer], cards: [card], spendings: [bills], balances: [{ id: 'b', accountId: 'payer', date: '2026-11-30', amount: 1_000_000 }] })
  // the projection still moves the money: each bill's 100,000 comes in on the 26th of the month before and leaves on the 14th
  const rows = projectAccount(payer, st, none, '2026-12', 3)!
  assert.deepEqual(rows.map((r) => [r.inflow, r.outflow, r.end]), [[100_000, 0, 1_100_000], [100_000, 100_000, 1_100_000], [100_000, 100_000, 1_100_000]])
  // but nothing was put into the account in 2027 (it was 1,100,000: eleven transfers of card money dated in the year)
  assert.equal(yearContribution(payer, st, none, 2027), 0)
  assert.equal(yearContribution(payer, st, none, 2026), 0)
  assert.equal(yearContribution(payer, { ...st, spendings: [] }, none, 2027), 0)
  // the same by dates, on a pay basis
  const onPay = { ...st, settings: { ...st.settings, monthBasis: 'pay' as const } }
  assert.equal(yearContribution(payer, onPay, none, 2027), 0)
  // what is put in still counts next to it: a deposit named by a balance record, and a transfer of a target linked to the account
  const withDeposit = { ...st, balances: [...st.balances, { id: 'b2', accountId: 'payer', date: '2027-03-02', amount: 1_300_000, deposit: 200_000 }] }
  assert.equal(yearContribution(payer, withDeposit, none, 2027), 200_000)
  const linked = state({ ...st, targets: [{ id: 'tf', name: 'Fixed', kind: 'fixed', accountId: 'payer' }], phases: [{ id: 'p', label: '', name: 'P', from: '2026-01', to: null, amounts: { tf: 50_000 } }] })
  assert.equal(yearContribution(payer, linked, none, 2027), 12 * 50_000)
  // goals are untouched: the projection's balance is what it is (the card money is in the account at the month's end)
  assert.equal(goalMonth(payer, st, none), '2026-12')
})

test('review 2 F-2: a remainder account still counts its buffer use: the bill out and the refills back in', () => {
  const targets: AllocationTarget[] = [{ id: 'tr', name: 'Rest', kind: 'remainder', accountId: 'pay' }]
  const pay = acc('pay', { buffer: 1_000_000 })
  const card: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'pay', billingDay: 16 }
  const r = planRounds({ bought: '2026-11-18', how: 'buffer', payBy: 'card', count: 3, principal: 300_000, refillFrom: '2026-12-25' }, S, none)
  const sp: Spending = {
    id: 's1', name: 'PC', category: 'home', bought: '2026-11-18', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-12-25', rounds: r,
  }
  const st = state({ targets, accounts: [pay], cards: [card], spendings: [sp], balances: [{ id: 'b', accountId: 'pay', date: '2026-11-30', amount: 0 }] })
  // December: remainder 3,000,000 − refill 100,000 = 2,900,000 in, the refill 100,000 back in, the bill 300,000 out
  const dec = projectAccount(pay, st, none, '2026-12', 1)![0]!
  assert.deepEqual([dec.inflow, dec.outflow, dec.end], [3_000_000, 300_000, 2_700_000])
  // the 이번 달 column counts the same money in (review 3 F-2)
  assert.equal(accountMonthIn(pay, st, '2026-12'), 3_000_000)
})

test('rc.2 S-14: a month adjustment replaces a target amount for that month only', () => {
  const targets: AllocationTarget[] = [...T, { id: 'ti', name: 'Invest', kind: 'invest' }, { id: 'ts', name: 'Savings', kind: 'saving' }]
  const accounts = [acc('x', { group: 'invest', ratio: 0.5 }), acc('y', { group: 'invest', ratio: 0.5 }), acc('cma', { group: 'saving', amount: 300_000 })]
  const adj = [
    { id: 'a1', ym: '2026-06', targetId: 'tf', amount: 50_000 },
    { id: 'a2', ym: '2026-06', targetId: 'ti', amount: 400_000 },
    { id: 'a3', ym: '2026-06', targetId: 'ts', amount: 100_000 },
  ]
  const at = (ym: string) => distributionAt(ym, S.netPay, [P1, P2], targets, [], [], [], S, 0, 0, accounts, adj)
  const row = (ym: string, k: string) => at(ym).rows.find((r) => r.key === k)?.amount ?? 0
  assert.equal(row('2026-06', 'tf'), 50_000)
  assert.equal(row('2026-07', 'tf'), 200_000)
  // a ratio split: the adjustment is the month's total, split over the items
  assert.equal(row('2026-06', 'ti'), 400_000)
  assert.deepEqual(groupAt('invest', accounts, [P1, P2], targets, S, '2026-06', adj).rows.map((r) => r.amount), [200_000, 200_000])
  assert.equal(row('2026-07', 'ti'), 1_000_000)
  // an amount split: the target gets the adjustment that month, spread over its items (review rc2-1 F-2)
  assert.equal(row('2026-06', 'ts'), 100_000)
  assert.deepEqual(groupAt('saving', accounts, [P1, P2], targets, S, '2026-06', adj).rows.map((r) => r.amount), [100_000])
  assert.equal(row('2026-07', 'ts'), 300_000)
  // monthMoney reads them from the state
  const st = state({ targets, accounts, monthAdjusts: adj })
  assert.equal(monthMoney(st, '2026-06').dist.rows.find((r) => r.key === 'tf')!.amount, 50_000)
})

test('review rc2-1 F-2: spreadOver shares a total by the amounts, rounded down, the last non-zero part takes the rest', () => {
  assert.deepEqual(spreadOver([300_000, 100_000], 100_000), [75_000, 25_000])
  assert.deepEqual(spreadOver([100_000, 100_000, 100_000], 100_000), [33_333, 33_333, 33_334])
  // a zero part stays 0 and does not take the rest, wherever it is
  assert.deepEqual(spreadOver([100_000, 200_000, 0], 100_001), [33_333, 66_668, 0])
  assert.deepEqual(spreadOver([0, 50_000], 7), [0, 7])
  // 0 spreads to all zeros; more than the sum spreads up
  assert.deepEqual(spreadOver([300_000, 100_000], 0), [0, 0])
  assert.deepEqual(spreadOver([300_000, 100_000], 800_000), [600_000, 200_000])
  // a sum of 0: nothing to spread over
  assert.deepEqual(spreadOver([0, 0], 100_000), [0, 0])
  assert.deepEqual(spreadOver([], 100_000), [])
  // large amounts stay exact
  assert.deepEqual(spreadOver([9_000_000_000_000, 1], 9_000_000_000_001), [9_000_000_000_000, 1])
})

test('review rc2-1 F-2: an amount-split adjustment is spread over the items, so itemSent, projections, limits and goals follow it', () => {
  const targets: AllocationTarget[] = [...T, { id: 'ts', name: 'Savings', kind: 'saving' }]
  const accounts = [
    acc('a', { group: 'saving', amount: 300_000, annualLimit: 3_600_000 }),
    acc('b', { group: 'saving', amount: 100_000 }),
    acc('late', { group: 'saving', amount: 500_000, from: '2026-07' }),
  ]
  const monthAdjusts = [{ id: 'm1', ym: '2026-06', targetId: 'ts', amount: 100_000 }]
  const st = state({ targets, accounts, monthAdjusts })
  const g = groupAt('saving', accounts, st.phases, targets, S, '2026-06', monthAdjusts)
  // 'late' does not send in June: the adjustment goes to a and b only
  assert.deepEqual(g.rows.map((r) => r.amount), [75_000, 25_000, 0])
  assert.equal(g.sum, 100_000)
  assert.equal(groupValue(g, monthAdjusts[0]), g.sum)
  assert.equal(monthMoney(st, '2026-06').dist.rows.find((r) => r.key === 'ts')!.amount, 100_000)
  assert.equal(itemSent(accounts[0]!, st, '2026-06'), 75_000)
  assert.equal(itemSent(accounts[0]!, st, '2026-07'), 300_000)
  // the projection and the yearly contribution read the spread amount in June
  const withRec = { ...st, balances: [{ id: 'b1', accountId: 'a', date: '2026-05-31', amount: 1_000_000 }] }
  assert.deepEqual(projectAccount(accounts[0]!, withRec, none, '2026-06', 2)!.map((m) => [m.inflow, m.end]), [[75_000, 1_075_000], [300_000, 1_375_000]])
  const full = state({ targets, accounts })
  assert.equal(yearContribution(accounts[0]!, full, none, 2026) - yearContribution(accounts[0]!, st, none, 2026), 225_000)
  // a sum of 0 (no item sends that month): no item gets it, the target does, as before
  const none0 = [{ id: 'm2', ym: '2026-06', targetId: 'ts', amount: 80_000 }]
  const st0 = state({ targets, accounts: [accounts[2]!], monthAdjusts: none0 })
  const g0 = groupAt('saving', st0.accounts, st0.phases, targets, S, '2026-06', none0)
  assert.deepEqual([g0.rows.map((r) => r.amount), g0.sum, groupValue(g0, none0[0])], [[0], 0, 80_000])
  assert.equal(monthMoney(st0, '2026-06').dist.rows.find((r) => r.key === 'ts')!.amount, 80_000)
  assert.equal(itemSent(accounts[2]!, st0, '2026-06'), 0)
})

test('review rc2-2 F-1: a maturity amount follows the share of an amount-split adjustment over all items', async () => {
  const { maturityAmount, maturityOf } = await import('../../src/lib/calc')
  const targets: AllocationTarget[] = [...T, { id: 'ts', name: 'Savings', kind: 'saving' }]
  const a = acc('a', { group: 'saving', amount: 300_000, term: '6개월', from: '2026-01' })
  const b = acc('b', { group: 'saving', amount: 100_000, from: '2026-01' })
  // 2026-03: the target gets 200,000 that month only → spread over A and B by 300,000 : 100,000
  const st = state({ targets, accounts: [a, b], monthAdjusts: [{ id: 'x', ym: '2026-03', targetId: 'ts', amount: 200_000 }] })
  const m = maturityOf(a)!
  // Jan, Feb, Apr, May, Jun at 300,000 and Mar at ⌊300,000 × 200,000 ÷ 400,000⌋ = 150,000
  assert.equal(maturityAmount(a, st, none, m).amount, 5 * 300_000 + 150_000)
})
