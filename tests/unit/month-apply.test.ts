// The month's basis applied to the sums (spec 018 S-3, S-4, W-4): what has a date counts in the month whose period
// holds it, what is saved by month name keeps its name. Every expected number is worked out by hand in the comments.
// No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { AllocationTarget, Card, IncomeExtra, IncomeItem, IncomeReceipt, LivingItem, Phase, PlanChange, Settings, Spending, Subscription } from '../../src/data/types'
import { changesIn, ctxOf, incomeAt, leftoverAfterTransfer, monthCtx, monthMoney, periodOf, planAt, spendingIn, transferAt, priced, type MonthState } from '../../src/lib/calc'
import { dayText, periodText } from '../../src/lib/format'

// Pay day 25 (a month is named by its end: "2026-12" = 11-25 … 12-24), transfer day 26, no weekend rule.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const PAY: Settings = { ...S, monthBasis: 'pay' }
// The basis card's usage period starts on the 12th (named by its start: "2026-12" = 12-12 … 01-11).
const CARDS: Card[] = [{ id: 'c1', name: 'Card', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }]
const CARD: Settings = { ...S, monthBasis: 'card', monthBasisCardId: 'c1' }
const none: ReadonlySet<string> = new Set()

const targets: AllocationTarget[] = [
  { id: 't-l', name: 'Living', kind: 'living' },
  { id: 't-s', name: 'Subs', kind: 'subscriptions' },
  { id: 't-f', name: 'Fixed', kind: 'fixed' },
  { id: 't-r', name: 'Rest', kind: 'remainder' },
]
// the fixed amount changes with the month's name: a phase is saved by name and stays so (S-4)
const phases: Phase[] = [
  { id: 'p1', label: '', name: 'one', from: '2026-01', to: '2026-12', amounts: { 't-f': 1_000_000 } },
  { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { 't-f': 1_200_000 } },
]
const livingItems: LivingItem[] = [{ id: 'li', name: 'Food', kind: '', payMethod: '', amount: 500_000, from: null, code: null, amounts: {} }]
// charged on the 5th; 10,000 until the change of 11-28, then 15,000
const subs: Subscription[] = [{
  id: 's1', name: 'Sub', category: 'tool', plan: 'Basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '2026-11-05', path: 'direct', verified: false,
} as Subscription]
const planChanges: PlanChange[] = [{ id: 'pc', subId: 's1', effective: '2026-11-28', to: { amount: 15_000, plan: 'Plus' }, note: '' }]
const round = (date: string, amount: number) => ({ no: 1, date, amount, state: 'left' as const, edited: false })
const spending = (id: string, payBy: Spending['payBy'], date: string, amount: number): Spending => ({
  id, name: id, category: '', bought: date, amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy, count: 1, fee: 0, interval: null,
  cancelled: false, rounds: [round(date, amount)],
})
const spendings: Spending[] = [
  spending('a', 'salary', '2026-11-30', 120_000),
  spending('b', 'subs', '2026-12-24', 3_000),
  spending('c', 'salary', '2026-12-25', 40_000),
]
const extra = (date: string, amount: number): IncomeExtra => ({ id: date, date, name: date, amount })
const incomeExtras: IncomeExtra[] = [
  extra('2026-11-25', 200_000), extra('2026-12-05', 11_000), extra('2026-12-24', 50_000), extra('2026-12-25', 70_000), extra('2027-01-05', 30_000),
]
// the salary of the month named 2026-12 came in as 3,100,000: a receipt is saved by month name
const incomeReceipts: IncomeReceipt[] = [{ id: 'r1', itemId: null, ym: '2026-12', amount: 3_100_000 }]
const incomes: IncomeItem[] = [{ id: 'bonus', name: 'Bonus', cycle: 'yearly', month: 12, day: 20, amount: 400_000 }]

const state = (settings: Settings, over: Partial<MonthState> = {}): MonthState => ({
  settings, phases, targets, living: { food: 0, transit: 0, allowance: 0 }, livingItems, subscriptions: subs, planChanges, spendings,
  currencies: [], incomes, incomeReceipts, incomeExtras, cards: CARDS, off: none, ...over,
})

test('the three bases name the same dates differently (the scenario of this file)', () => {
  assert.deepEqual(periodOf('2026-12', ctxOf(state(S))), { ym: '2026-12', start: '2026-12-01', end: '2026-12-31' })
  assert.deepEqual(periodOf('2026-12', ctxOf(state(PAY))), { ym: '2026-12', start: '2026-11-25', end: '2026-12-24' })
  assert.deepEqual(periodOf('2026-12', ctxOf(state(CARD))), { ym: '2026-12', start: '2026-12-12', end: '2027-01-11' })
})

