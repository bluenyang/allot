// spec 011 W-2: the zod rules of a spending and its rounds (server/validation.ts), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueMessage } from '../../server/messages'
import { spending } from '../../server/validation'

const R = (no: number, over: Record<string, unknown> = {}) => ({ no, date: `2090-0${no + 1}-16`, amount: 101_000, state: 'left', edited: false, ...over })
const card = {
  name: 'Fridge', category: 'home', bought: '2090-01-10', amount: 300_000, currency: 'KRW', fxRate: null,
  how: 'installment', payBy: 'card', count: 3, fee: 3_000, interval: null, cancelled: false, rounds: [R(1), R(2), R(3)],
}
const lump = { ...card, how: 'lump', count: 1, fee: 0, rounds: [R(1)] }
const split = { ...card, how: 'split', payBy: 'salary', fee: 0, interval: 'biweekly' }
const usd = { ...lump, amount: 49.5, currency: 'USD', fxRate: 1380 }

const ok = (x: unknown) => assert.equal(spending.safeParse(x).success, true, JSON.stringify(spending.safeParse(x).error?.issues))
const no = (x: unknown, path?: string) => {
  const r = spending.safeParse(x)
  assert.equal(r.success, false)
  if (path) assert.ok(r.error!.issues.some((i) => i.path.join('.') === path), `${path} in ${JSON.stringify(r.error!.issues.map((i) => i.path))}`)
}

test('accepts a card installment, a lump sum, a split and a USD spending', () => {
  for (const x of [card, lump, split, usd, { ...card, note: 'a note' }, { ...card, payBy: 'salary', fee: 0 }, { ...card, payBy: 'subs', fee: 0 }]) ok(x)
})

test('accepts an early payoff: merged rounds plus one new round, also a paid round', () => {
  ok({ ...card, rounds: [R(1, { state: 'paid' }), R(2, { state: 'merged' }), R(3, { state: 'merged' }), R(4, { amount: 202_000 })] })
  ok({ ...card, rounds: [R(1), R(2, { edited: true, amount: 50 }), R(3)], cancelled: true })
})

test('refuses a USD spending without a rate, a KRW one with a rate, a fractional KRW amount', () => {
  no({ ...usd, fxRate: null }, 'fxRate')
  no({ ...card, fxRate: 1380 }, 'fxRate')
  no({ ...card, amount: 1000.5 }, 'amount')
  no({ ...usd, fxRate: 0 })
})

test('refuses a way to pay that does not fit the count, the fee or the interval', () => {
  no({ ...lump, count: 2 }, 'count')
  no({ ...card, count: 1, rounds: [R(1)] }, 'count')
  no({ ...card, payBy: 'salary' }, 'fee') // a fee belongs to a card installment
  no({ ...lump, payBy: 'card', fee: 100 }, 'fee')
  no({ ...card, interval: 'monthly' }, 'interval')
  no({ ...split, interval: null }, 'interval')
  no({ ...split, interval: 'weekly' })
  no({ ...card, how: 'buffer' })
})

test('refuses rounds that do not match the spending', () => {
  no({ ...card, rounds: [] })
  no({ ...card, rounds: [R(1), R(2)] }, 'rounds') // fewer than the count
  no({ ...card, rounds: [R(1), R(2), R(3), R(4)] }, 'rounds') // one more, but nothing merged
  no({ ...card, rounds: [R(2), R(3), R(4)] }, 'rounds') // not numbered from 1
  no({ ...card, rounds: [R(1), R(3), R(2)] }, 'rounds') // not in order
  no({ ...card, rounds: [R(1), R(1), R(2)] }, 'rounds') // a number twice
  no({ ...lump, rounds: [R(1), R(2, { state: 'merged' })] }, 'rounds')
  no({ ...lump, rounds: [R(1, { state: 'merged' })] }, 'rounds')
  no({ ...card, rounds: Array.from({ length: 61 }, (_, i) => R(1, { no: i + 1 })) })
})

test('refuses a bad round: negative or fractional amount, an unreal date, an unknown state, a stray field', () => {
  no({ ...card, rounds: [R(1, { amount: -1 }), R(2), R(3)] })
  no({ ...card, rounds: [R(1, { amount: 10.5 }), R(2), R(3)] })
  no({ ...card, rounds: [R(1, { date: '2090-02-30' }), R(2), R(3)] })
  no({ ...card, rounds: [R(1, { date: '2090-2-3' }), R(2), R(3)] })
  no({ ...card, rounds: [R(1, { state: 'done' }), R(2), R(3)] })
  no({ ...card, rounds: [R(1, { extra: 1 }), R(2), R(3)] })
})

test('refuses a bad amount, count, fee, bought date and an empty name', () => {
  no({ ...card, amount: -1 })
  no({ ...card, count: 61 })
  no({ ...card, count: 0 })
  no({ ...card, fee: -1 })
  no({ ...card, bought: '2090-13-01' })
  no({ ...card, name: '  ' })
  no({ ...card, category: '' })
})

test('every message of a refusal is worded in both languages', () => {
  for (const x of [{ ...usd, fxRate: null }, { ...card, count: 1 }, { ...card, rounds: [R(1)] }, { ...card, amount: 1.5 }]) {
    const issue = spending.safeParse(x).error!.issues[0]
    for (const lang of ['ko', 'en'] as const) assert.ok(issueMessage(lang, issue).length > 3)
  }
})
