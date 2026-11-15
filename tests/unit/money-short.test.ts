// spec 007 S-18 (review 14): phone trend labels — short, never 0 for a positive amount, exact rounding edges.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moneyShort } from '../../src/lib/format'

test('moneyShort: zero, small amounts, one decimal under 10만, whole 만 above', () => {
  const cases: [number, string][] = [
    [0, '0'], [0.4, '0'], [1, '₩1'], [499, '₩499'], [999, '₩999'],
    [1000, '0.1만'], [1049, '0.1만'], [1050, '0.1만'], [1051, '0.1만'], [9_950, '1만'], [10_000, '1만'], [12_345, '1.2만'],
    [99_449, '9.9만'], [99_500, '10만'], [100_000, '10만'], [104_999, '10만'], [105_000, '11만'], [506_844, '51만'],
    [12_345_678, '1,235만'], [-1, '−₩1'], [-12_345, '−1.2만'],
  ]
  for (const [n, want] of cases) assert.equal(moneyShort(n), want, String(n))
})

test('moneyShort: a positive amount never reads as zero', () => {
  for (let n = 1; n < 200_000; n += 37) assert.notEqual(moneyShort(n).replace(/[^1-9]/g, ''), '', String(n))
})
