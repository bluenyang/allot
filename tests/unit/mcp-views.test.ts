// spec 008 V-6: what the MCP tools say is what calc.ts says for the same data (synthetic data).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bufferGauge, distributionAt, goalAlerts, goalMonth, groupAt, groupValue, livingAt, monthDates, monthlyKrw, monthMoney, nextPayment, parseDate, planAt, planRounds, projectAccount, transferAt,
  upcomingPayments, yearContribution, ymd, type AccountState,
  priced,
} from '../../src/lib/calc'
import type { Account, LivingItem, Spending, Subscription } from '../../src/data/types'
import { accountList, allocation, budget, eventMonths, incomeView, maturitySchedule, notificationList, overview, planChangeList, schedule, searchView, spendingList, subscriptionList, type Data } from '../../server/mcp/views'
import { maturityOf } from '../../server/mcp/maturity'
import { buildNotices } from '../../src/lib/notices'
import { search } from '../../src/lib/search'

const sub = (over: Partial<Subscription> & { id: string; name: string }): Subscription => ({
  category: 'tool', plan: 'basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active',
  nextDate: '2026-11-20', path: 'direct', verified: false, ...over,
})

const data: Data = {
  settings: { netPay: 3_000_000, fxRate: 1400, fxBuffer: 5, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, dayShift: 'after' },
  living: { food: 400_000, transit: 100_000, allowance: 200_000 },
  targets: [
    { id: 't-live', name: 'Living account', kind: 'living' },
    { id: 't-subs', name: 'Subscription account', kind: 'subscriptions' },
    { id: 't-save', name: 'Savings', kind: 'fixed', note: 'steady' },
    { id: 't-rest', name: 'Everything else', kind: 'remainder' },
  ],
  subscriptions: [
    sub({ id: 's1', name: 'Sub One', amount: 12_000 }),
    sub({ id: 's2', name: 'Sub Two', amount: 20, currency: 'USD', vat: 10, nextDate: '2026-11-05' }),
    sub({ id: 's3', name: 'Sub Three', amount: 120_000, cycle: 'yearly', nextDate: '2027-01-10' }),
    sub({ id: 's4', name: 'Sub Four', status: 'cancelled' }),
  ],
  planChanges: [
    { id: 'c1', subId: 's1', effective: '2027-01-01', to: { amount: 15_000, plan: 'plus' }, note: 'upgrade' },
    { id: 'c2', subId: 's2', effective: null, to: { status: 'cancelled' }, note: '' },
  ],
  phases: [{ id: 'p1', label: 'P1', name: 'first', from: '2026-01', to: null, amounts: { 't-save': 500_000 } }],
  events: [
    { id: 'e1', when: '2026-12', kind: '저축', title: 'Move savings', state: 'todo' },
    { id: 'e2', when: '2026-11~12', kind: '정책', title: 'Review', state: 'doing' },
  ],
  checks: [{ id: 'k1', text: 'Check the rate', done: false }],
  accounts: [{ id: 'a1', name: 'Main', role: 'salary', inflow: 'pay', outflow: 'split' }],
  debts: [{ id: 'd1', name: 'Loan', principal: 1_000_000, rate: '3%', method: 'equal', plan: 'monthly' }],
  remainderSplit: [{ id: 'r1', name: 'Fund A', code: 'A', ratio: 0.6 }, { id: 'r2', name: 'Fund B', code: 'B', ratio: 0.4 }],
  holidaySets: [],
}

test('overview matches calc.ts for the same data, this month and three months on', () => {
  for (const ym of ['2026-11', '2027-02']) {
    const o = overview(data, ym)
    const x = transferAt(data.subscriptions, data.planChanges, priced(data.settings), ym)
    assert.equal(o.subscriptionTransfer.transferKrw, x.transfer)
    assert.equal(o.subscriptionTransfer.neededKrw, x.needed)
    assert.equal(o.subscriptionTransfer.monthlyKrw, Math.round(x.monthlySum))
    const dist = distributionAt(ym, data.settings.netPay, data.phases, data.targets, data.living, data.subscriptions, data.planChanges, priced(data.settings))
    assert.deepEqual(o.distribution.rows.map((r) => [r.targetId, r.amountKrw]), dist.rows.map((r) => [r.key, Math.round(r.amount)]))
    assert.equal(o.distribution.remainderKrw, Math.round(dist.remainder))
    // pay = net pay minus everything: the rows add up to the net pay
    assert.equal(o.distribution.rows.reduce((a, r) => a + r.amountKrw, 0), data.settings.netPay)
    const d = monthDates(ym, data.settings, new Set())
    assert.equal(o.dates.pay.nominal, d.pay.nominal)
    assert.equal(o.dates.transfer.nominal, d.transfer.nominal)
    assert.equal(o.settings.netPay, 3_000_000)
  }
  // ratios: the last item takes what is left
  const o = overview(data, '2026-11')
  assert.equal(o.remainderSplit.reduce((a, s) => a + s.amountKrw, 0), Math.max(0, o.distribution.remainderKrw))
})

test('overview: a plan change shows in its month and moves the transfer', () => {
  const before = overview(data, '2026-12')
  const after = overview(data, '2027-01')
  assert.equal(before.planChanges.length, 0)
  assert.deepEqual(after.planChanges.map((c) => c.id), ['c1'])
  assert.equal(after.subscriptionTransfer.items.find((i) => i.subscriptionId === 's1')?.monthlyKrw, 15_000)
  assert.equal(before.subscriptionTransfer.items.find((i) => i.subscriptionId === 's1')?.monthlyKrw, 12_000)
})

test('overview: payments of the month are the ones calc.ts finds in that month', () => {
  const o = overview(data, '2026-11')
  const calc = upcomingPayments(data.subscriptions, data.planChanges, priced(data.settings), parseDate('2026-11-01'), 29).filter((p) => ymd(p.date).startsWith('2026-11'))
  assert.deepEqual(o.payments.map((p) => [p.date, p.subscriptionId, p.amountKrw]), calc.map((p) => [ymd(p.date), p.sub.id, Math.round(p.krw)]))
  assert.ok(o.payments.length >= 2)
  assert.ok(o.payments.every((p) => p.date.startsWith('2026-11')))
})

