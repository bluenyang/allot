// spec 013 S-23: the screens' currency helpers (src/lib/currency.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ForeignCurrency, PlanChange, Spending, Subscription } from '../../src/data/types'
import { chargeLabel, COMMON_CODES, currencyCodes, currencyUses, fxAmount, normalCode, rateFor, rateNum } from '../../src/lib/currency'
import { num } from '../../src/lib/calc'

const eur: ForeignCurrency = { id: 'c1', code: 'EUR', rate: 1500, buffer: 2, auto: false }
const jpy: ForeignCurrency = { id: 'c2', code: 'JPY', rate: 9.05, buffer: 0, auto: true }
const settings = { fxRate: 1400, fxBuffer: 5 }

test('a picker offers KRW, USD and the list in its order, and keeps a stored code that is not there', () => {
  assert.deepEqual(currencyCodes([]), ['KRW', 'USD'])
  assert.deepEqual(currencyCodes([eur, jpy]), ['KRW', 'USD', 'EUR', 'JPY'])
  assert.deepEqual(currencyCodes([eur], 'USD'), ['KRW', 'USD', 'EUR'])
  assert.deepEqual(currencyCodes([eur], 'GBP'), ['KRW', 'USD', 'EUR', 'GBP'])
})

test('rateFor: USD from the settings, a listed code from the list, none for KRW or an unknown code', () => {
  assert.deepEqual(rateFor('USD', settings, [eur]), { rate: 1400, buffer: 5 })
  assert.deepEqual(rateFor('EUR', settings, [eur]), { rate: 1500, buffer: 2 })
  assert.equal(rateFor('KRW', settings, [eur]), null)
  assert.equal(rateFor('GBP', settings, [eur]), null)
})

test('foreign amounts: USD reads as before, another code by its code', () => {
  assert.equal(fxAmount('USD', 12.5), '$12.50')
  assert.equal(fxAmount('EUR', 1234.5), 'EUR 1,234.50')
  assert.equal(chargeLabel({ currency: 'KRW', amount: 9900 }, num), 'KRW 9,900')
  assert.equal(chargeLabel({ currency: 'USD', amount: 12, vat: 10 }, num), 'USD 12.00 +10%')
  assert.equal(chargeLabel({ currency: 'EUR', amount: 8 }, num), 'EUR 8.00')
  assert.equal(rateNum(1380), '1,380')
  assert.equal(rateNum(9.05), '9.05')
  assert.equal(rateNum(0.054793), '0.054793', 'a small unit shows its stored rate (review rc3-2 N-1)')
})

test('uses of a code: subscriptions (a plan change to it counts for its subscription) and spendings', () => {
  const sub = (id: string, currency: string) => ({ id, currency }) as Subscription
  const subs = [sub('a', 'EUR'), sub('b', 'KRW'), sub('c', 'USD')]
  const changes = [{ id: 'p1', subId: 'b', effective: null, to: { currency: 'EUR' } }, { id: 'p2', subId: 'a', effective: null, to: { currency: 'EUR' } }] as PlanChange[]
  const spendings = [{ currency: 'EUR' }, { currency: 'KRW' }] as Spending[]
  assert.deepEqual(currencyUses('EUR', subs, changes, spendings), { subs: 2, spendings: 1 })
  assert.deepEqual(currencyUses('JPY', subs, changes, spendings), { subs: 0, spendings: 0 })
})

test('a typed code is trimmed and upper-cased; the common list holds neither KRW nor USD', () => {
  assert.equal(normalCode(' eur '), 'EUR')
  assert.ok(!(COMMON_CODES as readonly string[]).some((c) => c === 'KRW' || c === 'USD'))
  for (const c of COMMON_CODES) assert.match(c, /^[A-Z]{3}$/)
})
