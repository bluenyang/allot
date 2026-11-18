// spec 008 V-6: what the MCP tools say is what calc.ts says for the same data (synthetic data).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distributionAt, monthDates, monthlyKrw, nextPayment, parseDate, planAt, transferAt, upcomingPayments, ymd } from '../../src/lib/calc'
import type { Subscription } from '../../src/data/types'
import { allocation, overview, planChangeList, schedule, subscriptionList, type Data } from '../../server/mcp/views'

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
    const x = transferAt(data.subscriptions, data.planChanges, data.settings, ym)
    assert.equal(o.subscriptionTransfer.transferKrw, x.transfer)
    assert.equal(o.subscriptionTransfer.neededKrw, x.needed)
    assert.equal(o.subscriptionTransfer.monthlyKrw, Math.round(x.monthlySum))
    const dist = distributionAt(ym, data.settings.netPay, data.phases, data.targets, data.living, data.subscriptions, data.planChanges, data.settings)
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
  const calc = upcomingPayments(data.subscriptions, data.planChanges, data.settings, parseDate('2026-11-01'), 29).filter((p) => ymd(p.date).startsWith('2026-11'))
  assert.deepEqual(o.payments.map((p) => [p.date, p.subscriptionId, p.amountKrw]), calc.map((p) => [ymd(p.date), p.sub.id, Math.round(p.krw)]))
  assert.ok(o.payments.length >= 2)
  assert.ok(o.payments.every((p) => p.date.startsWith('2026-11')))
})

test('subscription list: plan at this month, monthly KRW, next payment, status filter', () => {
  const now = parseDate('2026-11-16')
  const all = subscriptionList(data, now)
  assert.equal(all.subscriptions.length, 4)
  const s2 = all.subscriptions.find((s) => s.id === 's2')!
  assert.equal(s2.monthlyKrw, Math.round(monthlyKrw(planAt(data.subscriptions[1]!, data.planChanges, '2026-11'), data.settings)))
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
  assert.equal(ymd(upcomingPayments(d.subscriptions, d.planChanges, d.settings, now, 400)[1]!.date), '2027-11-20')
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