test('subscription list: plan at this month, monthly KRW, next payment, status filter', () => {
  const now = parseDate('2026-11-16')
  const all = subscriptionList(data, now)
  assert.equal(all.subscriptions.length, 4)
  const s2 = all.subscriptions.find((s) => s.id === 's2')!
  assert.equal(s2.monthlyKrw, Math.round(monthlyKrw(planAt(data.subscriptions[1]!, data.planChanges, '2026-11'), priced(data.settings))))
  assert.equal(s2.nextPayment, ymd(nextPayment(data.subscriptions[1]!, data.planChanges, now)!))
  assert.equal(all.subscriptions.find((s) => s.id === 's4')!.nextPayment, null, 'a cancelled subscription has no next payment')
  assert.deepEqual(subscriptionList(data, now, 'cancelled').subscriptions.map((s) => s.id), ['s4'])
  // the plan change of January is not in force in November
  assert.equal(all.subscriptions.find((s) => s.id === 's1')!.amount, 12_000)
  assert.equal(subscriptionList(data, parseDate('2027-01-16')).subscriptions.find((s) => s.id === 's1')!.amount, 15_000)
})

test('subscription list: the next payment follows the plan in force, as the screen does (review finding 2)', () => {
  // anchored 2026-10-20, monthly; a change to a yearly plan takes effect in November
  const d: Data = {
    ...data,
    subscriptions: [sub({ id: 'x1', name: 'Cycle Change', nextDate: '2026-10-20' })],
    planChanges: [{ id: 'cx', subId: 'x1', effective: '2026-11-01', to: { cycle: 'yearly', amount: 100_000 }, note: '' }],
  }
  const now = parseDate('2026-11-16')
  const row = subscriptionList(d, now).subscriptions[0]!
  const p = planAt(d.subscriptions[0]!, d.planChanges, '2026-11')
  assert.equal(p.cycle, 'yearly')
  // the yearly charge falls in the month the change comes in (Nov 20), then a year on: the same dates the
  // payment schedule gives (A-10: one recurrence for every view)
  assert.equal(row.nextPayment, '2026-11-20')
  const sched = schedule(d, '2026-11', 1).months[0]!.payments.filter((x) => x.subscriptionId === 'x1').map((x) => x.date)
  assert.equal(sched[0], row.nextPayment)
  assert.equal(ymd(upcomingPayments(d.subscriptions, d.planChanges, priced(d.settings), now, 400)[1]!.date), '2027-11-20')
})

test('plan change list: dated first by date, undated last, with the monthly delta', () => {
  const l = planChangeList(data).planChanges
  assert.deepEqual(l.map((c) => c.id), ['c1', 'c2'])
  assert.equal(l[0]!.subscription, 'Sub One')
  assert.equal(l[0]!.monthlyDeltaKrw, 3_000)
  assert.equal(l[1]!.effective, null)
  assert.equal(l[1]!.monthlyDeltaKrw, null)
})

test('allocation: the definition as entered', () => {
  const a = allocation(data)
  assert.deepEqual(a.targets.map((t) => t.kind), ['living', 'subscriptions', 'fixed', 'remainder'])
  assert.deepEqual(a.phases[0]!.amounts, [{ targetId: 't-save', amountKrw: 500_000 }])
  assert.equal(a.debts[0]!.principalKrw, 1_000_000)
  assert.equal(a.living.food, 400_000)
})

test('schedule: months, plan events inside their range, check items, no holidays when none are on', () => {
  const s = schedule(data, '2026-11', 3)
  assert.deepEqual(s.months.map((m) => m.month), ['2026-11', '2026-12', '2027-01'])
  assert.deepEqual(s.months[0]!.planEvents.map((e) => e.id), ['e2'])
  assert.deepEqual(s.months[1]!.planEvents.map((e) => e.id).sort(), ['e1', 'e2'])
  assert.deepEqual(s.months[2]!.planEvents, [])
  assert.deepEqual(s.months[2]!.planChanges.map((c) => c.id), ['c1'])
  assert.equal(s.checkItems.length, 1)
  assert.ok(s.holidays.length > 0, 'the built-in holiday set counts as on')
  assert.ok(s.holidays.every((h) => h.date >= '2026-11-01' && h.date <= '2027-01-31'))
  const off = schedule({ ...data, holidaySets: [{ id: 'kr', name: 'KR', enabled: false, builtin: 'kr', rules: [] }] }, '2026-11', 1)
  assert.deepEqual(off.holidays, [], 'a holiday set that is off is not shown')
  // the dates of a month with the shift: pay day 25 → after weekends and holidays
  assert.match(s.months[0]!.dates.pay.date, /^2026-11-\d\d$/)
})

test('overview: one-off spendings are in the transfer and the remainder, with their own fields', () => {
  const sp = (id: string, payBy: 'salary' | 'subs', date: string, amount: number) => ({
    id, name: id, category: 'etc', bought: date, amount, currency: 'KRW' as const, fxRate: null, fxBuffer: null, how: 'lump' as const, payBy, count: 1, fee: 0, interval: null, cancelled: false,
    rounds: [{ no: 1, date, amount, state: 'left' as const, edited: false }],
  })
  const withSpend: Data = { ...data, spendings: [sp('x', 'salary', '2026-12-10', 100_000), sp('y', 'subs', '2026-12-12', 50_000)] }
  const base = overview(data, '2026-12')
  const o = overview(withSpend, '2026-12')
  assert.equal(base.distribution.spendingKrw, 0)
  assert.equal(o.distribution.spendingKrw, 100_000)
  assert.equal(o.subscriptionTransfer.spendingKrw, 50_000)
  const x = transferAt(data.subscriptions, data.planChanges, priced(data.settings), '2026-12', 50_000)
  assert.equal(o.subscriptionTransfer.transferKrw, x.transfer)
  assert.equal(o.subscriptionTransfer.neededKrw, x.needed)
  assert.equal(o.distribution.remainderKrw, base.distribution.remainderKrw - 100_000 - (x.transfer - base.subscriptionTransfer.transferKrw))
  assert.equal(o.distribution.rows.reduce((a, r) => a + r.amountKrw, 0), data.settings.netPay - 100_000)
  // another month is the same as without spendings
  assert.deepEqual(overview(withSpend, '2027-02'), overview(data, '2027-02'))
})

