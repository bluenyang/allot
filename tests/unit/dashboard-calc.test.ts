// spec 010 V-3 (W-4): the pure calculations behind 현황, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { PlanChange, Priced, Settings, Subscription } from '../../src/data/types'
import { clusterDots, leftoverAfterTransfer, nextPayment, paymentDates, paysAfter31, phaseNumbers, unallocated, upcomingPayments, ymd } from '../../src/lib/calc'

const settings: Priced = { ...DEFAULT_SETTINGS, netPay: 3_000_000, transferDay: 26, subRound: 10_000, fxBuffer: 0, currencies: [] }
let n = 0
const sub = (over: Partial<Subscription>): Subscription => ({
  id: `s${++n}`, name: `S${n}`, category: 'tool', plan: 'Basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '2026-11-10', path: 'direct', verified: false, ...over,
} as Subscription)
const state = (subscriptions: Subscription[], planChanges: PlanChange[] = [], s: Settings = settings) => ({ subscriptions, planChanges, settings: s })

test('leftoverAfterTransfer: the window runs from the transfer day to the day before the next transfer day', () => {
  const r = leftoverAfterTransfer(state([sub({ amount: 100_000, nextDate: '2026-11-26' })]), '2026-11')
  assert.equal(r.from, '2026-11-26')
  assert.equal(r.to, '2026-12-25')
  assert.equal(r.transfer, 100_000)
  // the payment on 11/26 (the transfer day) counts, the one on 12/26 (the next transfer day) does not
  assert.equal(r.count, 1)
  assert.equal(r.paid, 100_000)
  assert.equal(r.left, 0)
})

test('leftoverAfterTransfer: edges of the window (yearly charges, so one date is one payment)', () => {
  const edge = (nextDate: string) => leftoverAfterTransfer(state([sub({ amount: 12_000, cycle: 'yearly', nextDate })]), '2026-11').count
  assert.equal(edge('2026-11-25'), 0, 'the day before the transfer day belongs to the previous window')
  assert.equal(edge('2026-11-26'), 1, 'the transfer day itself')
  assert.equal(edge('2026-12-25'), 1, 'the day before the next transfer day')
  assert.equal(edge('2026-12-26'), 0, 'the next transfer day starts the next window')
})

test('leftoverAfterTransfer: no payments in the window leaves the whole transfer', () => {
  const r = leftoverAfterTransfer(state([sub({ amount: 30_000, nextDate: '2027-03-01', cycle: 'yearly' })]), '2026-11')
  assert.equal(r.count, 0)
  assert.equal(r.paid, 0)
  assert.equal(r.left, r.transfer)
  const none = leftoverAfterTransfer(state([]), '2026-11')
  assert.equal(none.left, 0)
  assert.equal(none.count, 0)
})

test('leftoverAfterTransfer: a transfer that does not cover the window is negative', () => {
  // the yearly charge falls in the window, the transfer only reserves a twelfth of it
  const yearly = sub({ amount: 120_000, cycle: 'yearly', nextDate: '2026-12-01' })
  const r = leftoverAfterTransfer(state([yearly]), '2026-11')
  assert.equal(r.transfer, 10_000)
  assert.equal(r.paid, 120_000)
  assert.equal(r.left, -110_000)
})

test('leftoverAfterTransfer: the day shift moves the window, and a plan change applies to its month', () => {
  // 2026-11-26 is a Thursday; shift 'after' with a holiday on it moves the transfer to the Friday
  const shifted = leftoverAfterTransfer(state([sub({ amount: 12_000, cycle: 'yearly', nextDate: '2026-11-27' })], [], { ...settings, dayShift: 'after' }), '2026-11', new Set(['2026-11-26']))
  assert.equal(shifted.from, '2026-11-27')
  assert.equal(shifted.to, '2026-12-27', '12/26 is a Saturday: the next transfer is Monday 12/28, so the window ends the day before')
  assert.equal(shifted.count, 1)
  const change: PlanChange = { id: 'c1', subId: 'x', effective: '2026-12-01', to: { amount: 50_000 }, note: '' }
  const s1 = sub({ id: 'x', amount: 10_000, nextDate: '2026-12-10' })
  const r = leftoverAfterTransfer(state([s1], [change]), '2026-11')
  assert.equal(r.paid, 50_000, 'the 12/10 charge is the new amount')
})

