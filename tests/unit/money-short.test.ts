// spec 007 S-18 (review 14): phone trend labels — short, never 0 for a positive amount, exact rounding edges.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moneyShort } from '../../src/lib/format'

test('moneyShort: zero, small amounts, one decimal under 10만, whole 만 above', () => {
  const cases: [number, string][] = [
    [0, '0'], [-0, '0'], [0.4, '<₩1'], [1 / 12, '<₩1'], [-0.4, '−<₩1'], [1, '₩1'], [12 / 12, '₩1'], [499, '₩499'], [999, '₩999'],
    [1000, '0.1만'], [1049, '0.1만'], [1050, '0.1만'], [1051, '0.1만'], [9_950, '1만'], [10_000, '1만'], [12_345, '1.2만'],
    [99_449, '9.9만'], [99_500, '10만'], [100_000, '10만'], [104_999, '10만'], [105_000, '11만'], [506_844, '51만'],
    [12_345_678, '1,235만'], [-1, '−₩1'], [-12_345, '−1.2만'],
  ]
  for (const [n, want] of cases) assert.equal(moneyShort(n), want, String(n))
})

test('moneyShort: an amount that is not zero never reads as zero (fractions too: yearly ÷ 12)', () => {
  for (let n = 1 / 12; n < 200_000; n += 37.3) assert.notEqual(moneyShort(n), '0', String(n))
})

// spec 008 S-9: English amount units (₩1,234 · ₩1,234K · ₩123.4×10K), Korean unchanged.
import { manText, money, wonText } from '../../src/lib/format'

test('English units: won ₩1,234, thousand ₩1,234K, ×10,000 ₩123.4×10K; Korean as before', () => {
  const p = (amountUnit: 'won' | 'thousand' | 'man') => ({ amountUnit, negative: 'minus' as const, dateFormat: 'iso' as const })
  assert.equal(money(1_234, p('won'), 'en'), '₩1,234')
  assert.equal(money(1_234_000, p('thousand'), 'en'), '₩1,234K')
  assert.equal(money(1_234_000, p('man'), 'en'), '₩123.4×10K')
  assert.equal(money(-1_234, p('won'), 'en'), '−₩1,234')
  assert.equal(money(-1_234, { ...p('won'), negative: 'paren' }, 'en'), '(₩1,234)')
  assert.equal(money(-0.4, p('man'), 'en'), '₩0×10K', 'a negative that rounds to zero has no sign')
  assert.equal(money(1_234_000, p('thousand'), 'ko'), '1,234천원')
  assert.equal(money(1_234_000, p('man'), 'ko'), '123.4만원')
  assert.equal(moneyShort(12_345, 'en'), '1.2×10K')
  assert.equal(moneyShort(990, 'en'), '₩990')
  assert.equal(wonText(1234.4, 'en'), '₩1,234')
  assert.equal(wonText(1234.4, 'ko'), '1,234원')
  assert.equal(manText(125_000, 'en'), '12.5×10K')
  assert.equal(manText(125_000, 'ko'), '12.5만')
})