const rnd = (no: number, date: string, amount: number, state: 'left' | 'paid' | 'merged' = 'left') => ({ no, date, amount, state, edited: false })
const inst: Spending = {
  id: 'i1', name: 'Laptop', category: 'etc', bought: '2026-10-05', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'installment', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false,
  rounds: [rnd(1, '2026-11-14', 100_000, 'paid'), rnd(2, '2026-12-14', 100_000), rnd(3, '2027-01-14', 100_000)],
}
const lump: Spending = {
  id: 'l1', name: 'Chair', category: 'etc', bought: '2026-11-02', amount: 50_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'lump', payBy: 'subs', count: 1, fee: 0, interval: null, cancelled: false, rounds: [rnd(1, '2026-12-12', 50_000)],
}
const usd: Spending = {
  id: 'u1', name: 'Course', category: 'edu', bought: '2026-09-01', amount: 100, currency: 'USD', fxRate: 1300, fxBuffer: 2,
  how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false, rounds: [rnd(1, '2026-09-25', 132_600, 'paid')],
}
const gone: Spending = { ...lump, id: 'g1', name: 'Gone', cancelled: true }
const withSp: Data = { ...data, spendings: [inst, lump, usd, gone] }
const NOW = new Date(2026, 10, 21)

test('list_spendings: rounds, progress and state per spending', () => {
  const l = spendingList(withSp, NOW)
  assert.deepEqual(l.spendings.map((x) => x.id), ['i1', 'l1', 'u1', 'g1'])
  const i = l.spendings[0]!
  assert.equal(i.state, 'planned')
  assert.deepEqual(i.progress, { paid: 1, left: 2, merged: 0, next: { round: 2, date: '2026-12-14', amountKrw: 100_000 } })
  assert.deepEqual(i.rounds.map((r) => [r.round, r.state, r.amountKrw]), [[1, 'paid', 100_000], [2, 'left', 100_000], [3, 'left', 100_000]])
  assert.equal(i.principalKrw, 300_000)
  assert.equal(i.payBy, 'card')
  assert.equal(l.spendings[1]!.payBy, 'subs')
  const u = l.spendings[2]!
  assert.equal(u.state, 'paid')
  assert.equal(u.principalKrw, 132_600) // 100 x 1300 x 1.02 with the rate saved with it, not the settings'
  assert.equal(u.progress.next, null)
  const g = l.spendings[3]!
  assert.equal(g.state, 'cancelled')
  assert.equal(g.progress.next, null)
})

test('list_spendings: status and month filters', () => {
  const ids = (f: Parameters<typeof spendingList>[2]) => spendingList(withSp, NOW, f).spendings.map((x) => x.id)
  assert.deepEqual(ids({ status: 'active' }), ['i1', 'l1'])
  assert.deepEqual(ids({ status: 'done' }), ['u1'])
  assert.deepEqual(ids({ status: 'cancelled' }), ['g1'])
  assert.deepEqual(ids({ status: 'all' }), ['i1', 'l1', 'u1', 'g1'])
  assert.deepEqual(ids({ month: '2026-12' }), ['i1', 'l1', 'g1'])
  assert.deepEqual(ids({ month: '2026-12', status: 'active' }), ['i1', 'l1'])
  assert.deepEqual(ids({ month: '2026-03' }), [])
  const m = spendingList(withSp, NOW, { month: '2026-12' })
  assert.deepEqual(m.monthTotals, { subscriptionAccountKrw: 50_000, remainderKrw: 100_000 }) // the cancelled one adds nothing
  assert.equal('monthTotals' in spendingList(withSp, NOW), false)
  assert.deepEqual(spendingList(data, NOW).spendings, [])
})

test('list_spendings: a payoff round and a merged round are told apart', () => {
  const paid: Spending = { ...inst, rounds: [rnd(1, '2026-11-14', 100_000, 'paid'), rnd(2, '2026-12-14', 100_000, 'merged'), rnd(3, '2027-01-14', 100_000, 'merged'), rnd(4, '2026-11-20', 200_000)] }
  const x = spendingList({ ...data, spendings: [paid] }, NOW).spendings[0]!
  assert.deepEqual([x.progress.paid, x.progress.left, x.progress.merged], [1, 1, 2])
  assert.equal(x.progress.next?.round, 4)
  const r = overview({ ...data, spendings: [paid] }, '2026-11').spendingRounds
  assert.deepEqual(r.map((y) => [y.round, y.of, y.payoff ?? false, y.state]), [[1, 3, false, 'paid'], [4, 3, true, 'left']])
})

test('overview and schedule: spending rounds are items of their own, not in the subscription charges', () => {
  const o = overview(withSp, '2026-12')
  assert.deepEqual(o.spendingRounds.map((r) => [r.date, r.name, r.round, r.of, r.amountKrw, r.payBy]), [['2026-12-12', 'Chair', 1, 1, 50_000, 'subs'], ['2026-12-14', 'Laptop', 2, 3, 100_000, 'card']])
  assert.deepEqual(o.payments, overview(data, '2026-12').payments)
  const s = schedule(withSp, '2026-11', 3)
  assert.deepEqual(s.months.map((m) => m.spendingRounds.length), [1, 2, 1])
  assert.deepEqual(s.months.map((m) => m.payments), schedule(data, '2026-11', 3).months.map((m) => m.payments))
  assert.deepEqual(schedule(data, '2026-11', 1).months[0]!.spendingRounds, [])
})

