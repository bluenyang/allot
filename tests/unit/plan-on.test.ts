// spec 018 S-7 (W-6, V-4): every charge uses the plan in force on its own date, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { PlanChange, Priced, Subscription } from '../../src/data/types'
import { chargeKrw, paysAfter31, planAt, planOn, transferAt, upcomingPayments, ymd } from '../../src/lib/calc'

const settings: Priced = { ...DEFAULT_SETTINGS, netPay: 3_000_000, transferDay: 26, subRound: 10_000, fxRate: 1_400, fxBuffer: 0, currencies: [] }
const sub = (over: Partial<Subscription> & { id: string }): Subscription => ({
  name: over.id, category: 'tool', plan: 'Basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '2026-11-27', path: 'direct', verified: false, ...over,
} as Subscription)
const change = (subId: string, effective: string | null, to: PlanChange['to'], id = `c-${subId}-${effective}`): PlanChange => ({ id, subId, effective, to, note: '' })
// amounts are whole KRW on every screen: a foreign-currency charge is rounded as the readers round it
const rows = (list: { date: Date; sub: Subscription; krw: number }[]) => list.map((p) => [ymd(p.date), p.sub.plan, Math.round(p.krw)])

test('planOn: the changes dated that day or earlier, in order; an undated change and another subscription\'s are left out', () => {
  const s = sub({ id: 'a' })
  const changes = [
    change('a', '2026-12-15', { plan: 'Max', amount: 50_000 }),
    change('a', '2026-11-28', { plan: 'Pro', amount: 30_000 }),
    change('a', null, { status: 'cancelled' }),
    change('b', '2026-11-01', { plan: 'Other', amount: 1 }),
  ]
  const at = (date: string) => { const p = planOn(s, changes, date); return [p.plan, p.amount, p.status] }
  assert.deepEqual(at('2026-11-27'), ['Basic', 10_000, 'active'], 'the day before the change')
  assert.deepEqual(at('2026-11-28'), ['Pro', 30_000, 'active'], 'the effective date itself counts')
  assert.deepEqual(at('2026-12-14'), ['Pro', 30_000, 'active'])
  assert.deepEqual(at('2026-12-15'), ['Max', 50_000, 'active'])
  assert.deepEqual(at('2031-01-01'), ['Max', 50_000, 'active'], 'the undated change never comes in')
  // the stored subscription is not changed
  assert.equal(s.plan, 'Basic')
  // a change of one field keeps the others of the plan before it
  assert.deepEqual(planOn(s, [change('a', '2026-11-01', { amount: 12_000 })], '2026-11-01').plan, 'Basic')
})

test('a charge is priced with the plan on its date: effective before, on and after the charge date in the same month', () => {
  // a foreign-currency plan with VAT (100 × 1.1 × 1,400 = 154,000) changes to a KRW plan of 200,000; charged on the 27th
  const s = sub({ id: 'x', plan: 'Small', amount: 100, currency: 'USD', vat: 10 })
  const to = { plan: 'Big', amount: 200_000, currency: 'KRW' as const, vat: 0 }
  const november = (effective: string) => rows(upcomingPayments([s], [change('x', effective, to)], settings, new Date(2026, 10, 1), 29))
  assert.deepEqual(november('2026-11-26'), [['2026-11-27', 'Big', 200_000]], 'the day before the charge: the new plan')
  assert.deepEqual(november('2026-11-27'), [['2026-11-27', 'Big', 200_000]], 'the charge date itself: the new plan')
  assert.deepEqual(november('2026-11-28'), [['2026-11-27', 'Small', 154_000]], 'the day after the charge: that charge is still the old plan')
  assert.deepEqual(november('2026-11-30'), [['2026-11-27', 'Small', 154_000]])
  // the next charge is the new plan in every case
  const two = rows(upcomingPayments([s], [change('x', '2026-11-28', to)], settings, new Date(2026, 10, 1), 60))
  assert.deepEqual(two, [['2026-11-27', 'Small', 154_000], ['2026-12-27', 'Big', 200_000]])
})

test('the monthly sums stay by month: a change dated after the month\'s charge still counts for that whole month', () => {
  const s = sub({ id: 'm', plan: 'Small', amount: 10_000 })
  const changes = [change('m', '2026-11-28', { plan: 'Big', amount: 25_000 })]
  // the plan of the month and the transfer: November already has the new plan (as before W-6)
  assert.equal(planAt(s, changes, '2026-11').plan, 'Big')
  assert.equal(planAt(s, changes, '2026-10').plan, 'Small')
  assert.equal(transferAt([s], changes, settings, '2026-11').monthlySum, 25_000)
  assert.equal(transferAt([s], changes, settings, '2026-10').monthlySum, 10_000)
  // the charge of 11/27 itself is the old plan's
  assert.deepEqual(rows(upcomingPayments([s], changes, settings, new Date(2026, 10, 1), 29)), [['2026-11-27', 'Small', 10_000]])
})

test('paysAfter31: "now" is the plan in force today, and each later charge has the plan of its date', () => {
  const from = new Date(2026, 10, 18)
  // charged on the 10th; the new plan comes in on Jan 20, after January's charge: the first charge with it is Feb 10
  const late = sub({ id: 'late', nextDate: '2026-11-10' })
  const lateChange = change('late', '2027-01-20', { plan: 'Pro', amount: 30_000 })
  const a = paysAfter31([late], [lateChange], settings, from)
  assert.deepEqual(a.map((r) => [ymd(r.date), r.sub.plan, r.krw, r.reason]), [['2027-02-10', 'Pro', 30_000, 'plan']])
  // on the charge date: that charge is the first with the new plan
  const b = paysAfter31([late], [change('late', '2027-01-10', { plan: 'Pro', amount: 30_000 })], settings, from)
  assert.deepEqual(b.map((r) => [ymd(r.date), r.krw]), [['2027-01-10', 30_000]])
  // a change dated later this month than today is not what it pays now: the first charge after the 31 days shows as a new plan
  const soon = sub({ id: 'soon', nextDate: '2026-11-28' })
  const soonChange = change('soon', '2026-11-25', { plan: 'Pro', amount: 30_000 })
  assert.equal(chargeKrw(planOn(soon, [soonChange], ymd(from)), settings), 10_000)
  const c = paysAfter31([soon], [soonChange], settings, from)
  assert.deepEqual(c.map((r) => [ymd(r.date), r.sub.plan, r.krw, r.reason]), [['2026-12-28', 'Pro', 30_000, 'plan']])
  // a change that came in before today: the charges after the 31 days are what it pays now, so nothing is listed
  assert.equal(paysAfter31([soon], [change('soon', '2026-11-18', { plan: 'Pro', amount: 30_000 })], settings, from).length, 0)
})
