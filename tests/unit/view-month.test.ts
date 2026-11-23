// review rc3-1 F-3 (spec 013 S-22): the dashboard's month starts in the user's time zone once the state has loaded,
// not in the default zone the module saw at import. Synthetic; no browser, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { status, store } from '../../src/lib/store'
import { view } from '../../src/lib/view'
import { todayIn, ymOf } from '../../src/lib/calc'

test('view.ym follows the loaded zone on the first load, and keeps the user\'s month on later loads', () => {
  // a zone whose today is a different month from Asia/Seoul at some hour is not needed: the value must be the
  // loaded zone's month, whatever the hour
  store.preferences.timezone = 'Pacific/Pago_Pago' // UTC-11
  view.ym = '1999-01' // stands for the import-time value
  status.loaded = true
  assert.equal(view.ym, ymOf(todayIn('Pacific/Pago_Pago')))
  // the user moves the month; a reload after a save (loaded stays true) leaves it
  view.ym = '2030-05'
  status.loaded = true
  assert.equal(view.ym, '2030-05')
  // a new session (loaded false, then true) starts from today again
  status.loaded = false
  store.preferences.timezone = 'Pacific/Kiritimati' // UTC+14
  status.loaded = true
  assert.equal(view.ym, ymOf(todayIn('Pacific/Kiritimati')))
  status.loaded = false
})