test('incomeAt: money that came in once counts in the month whose period holds its date; the salary and a receipt go by the name (the yearly income of 12-20 lies in "2026-12" on all three bases)', () => {
  // calendar, 2026-12: the extras of 12-05, 12-24 and 12-25 = 131,000
  const cal = incomeAt(state(S), '2026-12')
  assert.deepEqual(cal.extras.map((x) => x.date), ['2026-12-05', '2026-12-24', '2026-12-25'])
  assert.equal(cal.extraSum, 131_000)
  // pay basis, "2026-12" = 11-25 … 12-24: the extra dated on the period's first day is in, the one of 12-25 is next month's
  const pay = incomeAt(state(PAY), '2026-12')
  assert.deepEqual(pay.extras.map((x) => x.date), ['2026-11-25', '2026-12-05', '2026-12-24'])
  assert.equal(pay.extraSum, 261_000)
  assert.deepEqual(incomeAt(state(PAY), '2027-01').extras.map((x) => x.date), ['2026-12-25', '2027-01-05'])
  assert.deepEqual(incomeAt(state(PAY), '2026-11').extras, [])
  // card basis, "2026-12" = 12-12 … 01-11: 12-24, 12-25 and 01-05 = 150,000; 12-05 belongs to "2026-11"
  const card = incomeAt(state(CARD), '2026-12')
  assert.deepEqual(card.extras.map((x) => x.date), ['2026-12-24', '2026-12-25', '2027-01-05'])
  assert.equal(card.extraSum, 150_000)
  assert.deepEqual(incomeAt(state(CARD), '2026-11').extras.map((x) => x.date), ['2026-11-25', '2026-12-05'])
  // by name on every basis: the salary line with its receipt of "2026-12", and the yearly income of month 12
  for (const [name, x] of [['calendar', cal], ['pay', pay], ['card', card]] as const) {
    const salary = x.rows.find((r) => r.key === 'salary')!
    assert.deepEqual([salary.expected, salary.received, salary.used], [3_000_000, 3_100_000, 3_100_000], name)
    assert.equal(x.rows.find((r) => r.key === 'bonus')!.expected, 400_000, name)
    // expected 3,400,000; counted 3,100,000 + 400,000 + the extras
    assert.equal(x.expected, 3_400_000, name)
    assert.equal(x.total, 3_500_000 + x.extraSum, name)
  }
  // the month before has no receipt and no yearly income, on every basis: the expected salary
  for (const s of [S, PAY, CARD]) assert.equal(incomeAt(state(s), '2026-11').rows.length, 1)
  assert.equal(incomeAt(state(PAY), '2026-11').total, 3_000_000)
  // the yearly income of another month comes next in the month of that name
  assert.deepEqual(incomeAt(state(PAY), '2027-01').later, [{ id: 'bonus', name: 'Bonus', amount: 400_000, ym: '2027-12' }])
})

