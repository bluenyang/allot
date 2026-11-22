// spec 013 W-1: the zod rules of the budget core (S-9), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { account, balance, card, livingItem, settings, spending, target } from '../../server/validation'

const ok = (schema: { safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown[] } } }, x: unknown) => {
  const r = schema.safeParse(x)
  assert.equal(r.success, true, JSON.stringify(r.error?.issues))
}
const no = (schema: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) => assert.equal(schema.safeParse(x).success, false, JSON.stringify(x))

const OLD_ACCOUNT = { name: 'Pay', role: 'income', inflow: 'salary', outflow: 'everything' }

test('an account in the 0.1.6 shape is still accepted as it was (S-11)', () => {
  ok(account, OLD_ACCOUNT)
  ok(account, { name: 'Pay', role: '', inflow: '', outflow: '' })
})

test('last 4 digits: empty or exactly 4 numbers (S-9)', () => {
  ok(account, { ...OLD_ACCOUNT, last4: '' })
  ok(account, { ...OLD_ACCOUNT, last4: '0123' })
  no(account, { ...OLD_ACCOUNT, last4: '123' })
  no(account, { ...OLD_ACCOUNT, last4: '12345' })
  no(account, { ...OLD_ACCOUNT, last4: '12a4' })
  ok(card, { name: 'Card', last4: '9876', accountId: null, billingDay: null })
  no(card, { name: 'Card', last4: '987', accountId: null, billingDay: null })
})

test('account money fields: whole won from 0, goal and limit may be empty', () => {
  ok(account, { ...OLD_ACCOUNT, buffer: 0, goal: null, annualLimit: null })
  ok(account, { ...OLD_ACCOUNT, buffer: 1_500_000, goal: 4_000_000, annualLimit: 20_000_000 })
  no(account, { ...OLD_ACCOUNT, buffer: -1 })
  no(account, { ...OLD_ACCOUNT, goal: 10.5 })
  no(account, { ...OLD_ACCOUNT, annualLimit: 2_147_483_648 })
})

test('ratio: 0..1 with at most 4 decimals', () => {
  ok(account, { ...OLD_ACCOUNT, group: 'invest', ratio: 0.3333 })
  ok(account, { ...OLD_ACCOUNT, group: 'invest', ratio: 1 })
  no(account, { ...OLD_ACCOUNT, group: 'invest', ratio: 0.33333 })
  no(account, { ...OLD_ACCOUNT, group: 'invest', ratio: 1.01 })
})

test('only a Savings / Investment item has a monthly amount, a ratio or phase amounts', () => {
  ok(account, { ...OLD_ACCOUNT, group: 'saving', amount: 300_000, amounts: { p1: 200_000 } })
  no(account, { ...OLD_ACCOUNT, group: null, amount: 300_000 })
  no(account, { ...OLD_ACCOUNT, group: null, ratio: 0.5 })
  no(account, { ...OLD_ACCOUNT, group: null, amounts: { p1: 1 } })
  ok(account, { ...OLD_ACCOUNT, group: null, amount: 0, ratio: null, amounts: {} })
  no(account, { ...OLD_ACCOUNT, group: 'pension' })
})

test('months are YYYY-MM; free text is at most 40 characters, a note 200', () => {
  ok(account, { ...OLD_ACCOUNT, group: 'saving', from: '2026-12', stopFrom: null })
  no(account, { ...OLD_ACCOUNT, group: 'saving', from: '2026-13' })
  ok(account, { ...OLD_ACCOUNT, bank: 'x'.repeat(40) })
  no(account, { ...OLD_ACCOUNT, bank: 'x'.repeat(41) })
  ok(account, { ...OLD_ACCOUNT, note: 'x'.repeat(200) })
  no(account, { ...OLD_ACCOUNT, note: 'x'.repeat(201) })
})

test('a living item and a balance record', () => {
  ok(livingItem, { name: 'Food', kind: 'Food', payMethod: '', amount: 300_000, from: null })
  ok(livingItem, { name: 'Food', kind: '', payMethod: 'card', amount: 0, from: '2027-01', amounts: { p1: 250_000 } })
  no(livingItem, { name: '', kind: '', payMethod: '', amount: 0, from: null })
  no(livingItem, { name: 'Food', kind: '', payMethod: '', amount: -1, from: null })
  ok(balance, { accountId: 'a1', date: '2026-11-23', amount: 10_000_000 })
  no(balance, { accountId: 'a1', date: '2026-02-30', amount: 1 })
  no(balance, { accountId: 'a1', date: '2026-11-23', amount: -1 })
})

test('a card: billing day 1..31 or empty', () => {
  ok(card, { name: 'Card', last4: '', accountId: 'a1', billingDay: 16 })
  no(card, { name: 'Card', last4: '', accountId: 'a1', billingDay: 32 })
  no(card, { name: '', last4: '', accountId: null, billingDay: null })
})

test('targets take the new kinds; settings without the split keep working', () => {
  ok(target, { name: 'Savings', kind: 'saving' })
  ok(target, { name: 'Invest', kind: 'invest', accountId: 'a1' })
  ok(target, { name: 'Old', kind: 'fixed' })
  const s = { netPay: 1, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
  ok(settings, s)
  ok(settings, { ...s, savingSplit: 'ratio', investSplit: 'amount' })
  no(settings, { ...s, investSplit: 'half' })
})

const R = (no: number, amount: number) => ({ no, date: `2090-0${no + 1}-25`, amount, state: 'left', edited: false })
const buffer = {
  name: 'Mini PC', category: 'home', bought: '2090-01-10', amount: 1_000_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2090-02-25',
  rounds: [R(1, 333_330), R(2, 333_330), R(3, 333_340)],
}

test('a buffer use: a card, no fee, a refill start, 1..60 months (S-8, S-9)', () => {
  ok(spending, buffer)
  ok(spending, { ...buffer, count: 1, rounds: [R(1, 1_000_000)] })
  no(spending, { ...buffer, cardId: null })
  no(spending, { ...buffer, cardId: undefined })
  no(spending, { ...buffer, payBy: 'salary' })
  no(spending, { ...buffer, fee: 1_000 })
  no(spending, { ...buffer, refillFrom: null })
})

test('a card only on a card spending; a refill start only on a buffer use; old spendings unchanged', () => {
  const lump = { ...buffer, how: 'lump', count: 1, cardId: undefined, refillFrom: undefined, rounds: [R(1, 1_000_000)] }
  ok(spending, lump)
  ok(spending, { ...lump, cardId: 'c1' })
  ok(spending, { ...lump, cardId: null, refillFrom: null })
  no(spending, { ...lump, payBy: 'salary', cardId: 'c1' })
  no(spending, { ...lump, refillFrom: '2090-02-25' })
})

test('review 1 F-2, F-3: names have no maximum, and an unknown key is dropped as in 0.1.6', () => {
  ok(account, { ...OLD_ACCOUNT, id: 'a1' })
  ok(livingItem, { name: 'x'.repeat(41), kind: '', payMethod: '', amount: 0, from: null, extra: 1 })
  ok(card, { name: 'x'.repeat(41), last4: '', accountId: null, billingDay: null, id: 'c1' })
  ok(balance, { accountId: 'a1', date: '2026-11-23', amount: 1, id: 'b1' })
})
