// spec 013 rc.3 data layer: the zod rules of S-22, S-23 and S-26 (time zone, currency codes, the currency list, monthly
// dates) and the calc for foreign currencies and "today" in a time zone. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foreignCurrency, preferences, scheduleItem, settings, spending, subscription } from '../../server/validation'
import { chargeKrw, priced, rateOf, spendingKrw, timeZoneName, todayIn, transferAt, ymd } from '../../src/lib/calc'
import type { Settings, Subscription } from '../../src/data/types'
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from '../../src/data/defaults'

const ok = (schema: { safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown[] } } }, x: unknown) => {
  const r = schema.safeParse(x)
  assert.equal(r.success, true, JSON.stringify(r.error?.issues))
}
const no = (schema: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) => assert.equal(schema.safeParse(x).success, false, JSON.stringify(x))

const SUB = { name: 'S', category: 'tool', plan: 'p', amount: 1.5, currency: 'USD', vat: 10, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false }
const SPEND = { name: 'X', category: 'c', bought: '2031-01-10', amount: 100, currency: 'USD', fxRate: 1000, fxBuffer: 3.5, how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false, rounds: [{ no: 1, date: '2031-02-16', amount: 103_500, state: 'left', edited: false }] }

test('the old currency values are still accepted: KRW and USD on subscriptions and spendings (S-23)', () => {
  ok(subscription, SUB)
  ok(subscription, { ...SUB, currency: 'KRW', amount: 10_000, vat: 0 })
  ok(spending, SPEND)
  ok(spending, { ...SPEND, currency: 'KRW', amount: 5000, fxRate: null, fxBuffer: null, rounds: [{ no: 1, date: '2031-02-16', amount: 5000, state: 'left', edited: false }] })
})

test('a currency code is three capitals (S-26); another foreign code carries a rate and a buffer like USD', () => {
  ok(subscription, { ...SUB, currency: 'EUR' })
  no(subscription, { ...SUB, currency: 'eur' })
  no(subscription, { ...SUB, currency: 'EURO' })
  ok(spending, { ...SPEND, currency: 'JPY' })
  ok(spending, { ...SPEND, currency: 'VND', fxRate: 0.054812 }) // 6 decimals (review rc3-1 F-2, A-43)
  no(spending, { ...SPEND, currency: 'VND', fxRate: 0.0548123 })
  no(spending, { ...SPEND, fxBuffer: 3.555 }) // the buffer keeps 2
  no(spending, { ...SPEND, currency: 'JPY', fxRate: null })
  no(spending, { ...SPEND, currency: 'JPY', fxBuffer: null })
})

test('the currency list: code, rate above 0, buffer 0..100; KRW and USD are not list rows (S-26, A-35)', () => {
  ok(foreignCurrency, { code: 'EUR', rate: 1500.25, buffer: 2 })
  ok(foreignCurrency, { code: 'JPY', rate: 9.1, buffer: 0, auto: true })
  no(foreignCurrency, { code: 'KRW', rate: 1, buffer: 0 })
  no(foreignCurrency, { code: 'USD', rate: 1400, buffer: 0 })
  no(foreignCurrency, { code: 'EUR', rate: 0, buffer: 0 })
  no(foreignCurrency, { code: 'EUR', rate: 1500, buffer: 101 })
  no(foreignCurrency, { code: 'EUR', rate: 1500, buffer: -1 })
})

test('settings in the rc.2 shape are accepted; fxAuto is optional (S-23)', () => {
  const { fxAuto: _a, fxAutoAt: _b, fxAutoError: _c, ...old } = DEFAULT_SETTINGS
  ok(settings, old)
  ok(settings, { ...old, fxAuto: true })
  const parsed = settings.parse(old)
  assert.equal('fxAuto' in parsed && parsed.fxAuto !== undefined, false, 'left out stays left out (the saved value is kept)')
})

test('time zone: an IANA name, stored in its canonical spelling; left out keeps the saved one (S-22, S-26)', () => {
  const { timezone: _t, ...old } = DEFAULT_PREFERENCES
  ok(preferences, old)
  assert.equal(preferences.parse(old).timezone, undefined)
  assert.equal(preferences.parse({ ...old, timezone: 'asia/seoul' }).timezone, 'Asia/Seoul')
  assert.equal(preferences.parse({ ...old, timezone: 'UTC' }).timezone, 'UTC')
  no(preferences, { ...old, timezone: '+09:00' })
  no(preferences, { ...old, timezone: 'Nowhere/Town' })
  no(preferences, { ...old, timezone: '' })
  assert.equal(timeZoneName('Europe/Berlin'), 'Europe/Berlin')
})

