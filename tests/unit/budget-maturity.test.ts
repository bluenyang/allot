// spec 013 rev 1 W-13: the maturities and 월별 기록 (S-15), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monthPlans } from '../../src/lib/budget-page'
import { maturityAlerts, maturityAmount, maturityOf, monthsBetween, type AccountState } from '../../src/lib/calc'
import type { Account, AllocationTarget, MonthAdjust, Phase, Settings } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, dayShift: 'none', savingSplit: 'amount', investSplit: 'ratio' }
const none: ReadonlySet<string> = new Set()
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

test('S-15: the term is read as "N개월" / "N months" or "YYYY-MM까지" / "until YYYY-MM", and only with a from month', () => {
  assert.deepEqual(maturityOf({ term: '12개월', from: '2026-01' }), { ym: '2027-01', months: 12 })
  assert.deepEqual(maturityOf({ term: ' 6 개월 ', from: '2026-09' }), { ym: '2027-03', months: 6 })
  assert.deepEqual(maturityOf({ term: '18 months', from: '2026-01' }), { ym: '2027-07', months: 18 })
  assert.deepEqual(maturityOf({ term: '1 month', from: '2026-12' }), { ym: '2027-01', months: 1 })
  assert.deepEqual(maturityOf({ term: '2027-06까지', from: '2026-01' }), { ym: '2027-06', months: 17 })
  assert.deepEqual(maturityOf({ term: 'until 2027-06', from: '2026-01' }), { ym: '2027-06', months: 17 })
  // not read: no from, no term, other text, zero, an end before the start (no upper limit: first audit rc.2 F-1)
  for (const x of [{ term: '12개월', from: null }, { term: '', from: '2026-01' }, { term: '만기 없음', from: '2026-01' }, { term: '연 3%', from: '2026-01' },
    { term: '0개월', from: '2026-01' }, { term: '2025-06까지', from: '2026-01' }, { term: '2027-13까지', from: '2026-01' }]) {
    assert.equal(maturityOf(x), null, JSON.stringify(x))
  }
  assert.deepEqual(maturityOf({ term: '1201개월', from: '2026-01' }), { ym: '2126-02', months: 1201 })
  assert.equal(monthsBetween('2026-11', '2027-02'), 3)
  assert.equal(monthsBetween('2027-02', '2026-11'), -3)
})

test('S-15: what an item holds at maturity — the plan without a record, the projection before the maturity month with one', () => {
  const save = acc('c', { group: 'saving', amount: 100_000, from: '2026-01', term: '12개월' })
  const st = state({ accounts: [save] })
  const m = maturityOf(save)!
  // 12 transfers, January to December 2026
  assert.deepEqual(maturityAmount(save, st, none, m), { amount: 1_200_000, projected: false })
  // a stop month in the middle: what the plan really sends
  assert.equal(maturityAmount({ ...save, stopFrom: '2026-07' }, state({ accounts: [{ ...save, stopFrom: '2026-07' }] }), none, m).amount, 600_000)
  // without the menu's target the pay split sends nothing to the items
  assert.equal(maturityAmount(save, state({ accounts: [save], targets: T.filter((x) => x.kind !== 'saving') }), none, m).amount, 0)
  // a balance record: 500,000 on 2026-06-30, then July to December (6 × 100,000) by the end of December
  const rec = state({ accounts: [save], balances: [{ id: 'b', accountId: 'c', date: '2026-06-30', amount: 500_000 }] })
  assert.deepEqual(maturityAmount(save, rec, none, m), { amount: 1_100_000, projected: true })
})

test('S-15: a maturity card for a Savings item whose maturity has come and that still sends; the browser may keep one', () => {
  const due = acc('due', { group: 'saving', amount: 100_000, from: '2025-12', term: '12개월' }) // matures 2026-12
  const later = acc('later', { group: 'saving', amount: 100_000, from: '2026-06', term: '12개월' })
  const stopped = acc('stopped', { group: 'saving', amount: 100_000, from: '2025-01', term: '6개월', stopFrom: '2025-07' })
  const inv = acc('inv', { group: 'invest', ratio: 1, from: '2025-01', term: '6개월' })
  const st = state({ accounts: [due, later, stopped, inv] })
  const cards = maturityAlerts(st, '2026-12-01', none)
  assert.deepEqual(cards.map((c) => [c.account.id, c.month, c.stopFrom]), [['due', '2026-12', '2026-12']])
  // after this month's transfer day the stop starts next month
  assert.equal(maturityAlerts(st, '2026-12-27', none)[0]!.stopFrom, '2027-01')
  // not yet
  assert.deepEqual(maturityAlerts(st, '2026-11-30', none), [])
  // kept in this browser for that maturity
  assert.deepEqual(maturityAlerts(st, '2026-12-01', none, (id, ym) => id === 'due' && ym === '2026-12'), [])
})

test('S-15: 월별 기록 — the target value of the last six months and this month, newest first', () => {
  const items = [{ id: 'f', name: 'f', kind: '', payMethod: '', amount: 300_000, from: '2026-05', code: null, amounts: {} }]
  const accounts = [acc('x', { group: 'invest', ratio: 1 })]
  const adj: MonthAdjust[] = [{ id: 'a', ym: '2026-11', targetId: 'ti', amount: 500_000 }]
  const st = state({ livingItems: items, accounts, monthAdjusts: adj })
  const inv = monthPlans(st, 'invest', '2027-01')
  assert.deepEqual(inv.map((x) => x.ym), ['2027-01', '2026-12', '2026-11', '2026-10', '2026-09', '2026-08', '2026-07'])
  assert.deepEqual(inv.map((x) => x.planned), [1_200_000, 1_000_000, 500_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000])
  const liv = monthPlans(st, 'living', '2026-07')
  assert.deepEqual(liv.map((x) => x.planned), [300_000, 300_000, 300_000, 0, 0, 0, 0])
  // without the living target: the items' sum
  assert.deepEqual(monthPlans(state({ livingItems: items, targets: T.filter((x) => x.kind !== 'living') }), 'living', '2026-05', 1).map((x) => x.planned), [300_000, 0])
})
