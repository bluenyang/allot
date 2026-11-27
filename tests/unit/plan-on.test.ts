// spec 018 S-7 (W-6, V-4): every charge uses the plan in force on its own date, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { PlanChange, Priced, Subscription } from '../../src/data/types'
import { chargeKrw, nextPayment, paymentDates, paysAfter31, planAt, planOn, transferAt, upcomingPayments, ymd } from '../../src/lib/calc'

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

// ---------- the schedule: segments cut at the effective dates ----------
const days = (list: Date[]) => list.map(ymd)
const D = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
const dates = (s: Subscription, changes: PlanChange[], from: string, to: string) => days(paymentDates(s, changes, D(from), D(to)))
/** The dates `nextPayment` walks through from `from`, up to `to`: they must be the dates of `paymentDates`. */
function walk(s: Subscription, changes: PlanChange[], from: string, to: string): string[] {
  const out: string[] = []
  let at = D(from)
  for (let k = 0; k < 400; k++) {
    const d = nextPayment(s, changes, at)
    if (!d || ymd(d) > to) break
    out.push(ymd(d))
    at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
  return out
}

test('a cancellation: the billing dates from its effective date on are gone, the earlier ones stay', () => {
  const s = sub({ id: 'k' }) // charged on the 27th
  const gone = (effective: string) => [change('k', effective, { status: 'cancelled' })]
  // after the month's charge: the charge of 11/27 stays
  assert.deepEqual(dates(s, gone('2026-11-30'), '2026-11-01', '2027-02-28'), ['2026-11-27'])
  assert.deepEqual(dates(s, gone('2026-11-28'), '2026-11-01', '2027-02-28'), ['2026-11-27'])
  // on the charge date and before it: that charge is gone
  assert.deepEqual(dates(s, gone('2026-11-27'), '2026-11-01', '2027-02-28'), [])
  assert.deepEqual(dates(s, gone('2026-11-10'), '2026-11-01', '2027-02-28'), [])
  // the month before is charged either way
  assert.deepEqual(dates(s, gone('2026-11-10'), '2026-10-01', '2027-02-28'), ['2026-10-27'])
  // the amount of the charge that stays is the plan's of that day, and the row is the active plan
  const p = upcomingPayments([s], gone('2026-11-30'), settings, D('2026-11-01'), 120)
  assert.deepEqual(p.map((x) => [ymd(x.date), x.krw, x.sub.status]), [['2026-11-27', 10_000, 'active']])
  // nextPayment: the charge before the cancellation is still the next one; after it there is none
  assert.equal(ymd(nextPayment(s, gone('2026-11-30'), D('2026-11-20'))!), '2026-11-27')
  assert.equal(nextPayment(s, gone('2026-11-30'), D('2026-11-28')), null)
  assert.equal(nextPayment(s, gone('2026-11-27'), D('2026-11-20')), null)
})

test('a plan that comes back is charged from its effective date on', () => {
  const s = sub({ id: 'r' }) // charged on the 27th
  const changes = (back: string) => [change('r', '2026-11-10', { status: 'cancelled' }), change('r', back, { status: 'active' })]
  // back before the month's billing date, and on it: that date is charged
  assert.deepEqual(dates(s, changes('2027-01-15'), '2026-10-01', '2027-03-31'), ['2026-10-27', '2027-01-27', '2027-02-27', '2027-03-27'])
  assert.deepEqual(dates(s, changes('2027-01-27'), '2026-10-01', '2027-03-31'), ['2026-10-27', '2027-01-27', '2027-02-27', '2027-03-27'])
  // back after it: the first charge is the next month's
  assert.deepEqual(dates(s, changes('2027-01-28'), '2026-10-01', '2027-03-31'), ['2026-10-27', '2027-02-27', '2027-03-27'])
  assert.equal(ymd(nextPayment(s, changes('2027-01-28'), D('2026-11-01'))!), '2027-02-27')
  assert.equal(ymd(nextPayment(s, changes('2027-01-27'), D('2026-11-01'))!), '2027-01-27')
  // a subscription stored as cancelled that comes back mid-month, with a new amount from that day
  const off = sub({ id: 'off', status: 'cancelled', nextDate: '2026-11-05' })
  const on = [change('off', '2026-12-06', { status: 'active', amount: 7_000 })]
  assert.deepEqual(rows(upcomingPayments([off], on, settings, D('2026-11-01'), 90)), [['2027-01-05', 'Basic', 7_000]])
})

test('monthly → yearly in mid-month: the first billing date on or after the effective date is the first yearly charge, and its month the yearly month', () => {
  const s = sub({ id: 'my', nextDate: '2026-10-10' }) // monthly, charged on the 10th
  const yearly = (effective: string) => [change('my', effective, { cycle: 'yearly', plan: 'Year', amount: 100_000 })]
  const list = (effective: string) => rows(upcomingPayments([s], yearly(effective), settings, D('2026-10-01'), 800))
  // dated after November's charge: 11/10 is still a monthly charge, 12/10 the first yearly one, then every December
  assert.deepEqual(list('2026-11-20'), [
    ['2026-10-10', 'Basic', 10_000], ['2026-11-10', 'Basic', 10_000], ['2026-12-10', 'Year', 100_000], ['2027-12-10', 'Year', 100_000],
  ])
  // dated on November's charge, and before it: 11/10 is the first yearly charge, then every November
  for (const effective of ['2026-11-10', '2026-11-03']) {
    assert.deepEqual(list(effective), [['2026-10-10', 'Basic', 10_000], ['2026-11-10', 'Year', 100_000], ['2027-11-10', 'Year', 100_000], ['2028-11-10', 'Year', 100_000]], effective)
  }
  // across the year's end: dated Dec 20, the first yearly charge is Jan 10
  assert.deepEqual(dates(s, yearly('2026-12-20'), '2026-11-01', '2028-12-31'), ['2026-11-10', '2026-12-10', '2027-01-10', '2028-01-10'])
  assert.deepEqual(walk(s, yearly('2026-11-20'), '2026-10-01', '2028-12-31'), dates(s, yearly('2026-11-20'), '2026-10-01', '2028-12-31'))
})

test('yearly → monthly in mid-month: monthly charges from the first billing date on or after the effective date', () => {
  const s = sub({ id: 'ym', cycle: 'yearly', plan: 'Year', amount: 120_000, nextDate: '2027-06-15' })
  const monthly = (effective: string) => [change('ym', effective, { cycle: 'monthly', plan: 'Month', amount: 12_000 })]
  const list = (effective: string) => rows(upcomingPayments([s], monthly(effective), settings, D('2027-06-01'), 100))
  // dated after the yearly charge of 6/15: that charge is the yearly one, monthly from 7/15
  assert.deepEqual(list('2027-06-20'), [['2027-06-15', 'Year', 120_000], ['2027-07-15', 'Month', 12_000], ['2027-08-15', 'Month', 12_000]])
  // dated on it or before it: 6/15 is already a monthly charge
  assert.deepEqual(list('2027-06-15'), [['2027-06-15', 'Month', 12_000], ['2027-07-15', 'Month', 12_000], ['2027-08-15', 'Month', 12_000]])
  assert.deepEqual(list('2027-06-02'), [['2027-06-15', 'Month', 12_000], ['2027-07-15', 'Month', 12_000], ['2027-08-15', 'Month', 12_000]])
  // dated in a month without a yearly charge, after that month's billing day: monthly from the next month
  assert.deepEqual(dates(s, monthly('2026-12-20'), '2026-11-01', '2027-03-31'), ['2027-01-15', '2027-02-15', '2027-03-15'])
  assert.deepEqual(dates(s, monthly('2026-12-15'), '2026-11-01', '2027-03-31'), ['2026-12-15', '2027-01-15', '2027-02-15', '2027-03-15'])
  // a yearly plan with no change keeps the anchor's month
  assert.deepEqual(dates(s, [], '2026-01-01', '2029-12-31'), ['2026-06-15', '2027-06-15', '2028-06-15', '2029-06-15'])
})

test('a year of charges against a hand-written list: price changes, a pause and a change to yearly, on a billing day of 31', () => {
  const s = sub({ id: 'yr', nextDate: '2026-01-31' }) // monthly 10,000 on the 31st (the last day of a shorter month)
  const changes = [
    change('yr', '2026-03-15', { plan: 'Pro', amount: 20_000 }), // before 3/31: that charge is Pro
    change('yr', '2026-04-30', { amount: 25_000 }), // on 4/30, April's billing date: that charge is the new amount
    change('yr', '2026-06-10', { status: 'cancelled' }), // 6/30 and 7/31 are gone, 5/31 stays
    change('yr', '2026-08-31', { status: 'active' }), // back on a billing date: charged that day
    change('yr', '2026-10-05', { cycle: 'yearly', plan: 'Year', amount: 200_000 }), // 10/31 is the first yearly charge
  ]
  const year = upcomingPayments([s], changes, settings, D('2026-01-01'), 364)
  assert.deepEqual(rows(year), [
    ['2026-01-31', 'Basic', 10_000],
    ['2026-02-28', 'Basic', 10_000],
    ['2026-03-31', 'Pro', 20_000],
    ['2026-04-30', 'Pro', 25_000],
    ['2026-05-31', 'Pro', 25_000],
    ['2026-08-31', 'Pro', 25_000],
    ['2026-09-30', 'Pro', 25_000],
    ['2026-10-31', 'Year', 200_000],
  ])
  assert.equal(year.reduce((a, p) => a + p.krw, 0), 340_000)
  // the year after: only the yearly charge, in October
  assert.deepEqual(dates(s, changes, '2027-01-01', '2028-12-31'), ['2027-10-31', '2028-10-31'])
  // the same dates one by one, and from any start inside the year (the schedule does not depend on the window)
  const all = dates(s, changes, '2026-01-01', '2028-12-31')
  assert.deepEqual(walk(s, changes, '2026-01-01', '2028-12-31'), all)
  for (const from of ['2026-03-16', '2026-04-30', '2026-05-01', '2026-06-10', '2026-07-15', '2026-08-31', '2026-09-01', '2026-10-06', '2026-11-01']) {
    assert.deepEqual(dates(s, changes, from, '2028-12-31'), all.filter((d) => d >= from), from)
    assert.deepEqual(walk(s, changes, from, '2028-12-31'), all.filter((d) => d >= from), `one by one from ${from}`)
  }
})

test('two changes in one month: each billing date goes by the segment that holds it', () => {
  // charged on the 15th: a price change on the 5th and a cancellation on the 20th of the same month
  const s = sub({ id: 'tw', nextDate: '2026-11-15' })
  const changes = [change('tw', '2026-12-20', { status: 'cancelled' }), change('tw', '2026-12-05', { amount: 18_000 })]
  assert.deepEqual(rows(upcomingPayments([s], changes, settings, D('2026-11-01'), 120)), [['2026-11-15', 'Basic', 10_000], ['2026-12-15', 'Basic', 18_000]])
  // nothing before one cycle ahead of the anchor is charged, as before: the anchor 11/15 allows 10/15, not 9/15
  assert.deepEqual(dates(s, changes, '2026-08-01', '2027-02-28'), ['2026-10-15', '2026-11-15', '2026-12-15'])
})
