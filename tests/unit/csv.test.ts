// spec 013 S-17: the CSV export — RFC 4180 quoting, CRLF, a UTF-8 BOM, numbers as plain digits.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvField, toCsv, wonCell } from '../../src/lib/csv'

test('toCsv: BOM first, CRLF after every record', () => {
  const out = toCsv([['이름', '금액'], ['E2E-구독', 12000]])
  assert.equal(out, '﻿이름,금액\r\nE2E-구독,12000\r\n')
  assert.equal(Buffer.from(out, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf')
  assert.equal(toCsv([]), '﻿')
})

test('csvField: quotes a comma, a quote, CR or LF, and doubles the quotes (RFC 4180)', () => {
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('say "hi"'), '"say ""hi"""')
  assert.equal(csvField('line1\nline2'), '"line1\nline2"')
  assert.equal(csvField('a\r\nb'), '"a\r\nb"')
  assert.equal(csvField('plain text'), 'plain text')
  assert.equal(csvField(''), '')
  assert.equal(csvField(null), '')
  assert.equal(csvField(undefined), '')
})

test('csvField: numbers as plain digits', () => {
  assert.equal(csvField(1234567), '1234567')
  assert.equal(csvField(-500), '-500')
  assert.equal(csvField(0), '0')
  assert.equal(csvField(12.5), '12.5')
  assert.equal(csvField(1e21), '1000000000000000000000')
  assert.equal(csvField(Number.NaN), '')
})

test('csvField: a text a spreadsheet would run as a formula gets an apostrophe', () => {
  for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) assert.equal(csvField(s), `'${s}`)
  assert.equal(csvField('=a,b'), '"\'=a,b"')
  assert.equal(csvField('a=b'), 'a=b')
})

test('wonCell: a computed KRW amount is whole won, as the screens show it (review rc2-1 F-9)', () => {
  // a USD charge converted at the exchange rate is fractional: the file holds whole won
  assert.equal(csvField(wonCell(27_993.6)), '27994')
  assert.equal(csvField(wonCell(27_993.4)), '27993')
  assert.equal(csvField(wonCell(-1_500.5)), '-1500')
  assert.equal(csvField(wonCell(-0.4)), '0') // never -0
  assert.equal(wonCell(120_000), 120_000) // stored won as it is
})
