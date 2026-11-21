// spec 009 S-3: the fingerprint of the data and the month preview (synthetic data, no database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonical, hashState, monthPreview } from '../../server/preview'
import { overview, type Data } from '../../server/mcp/views'

const data: Data = {
  settings: { netPay: 3_000_000, fxRate: 1400, fxBuffer: 5, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, dayShift: 'after' },
  living: { food: 400_000, transit: 100_000, allowance: 200_000 },
  targets: [
    { id: 't-live', name: 'Living account', kind: 'living' },
    { id: 't-subs', name: 'Subscription account', kind: 'subscriptions' },
    { id: 't-save', name: 'Savings', kind: 'fixed' },
    { id: 't-rest', name: 'Everything else', kind: 'remainder' },
  ],
  subscriptions: [
    { id: 's1', name: 'Sub One', category: 'tool', plan: 'basic', amount: 12_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-11-20', path: 'direct', verified: false },
  ],
  planChanges: [],
  phases: [{ id: 'p1', label: 'P1', name: 'first', from: '2026-01', to: null, amounts: { 't-save': 500_000 } }],
  events: [], checks: [], accounts: [], debts: [], remainderSplit: [], holidaySets: [],
}

test('the fingerprint ignores key order and changes with any value', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }))
  assert.equal(hashState(data), hashState(JSON.parse(JSON.stringify(data))))
  assert.notEqual(hashState(data), hashState({ ...data, living: { ...data.living, food: 400_001 } }))
  assert.notEqual(hashState(data), hashState({ ...data, subscriptions: [] }))
  assert.match(hashState(data), /^[0-9a-f]{64}$/)
})

test('a month preview is the overview before and after', () => {
  const after: Data = { ...data, living: { ...data.living, food: 500_000 }, phases: [{ ...data.phases[0]!, amounts: { 't-save': 800_000 } }] }
  const p = monthPreview(data, after, '2026-11')
  assert.equal(p.month, '2026-11')
  assert.equal(p.transferKrw.before, overview(data, '2026-11').subscriptionTransfer.transferKrw)
  assert.equal(p.transferKrw.after, overview(after, '2026-11').subscriptionTransfer.transferKrw)
  const save = p.distribution.find((r) => r.targetId === 't-save')!
  assert.deepEqual(save.amountKrw, { before: 500_000, after: 800_000 })
  assert.equal(p.remainderKrw.before - p.remainderKrw.after, 400_000) // +100k living, +300k savings come out of the remainder
})

test('a target that exists on one side only shows null on the other', () => {
  const after: Data = { ...data, targets: [...data.targets, { id: 't-new', name: 'New', kind: 'fixed' }], phases: [{ ...data.phases[0]!, amounts: { 't-save': 500_000, 't-new': 100_000 } }] }
  const p = monthPreview(data, after, '2026-11')
  assert.deepEqual(p.distribution.find((r) => r.targetId === 't-new')!.amountKrw, { before: null, after: 100_000 })
  const gone = monthPreview(after, data, '2026-11')
  assert.deepEqual(gone.distribution.find((r) => r.targetId === 't-new')!.amountKrw, { before: 100_000, after: null })
})

test('a proposed spending moves the month it falls in: remainder (salary) or transfer (subscription account)', () => {
  const round = (date: string, amount: number) => [{ no: 1, date, amount, state: 'left' as const, edited: false }]
  const sp = (id: string, payBy: 'salary' | 'subs', amount: number) => ({
    id, name: id, category: 'etc', bought: '2026-11-02', amount, currency: 'KRW' as const, fxRate: null, fxBuffer: null, how: 'lump' as const, payBy, count: 1, fee: 0, interval: null, cancelled: false,
    rounds: round('2026-11-12', amount),
  })
  const salary = monthPreview(data, { ...data, spendings: [sp('a', 'salary', 70_000)] }, '2026-11')
  assert.equal(salary.remainderKrw.before - salary.remainderKrw.after, 70_000)
  assert.deepEqual(salary.transferKrw.before, salary.transferKrw.after)
  const subs = monthPreview(data, { ...data, spendings: [sp('b', 'subs', 40_000)] }, '2026-11')
  assert.ok(subs.transferKrw.after > subs.transferKrw.before)
  assert.ok(subs.neededKrw.after - subs.neededKrw.before === 40_000)
  assert.ok(subs.remainderKrw.after < subs.remainderKrw.before) // the larger transfer comes off the remainder too
  const other = monthPreview(data, { ...data, spendings: [sp('a', 'salary', 70_000)] }, '2026-12')
  assert.deepEqual(other.remainderKrw.before, other.remainderKrw.after)
  assert.notEqual(hashState(data), hashState({ ...data, spendings: [sp('a', 'salary', 70_000)] }))
})