// ── spec 013 S-10: get_budget and list_accounts (and get_overview, get_allocation with the new state) ──
const none: ReadonlySet<string> = new Set()
const item = (id: string, amount: number, over: Partial<LivingItem> = {}): LivingItem =>
  ({ id, name: `E2E-${id}`, kind: 'food', payMethod: 'card', amount, from: null, code: null, amounts: {}, ...over })
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: `E2E-${id}`, role: '', inflow: '', outflow: '', bank: '', last4: '', kind: '', rate: '', term: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const refills = planRounds({ bought: '2026-11-18', how: 'buffer', payBy: 'card', count: 2, principal: 400_000, refillFrom: '2026-12-25' }, data.settings, none)
const pc: Spending = {
  id: 'pc', name: 'E2E-PC', category: 'home', bought: '2026-11-18', amount: 400_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'buffer', payBy: 'card', count: 2, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-12-25', rounds: refills,
}
const bd: Data = {
  ...data,
  // no weekend or holiday shift, no holidays: the calc functions below run with no off days
  settings: { ...data.settings, dayShift: 'none' },
  holidaySets: [{ id: 'kr', name: 'KR', enabled: false, builtin: 'kr', rules: [] }],
  subscriptions: [], planChanges: [],
  living: { food: 300_000, transit: 0, allowance: 0 },
  livingItems: [item('food', 300_000, { code: 'food' }), item('later', 50_000, { from: '2026-12' }), item('phased', 30_000, { amounts: { p2: 80_000 }, note: 'n' })],
  phases: [
    { id: 'p1', label: 'P1', name: 'one', from: '2026-01', to: '2026-12', amounts: { 't-fix': 200_000, 't-inv': 1_000_000 } },
    { id: 'p2', label: 'P2', name: 'two', from: '2027-01', to: null, amounts: { 't-fix': 300_000, 't-inv': 1_200_000 } },
  ],
  targets: [
    { id: 't-live', name: 'Living', kind: 'living', accountId: 'living-acc' },
    { id: 't-sav', name: 'Savings', kind: 'saving' },
    { id: 't-inv', name: 'Investment', kind: 'invest', accountId: null },
    { id: 't-fix', name: 'Emergency', kind: 'fixed', accountId: 'emergency' },
    { id: 't-rest', name: 'Rest', kind: 'remainder' },
  ],
  accounts: [
    acc('cma', { group: 'saving', kind: 'CMA', bank: 'E2E Bank', last4: '1234', amount: 500_000, goal: 11_000_000, annualLimit: 12_000_000 }),
    acc('isa', { group: 'invest', kind: 'ISA', ratio: 0.6, annualLimit: 20_000_000 }),
    acc('irp', { group: 'invest', ratio: 0.3, from: '2027-01' }),
    acc('living-acc', { buffer: 1_000_000 }),
    acc('emergency'),
  ],
  balances: [
    { id: 'b1', accountId: 'cma', date: '2026-11-01', amount: 10_000_000, note: 'start' },
    { id: 'b2', accountId: 'living-acc', date: '2026-11-20', amount: 1_200_000 },
  ],
  cards: [
    { id: 'c1', name: 'E2E-Card', last4: '9876', accountId: 'living-acc', billingDay: 12 },
    { id: 'c2', name: 'E2E-Other', last4: '', accountId: null, billingDay: null },
  ],
  spendings: [pc],
}
const bst: AccountState = { ...bd, balances: bd.balances!, cards: bd.cards! }

test('get_budget: living items, the savings and investment menus and every target are calc.ts\'s', () => {
  for (const ym of ['2026-11', '2026-12', '2027-01']) {
    const b = budget(bd, ym)
    assert.equal(b.month, ym)
    const l = livingAt(bd.livingItems!, bd.phases, ym)
    assert.deepEqual(b.living.items.map((x) => [x.id, x.monthKrw]), l.rows.map((r) => [r.item.id, r.amount]))
    assert.equal(b.living.sumKrw, l.sum)
    for (const g of ['saving', 'invest'] as const) {
      const x = groupAt(g, bd.accounts, bd.phases, bd.targets, bd.settings, ym)
      assert.equal(b[g].mode, x.mode)
      assert.deepEqual(b[g].items.map((i) => [i.accountId, i.monthKrw]), x.rows.map((r) => [r.account.id, r.amount]))
      assert.equal(b[g].sumKrw, x.sum)
      assert.equal(b[g].totalKrw, x.total)
      assert.equal(b[g].ratioSum, x.ratioSum)
    }
    const { dist } = monthMoney(bd, ym)
    for (const t of b.targets) {
      const row = dist.rows.find((r) => r.key === t.targetId)
      assert.equal(t.amountKrw, t.kind === 'remainder' ? dist.remainder : (row?.amount ?? 0), `${ym} ${t.targetId}`)
    }
    assert.equal(b.remainderKrw, dist.remainder)
    // everything adds up to the net pay, less what one-off spendings take off the remainder
    assert.equal(b.targets.reduce((a, t) => a + t.amountKrw, 0), bd.settings.netPay - monthMoney(bd, ym).spend.remainder)
  }
  const nov = budget(bd, '2026-11')
  assert.deepEqual(nov.living.items.map((x) => x.monthKrw), [300_000, 0, 30_000])
  assert.equal(nov.living.items[2]!.note, 'n')
  assert.deepEqual(nov.living.items[2]!.phaseAmounts, [{ phaseId: 'p2', amountKrw: 80_000 }])
  assert.equal(nov.living.items[0]!.code, 'food')
  assert.equal(nov.saving.mode, 'amount')
  assert.deepEqual(nov.saving.target, { id: 't-sav', name: 'Savings', accountId: null })
  assert.deepEqual(nov.saving.items[0], {
    accountId: 'cma', name: 'E2E-cma', kind: 'CMA', bank: 'E2E Bank', last4: '1234', amountKrw: 500_000, phaseAmounts: [], ratio: null, monthKrw: 500_000,
    from: null, stopFrom: null, goalKrw: 11_000_000, annualLimitKrw: 12_000_000,
  })
  assert.equal(nov.invest.mode, 'ratio')
  assert.equal(nov.invest.totalKrw, 1_000_000)
  assert.deepEqual(nov.invest.items.map((i) => [i.accountId, i.ratio, i.monthKrw]), [['isa', 0.6, 600_000], ['irp', 0.3, 0]])
  assert.equal(nov.invest.ratioSum, 0.9)
  // 3,000,000 − living 330,000 − savings 500,000 − investment 600,000 − fixed 200,000
  assert.equal(nov.remainderKrw, 1_370_000)
  assert.deepEqual(nov.phase && nov.phase.id, 'p1')
  const jan = budget(bd, '2027-01')
  assert.equal(jan.living.sumKrw, 300_000 + 50_000 + 80_000)
  assert.deepEqual(jan.invest.items.map((i) => i.monthKrw), [720_000, 360_000])
  // the buffer refill of January comes off the remainder
  assert.equal(jan.remainderKrw, 3_000_000 - 430_000 - 500_000 - 1_080_000 - 300_000 - 200_000)
  // no living items: an empty list
  assert.deepEqual(budget(data, '2026-11').living, { items: [], sumKrw: 0 })
})

test('get_overview reads the living items and the savings and investment accounts', () => {
  const o = overview(bd, '2026-11')
  const { dist } = monthMoney(bd, '2026-11')
  assert.equal(o.distribution.livingKrw, 330_000)
  assert.deepEqual(o.distribution.rows.map((r) => [r.targetId, r.amountKrw]), dist.rows.map((r) => [r.key, r.amount]))
  assert.equal(o.distribution.remainderKrw, budget(bd, '2026-11').remainderKrw)
  // the old living row is not used when the items are there
  assert.notEqual(o.distribution.livingKrw, overview({ ...bd, livingItems: undefined }, '2026-11').distribution.livingKrw)
})

