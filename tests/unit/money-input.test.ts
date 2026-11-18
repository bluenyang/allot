// spec 010 S-5 / S-10 (W-2): MoneyInput takes everything a type="number" amount field took.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupMoney, moneyText, moneyValue, parseMoney, sameMoney } from '../../src/lib/money-input'

const num = (s: string) => {
  const p = parseMoney(s)
  assert.equal(p.kind, 'ok', s)
  return p.kind === 'ok' ? p.value : NaN
}

test('parseMoney: integers, decimals, zero, sign, with or without separators', () => {
  const cases: [string, number][] = [
    ['0', 0], ['00', 0], ['-0', 0], ['0.0', 0], ['7', 7], ['10000', 10000], ['1,000', 1000], ['1,234,567', 1234567], ['1234567', 1234567],
    ['12.5', 12.5], ['12.50', 12.5], ['.5', 0.5], ['5.', 5], ['0.1', 0.1], ['1,234.56', 1234.56], ['-12.5', -12.5], ['+3', 3], ['−1,000', -1000],
    ['1e3', 1000], ['1.5E2', 150], ['2e-2', 0.02], [' 1 000 ', 1000], ['1,00', 100], ['1380.25', 1380.25], ['99.99', 99.99],
  ]
  for (const [s, want] of cases) assert.equal(num(s), want, s)
})

test('parseMoney: empty means empty (also blanks); text no number input holds is not a number', () => {
  for (const s of ['', ' ', ',']) assert.equal(parseMoney(s).kind, 'empty', JSON.stringify(s))
  for (const s of ['abc', '-', '+', '.', '1.2.3', '1e', '12a', '--1', '1-', '₩1000', 'NaN', 'Infinity', '1e999']) assert.equal(parseMoney(s).kind, 'bad', s)
})

test('parseMoney: every value of the number field round-trips (String(n) → parse)', () => {
  for (const n of [0, 1, 9, 10, 999, 1000, 12.5, 0.1, 0.01, 1234567.89, 1e7, 123456789012, -5, -0.5, 1 / 3, 1e-7, 1e21]) {
    assert.equal(num(String(n)), n, String(n))
    assert.equal(num(moneyText(n)), n, `shown ${moneyText(n)}`)
  }
})

test('moneyValue: a number, or the field\'s own empty', () => {
  assert.equal(moneyValue(parseMoney('12.5'), ''), 12.5)
  assert.equal(moneyValue(parseMoney(''), ''), '')
  assert.equal(moneyValue(parseMoney(''), null), null)
  assert.equal(moneyValue(parseMoney('abc'), ''), '')
  assert.equal(moneyValue(parseMoney('0'), ''), 0)
})

test('groupMoney / moneyText: thousands while typing, the rest left as typed', () => {
  assert.equal(groupMoney('1234'), '1,234')
  assert.equal(groupMoney('1234567.891'), '1,234,567.891')
  assert.equal(groupMoney('1,2,3,4'), '1,234')
  assert.equal(groupMoney('-1234.50'), '-1,234.50')
  assert.equal(groupMoney('12.'), '12.')
  assert.equal(groupMoney('-'), '-')
  assert.equal(groupMoney('.5'), '.5')
  assert.equal(groupMoney('0012'), '12')
  assert.equal(groupMoney('0'), '0')
  assert.equal(groupMoney('00.5'), '0.5')
  assert.equal(groupMoney('abc'), 'abc')
  assert.equal(moneyText(0), '0')
  assert.equal(moneyText(''), '')
  assert.equal(moneyText(null), '')
  assert.equal(moneyText(1234567), '1,234,567')
  assert.equal(moneyText(12.5), '12.5')
  assert.equal(moneyText(-1234.5), '-1,234.5')
  assert.equal(moneyText(1e21), '1e+21')
})

test('sameMoney: a model change that typing caused leaves the text alone', () => {
  assert.ok(sameMoney('1,000', 1000))
  assert.ok(sameMoney('', ''))
  assert.ok(sameMoney('', null))
  assert.ok(sameMoney('-', ''))
  assert.ok(!sameMoney('1,000', 2000))
  assert.ok(!sameMoney('', 0))
  assert.ok(!sameMoney('5', ''))
})
