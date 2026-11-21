// spec 011 W-2: the zod rules of a spending and its rounds (server/validation.ts), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueMessage } from '../../server/messages'
import { spending } from '../../server/validation'
import { payOffEarly, spendingKrw } from '../../src/lib/calc'
import { ROUND_MAX, roundsProblem } from '../../src/lib/spending-rules'

const R = (no: number, over: Record<string, unknown> = {}) => ({ no, date: `2090-0${no + 1}-16`, amount: 101_000, state: 'left', edited: false, ...over })
const card = {
  name: 'Fridge', category: 'home', bought: '2090-01-10', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'installment', payBy: 'card', count: 3, fee: 3_000, interval: null, cancelled: false, rounds: [R(1), R(2), R(3)],
}
const lump = { ...card, how: 'lump', count: 1, fee: 0, rounds: [R(1)] }
const split = { ...card, how: 'split', payBy: 'salary', fee: 0, interval: 'biweekly' }
const usd = { ...lump, amount: 49.5, currency: 'USD', fxRate: 1380, fxBuffer: 3 }

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

test('the buffer is fixed with the rate: USD needs it, KRW has none, it stays within 0..100', () => {
  no({ ...usd, fxBuffer: null }, 'fxBuffer')
  no({ ...card, fxBuffer: 3 }, 'fxBuffer')
  no({ ...usd, fxBuffer: -1 })
  no({ ...usd, fxBuffer: 101 })
  ok({ ...usd, fxBuffer: 0 })
  ok({ ...usd, fxBuffer: 3.5 })
  ok({ ...usd, fxBuffer: 3.46 })
  no({ ...usd, fxBuffer: 3.456 }, 'fxBuffer')
  ok({ ...usd, fxRate: 1380.25 })
  no({ ...usd, fxRate: 1380.256 }, 'fxRate')
  // the check is exact: a value that is only close to a 2-decimal one would be stored rounded
  no({ ...usd, fxRate: 1.000000009 }, 'fxRate')
  for (const v of [3.46, 1380.25, 0.1, 99.99]) { ok({ ...usd, fxRate: v }); if (v <= 100) ok({ ...usd, fxBuffer: v }) }
  // so the principal worked out from what is sent is the one the stored columns give (USD 100,000,000 at 1.00, no buffer)
  assert.equal(spendingKrw(100_000_000, 'USD', { fxRate: 1, fxBuffer: 0 }), 100_000_000)
  no({ ...usd, amount: 100_000_000, fxRate: 1.000000009, fxBuffer: 0, rounds: [R(1, { amount: 50_000_000 })] }, 'fxRate')
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

test('rounds of one spending add up to at most 2,147,483,647 (merged rounds do not count)', () => {
  no({ ...card, count: 3, fee: 0, payBy: 'salary', rounds: [R(1, { amount: 1_000_000_000 }), R(2, { amount: 1_000_000_000 }), R(3, { amount: 1_000_000_000 })] }, 'rounds')
  ok({ ...card, fee: 0, payBy: 'salary', rounds: [R(1, { amount: ROUND_MAX }), R(2, { state: 'merged', amount: ROUND_MAX }), R(3, { state: 'merged', amount: ROUND_MAX })] })
})

test('a KRW amount plus its fee must fit one round', () => {
  no({ ...card, amount: ROUND_MAX, fee: 1 }, 'amount')
})

test('roundsProblem is the one rule: a revert that leaves count 4 with 3 rounds breaks it', () => {
  const rounds = [R(1, { state: 'paid' }), R(2, { state: 'left' }), R(3, { state: 'left' })] as { no: number; amount: number; state: 'left' | 'paid' | 'merged' }[]
  assert.equal(roundsProblem({ how: 'installment', count: 3, rounds }), null)
  assert.equal(roundsProblem({ how: 'installment', count: 4, rounds }), 'rounds')
  assert.equal(roundsProblem({ how: 'lump', count: 2, rounds }), 'count')
})

test('an early payoff of a maximal spending is one saveable round', () => {
  const x = { ...card, fee: 0, payBy: 'salary', rounds: [R(1, { amount: 1_000_000_000 }), R(2, { amount: 1_000_000_000 }), R(3, { amount: 147_483_647 })] }
  ok(x)
  const off = payOffEarly(x.rounds as never, '2090-05-16')
  assert.equal(off.at(-1)!.amount, ROUND_MAX)
  ok({ ...x, rounds: off })
})

test('every message of a refusal is worded in both languages', () => {
  for (const x of [{ ...usd, fxRate: null }, { ...card, count: 1 }, { ...card, rounds: [R(1)] }, { ...card, amount: 1.5 }]) {
    const issue = spending.safeParse(x).error!.issues[0]
    for (const lang of ['ko', 'en'] as const) assert.ok(issueMessage(lang, issue).length > 3)
  }
})
