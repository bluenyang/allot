// spec 009 S-3: the fingerprint of the data and the month preview (synthetic data, no database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonical, hashState, incomeLine, monthPreview } from '../../server/preview'
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

test('the preview reads the living items, the savings accounts and a buffer use (spec 013 S-10)', () => {
  const item = { id: 'i1', name: 'E2E-food', kind: '', payMethod: '', amount: 400_000, from: null, code: 'food' as const, amounts: {} }
  const base: Data = {
    ...data,
    livingItems: [item],
    targets: [...data.targets, { id: 't-sv', name: 'Saving total', kind: 'saving' }],
    accounts: [{ id: 'a1', name: 'E2E-cma', role: '', inflow: '', outflow: '', group: 'saving', amount: 100_000 }],
    cards: [{ id: 'c1', name: 'E2E-card', last4: '', accountId: 'a1', billingDay: null }],
  }
  // a new living item and a larger savings amount come out of the remainder
  const more: Data = { ...base, livingItems: [item, { ...item, id: 'i2', name: 'E2E-other', code: null, amount: 50_000 }], accounts: [{ ...base.accounts[0]!, amount: 300_000 }] }
  const p = monthPreview(base, more, '2026-11')
  assert.deepEqual(p.distribution.find((r) => r.targetId === 't-live')!.amountKrw, { before: 400_000, after: 450_000 })
  assert.deepEqual(p.distribution.find((r) => r.targetId === 't-sv')!.amountKrw, { before: 100_000, after: 300_000 })
  assert.equal(p.remainderKrw.before - p.remainderKrw.after, 250_000)
  // a buffer use takes only its refill off the month's remainder, not the bill
  const refill = (no: number, date: string) => ({ no, date, amount: 150_000, state: 'left' as const, edited: false })
  const buf: Data = { ...base, spendings: [{
    id: 'b', name: 'E2E-pc', category: 'etc', bought: '2026-11-02', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'buffer', payBy: 'card',
    count: 2, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-11-25', rounds: [refill(1, '2026-11-25'), refill(2, '2026-12-25')],
  }] }
  for (const ym of ['2026-11', '2026-12']) assert.equal(monthPreview(base, buf, ym).remainderKrw.before - monthPreview(base, buf, ym).remainderKrw.after, 150_000)
})

// ── spec 014 S-10: income rows in words, with the left over of their month ──
test('an income, money received and money that came in once each read as a line', () => {
  const side = { id: 'in1', name: 'E2E-side', cycle: 'monthly' as const, month: null, day: 10, amount: 200_000, accountId: null }
  const base: Data = { ...data, incomes: [side] }
  // a new monthly and a yearly income
  assert.equal(incomeLine({ table: 'income_item', op: 'insert', before: null, after: side }, data, base),
    'New income "E2E-side": 200,000 KRW, every month on day 10.')
  const bonus = { id: 'in2', name: 'E2E-bonus', cycle: 'yearly', month: 3, day: 15, amount: 1_000_000, accountId: null }
  assert.equal(incomeLine({ table: 'income_item', op: 'update', before: { ...bonus, amount: 900_000 }, after: bonus }, base, base),
    'Changed income "E2E-bonus": 900,000 KRW → 1,000,000 KRW, every March on day 15.')
  // money received for the salary and for an income: whose, the month, the amount, and the left over before and after
  const r1 = { id: 'r1', itemId: null, ym: '2026-11', amount: 3_100_000, date: '2026-11-25' }
  const got: Data = { ...base, incomeReceipts: [r1] }
  const left = (d: Data) => overview(d, '2026-11').distribution.remainderKrw.toLocaleString('en-US')
  assert.equal(incomeLine({ table: 'income_receipt', op: 'insert', before: null, after: r1 }, base, got),
    `New money received for salary in 2026-11: 3,100,000 KRW on 2026-11-25; left over of 2026-11: ${left(base)} KRW → ${left(got)} KRW.`)
  assert.equal(overview(got, '2026-11').distribution.remainderKrw - overview(base, '2026-11').distribution.remainderKrw, 100_000)
  const r2 = { id: 'r2', itemId: 'in1', ym: '2026-11', amount: 150_000, date: null }
  const less: Data = { ...got, incomeReceipts: [r1, r2] }
  assert.equal(incomeLine({ table: 'income_receipt', op: 'delete', before: r2, after: null }, less, got),
    `Deleted money received for "E2E-side" in 2026-11: 150,000 KRW; left over of 2026-11: ${left(less)} KRW → ${left(got)} KRW.`)
  // a receipt moved to another month shows both months
  const moved = incomeLine({ table: 'income_receipt', op: 'update', before: r1, after: { ...r1, ym: '2026-12' } }, got, { ...got, incomeReceipts: [{ ...r1, ym: '2026-12' }] })!
  assert.match(moved, /in 2026-11 → 2026-12: 3,100,000 KRW on 2026-11-25; left over of 2026-11: .+; left over of 2026-12: .+\.$/)
  // money that came in once, in the month of its date
  const x1 = { id: 'x1', date: '2027-01-03', name: 'E2E-refund', amount: 50_000 }
  const extra: Data = { ...base, incomeExtras: [x1] }
  const jan = (d: Data) => overview(d, '2027-01').distribution.remainderKrw.toLocaleString('en-US')
  assert.equal(incomeLine({ table: 'income_extra', op: 'insert', before: null, after: x1 }, base, extra),
    `New money that came in once "E2E-refund" on 2027-01-03: 50,000 KRW; left over of 2027-01: ${jan(base)} KRW → ${jan(extra)} KRW.`)
  // other tables have no line
  assert.equal(incomeLine({ table: 'subscription', op: 'insert', before: null, after: { id: 's9' } }, data, data), null)
})