// Review 2 F-5: a yearly income is a calendar date (its month number and day), so it counts — and is shown — in the
// month whose period holds that date, not on "its day inside the period named after its month number".
test('incomeAt: a yearly income counts in the month whose period holds its calendar date; a monthly income keeps its day inside the period', () => {
  const yearly = (id: string, month: number, day: number): IncomeItem => ({ id, name: id, cycle: 'yearly', month, day, amount: 400_000 })
  const st = (s: Settings, list: IncomeItem[]) => state(s, { incomes: list, incomeReceipts: [], incomeExtras: [] })
  const row = (s: Settings, list: IncomeItem[], ym: string, id: string) => incomeAt(st(s, list), ym).rows.find((r) => r.key === id)
  // pay day 25, named by the end: "2026-12" = 11-25 … 12-24, "2027-01" = 12-25 … 01-24
  const late = [yearly('late', 12, 28)]
  assert.equal(row(PAY, late, '2026-12', 'late'), undefined, '12-28 is not in 11-25 … 12-24')
  assert.deepEqual(row(PAY, late, '2027-01', 'late'), { key: 'late', name: 'late', day: 28, date: '2026-12-28', expected: 400_000, received: null, used: 400_000, diff: 0 })
  assert.equal(incomeAt(st(PAY, late), '2026-12').total, 3_000_000)
  assert.equal(incomeAt(st(PAY, late), '2027-01').total, 3_400_000)
  // once a year, in one month only
  const names = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
  assert.deepEqual(names.filter((ym) => row(PAY, late, ym, 'late')), ['2027-01'])
  // the months that do not count it name the month it comes next
  assert.deepEqual(incomeAt(st(PAY, late), '2026-12').later, [{ id: 'late', name: 'late', amount: 400_000, ym: '2027-01' }])
  assert.deepEqual(incomeAt(st(PAY, late), '2027-02').later, [{ id: 'late', name: 'late', amount: 400_000, ym: '2028-01' }])
  assert.deepEqual(incomeAt(st(PAY, late), '2027-01').later, [])
  // pay day 10, named by the start: "2026-12" = 12-10 … 01-09, so 12-05 belongs to "2026-11" (11-10 … 12-09)
  const PAY10: Settings = { ...PAY, payDay: 10 }
  const early = [yearly('early', 12, 5)]
  assert.equal(row(PAY10, early, '2026-12', 'early'), undefined)
  assert.equal(row(PAY10, early, '2026-11', 'early')!.date, '2026-12-05')
  // the card basis (first day 12): "2026-12" = 12-12 … 01-11; 12-05 is in "2026-11", 01-05 in "2026-12"
  assert.equal(row(CARD, early, '2026-11', 'early')!.date, '2026-12-05')
  assert.equal(row(CARD, early, '2026-12', 'early'), undefined)
  assert.equal(row(CARD, [yearly('jan', 1, 5)], '2026-12', 'jan')!.date, '2027-01-05')
  assert.deepEqual(incomeAt(st(CARD, [yearly('jan', 1, 5)]), '2027-01').later.map((l) => l.ym), ['2027-12'])
  // a day the month lacks is its last day: 02-30 is 02-28 in 2027
  assert.equal(row(PAY, [yearly('feb', 2, 30)], '2027-03', 'feb')!.date, '2027-02-28')
  // the calendar basis is as it was: the month of that number, on that day
  for (const ym of names) assert.equal(!!row(S, late, ym, 'late'), ym === '2026-12', ym)
  assert.equal(row(S, late, '2026-12', 'late')!.date, '2026-12-28')
  assert.deepEqual(incomeAt(st(S, late), '2026-11').later.map((l) => l.ym), ['2026-12'])
  assert.deepEqual(incomeAt(st(S, late), '2027-01').later.map((l) => l.ym), ['2027-12'])
  // a monthly income has no date of its own: every month counts it, by the name
  const monthly: IncomeItem = { id: 'side', name: 'side', cycle: 'monthly', day: 28, amount: 100_000 }
  for (const ym of ['2026-12', '2027-01']) assert.deepEqual([row(PAY, [monthly], ym, 'side')!.expected, row(PAY, [monthly], ym, 'side')!.date], [100_000, undefined], ym)
  // a receipt written down for the yearly income in another month still counts there, with nothing expected and no date
  const got = incomeAt(state(PAY, { incomes: late, incomeReceipts: [{ id: 'r', itemId: 'late', ym: '2026-12', amount: 390_000 }], incomeExtras: [] }), '2026-12')
  assert.deepEqual(got.rows.find((r) => r.key === 'late'), { key: 'late', name: 'late', day: 28, expected: 0, received: 390_000, used: 390_000, diff: 390_000 })
})

test('spendingIn: each live round counts in the month whose period holds its date', () => {
  const sum = (s: Settings, ym: string) => { const x = spendingIn(spendings, ym, ctxOf(state(s))); return [x.remainder, x.subs, x.items.map((i) => i.spending.id).join('')] }
  // calendar: 11-30 → 2026-11; 12-24 and 12-25 → 2026-12
  assert.deepEqual(sum(S, '2026-11'), [120_000, 0, 'a'])
  assert.deepEqual(sum(S, '2026-12'), [40_000, 3_000, 'bc'])
  // pay: 11-30 and 12-24 are in "2026-12" (11-25 … 12-24), 12-25 opens "2027-01"
  assert.deepEqual(sum(PAY, '2026-11'), [0, 0, ''])
  assert.deepEqual(sum(PAY, '2026-12'), [120_000, 3_000, 'ab'])
  assert.deepEqual(sum(PAY, '2027-01'), [40_000, 0, 'c'])
  // card: 11-30 is in "2026-11" (11-12 … 12-11), the other two in "2026-12" (12-12 … 01-11)
  assert.deepEqual(sum(CARD, '2026-11'), [120_000, 0, 'a'])
  assert.deepEqual(sum(CARD, '2026-12'), [40_000, 3_000, 'bc'])
  // without a basis: the calendar month, as before
  assert.deepEqual(spendingIn(spendings, '2026-12'), spendingIn(spendings, '2026-12', ctxOf(state(S))))
})

