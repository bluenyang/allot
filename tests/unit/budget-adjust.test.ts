// spec 013 rev 1 W-12: the pure helpers of "이번 달만 조정" (S-14), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjustable, adjustOf, adjustPreview, adjustStart, phaseScope, withAdjust, withoutAdjust } from '../../src/lib/budget-page'
import { monthMoney, type AccountState } from '../../src/lib/calc'
import type { Account, AllocationTarget, MonthAdjust, Phase, Settings } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, dayShift: 'none', savingSplit: 'amount', investSplit: 'ratio' }
const P1: Phase = { id: 'p1', label: 'keep', name: 'one', from: '2026-01', to: '2026-12', amounts: { tf: 200_000, ti: 1_000_000 } }
const P2: Phase = { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { tf: 300_000, ti: 1_200_000 } }
const T: AllocationTarget[] = [
  { id: 'tf', name: 'Fixed', kind: 'fixed' },
  { id: 'ti', name: 'Invest', kind: 'invest' },
  { id: 'ts', name: 'Save', kind: 'saving' },
  { id: 'tl', name: 'Living', kind: 'living' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: [P1, P2], targets: T, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
  spendings: [], accounts: [], balances: [], cards: [], monthAdjusts: [], ...over,
})
const row = (st: AccountState, ym: string, key: string) => monthMoney(st, ym).dist.rows.find((r) => r.key === key)?.amount ?? 0

test('S-14: the adjustment list helpers replace, add and drop one (ym, target) only', () => {
  const list: MonthAdjust[] = [{ id: 'a1', ym: '2026-06', targetId: 'tf', amount: 50_000, reason: 'x' }, { id: 'a2', ym: '2026-07', targetId: 'tf', amount: 10_000 }]
  assert.equal(adjustOf(list, '2026-06', 'tf')?.id, 'a1')
  assert.equal(adjustOf(list, '2026-06', 'ti'), undefined)
  assert.deepEqual(withAdjust(list, '2026-06', 'tf', 70_000), [{ ...list[0]!, amount: 70_000 }, list[1]])
  assert.deepEqual(withAdjust(list, '2026-06', 'ti', 1)[2], { id: '', ym: '2026-06', targetId: 'ti', amount: 1 })
  assert.deepEqual(withoutAdjust(list, '2026-06', 'tf'), [list[1]])
  assert.equal(list[0]!.amount, 50_000) // not changed in place
  assert.deepEqual(['fixed', 'saving', 'invest', 'living', 'subscriptions', 'remainder'].map(adjustable), [true, true, true, false, false, false])
})

test('S-14: "이 구간 끝까지" needs a phase; an amount-split Savings / Investment total offers "이번 달만" only', () => {
  const st = state()
  assert.deepEqual(phaseScope(T[0]!, st, '2026-06'), { phase: P1 })
  assert.deepEqual(phaseScope(T[1]!, st, '2027-03'), { phase: P2 }) // invest: ratio split
  assert.deepEqual(phaseScope(T[2]!, st, '2026-06'), { reason: 'amountSplit' }) // saving: amount split
  assert.deepEqual(phaseScope(T[0]!, st, '2025-06'), { reason: 'noPhase' })
})

test('S-14: the preview of a fixed target — this month only, or the phase (which takes the month adjustment away)', () => {
  const st = state()
  const m = adjustPreview(st, '2026-06', 'tf', 150_000, 'month')
  // 3,000,000 − fixed 200,000 − invest 0 (no items) = 2,800,000; with 150,000: 2,850,000
  assert.deepEqual(m, { base: 200_000, current: 200_000, before: 2_800_000, after: 2_850_000, value: 150_000 })
  const adj = state({ monthAdjusts: [{ id: 'a1', ym: '2026-06', targetId: 'tf', amount: 50_000 }] })
  assert.equal(row(adj, '2026-06', 'tf'), 50_000)
  const again = adjustPreview(adj, '2026-06', 'tf', 80_000, 'month')
  assert.deepEqual(again, { base: 200_000, current: 50_000, before: 2_950_000, after: 2_920_000, value: 80_000 })
  // the phase scope: the phase amount becomes 250,000 and the adjustment no longer hides it
  const ph = adjustPreview(adj, '2026-06', 'tf', 250_000, 'phase')
  assert.deepEqual(ph, { base: 200_000, current: 50_000, before: 2_950_000, after: 2_750_000, value: 250_000 })
  // a take-home tried on the screen
  assert.equal(adjustPreview(st, '2026-06', 'tf', 150_000, 'month', 2_000_000).after, 1_850_000)
  // the other months are untouched
  assert.equal(row(adj, '2026-07', 'tf'), 200_000)
})

test('S-14: the preview of Savings / Investment totals — the ratio split takes the month total, the amount split the target value', () => {
  const accounts = [acc('x', { group: 'invest', ratio: 0.5 }), acc('y', { group: 'invest', ratio: 0.5 }), acc('c', { group: 'saving', amount: 300_000 })]
  const st = state({ accounts })
  const inv = adjustPreview(st, '2026-06', 'ti', 400_000, 'month')
  assert.equal(inv.base, 1_000_000)
  assert.equal(inv.value, 400_000)
  assert.equal(inv.after - inv.before, 600_000)
  const sav = adjustPreview(st, '2026-06', 'ts', 100_000, 'month')
  assert.deepEqual([sav.base, sav.value, sav.after - sav.before], [300_000, 100_000, 200_000])
})

test('review rc2-1 F-1: in the ratio split the dialog starts from the month total, so saving it unchanged keeps the target', () => {
  // one invest item at 50%: the phase total is 1,000,000, the items get 500,000, the rest stays in the remainder
  const accounts = [acc('x', { group: 'invest', ratio: 0.5 }), acc('c', { group: 'saving', amount: 300_000 })]
  const st = state({ accounts })
  const inv = adjustStart(st, '2026-06', T[1]!)
  assert.deepEqual(inv, { base: 1_000_000, current: 1_000_000, total: true })
  assert.equal(row(st, '2026-06', 'ti'), 500_000)
  // saving the pre-filled draft as the month's adjustment leaves the target as it was
  const same = state({ accounts, monthAdjusts: [{ id: 'a1', ym: '2026-06', targetId: 'ti', amount: inv.current }] })
  assert.equal(row(same, '2026-06', 'ti'), 500_000)
  // +50,000 on the total gives the item half of it
  const up = state({ accounts, monthAdjusts: [{ id: 'a1', ym: '2026-06', targetId: 'ti', amount: inv.current + 50_000 }] })
  assert.equal(row(up, '2026-06', 'ti'), 525_000)
  // with an adjustment, current is the adjusted total; base stays the phase total
  assert.deepEqual(adjustStart(up, '2026-06', T[1]!), { base: 1_000_000, current: 1_050_000, total: true })
  // no phase that month: the total is 0
  assert.deepEqual(adjustStart(st, '2025-06', T[1]!), { base: 0, current: 0, total: true })
  // the amount split and a fixed target start from the target's value
  assert.deepEqual(adjustStart(st, '2026-06', T[2]!), { base: 300_000, current: 300_000, total: false })
  assert.deepEqual(adjustStart(st, '2026-06', T[0]!), { base: 200_000, current: 200_000, total: false })
})
