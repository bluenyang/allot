// spec 014 V-2 (W-2): what comes in in a month, and the month's money with it. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { AllocationTarget, IncomeExtra, IncomeItem, IncomeReceipt, LivingItem, Phase, Settings, Spending, Subscription } from '../../src/data/types'
import { incomeAt, monthMoney, type MonthState } from '../../src/lib/calc'

const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_200_000, payDay: 25, transferDay: 26, subRound: 10_000, fxBuffer: 0 }
const targets: AllocationTarget[] = [
  { id: 't-l', name: 'Living', kind: 'living' },
  { id: 't-s', name: 'Subs', kind: 'subscriptions' },
  { id: 't-f', name: 'Fixed', kind: 'fixed' },
  { id: 't-r', name: 'Rest', kind: 'remainder' },
] as AllocationTarget[]
const phases: Phase[] = [{ id: 'p1', label: '1', name: 'P', from: '2026-01', to: null, amounts: { 't-f': 1_000_000 } } as Phase]
const livingItems: LivingItem[] = [{ id: 'li', name: 'Food', amount: 500_000, code: 'food' } as LivingItem]
const subs: Subscription[] = [{
  id: 's1', name: 'Sub', category: 'tool', plan: 'Basic', amount: 12_000, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '2026-11-10', path: 'direct', verified: false,
} as Subscription]
const spendings: Spending[] = [{
  id: 'sp', name: 'Thing', amount: 300_000, currency: 'KRW', bought: '2026-11-03', how: 'lump', payBy: 'salary', cancelled: false,
  rounds: [{ no: 1, date: '2026-11-03', amount: 300_000, state: 'left' }],
} as unknown as Spending]
const base = (over: Partial<MonthState> = {}): MonthState => ({
  settings: S, phases, targets, living: { food: 500_000, transit: 0, allowance: 0 }, livingItems,
  subscriptions: subs, planChanges: [], spendings, currencies: [], ...over,
})
const item = (over: Partial<IncomeItem>): IncomeItem => ({ id: 'i1', name: 'Side', cycle: 'monthly', month: null, day: 10, amount: 150_000, ...over })
const rc = (over: Partial<IncomeReceipt>): IncomeReceipt => ({ id: `r${Math.random()}`, itemId: null, ym: '2026-11', amount: 0, ...over })

test('no incomes, receipts or extras: the month is what it was (total = netPay, every month, any pay)', () => {
  let seed = 7
  const rnd = (lo: number, hi: number) => { seed = (seed * 48271) % 2147483647; return lo + (seed % (hi - lo + 1)) }
  for (let k = 0; k < 300; k++) {
    const netPay = rnd(0, 9_000_000)
    const ym = `${rnd(2025, 2028)}-${String(rnd(1, 12)).padStart(2, '0')}`
    // the state varies too (review 1 F-8): the fixed amount, the living items, the subscription, the spending, the targets
    const fixed = rnd(0, 4_000_000)
    const st = base({
      settings: { ...S, netPay, subRound: [1_000, 10_000, 50_000][rnd(0, 2)]!, transferDay: rnd(1, 28) },
      phases: [{ ...phases[0]!, from: `${rnd(2024, 2027)}-01`, amounts: { 't-f': fixed } }],
      targets: rnd(0, 1) ? targets : targets.filter((t) => t.kind !== 'fixed'),
      livingItems: Array.from({ length: rnd(0, 4) }, (_, i) => ({ id: `li${i}`, name: `L${i}`, amount: rnd(0, 900_000) } as LivingItem)),
      subscriptions: rnd(0, 1) ? [{ ...subs[0]!, amount: rnd(1_000, 200_000), cycle: rnd(0, 1) ? 'monthly' : 'yearly' }] : [],
      spendings: rnd(0, 1) ? [{ ...spendings[0]!, amount: rnd(1, 2_000_000), bought: `${ym}-0${rnd(1, 9)}`, rounds: [{ no: 1, date: `${ym}-1${rnd(0, 9)}`, amount: rnd(1, 2_000_000), state: 'left' }] } as unknown as Spending] : [],
    })
    const now = monthMoney(st, ym)
    const before = monthMoney(st, ym, { pay: netPay }) // the 0.1.7 call: pay = settings.netPay
    assert.deepEqual(now.dist, before.dist, `dist ${k}`)
    assert.deepEqual(now.transfer, before.transfer, `transfer ${k}`)
    assert.deepEqual(now.spend, before.spend, `spend ${k}`)
    assert.equal(now.income.total, netPay)
    assert.equal(now.income.diff, 0)
    // empty lists are the same as absent ones
    assert.deepEqual(monthMoney({ ...st, incomes: [], incomeReceipts: [], incomeExtras: [] }, ym).dist, before.dist)
  }
})