test('planAt, changesIn, transferAt: a plan change counts from the month whose period holds its effective date', () => {
  const p = priced(S, [])
  const amount = (s: Settings, ym: string) => planAt(subs[0]!, planChanges, ym, ctxOf(state(s))).amount
  // calendar: effective 11-28 → from 2026-11
  assert.deepEqual([amount(S, '2026-10'), amount(S, '2026-11'), amount(S, '2026-12')], [10_000, 15_000, 15_000])
  assert.equal(planAt(subs[0]!, planChanges, '2026-11').amount, 15_000) // no basis named: the calendar month
  // pay: 11-28 lies in "2026-12" (11-25 … 12-24), so the month named 2026-11 still has the old plan
  assert.deepEqual([amount(PAY, '2026-11'), amount(PAY, '2026-12'), amount(PAY, '2027-01')], [10_000, 15_000, 15_000])
  // card: 11-28 lies in "2026-11" (11-12 … 12-11)
  assert.deepEqual([amount(CARD, '2026-10'), amount(CARD, '2026-11')], [10_000, 15_000])
  const ids = (s: Settings, ym: string) => changesIn(planChanges, ym, ctxOf(state(s))).map((c) => c.id)
  assert.deepEqual([ids(S, '2026-11'), ids(S, '2026-12')], [['pc'], []])
  assert.deepEqual([ids(PAY, '2026-11'), ids(PAY, '2026-12')], [[], ['pc']])
  assert.deepEqual([ids(CARD, '2026-11'), ids(CARD, '2026-12')], [['pc'], []])
  assert.deepEqual(changesIn(planChanges, '2026-11').map((c) => c.id), ['pc'])
  // the transfer: 10,000 → 10,000 a month; 15,000 → needed 15,000, rounded up to the 10,000 unit = 20,000
  assert.equal(transferAt(subs, planChanges, p, '2026-11', 0, ctxOf(state(PAY))).transfer, 10_000)
  assert.equal(transferAt(subs, planChanges, p, '2026-12', 0, ctxOf(state(PAY))).transfer, 20_000)
  assert.equal(transferAt(subs, planChanges, p, '2026-11').transfer, 20_000)
})

test('monthMoney, pay basis (pay day 25, naming auto): the month named 2026-12 is 11-25 … 12-24', () => {
  const m = monthMoney(state(PAY), '2026-12')
  // comes in: the receipt 3,100,000 + the yearly income 400,000 + the extras of 11-25, 12-05, 12-24 (261,000)
  assert.equal(m.income.total, 3_761_000)
  // goes out of the left over: the round of 11-30 (120,000); the subscription account pays the round of 12-24 (3,000)
  assert.deepEqual([m.spend.remainder, m.spend.subs], [120_000, 3_000])
  // the subscription transfer: the plan of 11-28 counts (15,000) + 3,000 = 18,000 → rounded up to 20,000
  assert.deepEqual([m.transfer.monthlySum, m.transfer.needed, m.transfer.transfer], [15_000, 18_000, 20_000])
  // the fixed target is the phase of the NAME 2026-12 (1,000,000), though the period starts in November
  assert.equal(m.dist.rows.find((r) => r.key === 't-f')!.amount, 1_000_000)
  // left over: 3,761,000 − living 500,000 − subscriptions 20,000 − fixed 1,000,000 − spendings 120,000
  assert.equal(m.dist.remainder, 2_121_000)

  // the month named 2026-11 (10-25 … 11-24): nothing dated in it; the old plan (10,000 → transfer 10,000)
  const nov = monthMoney(state(PAY), '2026-11')
  assert.deepEqual([nov.income.total, nov.spend.remainder, nov.spend.subs, nov.transfer.transfer], [3_000_000, 0, 0, 10_000])
  assert.equal(nov.dist.remainder, 3_000_000 - 500_000 - 10_000 - 1_000_000)

  // the month named 2027-01 (12-25 … 01-24): the extras of 12-25 and 01-05, the round of 12-25, the phase from 2027-01
  const jan = monthMoney(state(PAY), '2027-01')
  assert.deepEqual([jan.income.total, jan.spend.remainder, jan.transfer.transfer], [3_100_000, 40_000, 20_000])
  assert.equal(jan.dist.remainder, 3_100_000 - 500_000 - 20_000 - 1_200_000 - 40_000)
})