test('list_accounts: fields, balance records, projection, goal month, yearly contribution, buffer gauge, links and cards', () => {
  const now = new Date(2026, 10, 21)
  const l = accountList(bd, now, 4)
  assert.equal(l.month, '2026-11')
  assert.deepEqual(l.accounts.map((a) => a.id), ['cma', 'isa', 'irp', 'living-acc', 'emergency'])
  const cmaAcc = bd.accounts[0]!
  const cma = l.accounts[0]!
  assert.deepEqual([cma.group, cma.kind, cma.bank, cma.last4, cma.amountKrw, cma.goalKrw, cma.annualLimitKrw, cma.bufferKrw], ['saving', 'CMA', 'E2E Bank', '1234', 500_000, 11_000_000, 12_000_000, 0])
  assert.deepEqual(cma.balances, [{ id: 'b1', date: '2026-11-01', amountKrw: 10_000_000, depositKrw: null, note: 'start' }])
  assert.deepEqual(cma.lastBalance, { date: '2026-11-01', amountKrw: 10_000_000 })
  assert.deepEqual(cma.projection, projectAccount(cmaAcc, bst, none, '2026-11', 4)!.map((r) => ({ month: r.ym, inflowKrw: r.inflow, outflowKrw: r.outflow, endKrw: r.end })))
  assert.deepEqual(cma.projection!.map((r) => r.endKrw), [10_500_000, 11_000_000, 11_500_000, 12_000_000])
  assert.equal(cma.goalMonth, goalMonth(cmaAcc, bst, none))
  assert.equal(cma.goalMonth, '2026-12')
  assert.equal(cma.year.contributionKrw, yearContribution(cmaAcc, bst, none, 2026))
  // 10,000,000 put in at once (the first record) + Nov and Dec 500,000: 11,000,000 of 12,000,000 is over 90%
  assert.deepEqual(cma.year, { year: 2026, contributionKrw: 6_000_000, limitKrw: 12_000_000, leftKrw: 6_000_000, state: 'under' })
  const isa = l.accounts[1]!
  assert.equal(isa.projection, null, 'no balance record: no projection')
  assert.equal(isa.goalMonth, null)
  assert.equal(isa.year.state, 'under')
  assert.deepEqual(l.accounts[2]!.year, { year: 2026, contributionKrw: 0, limitKrw: null, leftKrw: null, state: null })
  const liv = l.accounts[3]!
  const livAcc = bd.accounts[3]!
  assert.deepEqual(liv.buffer, { bufferKrw: 1_000_000, usedKrw: 400_000, leftKrw: 600_000 })
  assert.deepEqual(liv.buffer, (({ buffer, used, left }) => ({ bufferKrw: buffer, usedKrw: used, leftKrw: left }))(bufferGauge(livAcc, bst, '2026-11-21')))
  assert.deepEqual(liv.targets, [{ id: 't-live', name: 'Living', kind: 'living' }])
  assert.deepEqual(liv.cards, [{ id: 'c1', name: 'E2E-Card', last4: '9876', effectiveBillingDay: 12 }])
  // Nov: living 330,000 in on the 26th; Dec: the card bill out on the 12th, the living transfer and the refill in
  assert.deepEqual(liv.projection!.slice(0, 2).map((r) => [r.month, r.inflowKrw, r.outflowKrw, r.endKrw]), [
    ['2026-11', 330_000, 0, 1_530_000],
    ['2026-12', 380_000 + 200_000, 400_000, 1_710_000],
  ])
  assert.deepEqual(liv.projection, projectAccount(livAcc, bst, none, '2026-11', 4)!.map((r) => ({ month: r.ym, inflowKrw: r.inflow, outflowKrw: r.outflow, endKrw: r.end })))
  assert.deepEqual(l.accounts[4]!.targets, [{ id: 't-fix', name: 'Emergency', kind: 'fixed' }])
  assert.deepEqual(l.cards, [
    { id: 'c1', name: 'E2E-Card', last4: '9876', accountId: 'living-acc', account: 'E2E-living-acc', billingDay: 12, effectiveBillingDay: 12 },
    { id: 'c2', name: 'E2E-Other', last4: '', accountId: null, account: null, billingDay: null, effectiveBillingDay: 14 },
  ])
  // the default is twelve months from this month
  assert.equal(accountList(bd, now).accounts[0]!.projection!.length, 12)
  // no balance records or cards in the data: every account without a projection, no cards
  const bare = accountList(data, now)
  assert.deepEqual(bare.cards, [])
  assert.equal(bare.accounts[0]!.projection, null)
  assert.equal(bare.accounts[0]!.name, 'Main')
})

test('get_allocation: the new target kinds with their account, and each account\'s group', () => {
  const a = allocation(bd)
  assert.deepEqual(a.targets.map((t) => [t.kind, t.accountId]), [['living', 'living-acc'], ['saving', null], ['invest', null], ['fixed', 'emergency'], ['remainder', null]])
  assert.deepEqual(a.accounts.map((x) => x.group), ['saving', 'invest', 'invest', null, null])
  // the fields it had stay
  assert.deepEqual(Object.keys(allocation(data).accounts[0]!), ['id', 'name', 'role', 'inflow', 'outflow', 'group'])
})

