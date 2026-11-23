// Review rc3-1 F-1 (A-44): a change set logged before a migration added a column can still be reverted.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stillAsLogged } from '../../server/row-compare'

const RC2_SETTINGS = { netPay: 1_000_000, fxRate: 1380.5, fxBuffer: 3, payDay: 24, transferDay: 26, billingDay: 14, subRound: 10_000, dayShift: 'none', savingSplit: 'amount', investSplit: 'ratio' }

test('a settings row logged on rc.2 still matches the row after the rc.3 columns were added', () => {
  const now = { userId: 'u1', ...RC2_SETTINGS, fxAuto: false, fxAutoAt: null, fxAutoError: null }
  assert.equal(stillAsLogged(now, RC2_SETTINGS), true)
})

test('a display-settings row logged before the time zone column still matches', () => {
  const logged = { themeMode: 'light', primary: null, accent: null, radius: 'base', density: 'base', dateFormat: 'iso', amountUnit: 'won', negative: 'minus', language: null }
  assert.equal(stillAsLogged({ userId: 'u1', ...logged, timezone: 'Asia/Seoul' }, logged), true)
  assert.equal(stillAsLogged({ userId: 'u1', ...logged, timezone: 'Europe/Berlin' }, logged), true, 'a later zone change is not a change of this set')
})

test('a logged column that changed later still stops the revert', () => {
  const now = { userId: 'u1', ...RC2_SETTINGS, payDay: 23, fxAuto: false }
  assert.equal(stillAsLogged(now, RC2_SETTINGS), false)
})

test('a row that is gone or appeared does not match', () => {
  assert.equal(stillAsLogged(null, RC2_SETTINGS), false)
  assert.equal(stillAsLogged({ ...RC2_SETTINGS }, null), false)
  assert.equal(stillAsLogged(null, null), true)
})