test('the salary line: expected netPay on payDay, received = the sum of its receipts in that month', () => {
  const st = base({ incomeReceipts: [rc({ amount: 3_000_000 }), rc({ amount: 260_000 }), rc({ ym: '2026-10', amount: 1 })] })
  const inc = incomeAt(st, '2026-11')
  assert.equal(inc.rows.length, 1)
  assert.deepEqual({ ...inc.rows[0] }, { key: 'salary', name: null, day: 25, expected: 3_200_000, received: 3_260_000, used: 3_260_000, diff: 60_000 })
  assert.equal(inc.total, 3_260_000)
  assert.equal(inc.allReceived, true)
})

test('the difference goes to the remainder only: the other targets do not move', () => {
  const plain = monthMoney(base(), '2026-11')
  const st = base({
    incomes: [item({})],
    incomeReceipts: [rc({ amount: 3_260_000 }), rc({ itemId: 'i1', amount: 120_000 })],
    incomeExtras: [{ id: 'x', date: '2026-11-12', name: 'Sold', amount: 45_000 } as IncomeExtra, { id: 'y', date: '2026-12-01', name: 'Later', amount: 9 } as IncomeExtra],
  })
  const m = monthMoney(st, '2026-11')
  assert.equal(m.income.expected, 3_350_000)
  assert.equal(m.income.total, 3_260_000 + 120_000 + 45_000)
  assert.equal(m.income.extraSum, 45_000)
  assert.equal(m.dist.remainder - plain.dist.remainder, (3_260_000 - 3_200_000) + 120_000 + 45_000)
  for (const r of m.dist.rows.filter((x) => x.kind !== 'remainder')) {
    assert.equal(r.amount, plain.dist.rows.find((p) => p.key === r.key)!.amount, `target ${r.key} unchanged`)
  }
  assert.deepEqual(m.spend, plain.spend)
  assert.deepEqual(m.transfer, plain.transfer)
})

test('an income not yet received counts at its expected amount', () => {
  const m = monthMoney(base({ incomes: [item({})] }), '2026-11')
  const side = m.income.rows.find((r) => r.key === 'i1')!
  assert.equal(side.received, null)
  assert.equal(side.used, 150_000)
  assert.equal(side.diff, 0)
  assert.equal(m.income.total, 3_350_000)
  assert.equal(m.income.allReceived, false)
})

test('a yearly income counts only in its month; the others list it with the next month it comes', () => {
  const st = base({ incomes: [item({ id: 'b', name: 'Bonus', cycle: 'yearly', month: 12, day: 25, amount: 1_000_000 }), item({ id: 'j', name: 'Jan', cycle: 'yearly', month: 1, amount: 5 })] })
  const nov = incomeAt(st, '2026-11')
  assert.equal(nov.rows.some((r) => r.key === 'b'), false)
  assert.deepEqual(nov.later.map((l) => [l.id, l.ym]), [['b', '2026-12'], ['j', '2027-01']])
  const dec = incomeAt(st, '2026-12')
  assert.equal(dec.rows.find((r) => r.key === 'b')!.used, 1_000_000)
  assert.equal(dec.total, 3_200_000 + 1_000_000)
  assert.deepEqual(dec.later.map((l) => l.id), ['j'])
})

test('a yearly income received short: the difference is negative', () => {
  const st = base({ incomes: [item({ id: 'b', cycle: 'yearly', month: 12, amount: 1_000_000 })], incomeReceipts: [rc({ itemId: 'b', ym: '2026-12', amount: 900_000 })] })
  assert.equal(incomeAt(st, '2026-12').rows.find((r) => r.key === 'b')!.diff, -100_000)
  assert.equal(incomeAt(st, '2026-12').diff, -100_000)
})

test('a receipt of a yearly income in another month is never dropped: it counts there with nothing expected', () => {
  const st = base({ incomes: [item({ id: 'b', cycle: 'yearly', month: 12, amount: 1_000_000 })], incomeReceipts: [rc({ itemId: 'b', ym: '2026-11', amount: 1_000_000 })] })
  const nov = incomeAt(st, '2026-11')
  assert.deepEqual({ ...nov.rows.find((r) => r.key === 'b')! }, { key: 'b', name: 'Side', day: 10, expected: 0, received: 1_000_000, used: 1_000_000, diff: 1_000_000 })
  assert.equal(nov.expected, 3_200_000)
  assert.equal(nov.total, 4_200_000)
  // its own month still expects it until something is written down there
  assert.equal(incomeAt(st, '2026-12').rows.find((r) => r.key === 'b')!.used, 1_000_000)
})

test('the what-if pay of the allocation page still wins over the incomes', () => {
  const st = base({ incomes: [item({})], incomeReceipts: [rc({ amount: 1 })] })
  assert.deepEqual(monthMoney(st, '2026-11', { pay: 2_000_000 }).dist, monthMoney(base(), '2026-11', { pay: 2_000_000 }).dist)
})
