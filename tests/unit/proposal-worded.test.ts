// review rc3-1 F-5: a proposal row's values are worded with its table — a currency's buffer is a percent, an
// account's buffer an amount. Synthetic; no browser, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { worded } from '../../src/lib/proposals'

test('buffer: a percent on foreign_currency, money elsewhere', () => {
  assert.equal(worded('buffer', 2, { code: 'EUR', rate: 1500, buffer: 2 }, 'foreign_currency'), '2%')
  assert.equal(worded('buffer', 2.5, null, 'foreign_currency'), '2.5%')
  assert.equal(worded('buffer', null, null, 'foreign_currency'), '—')
  const krw = worded('buffer', 2, null, 'bank_account')
  assert.notEqual(krw, '2%')
  assert.equal(krw, worded('buffer', 2)) // no table: as before
  // a currency's other fields read as before
  assert.equal(worded('rate', 1500, null, 'foreign_currency'), '1500')
})