// ── spec 013 rev 1: month adjustments, maturity, events across years, search, notifications (S-14, S-15, S-18..S-20) ──
test('get_overview and get_budget: the month adjustments, worked out by calc.ts, and only in their month', () => {
  const ad: Data = {
    ...bd,
    monthAdjusts: [
      { id: 'm1', ym: '2026-11', targetId: 't-fix', amount: 50_000, reason: 'E2E once' },
      { id: 'm2', ym: '2026-11', targetId: 't-sav', amount: 300_000 },
      { id: 'm3', ym: '2026-11', targetId: 't-inv', amount: 500_000 },
    ],
  }
  const o = overview(ad, '2026-11')
  const { dist } = monthMoney(ad, '2026-11')
  assert.deepEqual(o.distribution.rows.map((r) => [r.targetId, r.amountKrw]), dist.rows.map((r) => [r.key, r.amount]))
  assert.equal(o.distribution.rows.find((r) => r.targetId === 't-fix')!.amountKrw, 50_000)
  assert.equal(o.distribution.rows.find((r) => r.targetId === 't-sav')!.amountKrw, 300_000)
  // a ratio split's adjustment is the month's total: the items share 500,000 (60% and the IRP not yet)
  assert.equal(o.distribution.rows.find((r) => r.targetId === 't-inv')!.amountKrw, 300_000)
  assert.deepEqual(o.monthAdjusts, [
    { id: 'm1', month: '2026-11', targetId: 't-fix', target: 'Emergency', kind: 'fixed', amountKrw: 50_000, plannedKrw: 200_000, reason: 'E2E once' },
    { id: 'm2', month: '2026-11', targetId: 't-sav', target: 'Savings', kind: 'saving', amountKrw: 300_000, plannedKrw: 500_000 },
    { id: 'm3', month: '2026-11', targetId: 't-inv', target: 'Investment', kind: 'invest', amountKrw: 500_000, plannedKrw: 1_000_000 },
  ])
  // 3,000,000 − living 330,000 − savings 300,000 − investment 300,000 − fixed 50,000
  assert.equal(o.distribution.remainderKrw, 2_020_000)
  const b = budget(ad, '2026-11')
  assert.equal(b.remainderKrw, 2_020_000)
  assert.deepEqual(b.monthAdjusts, o.monthAdjusts)
  const inv = groupAt('invest', ad.accounts, ad.phases, ad.targets, ad.settings, '2026-11', ad.monthAdjusts)
  assert.equal(b.invest.totalKrw, 500_000)
  assert.deepEqual(b.invest.items.map((i) => i.monthKrw), inv.rows.map((r) => r.amount))
  assert.equal(b.invest.targetKrw, inv.sum)
  assert.deepEqual(b.invest.adjustment, { id: 'm3', amountKrw: 500_000 })
  const sav = groupAt('saving', ad.accounts, ad.phases, ad.targets, ad.settings, '2026-11', ad.monthAdjusts)
  // an amount split spreads the adjustment over its items by their amounts (review rc2-1 F-2): the one item gets it all
  assert.equal(b.saving.sumKrw, 300_000)
  assert.deepEqual(b.saving.items.map((i) => i.monthKrw), sav.rows.map((r) => r.amount))
  assert.deepEqual(b.saving.items.map((i) => [i.amountKrw, i.monthKrw]), [[500_000, 300_000]])
  assert.equal(b.saving.targetKrw, groupValue(sav, ad.monthAdjusts![1]))
  assert.equal(b.saving.targetKrw, 300_000)
  assert.equal(b.targets.find((t) => t.targetId === 't-sav')!.amountKrw, 300_000)
  // the next month is as planned
  const dec = budget(ad, '2026-12')
  assert.deepEqual(dec.monthAdjusts, [])
  assert.equal(dec.saving.adjustment, null)
  assert.equal(dec.remainderKrw, budget(bd, '2026-12').remainderKrw)
  assert.deepEqual(overview(ad, '2026-12').distribution, overview(bd, '2026-12').distribution)
})

test('maturity: the term forms, and the savings schedule with its expected amount', () => {
  assert.deepEqual(maturityOf({ term: '12개월', from: '2026-03' }), { month: '2027-03', months: 12 })
  assert.deepEqual(maturityOf({ term: ' 6 months ', from: '2026-11' }), { month: '2027-05', months: 6 })
  assert.deepEqual(maturityOf({ term: '1 Month', from: '2026-11' }), { month: '2026-12', months: 1 })
  assert.deepEqual(maturityOf({ term: '2027-06까지', from: '2026-12' }), { month: '2027-06', months: 6 })
  assert.equal(maturityOf({ term: '12개월', from: null }), null, 'no from month: no maturity')
  assert.equal(maturityOf({ term: '자유', from: '2026-01' }), null)
  assert.equal(maturityOf({ term: '0개월', from: '2026-01' }), null)
  assert.equal(maturityOf({ term: '', from: '2026-01' }), null)
  const md: Data = {
    ...bd,
    accounts: [
      acc('cma', { ...bd.accounts[0]!, term: '3개월', from: '2026-10', afterMaturity: 'E2E to living' }),
      acc('dep', { group: 'saving', amount: 100_000, term: '2027-04까지', from: '2026-10' }),
      acc('free', { group: 'saving', amount: 100_000, term: 'open' }),
      acc('isa', { group: 'invest', ratio: 0.6, term: '12개월', from: '2026-01' }),
    ],
  }
  const m = maturitySchedule(md, '2027-01')
  assert.deepEqual(m.map((x) => [x.accountId, x.maturityMonth, x.months, x.basis, x.state]), [['cma', '2027-01', 3, 'projection', 'due'], ['dep', '2027-04', 6, 'amount', 'upcoming']])
  // the CMA has a balance record: the screens' rule (calc maturityAmount) — the projected balance at the end of the month
  // before maturity, so the transfer of the maturity month is not counted (10,000,000 on Nov 1, 500,000 a month in: Nov, Dec)
  const st: AccountState = { ...md, balances: md.balances!, cards: md.cards! }
  assert.equal(m[0]!.expectedKrw, projectAccount(md.accounts[0]!, st, none, '2026-12', 1)!.find((r) => r.ym === '2026-12')!.end)
  assert.equal(m[0]!.expectedKrw, 11_000_000)
  assert.equal(m[0]!.afterMaturity, 'E2E to living')
  assert.equal(m[1]!.expectedKrw, 600_000, 'no record: the monthly amount × the months')
  assert.equal(maturitySchedule(md, '2027-02')[0]!.state, 'past')
  assert.deepEqual(budget(md, '2027-01').maturity, m)
  const l = accountList(md, new Date(2026, 10, 21))
  assert.deepEqual(l.accounts.map((a) => a.maturityMonth), ['2027-01', '2027-04', null, '2027-01'])
  assert.equal(l.accounts[0]!.afterMaturity, 'E2E to living')
})