test('monthMoney, card basis (usage period from the 12th, naming auto): the month named 2026-12 is 12-12 … 01-11', () => {
  const m = monthMoney(state(CARD), '2026-12')
  // comes in: 3,100,000 + 400,000 + the extras of 12-24, 12-25 and 01-05 (150,000)
  assert.equal(m.income.total, 3_650_000)
  assert.deepEqual([m.spend.remainder, m.spend.subs], [40_000, 3_000])
  assert.deepEqual([m.transfer.needed, m.transfer.transfer], [18_000, 20_000])
  // left over: 3,650,000 − 500,000 − 20,000 − 1,000,000 − 40,000
  assert.equal(m.dist.remainder, 2_090_000)
  // "2026-11" (11-12 … 12-11): the extras of 11-25 and 12-05, the round of 11-30, the plan of 11-28
  const nov = monthMoney(state(CARD), '2026-11')
  assert.deepEqual([nov.income.total, nov.spend.remainder, nov.transfer.transfer], [3_211_000, 120_000, 20_000])
  assert.equal(nov.dist.remainder, 3_211_000 - 500_000 - 20_000 - 1_000_000 - 120_000)
})

test('monthMoney, calendar basis: the same state by the calendar month', () => {
  const m = monthMoney(state(S), '2026-12')
  // 3,100,000 + 400,000 + the extras of 12-05, 12-24, 12-25 (131,000); the rounds of 12-24 (subs) and 12-25
  assert.equal(m.income.total, 3_631_000)
  assert.deepEqual([m.spend.remainder, m.spend.subs, m.transfer.transfer], [40_000, 3_000, 20_000])
  assert.equal(m.dist.remainder, 3_631_000 - 500_000 - 20_000 - 1_000_000 - 40_000)
})

test('the calendar basis gives what a call without cards and holidays gives, and so does a card basis that has no usable card', () => {
  // holidays that would move a pay date, to show that the calendar basis does not read them
  const off: ReadonlySet<string> = new Set(['2026-11-25', '2026-12-25', '2027-01-01'])
  const bare = (settings: Settings): MonthState => { const { cards: _c, off: _o, ...rest } = state(settings); return rest }
  // the same state as 0.1.9 held it: no month keys in the settings, no cards and no holidays handed to the sums
  const old = (st: MonthState): MonthState => {
    const { monthBasis: _b, monthBasisCardId: _i, monthNaming: _n, ...settings } = st.settings
    const { cards: _c, off: _o, ...rest } = st
    return { ...rest, settings }
  }
  const same: [string, MonthState][] = [
    ['calendar, with cards and holidays', state({ ...S, monthBasis: 'calendar', monthBasisCardId: 'c1', monthNaming: 'end' }, { off })],
    ['calendar, weekend rules', state({ ...S, payShift: 'before', transferShift: 'after' }, { off })],
    ['card basis, no card chosen', state({ ...S, monthBasis: 'card', monthBasisCardId: null }, { off })],
    ['card basis, the card is gone', state({ ...S, monthBasis: 'card', monthBasisCardId: 'gone' }, { off })],
    ['card basis, the card has no first day', state(CARD, { cards: [{ ...CARDS[0]!, usageFrom: null }], off })],
    ['card basis, no cards in the state', bare(CARD)],
  ]
  for (const ym of ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']) {
    for (const [name, st] of same) {
      const want = monthMoney(old(st), ym)
      assert.deepEqual(monthMoney(st, ym), want, `${name} ${ym}`)
      assert.deepEqual(incomeAt(st, ym), want.income, `${name} ${ym} income`)
      assert.deepEqual(leftoverAfterTransfer(st, ym, off, spendings), leftoverAfterTransfer(old(st), ym, off, spendings), `${name} ${ym} leftover`)
    }
  }
  // a pay basis is read from the settings alone: it needs no cards
  assert.deepEqual(monthMoney(bare(PAY), '2026-12'), monthMoney(state(PAY), '2026-12'))
})

test('monthMoney: a basis worked out by the caller is used as it is', () => {
  const ctx = monthCtx(PAY, [], none)
  assert.deepEqual(monthMoney(state(S), '2026-12', { ctx }), monthMoney(state(PAY), '2026-12'))
})

