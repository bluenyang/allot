// Review rc3-1 F-1 (A-44): a change set logged before a migration added a column can still be reverted.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asNow, basisAsLeft, isBasisDrop, stillAsLogged, type LoggedChange } from '../../server/row-compare'

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

// spec 018 S-1 (A-2): a settings row logged up to 0.1.9 has the one rule `dayShift`; the table now has the rule of each date.
test('a settings row logged with dayShift reads as that rule on each date, and still matches the migrated row', () => {
  const logged = { ...RC2_SETTINGS, dayShift: 'before' }
  const { dayShift: _d, ...rest } = logged
  assert.deepEqual(asNow('settings', logged), { ...rest, payShift: 'before', transferShift: 'before', billingShift: 'before' })
  // the row as migration 0045 left it (day_shift copied into the three, then dropped), with the later columns
  const now = { userId: 'u1', ...rest, payShift: 'before', transferShift: 'before', billingShift: 'before', fxAuto: false, fxAutoAt: null, fxAutoError: null }
  assert.equal(stillAsLogged(now, asNow('settings', logged)), true)
  // without the reading, the dropped column would make every such set look changed
  assert.equal(stillAsLogged(now, logged), false)
})

test('a rule changed after the upgrade still stops the revert of a set logged before it', () => {
  const { dayShift: _d, ...rest } = RC2_SETTINGS
  const now = { userId: 'u1', ...rest, payShift: 'none', transferShift: 'after', billingShift: 'none' }
  assert.equal(stillAsLogged(now, asNow('settings', RC2_SETTINGS)), false)
})

test('a row that names its rules keeps them; other tables and empty rows are left as they are', () => {
  const both = { ...RC2_SETTINGS, dayShift: 'before', payShift: 'after', transferShift: 'none', billingShift: 'none' }
  const got = asNow('settings', both)!
  assert.deepEqual([got.payShift, got.transferShift, got.billingShift, 'dayShift' in got], ['after', 'none', 'none', false])
  const fresh = { netPay: 1, payShift: 'after', transferShift: 'none', billingShift: 'none' }
  assert.equal(asNow('settings', fresh), fresh)
  const item = { id: 'i', name: 'x', day: 3, dayShift: 'kept: not a settings row' }
  assert.equal(asNow('schedule_item', item), item)
  assert.equal(asNow('settings', null), null)
})

// Review 2 F-3 (a), spec 018 A-26: the settings row a basis card's delete writes is told from every other settings
// change, and the revert reads it by its two month keys alone.
const NOW_SETTINGS = { netPay: 1_000_000, fxRate: 1380.5, fxBuffer: 3, payDay: 24, transferDay: 26, billingDay: 14, subRound: 10_000, payShift: 'none', transferShift: 'none', billingShift: 'none', savingSplit: 'amount', investSplit: 'ratio', fxAuto: true, monthNaming: 'auto' }
const change = (tableName: string, op: string, id: string | null, before: unknown, after: unknown): LoggedChange => ({ tableName, op, rowKey: id ? { id } : {}, before, after })
const drop = change('settings', 'update', null, { ...NOW_SETTINGS, monthBasis: 'card', monthBasisCardId: 'c1' }, { ...NOW_SETTINGS, monthBasis: 'calendar', monthBasisCardId: null })
const kept = change('settings', 'update', null, { ...NOW_SETTINGS, monthBasis: 'pay', monthBasisCardId: 'c1' }, { ...NOW_SETTINGS, monthBasis: 'pay', monthBasisCardId: null })
const cardGone = change('card', 'delete', 'c1', { id: 'c1', name: 'Card' }, null)

test('the settings row of a basis card\'s delete: the month keys alone, of the card that set deletes', () => {
  assert.equal(isBasisDrop(drop, [drop, cardGone]), true)
  assert.equal(isBasisDrop(kept, [kept, cardGone]), true, 'a card only kept under another basis is let go the same way')
  // not without the card's delete in the set, and not for another card
  assert.equal(isBasisDrop(drop, [drop]), false, 'a settings save that clears the card is an ordinary change')
  assert.equal(isBasisDrop(drop, [drop, change('card', 'delete', 'c2', { id: 'c2' }, null)]), false)
  assert.equal(isBasisDrop(drop, [drop, change('card', 'update', 'c1', { id: 'c1' }, { id: 'c1' })]), false)
  // not when the change touches anything else, or does not let go of a card
  assert.equal(isBasisDrop(change('settings', 'update', null, drop.before, { ...(drop.after as object), netPay: 2 }), [cardGone]), false)
  assert.equal(isBasisDrop(change('settings', 'update', null, drop.before, { ...(drop.after as object), monthBasisCardId: 'c2' }), [cardGone]), false)
  assert.equal(isBasisDrop(change('settings', 'update', null, { ...NOW_SETTINGS, monthBasis: 'calendar', monthBasisCardId: null }, drop.after), [cardGone]), false)
  assert.equal(isBasisDrop(change('settings', 'insert', null, null, drop.after), [cardGone]), false)
  assert.equal(isBasisDrop(cardGone, [drop, cardGone]), false)
})

test('the basis comes back with the card only while the month keys are what the delete left them', () => {
  const after = drop.after as Record<string, unknown>
  assert.equal(basisAsLeft({ userId: 'u1', ...after }, after), true)
  // the row changed elsewhere since (the daily rate refresh, a save): still as left — and the whole-row rule would refuse
  const later = { userId: 'u1', ...after, fxRate: 1401.2, netPay: 1_100_000, monthNaming: 'end' }
  assert.equal(basisAsLeft(later, after), true)
  assert.equal(stillAsLogged(later, after), false)
  // the user picked another basis, or another card, meanwhile: left as it is now
  assert.equal(basisAsLeft({ ...after, monthBasis: 'pay' }, after), false)
  assert.equal(basisAsLeft({ ...after, monthBasis: 'card', monthBasisCardId: 'c2' }, after), false)
  assert.equal(basisAsLeft({ ...after, monthBasisCardId: 'c2' }, after), false)
  assert.equal(basisAsLeft(null, after), false)
  // a card kept under the pay basis: back while the basis is still pay without a card
  const keptAfter = kept.after as Record<string, unknown>
  assert.equal(basisAsLeft({ ...keptAfter, fxRate: 1 }, keptAfter), true)
  assert.equal(basisAsLeft({ ...keptAfter, monthBasis: 'calendar' }, keptAfter), false)
})