test('paysAfter31: only yearly or new-plan payments, one per subscription, within a year', () => {
  const from = new Date(2026, 10, 18)
  const monthlyOnly = sub({ name: 'plain', nextDate: '2026-11-20' })
  const yearly = sub({ name: 'yearly', cycle: 'yearly', amount: 150_000, nextDate: '2027-03-12' })
  const farYearly = sub({ name: 'far', cycle: 'yearly', amount: 90_000, nextDate: '2029-05-01' })
  const upgraded = sub({ id: 'up', name: 'upgraded', plan: 'Basic', amount: 30_000, nextDate: '2026-11-28' })
  const change: PlanChange = { id: 'c', subId: 'up', effective: '2026-12-28', to: { plan: 'Pro', amount: 150_000 }, note: '' }
  const rows = paysAfter31([monthlyOnly, yearly, farYearly, upgraded], [change], settings, from)
  assert.deepEqual(rows.map((r) => r.sub.name), ['upgraded', 'yearly'])
  assert.deepEqual(rows.map((r) => r.reason), ['plan', 'yearly'])
  assert.equal(rows[0]!.krw, 150_000)
  assert.equal(rows[0]!.date.getMonth(), 11)
  assert.equal(rows[0]!.date.getDate(), 28)
})

test('paysAfter31: a subscription paid only inside the 31 days is left out; at most 3 rows, soonest first', () => {
  const from = new Date(2026, 10, 18)
  assert.equal(paysAfter31([sub({ cycle: 'yearly', nextDate: '2026-12-10' })], [], settings, from).length, 0, 'its next yearly charge is a year away')
  const five = [5, 4, 3, 2, 1].map((i) => sub({ name: `y${i}`, cycle: 'yearly', nextDate: `2027-0${i}-15` }))
  const rows = paysAfter31(five, [], settings, from)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((r) => r.sub.name), ['y1', 'y2', 'y3'])
  assert.equal(paysAfter31(five, [], settings, from, 5).length, 5)
})

test('unallocated: the remainder target takes everything; without one the rest is the pay minus the targets', () => {
  const target = { id: 't', name: 'R', kind: 'remainder' as const, note: '' }
  assert.equal(unallocated({ remainder: 120_000, remainderTarget: target as never }), 0)
  assert.equal(unallocated({ remainder: 120_000, remainderTarget: null }), 120_000)
  assert.equal(unallocated({ remainder: -30_000, remainderTarget: null }), -30_000)
  assert.equal(unallocated({ remainder: 0, remainderTarget: null }), 0)
})

const days = (list: Date[]) => list.map(ymd)