test('a monthly date: name, day 1..31, account or none, in or out (S-22, S-26, A-36)', () => {
  ok(scheduleItem, { name: 'Rent', day: 1, accountId: null, direction: 'out' })
  ok(scheduleItem, { name: 'Bonus', day: 31, accountId: 'a1', direction: 'in', note: 'n' })
  no(scheduleItem, { name: '', day: 1, accountId: null, direction: 'out' })
  no(scheduleItem, { name: 'X', day: 0, accountId: null, direction: 'out' })
  no(scheduleItem, { name: 'X', day: 32, accountId: null, direction: 'out' })
  no(scheduleItem, { name: 'X', day: 5, accountId: null, direction: 'sideways' })
})

test('today in a time zone: the date there, not the process clock (S-22)', () => {
  const at = new Date('2026-11-23T16:30:00Z') // 01:30 on the 24th in Seoul, 08:30 on the 23rd in Los Angeles
  assert.equal(ymd(todayIn('Asia/Seoul', at)), '2026-11-24')
  assert.equal(ymd(todayIn('America/Los_Angeles', at)), '2026-11-23')
  assert.equal(ymd(todayIn('UTC', at)), '2026-11-23')
  assert.equal(ymd(todayIn(undefined, at)), '2026-11-24', 'no zone = Asia/Seoul')
  assert.equal(ymd(todayIn('Nowhere/Town', at)), '2026-11-24', 'an unknown zone = Asia/Seoul')
})

const S: Settings = { ...DEFAULT_SETTINGS, fxRate: 1400, fxBuffer: 3, subRound: 10_000 }
const sub = (over: Partial<Subscription>): Subscription => ({ id: 'x', name: 'x', category: 'tool', plan: '', amount: 10, currency: 'USD', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-12-05', path: 'direct', verified: false, ...over })

test('rates: KRW 1, USD from the settings, another code from the list (S-23)', () => {
  const p = priced(S, [{ id: 'e', code: 'EUR', rate: 1500, buffer: 5, auto: false }])
  assert.deepEqual(rateOf('KRW', p), { rate: 1, buffer: 0 })
  assert.deepEqual(rateOf('USD', p), { rate: 1400, buffer: 3 })
  assert.deepEqual(rateOf('EUR', p), { rate: 1500, buffer: 5 })
  assert.equal(chargeKrw(sub({ currency: 'EUR', amount: 10, vat: 10 }), p), 10 * 1.1 * 1500)
  assert.equal(spendingKrw(100, 'EUR', { fxRate: 1500, fxBuffer: 2 }), 153_000, 'a spending keeps its own saved rate and buffer')
})

test('the subscription transfer: each currency takes its own buffer; USD and KRW only gives what it gave before (S-23)', () => {
  const usd = sub({ id: 'u', amount: 10 })
  const krw = sub({ id: 'k', currency: 'KRW', amount: 20_000 })
  const eur = sub({ id: 'e', currency: 'EUR', amount: 10 })
  const before = transferAt([usd, krw], [], priced(S), '2026-12')
  assert.equal(before.buffer, (10 * 1400 * 3) / 100)
  assert.equal(before.foreignMonthly, before.usdMonthly)
  const p = priced(S, [{ id: 'e', code: 'EUR', rate: 1500, buffer: 10, auto: false }])
  const after = transferAt([usd, krw, eur], [], p, '2026-12')
  assert.equal(after.usdMonthly, 14_000)
  assert.equal(after.foreignMonthly, 14_000 + 15_000)
  assert.equal(after.buffer, (14_000 * 3) / 100 + (15_000 * 10) / 100)
  assert.equal(after.transfer, Math.ceil(Math.ceil((14_000 + 20_000 + 15_000 + after.buffer) / 1000) * 1000 / 10_000) * 10_000)
})

test('a rate refresh that changes no rate leaves the state fingerprint of a pending proposal as it was (S-23)', async () => {
  const { hashState } = await import('../../server/preview')
  const base = { settings: { ...DEFAULT_SETTINGS, fxAutoAt: null, fxAutoError: null }, currencies: [{ id: 'e', code: 'EUR', rate: 1500, buffer: 0, auto: true, autoAt: null, autoError: null }] }
  const refreshed = { settings: { ...base.settings, fxAutoAt: '2026-11-23T00:00:00Z', fxAutoError: 'network' }, currencies: [{ ...base.currencies[0]!, autoAt: '2026-11-23T00:00:00Z' }] }
  assert.equal(hashState(refreshed), hashState(base))
  assert.notEqual(hashState({ ...refreshed, currencies: [{ ...refreshed.currencies[0]!, rate: 1501 }] }), hashState(base), 'a changed rate still counts')
})