test('get_schedule: an event into a later year is in every month of its range, the old forms as before', () => {
  assert.deepEqual(eventMonths('2026-11'), { from: '2026-11', to: '2026-11' })
  assert.deepEqual(eventMonths('2026-11~12'), { from: '2026-11', to: '2026-12' })
  assert.deepEqual(eventMonths('2026-11~2027-02'), { from: '2026-11', to: '2027-02' })
  // a reversed range is its start month only, as the screens show it
  assert.deepEqual(eventMonths('2026-11~09'), { from: '2026-11', to: '2026-11' })
  assert.deepEqual(eventMonths('2027-03~2026-12'), { from: '2027-03', to: '2027-03' })
  const ev: Data = { ...data, events: [...data.events, { id: 'e3', when: '2026-12~2027-02', kind: '세금', title: 'E2E-Across', state: 'todo' }] }
  const s = schedule(ev, '2026-11', 5)
  assert.deepEqual(s.months.map((m) => m.planEvents.map((e) => e.id).sort()), [['e2'], ['e1', 'e2', 'e3'], ['e3'], ['e3'], []])
  const back = schedule({ ...data, events: [{ id: 'r1', when: '2027-01~2026-12', kind: '세금', title: 'E2E-Back', state: 'todo' }] }, '2026-11', 4)
  assert.deepEqual(back.months.map((m) => m.planEvents.map((e) => e.id)), [[], [], ['r1'], []])
  assert.deepEqual(s.months[2]!.planEvents[0], { id: 'e3', when: '2026-12~2027-02', from: '2026-12', to: '2027-02', kind: '세금', title: 'E2E-Across', state: 'todo' })
  // the old forms answer as before (with their months)
  assert.deepEqual(schedule(data, '2026-11', 3).months.map((m) => m.planEvents.map((e) => e.id).sort()), [['e2'], ['e1', 'e2'], []])
})

test('search: the same matching as the header search, with each row\'s page', () => {
  const sd: Data = { ...bd, subscriptions: [sub({ id: 's1', name: 'E2E Insurance', note: 'family' })], events: data.events, checks: data.checks }
  const r = searchView(sd, 'e2e-c')
  const want = search({ ...sd, spendings: sd.spendings!, livingItems: sd.livingItems!, cards: sd.cards! }, 'e2e-c')
  assert.deepEqual(r.results.map((x) => [x.kind, x.id, x.matched, x.page]), want.map((h) => [h.kind, h.id, h.field, h.path]))
  assert.deepEqual(r.results.map((x) => [x.kind, x.id]), [['account', 'cma'], ['card', 'c1']])
  assert.equal(r.count, 2)
  assert.deepEqual(searchView(sd, 'FAMILY').results, [{ kind: 'subscription', id: 's1', name: 'E2E Insurance', note: 'family', matched: 'note', page: '/spend/subs' }])
  assert.deepEqual(searchView(sd, 'e2e-c', ['card']).results.map((x) => x.id), ['c1'])
  assert.deepEqual(searchView(sd, '  ').results, [])
})

test('list_notifications: the bell\'s list with a sentence each, goal cards and proposals from the caller', () => {
  const now = new Date(2026, 11, 22) // 2026-12-22: the buffer refill of Dec 25 is in three days
  const nd: Data = {
    ...bd,
    accounts: bd.accounts.map((a) => (a.id === 'cma' ? { ...a, annualLimit: 6_500_000 } : a)),
    subscriptions: [sub({ id: 's1', name: 'E2E Sub', nextDate: '2026-12-24' })],
  }
  const l = notificationList(nd, now, 2)
  assert.equal(l.date, '2026-12-22')
  const st: AccountState = { ...nd, balances: nd.balances!, cards: nd.cards! }
  const goals = goalAlerts(st, '2026-12-22', none)
  const want = buildNotices(st, '2026-12-22', none, { proposals: 2, goalAccounts: goals.map((g) => g.account.id) })
  assert.deepEqual(l.notifications.map((n) => n.id), want.map((n) => n.id))
  assert.deepEqual(l.notifications.map((n) => n.kind), ['proposals', 'goals', 'charge', 'round', 'yearLimit'])
  assert.deepEqual((l.notifications[1] as { accounts?: unknown }).accounts, goals.map((g) => ({ accountId: g.account.id, name: g.account.name, goalMonth: g.month, stopFrom: g.stopFrom })))
  assert.ok(l.notifications.every((n) => n.message.length > 0))
  assert.match(l.notifications[2]!.message, /E2E Sub is charged 10,000 KRW on 2026-12-24 \(in 2 days\)/)
  assert.match(l.notifications[3]!.message, /^Round 1\/2 of E2E-PC: 200,000 KRW on 2026-12-25/)
  // nothing waits: no pending notices
  assert.deepEqual(notificationList({ ...nd, accounts: nd.accounts.map((a) => ({ ...a, goal: null })) }, now, 0).notifications.filter((n) => n.group === 'pending'), [])
  // a Savings item due this month that still sends is a maturity card, stopped from the next transfer (Dec 26; review rc2-1 F-5);
  // a stopped one is not
  const due: Data = { ...nd, accounts: [...nd.accounts.map((a) => ({ ...a, goal: null })), acc('dep', { group: 'saving', amount: 100_000, term: '12개월', from: '2025-12' })] }
  const md = notificationList(due, now, 0).notifications.filter((n) => n.group === 'pending')
  assert.deepEqual(md.map((n) => [n.kind, n.id]), [['maturities', 'maturities:dep@2026-12']])
  assert.deepEqual((md[0] as { accounts?: unknown }).accounts, [{ accountId: 'dep', name: 'E2E-dep', maturityMonth: '2026-12', stopFrom: '2026-12' }])
  assert.match(md[0]!.message, /1 savings item\(s\) reached maturity/)
  const stopped: Data = { ...due, accounts: due.accounts.map((a) => (a.id === 'dep' ? { ...a, stopFrom: '2027-01' } : a)) }
  assert.deepEqual(notificationList(stopped, now, 0).notifications.filter((n) => n.group === 'pending'), [])
})

// ── spec 016 S-4: the account's marks — read flags as the bell shows them, and a maturity answered "keep sending" left out ──
test('list_notifications: read comes from the account marks; a kept maturity is not listed', () => {
  const now = new Date(2026, 11, 22)
  const nd: Data = { ...bd, subscriptions: [sub({ id: 's1', name: 'E2E Sub', nextDate: '2026-12-24' })] }
  const due: Data = { ...nd, accounts: [...nd.accounts.map((a) => ({ ...a, goal: null })), acc('dep', { group: 'saving', amount: 100_000, term: '12개월', from: '2025-12' })] }
  const plain = notificationList(due, now, 0)
  assert.ok(plain.notifications.every((n) => n.read === false), 'no marks: nothing read')
  const charge = plain.notifications.find((n) => n.kind === 'charge')!
  const marked = notificationList(due, now, 0, { read: [charge.id, 'gone:1'], maturityKept: [] })
  assert.deepEqual(marked.notifications.filter((n) => n.read).map((n) => n.id), [charge.id])
  assert.ok(marked.notifications.some((n) => n.kind === 'maturities'))
  const kept = notificationList(due, now, 0, { read: [], maturityKept: ['dep@2026-12'] })
  assert.deepEqual(kept.notifications.filter((n) => n.kind === 'maturities'), [], 'the kept maturity is left out, as in the app')
  assert.deepEqual(kept.notifications.filter((n) => n.kind !== 'maturities').map((n) => n.id), plain.notifications.filter((n) => n.kind !== 'maturities').map((n) => n.id))
})