test('paymentDates: the billing day comes back after a short month (Jan 31 → Feb 28 → Mar 31), and in a leap year', () => {
  const s31 = sub({ nextDate: '2027-01-31' })
  assert.deepEqual(days(paymentDates(s31, [], new Date(2027, 0, 1), new Date(2027, 3, 30))), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  const leap = sub({ nextDate: '2028-01-31' })
  assert.deepEqual(days(paymentDates(leap, [], new Date(2028, 0, 1), new Date(2028, 3, 30))), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
  // an anchor in the past, and a yearly one on Feb 29
  assert.deepEqual(days(paymentDates(sub({ nextDate: '2024-02-29', cycle: 'yearly' }), [], new Date(2027, 0, 1), new Date(2029, 11, 31))), ['2027-02-28', '2028-02-29', '2029-02-28'])
  assert.deepEqual(upcomingPayments([s31], [], settings, new Date(2027, 1, 1), 59).map((p) => ymd(p.date)), ['2027-02-28', '2027-03-31'])
})

test('leftoverAfterTransfer: a window across February counts each monthly charge once', () => {
  // transfer day 29: Feb 2027 has 28 days, so the transfer is Feb 28 and the next one Mar 29
  const st = { ...settings, transferDay: 29 }
  const r = leftoverAfterTransfer(state([sub({ amount: 10_000, nextDate: '2027-01-31' })], [], st), '2027-02')
  assert.equal(r.from, '2027-02-28')
  assert.equal(r.to, '2027-03-28')
  assert.equal(r.count, 1, 'Feb 28 is in; Mar 31 is not')
  assert.equal(r.paid, 10_000)
  // the leap year: Feb 29 is the transfer day and the charge day
  const leap = leftoverAfterTransfer(state([sub({ amount: 10_000, nextDate: '2028-01-31' })], [], st), '2028-02')
  assert.equal(leap.from, '2028-02-29')
  assert.equal(leap.count, 1)
})

test('paysAfter31: a price change in March is charged on Mar 31, not Mar 28', () => {
  const m = sub({ id: 'm31', plan: 'Basic', amount: 10_000, nextDate: '2027-01-31' })
  const change: PlanChange = { id: 'cm', subId: 'm31', effective: '2027-03-01', to: { plan: 'Pro', amount: 30_000 }, note: '' }
  const rows = paysAfter31([m], [change], settings, new Date(2027, 0, 1))
  assert.equal(rows.length, 1)
  assert.equal(ymd(rows[0]!.date), '2027-03-31')
  assert.equal(rows[0]!.krw, 30_000)
})

test('plan changes between monthly and yearly: no payment is skipped', () => {
  const from = new Date(2026, 10, 18)
  // yearly (June) → monthly from December: December to February are charged monthly
  const y = sub({ id: 'y2m', cycle: 'yearly', amount: 120_000, nextDate: '2027-06-15' })
  const toMonthly: PlanChange = { id: 'c1', subId: 'y2m', effective: '2026-12-01', to: { cycle: 'monthly', amount: 12_000 }, note: '' }
  const a = upcomingPayments([y], [toMonthly], settings, from, 130)
  assert.deepEqual(a.map((p) => ymd(p.date)), ['2026-12-15', '2027-01-15', '2027-02-15', '2027-03-15'])
  assert.deepEqual(a.map((p) => p.krw), [12_000, 12_000, 12_000, 12_000])
  const lo = leftoverAfterTransfer(state([y], [toMonthly]), '2026-12')
  assert.equal(lo.paid, 12_000, 'Dec 26 – Jan 25 holds the Jan 15 monthly charge')
  assert.equal(lo.count, 1)
  // monthly → yearly from February: monthly until then, the yearly charge in February, the next one a year on
  const m = sub({ id: 'm2y', cycle: 'monthly', amount: 10_000, nextDate: '2026-11-10' })
  const toYearly: PlanChange = { id: 'c2', subId: 'm2y', effective: '2027-02-01', to: { cycle: 'yearly', amount: 100_000 }, note: '' }
  const b = upcomingPayments([m], [toYearly], settings, from, 800)
  assert.deepEqual(b.map((p) => ymd(p.date)), ['2026-12-10', '2027-01-10', '2027-02-10', '2028-02-10'])
  assert.deepEqual(b.map((p) => p.krw), [10_000, 10_000, 100_000, 100_000])
})

test('paymentDates: the schedule does not depend on the window asked for (A-10)', () => {
  // monthly anchor in June 2027, a change to yearly takes effect in February 2027 (before the anchor)
  const m = sub({ id: 'fut', cycle: 'monthly', amount: 10_000, nextDate: '2027-06-15' })
  const ch: PlanChange = { id: 'cf', subId: 'fut', effective: '2027-02-01', to: { cycle: 'yearly', amount: 100_000 }, note: '' }
  const end = new Date(2028, 11, 31)
  const a = days(paymentDates(m, [ch], new Date(2027, 0, 1), end))
  const b = days(paymentDates(m, [ch], new Date(2027, 2, 1), end))
  const c = days(paymentDates(m, [ch], new Date(2026, 5, 1), end))
  assert.deepEqual(a, ['2028-02-15'])
  assert.deepEqual(b, a, 'a later start gives the same dates')
  assert.deepEqual(c, a)
  // overlapping windows agree on the dates they share
  const all = days(paymentDates(sub({ id: 'ov', nextDate: '2026-01-31' }), [], new Date(2026, 0, 1), new Date(2026, 11, 31)))
  const part = days(paymentDates(sub({ id: 'ov', nextDate: '2026-01-31' }), [], new Date(2026, 4, 10), new Date(2026, 8, 10)))
  assert.deepEqual(part, all.filter((d) => d >= '2026-05-10' && d <= '2026-09-10'))
})

test('paymentDates: an old anchor and a far window are not cut short (A-10)', () => {
  assert.deepEqual(days(paymentDates(sub({ nextDate: '1900-01-15' }), [], new Date(2026, 10, 1), new Date(2026, 11, 31))), ['2026-11-15', '2026-12-15'])
  assert.deepEqual(days(paymentDates(sub({ nextDate: '1900-03-10', cycle: 'yearly' }), [], new Date(2026, 0, 1), new Date(2027, 11, 31))), ['2026-03-10', '2027-03-10'])
  assert.deepEqual(days(paymentDates(sub({ nextDate: '2026-01-15' }), [], new Date(2152, 10, 1), new Date(2152, 11, 31))), ['2152-11-15', '2152-12-15'])
  assert.deepEqual(days(paymentDates(sub({ nextDate: '2026-01-15', cycle: 'yearly' }), [], new Date(2152, 0, 1), new Date(2152, 11, 31))), ['2152-01-15'])
})

test('nextPayment is the first date of the same schedule', () => {
  const y = sub({ id: 'np', cycle: 'monthly', nextDate: '2026-10-20' })
  const ch: PlanChange = { id: 'cn', subId: 'np', effective: '2026-11-01', to: { cycle: 'yearly', amount: 100_000 }, note: '' }
  const now = new Date(2026, 10, 16)
  assert.equal(ymd(nextPayment(y, [ch], now)!), '2026-11-20')
  assert.equal(ymd(upcomingPayments([y], [ch], settings, now, 400)[0]!.date), '2026-11-20')
  assert.equal(ymd(nextPayment(y, [ch], new Date(2026, 10, 21))!), '2027-11-20')
})

test('nextPayment has no horizon: a first charge any distance away is found (A-12)', () => {
  const now = new Date(2026, 10, 19)
  assert.equal(ymd(nextPayment(sub({ nextDate: '2031-01-15' }), [], now)!), '2030-12-15', 'one cycle ahead of the typed date')
  assert.equal(ymd(nextPayment(sub({ nextDate: '2100-03-10', cycle: 'yearly' }), [], now)!), '2099-03-10')
  // it agrees with the dates of the same schedule
  const far = sub({ id: 'far', nextDate: '2031-01-31' })
  assert.equal(ymd(nextPayment(far, [], now)!), ymd(paymentDates(far, [], now, new Date(2031, 11, 31))[0]!))
  // a cancelled plan is not charged; one that comes back later is found
  const gone = sub({ id: 'gone', status: 'cancelled', nextDate: '2026-12-10' })
  assert.equal(nextPayment(gone, [], now), null)
  const back: PlanChange = { id: 'cb', subId: 'gone', effective: '2040-05-01', to: { status: 'active' }, note: '' }
  assert.equal(ymd(nextPayment(gone, [back], now)!), '2040-05-10')
  assert.equal(ymd(paymentDates(gone, [back], now, new Date(2041, 0, 1))[0]!), '2040-05-10')
  // mid-month: today's charge counts, yesterday's does not
  const m = sub({ nextDate: '2026-10-19' })
  assert.equal(ymd(nextPayment(m, [], new Date(2026, 10, 19))!), '2026-11-19')
  assert.equal(ymd(nextPayment(m, [], new Date(2026, 10, 20))!), '2026-12-19')
})

test('phaseNumbers: 1, 2, 3 by start month, list order breaks a tie, the stored label plays no part', () => {
  const ph = (id: string, from: string, label = '') => ({ id, from, label })
  assert.deepEqual(phaseNumbers([]), {})
  // listed out of order: numbered by start month
  assert.deepEqual(phaseNumbers([ph('b', '2027-03'), ph('a', '2026-01', '③'), ph('c', '2028-01')]), { a: 1, b: 2, c: 3 })
  // the same start month: the list order
  assert.deepEqual(phaseNumbers([ph('x', '2026-05'), ph('y', '2026-05'), ph('z', '2026-04')]), { z: 1, x: 2, y: 3 })
  // one phase is 1
  assert.deepEqual(phaseNumbers([ph('only', '2026-01')]), { only: 1 })
})

test('clusterDots: dots closer than the dot size share one, keeping every member (A-27)', () => {
  // 320px phone, two-column strip ~114px: D+10 and D+12 are ~7px apart, so they cluster; D+25 stands alone
  const c = clusterDots([0, 10, 12, 25], 114, 18)
  assert.deepEqual(c.map((x) => x.members), [[0], [1, 2], [3]])
  // on a wide strip the same dates stay separate
  assert.deepEqual(clusterDots([0, 10, 12, 25], 600, 18).map((x) => x.members), [[0], [1], [2], [3]])
  // every payment is in exactly one dot, and no two dots are closer than the dot size
  const days = [0, 0, 1, 2, 3, 8, 9, 20, 30, 31]
  for (const w of [114, 240, 400]) {
    const cl = clusterDots(days, w, 18)
    assert.equal(cl.flatMap((x) => x.members).length, days.length)
    cl.slice(1).forEach((x, i) => assert.ok(((x.pct - cl[i]!.pct) / 100) * w >= 18 - 1e-9))
  }
})
