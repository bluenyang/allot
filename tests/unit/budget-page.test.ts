// spec 013 W-3, W-4: the pure helpers of the Living, Savings and Investment pages, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chipOf, chipValue, fromChoice, fromOf, limitTone, percentOfRatio, ratioAmount, ratioOfPercent, sumStatus, totalPreview, withTotal, yearSent,
} from '../../src/lib/budget-page'
import { groupAt, phaseAt } from '../../src/lib/calc'
import type { Account, AllocationTarget, Phase, Settings } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, dayShift: 'none', savingSplit: 'amount', investSplit: 'ratio' }
const P1: Phase = { id: 'p1', label: 'keep', name: 'one', from: '2026-01', to: '2026-12', amounts: { tf: 200_000, ti: 1_000_000 } }
const P2: Phase = { id: 'p2', label: '', name: 'two', from: '2027-01', to: null, amounts: { ti: 1_200_000 } }
const T: AllocationTarget[] = [
  { id: 'tf', name: 'Fixed', kind: 'fixed' },
  { id: 'ti', name: 'Invest', kind: 'invest' },
  { id: 'ts', name: 'Save', kind: 'saving' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const third = ['a', 'b', 'c'].map((id) => acc(id, { group: 'invest', ratio: 0.3333 }))

test('percent ↔ ratio: 2 decimals of the percent (4 of the ratio), empty stays null, nothing else refused', () => {
  assert.equal(ratioOfPercent(33.33), 0.3333)
  assert.equal(ratioOfPercent(33.333), 0.3333) // kept to the 4 decimals numeric(5,4) stores
  assert.equal(ratioOfPercent(40), 0.4)
  assert.equal(ratioOfPercent(0), 0)
  assert.equal(ratioOfPercent(150), 1.5) // over 100%: the API answers, not the editor
  assert.equal(ratioOfPercent(''), null)
  assert.equal(ratioOfPercent(null), null)
  for (const r of [0, 0.0001, 0.1234, 0.3333, 0.5, 0.9999, 1]) {
    const back = ratioOfPercent(percentOfRatio(r) as number)
    assert.equal(back, r, String(r))
    assert.equal(Math.round(back! * 10_000) / 10_000, back) // what the API's ratioDecimals rule checks
  }
  assert.equal(percentOfRatio(null), '')
  assert.equal(ratioAmount(1_000_000, 1 / 3), 333_000) // V-6: rounded to the nearest 1,000
  assert.equal(ratioAmount(1_000_000, null), 0)
})

test('the status line: amount split always matches; ratio split names the ratio sum, then the rounding gap (S-3)', () => {
  const ym = '2026-05'
  const phase = phaseAt([P1, P2], ym)
  const st = (accounts: Account[], s = S, targets = T) => sumStatus(groupAt('invest', accounts, [P1, P2], targets, s, ym), phase)
  assert.deepEqual(st(third), { code: 'ratioUnder', pct: 99.99, rest: 0.01 })
  assert.deepEqual(st([acc('a', { group: 'invest', ratio: 0.6 }), acc('b', { group: 'invest', ratio: 0.5 })]), { code: 'ratioOver', pct: 110, over: 10 })
  assert.deepEqual(st([acc('a', { group: 'invest', ratio: 0.5 }), acc('b', { group: 'invest', ratio: 0.5 })]), { code: 'same', ratio: true })
  // 100% but 1,000-rounding: 1,000,000 × .3335 = 333,500 → 334,000 (×2) and .333 → 333,000: 1,001,000
  assert.deepEqual(st([acc('a', { group: 'invest', ratio: 0.3335 }), acc('b', { group: 'invest', ratio: 0.3335 }), acc('c', { group: 'invest', ratio: 0.333 })]), { code: 'over', amount: 1_000 })
  assert.deepEqual(st([acc('a', { group: 'invest', ratio: 0.3334 }), acc('b', { group: 'invest', ratio: 0.3333 }), acc('c', { group: 'invest', ratio: 0.3333 })]), { code: 'under', amount: 1_000 })
  assert.deepEqual(st(third, { ...S, investSplit: 'amount' }), { code: 'same', ratio: false })
  assert.deepEqual(st(third, S, T.filter((t) => t.kind !== 'invest')), { code: 'noTarget' })
  assert.deepEqual(sumStatus(groupAt('invest', third, [P1], T, S, '2025-01'), null), { code: 'noPhase' })
})

test('chips fill a free-text field and keep every stored value (S-2, S-5)', () => {
  const chips = [{ id: 'food', label: 'Food' }, { id: 'other', label: 'Other' }]
  assert.deepEqual(chipOf('Food', chips, 'other'), { id: 'food', text: '' })
  assert.deepEqual(chipOf('Pet', chips, 'other'), { id: 'other', text: 'Pet' })
  assert.deepEqual(chipOf('', chips, 'other'), { id: null, text: '' })
  assert.deepEqual(chipOf(undefined, chips, 'other'), { id: null, text: '' })
  assert.deepEqual(chipOf('Other', chips, 'other'), { id: 'other', text: '' })
  // and back: what was stored is what is saved when nothing is changed
  for (const v of ['Food', 'Pet', '', 'Other', '  spaced  ']) assert.equal(chipValue(chipOf(v, chips, 'other'), chips, 'other', 'Other'), v)
  assert.equal(chipValue({ id: 'other', text: '' }, chips, 'other', ''), '') // a term typed empty stays empty
})

test('언제부터: this month, next month, or the stored month as it is (null stays null)', () => {
  const now = '2026-11'
  assert.equal(fromChoice('2026-11', now), 'now')
  assert.equal(fromChoice('2026-12', now), 'next')
  assert.equal(fromChoice(null, now), 'kept')
  assert.equal(fromChoice('2026-03', now), 'kept')
  assert.equal(fromOf('now', null, now), '2026-11')
  assert.equal(fromOf('next', null, now), '2026-12')
  assert.equal(fromOf('kept', null, now), null)
  assert.equal(fromOf('kept', '2026-03', now), '2026-03')
  assert.equal(fromOf('next', '2026-11', '2026-12'), '2027-01')
})

test('총액 수정: the phase amount of the target changes, the label and other amounts stay; the preview shows the remainder before → after', () => {
  const next = withTotal([P1, P2], 'p1', 'ti', 900_000)
  assert.deepEqual(next[0], { ...P1, amounts: { tf: 200_000, ti: 900_000 } })
  assert.equal(next[1], P2)
  assert.equal(P1.amounts.ti, 1_000_000) // not changed in place
  const state = {
    settings: S, phases: [P1, P2], targets: T, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [], spendings: [],
    accounts: [acc('a', { group: 'invest', ratio: 0.4 }), acc('b', { group: 'invest', ratio: 0.6 })],
  }
  const p = totalPreview(state, 'invest', '2026-05', 900_000)!
  assert.equal(p.phase.id, 'p1')
  // pay 3,000,000 − fixed 200,000 − invest 1,000,000 = 1,800,000 → with 900,000: 1,900,000
  assert.equal(p.before, 1_800_000)
  assert.equal(p.after, 1_900_000)
  assert.deepEqual(p.rows.map((r) => [r.account.id, r.before, r.after]), [['a', 400_000, 360_000], ['b', 600_000, 540_000]])
  assert.equal(totalPreview(state, 'invest', '2025-01', 1), null) // no phase that month
  assert.equal(totalPreview({ ...state, targets: T.filter((t) => t.kind !== 'invest') }, 'invest', '2026-05', 1), null)
})

test('KPIs: what a menu sent this year so far, and the annual-limit tone (90% near, above over)', () => {
  const accounts = [acc('a', { group: 'saving', amount: 100_000 }), acc('b', { group: 'saving', amount: 50_000, from: '2026-04' })]
  // Jan–May: a 5 × 100,000, b Apr–May 2 × 50,000
  assert.equal(yearSent('saving', accounts, [P1, P2], T, S, '2026-05'), 600_000)
  assert.equal(yearSent('saving', accounts, [P1, P2], T, S, '2026-01'), 100_000)
  assert.equal(limitTone(0, 1_000), 'ok')
  assert.equal(limitTone(899, 1_000), 'ok')
  assert.equal(limitTone(900, 1_000), 'near')
  assert.equal(limitTone(1_000, 1_000), 'near')
  assert.equal(limitTone(1_001, 1_000), 'over')
})
