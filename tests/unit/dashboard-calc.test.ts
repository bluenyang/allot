// spec 010 V-3 (W-4): the pure calculations behind 현황, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { PlanChange, Settings, Subscription } from '../../src/data/types'
import { leftoverAfterTransfer, paysAfter31, unallocated } from '../../src/lib/calc'

const settings: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, transferDay: 26, subRound: 10_000, fxBuffer: 0 }
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
