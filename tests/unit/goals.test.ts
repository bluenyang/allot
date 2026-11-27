// spec 013 W-8: the goal cards' pure helpers (src/lib/goals.ts), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { goalAlerts, type AccountState } from '../../src/lib/calc'
import { accountSendIn, goalOffRange, stopPreview } from '../../src/lib/goals'
import type { Account, AllocationTarget, Phase, Settings } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, payShift: 'none', transferShift: 'none', billingShift: 'none' }
const none: ReadonlySet<string> = new Set()
const P1: Phase = { id: 'p1', label: '', name: 'one', from: '2026-01', to: null, amounts: { tf: 200_000 } }
const T: AllocationTarget[] = [
  { id: 'tf', name: 'Fixed', kind: 'fixed', accountId: 'emergency' },
  { id: 'ts', name: 'Savings', kind: 'saving' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: [P1], targets: T, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
  spendings: [], accounts: [], balances: [], cards: [], ...over,
})

test('a Savings item: the card stops its amount from the next transfer month and the remainder grows by it (S-7)', () => {
  const cma = acc('cma', { group: 'saving', amount: 500_000, goal: 11_000_000 })
  const st = state({ accounts: [cma], balances: [{ id: 'b1', accountId: 'cma', date: '2026-11-01', amount: 10_000_000 }] })
  assert.equal(accountSendIn(cma, st, '2027-01'), 500_000)
  const [alert] = goalAlerts(st, '2026-12-27', none)
  assert.ok(alert)
  const p = stopPreview(st, alert)
  assert.equal(p.month, '2027-01')
  assert.deepEqual(p.send, { before: 500_000, after: 0 })
  // 3,000,000 − fixed 200,000 − savings 500,000 = 2,300,000; stopped: 2,800,000
  assert.deepEqual(p.remainder, { before: 2_300_000, after: 2_800_000 })
  // the state itself is not changed
  assert.equal(st.accounts[0]!.stopFrom, null)
})

test('an account behind a fixed target: the stop ends what the target sends to it (S-7)', () => {
  const em = acc('emergency', { goal: 1_000_000 })
  const st = state({ accounts: [em], balances: [{ id: 'b1', accountId: 'emergency', date: '2026-10-01', amount: 900_000 }] })
  assert.equal(accountSendIn(em, st, '2026-12'), 200_000)
  const [alert] = goalAlerts(st, '2026-12-01', none)
  assert.ok(alert)
  assert.equal(alert.month, '2026-10') // 900,000 + Oct 26 transfer
  const p = stopPreview(st, alert)
  assert.equal(p.month, '2026-12') // the December transfer is still to come
  assert.deepEqual(p.send, { before: 200_000, after: 0 })
  assert.deepEqual(p.remainder, { before: 2_800_000, after: 3_000_000 })
  // an account nothing sends to gets 0
  assert.equal(accountSendIn(acc('other'), st, '2026-12'), 0)
})

test('the holiday range: only with moved dates, from the month before the earliest record of an account with a goal (S-7)', () => {
  const st = state({
    accounts: [acc('a', { goal: 1 }), acc('b', { goal: 1 }), acc('c')],
    balances: [
      { id: '1', accountId: 'a', date: '2026-08-10', amount: 0 }, { id: '2', accountId: 'a', date: '2026-09-10', amount: 0 },
      { id: '3', accountId: 'b', date: '2026-07-01', amount: 0 }, { id: '4', accountId: 'c', date: '2020-01-01', amount: 0 },
    ],
  })
  assert.equal(goalOffRange(st, '2026-11-23'), null) // dayShift none
  const moved = { ...st, settings: { ...S, payShift: 'before' as const, transferShift: 'before' as const, billingShift: 'before' as const } }
  // a's last record is September, b's July (c has no goal): from June to three months after November
  assert.deepEqual(goalOffRange(moved, '2026-11-23'), ['2026-06-01', '2027-02-01'])
  // a record after today: still from the month before today
  assert.deepEqual(goalOffRange({ ...moved, balances: [{ id: '5', accountId: 'a', date: '2027-01-05', amount: 0 }] }, '2026-11-23'), ['2026-10-01', '2027-02-01'])
  // no account with a goal and a record
  assert.equal(goalOffRange({ ...moved, balances: [] }, '2026-11-23'), null)
})
