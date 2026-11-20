import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMonthText, valueToYm, valueToYmd, ymdToValue, ymToValue } from '../../src/lib/date-value'

test('a day string round-trips through the date value', () => {
  for (const s of ['2027-03-05', '2024-02-29', '1999-12-31', '2027-01-01']) {
    const v = ymdToValue(s)
    assert.ok(v, s)
    assert.equal(valueToYmd(v), s)
  }
})

test('a string that is not a real day gives no value', () => {
  for (const s of ['', null, undefined, '2027-02-30', '2027-13-01', '2027-00-10', '2027-3-5', '2027-03', '2023-02-29', 'abc']) assert.equal(ymdToValue(s as string), undefined, String(s))
})

test('a month string maps to its first day and back', () => {
  const v = ymToValue('2027-03')
  assert.ok(v)
  assert.equal(v.day, 1)
  assert.equal(valueToYm(v), '2027-03')
  assert.equal(ymToValue('2027-13'), undefined)
  assert.equal(ymToValue('2027-00'), undefined)
  assert.equal(ymToValue(''), undefined)
})

test('month text: separators and one-digit months are read, the rest is not', () => {
  for (const [t, ym] of [['2027-03', '2027-03'], ['2027-3', '2027-03'], ['2027.3', '2027-03'], ['2027/12', '2027-12'], ['202703', '2027-03'], [' 2027 03 ', '2027-03']] as const) assert.equal(parseMonthText(t), ym, t)
  for (const t of ['', '2027', '2027-13', '2027-00', '27-03', 'abc', '2027-03-01']) assert.equal(parseMonthText(t), null, t)
})
