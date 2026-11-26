// What a month is (spec 018 S-3, S-12, W-3): the settings body and the functions that name a month and give its dates.
//   pnpm test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import { settings as settingsBody, settingsRow } from '../../server/validation'

// ── the settings body ──
const OLD_BODY = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }

test('a new account counts by the calendar month: no card, the naming follows the first day', () => {
  assert.equal(DEFAULT_SETTINGS.monthBasis, 'calendar')
  assert.equal(DEFAULT_SETTINGS.monthBasisCardId, null)
  assert.equal(DEFAULT_SETTINGS.monthNaming, 'auto')
  assert.equal(settingsBody.safeParse(DEFAULT_SETTINGS).success, true)
})

test('the settings body: a body in the 0.1.9 shape passes and writes none of the three month keys', () => {
  const parsed = settingsBody.safeParse(OLD_BODY)
  assert.equal(parsed.success, true)
  const row = settingsRow(parsed.data!)
  // left out stays left out: the row that is written lacks the key, so the saved value stays
  for (const k of ['monthBasis', 'monthBasisCardId', 'monthNaming']) assert.equal(k in row, false, k)
  // the old one rule of all dates still passes next to them
  assert.equal(settingsBody.safeParse({ ...OLD_BODY, dayShift: 'before' }).success, true)
})

test('the settings body: the three month keys take their values, each on its own; anything else is refused', () => {
  for (const monthBasis of ['calendar', 'card', 'pay']) {
    const r = settingsBody.safeParse({ ...OLD_BODY, monthBasis })
    assert.equal(r.success, true, monthBasis)
    assert.deepEqual(settingsRow(r.data!), { ...OLD_BODY, monthBasis })
  }
  for (const monthNaming of ['auto', 'start', 'end']) {
    const r = settingsBody.safeParse({ ...OLD_BODY, monthNaming })
    assert.equal(r.success, true, monthNaming)
    assert.deepEqual(settingsRow(r.data!), { ...OLD_BODY, monthNaming })
  }
  for (const monthBasisCardId of ['card-1', null]) {
    const r = settingsBody.safeParse({ ...OLD_BODY, monthBasisCardId })
    assert.equal(r.success, true, String(monthBasisCardId))
    assert.deepEqual(settingsRow(r.data!), { ...OLD_BODY, monthBasisCardId })
  }
  // a card basis without a card, and a card kept under another basis, are both taken (they count as the calendar month
  // and as that basis)
  assert.equal(settingsBody.safeParse({ ...OLD_BODY, monthBasis: 'card', monthBasisCardId: null }).success, true)
  assert.equal(settingsBody.safeParse({ ...OLD_BODY, monthBasis: 'pay', monthBasisCardId: 'card-1', monthNaming: 'end' }).success, true)
  for (const monthBasis of ['salary', '', null, 1, true]) assert.equal(settingsBody.safeParse({ ...OLD_BODY, monthBasis }).success, false, `basis ${String(monthBasis)}`)
  for (const monthNaming of ['middle', '', null, 15]) assert.equal(settingsBody.safeParse({ ...OLD_BODY, monthNaming }).success, false, `naming ${String(monthNaming)}`)
  for (const monthBasisCardId of ['', '   ', 12, true, {}]) assert.equal(settingsBody.safeParse({ ...OLD_BODY, monthBasisCardId }).success, false, `card ${String(monthBasisCardId)}`)
})