// ── spec 013 S-23: the currencies in the overview, and items in a listed code ──
test('overview lists USD from the settings and the currency list; a subscription in a listed code is priced by its rate', () => {
  const eur = { id: 'fc1', code: 'EUR', rate: 1500, buffer: 2, auto: true, autoAt: '2026-11-23T00:00:00.000Z', autoError: null }
  const d: Data = { ...data, settings: { ...data.settings, fxAuto: false }, currencies: [eur], subscriptions: [...data.subscriptions, sub({ id: 's5', name: 'Sub Five', amount: 10, currency: 'EUR' })] }
  const o = overview(d, '2026-11')
  assert.deepEqual(o.currencies, [
    { code: 'USD', rate: 1400, buffer: 5, auto: false, autoAt: null, autoError: null },
    { id: 'fc1', code: 'EUR', rate: 1500, buffer: 2, auto: true, autoAt: '2026-11-23T00:00:00.000Z', autoError: null },
  ])
  const five = subscriptionList(d, NOW).subscriptions.find((x) => x.id === 's5')!
  assert.equal(five.currency, 'EUR')
  assert.equal(five.chargeKrw, 15_000)
  const x = transferAt(d.subscriptions, d.planChanges, priced(d.settings, d.currencies), '2026-11')
  assert.equal(o.subscriptionTransfer.foreignAsMonthlyKrw, Math.round(x.foreignMonthly))
  assert.equal(o.subscriptionTransfer.fxBufferKrw, Math.round(x.buffer))
  assert.equal(overview(data, '2026-11').currencies.length, 1)
})

// ── spec 014 S-10: get_income and the income in the overview ──
const withIncome: Data = {
  ...data,
  incomes: [
    { id: 'in-side', name: 'E2E-side', cycle: 'monthly', month: null, day: 10, amount: 200_000, accountId: 'a1' },
    { id: 'in-bonus', name: 'E2E-bonus', cycle: 'yearly', month: 3, day: 15, amount: 1_000_000, accountId: null, note: 'once a year' },
  ],
  // two receipts for the salary in one month add up
  incomeReceipts: [
    { id: 'rc1', itemId: null, ym: '2026-11', amount: 3_000_000, date: '2026-11-25' },
    { id: 'rc2', itemId: null, ym: '2026-11', amount: 100_000, date: null, note: 'late part' },
    { id: 'rc3', itemId: 'in-side', ym: '2026-10', amount: 150_000 },
  ],
  incomeExtras: [{ id: 'x1', date: '2026-11-03', name: 'E2E-refund', amount: 50_000 }],
}

test('get_income: the salary with its receipts, a monthly and a yearly income, the extra, totals and the left over', () => {
  const g = incomeView(withIncome, '2026-11')
  assert.equal(g.month, '2026-11')
  assert.deepEqual(g.incomes.map((r) => [r.incomeId, r.name, r.salary, r.expectedKrw, r.receivedKrw, r.countedKrw, r.diffKrw]), [
    [null, 'salary', true, 3_000_000, 3_100_000, 3_100_000, 100_000],
    ['in-side', 'E2E-side', false, 200_000, null, 200_000, 0],
  ])
  const salary = g.incomes[0]!
  assert.equal(salary.day, 25)
  assert.deepEqual(salary.receipts, [{ id: 'rc1', amountKrw: 3_000_000, date: '2026-11-25' }, { id: 'rc2', amountKrw: 100_000, date: null, note: 'late part' }])
  assert.deepEqual(g.incomes[1]!.receipts, []) // October's receipt is October's
  assert.equal(g.incomes[1]!.accountId, 'a1')
  assert.deepEqual(g.extras, [{ id: 'x1', date: '2026-11-03', name: 'E2E-refund', amountKrw: 50_000 }])
  assert.equal(g.extrasKrw, 50_000)
  assert.equal(g.expectedKrw, 3_200_000)
  assert.equal(g.totalKrw, 3_350_000)
  assert.equal(g.diffKrw, 150_000)
  assert.equal(g.allReceived, false)
  // the left over is monthMoney's remainder: what comes in above the net pay adds to it
  assert.equal(g.leftOverKrw, Math.round(monthMoney(withIncome, '2026-11').dist.remainder))
  assert.equal(g.leftOverKrw - Math.round(monthMoney(data, '2026-11').dist.remainder), 350_000)
  assert.deepEqual(g.later, [{ incomeId: 'in-bonus', name: 'E2E-bonus', amountKrw: 1_000_000, month: '2027-03' }])
  // the yearly income in its month: expected, nothing received yet
  const march = incomeView(withIncome, '2027-03')
  const bonus = march.incomes.find((r) => r.incomeId === 'in-bonus')!
  assert.deepEqual([bonus.cycle, bonus.yearlyMonth, bonus.expectedKrw, bonus.receivedKrw, bonus.countedKrw, bonus.note], ['yearly', 3, 1_000_000, null, 1_000_000, 'once a year'])
  assert.equal(march.totalKrw, 4_200_000)
  assert.deepEqual(march.later, [])
  // no income data: the salary alone, as before
  const plain = incomeView(data, '2026-11')
  assert.deepEqual(plain.incomes.map((r) => [r.name, r.expectedKrw, r.receivedKrw]), [['salary', 3_000_000, null]])
  assert.deepEqual([plain.totalKrw, plain.diffKrw, plain.extras.length, plain.later.length], [3_000_000, 0, 0, 0])
})

test('get_overview: the income of the month and its left over', () => {
  const o = overview(withIncome, '2026-11')
  assert.deepEqual(o.income, { expectedKrw: 3_200_000, totalKrw: 3_350_000, diffKrw: 150_000 })
  assert.equal(o.leftOverKrw, o.distribution.remainderKrw)
  assert.equal(o.leftOverKrw, incomeView(withIncome, '2026-11').leftOverKrw)
  const before = overview(data, '2026-11')
  assert.deepEqual(before.income, { expectedKrw: 3_000_000, totalKrw: 3_000_000, diffKrw: 0 })
  assert.equal(before.leftOverKrw, before.distribution.remainderKrw)
})