test('a pay basis starts on the actual pay date: a holiday in the state moves what counts in the month', () => {
  // 2026-12-25 is a Friday; closed as a holiday with the rule "before", the pay date is 12-24 and "2027-01" starts there
  const off: ReadonlySet<string> = new Set(['2026-12-25'])
  const before: Settings = { ...PAY, payShift: 'before' }
  assert.deepEqual(periodOf('2026-12', ctxOf(state(before, { off }))), { ym: '2026-12', start: '2026-11-25', end: '2026-12-23' })
  // so the extra and the subscription-account round of 12-24 move to the month named 2027-01
  assert.equal(monthMoney(state(before, { off }), '2026-12').income.extraSum, 211_000)
  assert.equal(monthMoney(state(before, { off }), '2026-12').spend.subs, 0)
  assert.equal(monthMoney(state(before, { off }), '2027-01').income.extraSum, 150_000)
  // without the holiday list the same settings start the month on 12-25
  assert.equal(monthMoney(state(before), '2026-12').income.extraSum, 261_000)
})

test('leftoverAfterTransfer: from the month\'s transfer date to the day before the next month\'s, each inside its period', () => {
  // calendar, 2026-12: 12-26 … 2027-01-25; the charge of 01-05 (15,000); transfer 20,000 (15,000 + the round of 12-24)
  assert.deepEqual(leftoverAfterTransfer(state(S), '2026-12', none, spendings), { transfer: 20_000, from: '2026-12-26', to: '2027-01-25', paid: 15_000, count: 1, left: 5_000 })
  // pay basis, "2026-12" (11-25 … 12-24): its transfer date is 11-26, the next month's 12-26 → 11-26 … 12-25;
  // the charge of 12-05 (15,000) and the subscription-account round of 12-24 (3,000); transfer 20,000
  assert.deepEqual(leftoverAfterTransfer(state(PAY), '2026-12', none, spendings), { transfer: 20_000, from: '2026-11-26', to: '2026-12-25', paid: 18_000, count: 2, left: 2_000 })
  // card basis, "2026-12" (12-12 … 01-11): the 26th lies in December → 12-26 … 01-25, as on the calendar
  assert.deepEqual(leftoverAfterTransfer(state(CARD), '2026-12', none, spendings), { transfer: 20_000, from: '2026-12-26', to: '2027-01-25', paid: 15_000, count: 1, left: 5_000 })
  // card basis with the transfer on the 5th (before the period's first day): the 5th of the second month
  const early = state({ ...CARD, transferDay: 5 })
  // "2026-12": 2027-01-05 … 02-04, with the charge of 01-05 (the one of 02-05 is the next window's)
  assert.deepEqual(leftoverAfterTransfer(early, '2026-12', none, spendings), { transfer: 20_000, from: '2027-01-05', to: '2027-02-04', paid: 15_000, count: 1, left: 5_000 })
})

test('ctxOf: a state\'s own holidays are the ones its months are read by; a caller\'s are used when the state has none', () => {
  const before: Settings = { ...PAY, payShift: 'before' }
  const closed: ReadonlySet<string> = new Set(['2026-12-25'])
  const { off: _o, ...bare } = state(before)
  // the state has none: the caller's
  assert.equal(periodOf('2026-12', ctxOf(bare, closed)).end, '2026-12-23')
  assert.equal(periodOf('2026-12', ctxOf(bare)).end, '2026-12-24')
  // the state has its own: one list for every question about that state
  assert.equal(periodOf('2026-12', ctxOf({ ...bare, off: closed }, none)).end, '2026-12-23')
  assert.equal(periodOf('2026-12', ctxOf({ ...bare, off: none }, closed)).end, '2026-12-24')
  // the sums read the same list: the subscription-account round of 12-24 is next month's
  assert.equal(monthMoney({ ...bare, off: closed }, '2026-12').spend.subs, 0)
})

test('the period text next to a month\'s name follows the user\'s date format', () => {
  assert.equal(periodText('2026-11-25', '2026-12-24', { dateFormat: 'iso' }), '11-25~12-24')
  assert.equal(periodText('2026-11-25', '2026-12-24', { dateFormat: 'dot' }), '11. 25.~12. 24.')
  assert.equal(periodText('2026-11-25', '2026-12-24', { dateFormat: 'us' }), '11/25~12/24')
  assert.equal(dayText('2027-01-05', { dateFormat: 'us' }), '01/05')
  assert.equal(dayText('not a date', { dateFormat: 'iso' }), 'not a date')
})
