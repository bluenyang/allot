// review rc3-1 F-9 (spec 013 S-25): each 만료 연장 choice shows the expiry it gives (now + n days) and is marked when
// it ends sooner than the key does now; no choice is hidden. Synthetic.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extendChoices } from '../../src/lib/key-extend'

const now = new Date('2026-11-23T00:00:00Z')

test('a key with 355 days left: +30 and +90 are sooner, +365 is later', () => {
  const left355 = new Date(now.getTime() + 355 * 86_400_000).toISOString()
  assert.deepEqual(extendChoices([30, 90, 365], left355, now), [
    { days: 30, at: '2026-12-23T00:00:00.000Z', shorter: true },
    { days: 90, at: '2027-02-21T00:00:00.000Z', shorter: true },
    { days: 365, at: '2027-11-23T00:00:00.000Z', shorter: false },
  ])
})

test('a key that ends in 10 days: none is sooner; a key with no expiry: every date is sooner', () => {
  const soon = new Date(now.getTime() + 10 * 86_400_000).toISOString()
  assert.deepEqual(extendChoices([30, 90, 365], soon, now).map((c) => c.shorter), [false, false, false])
  assert.deepEqual(extendChoices([30, 90, 365], null, now).map((c) => c.shorter), [true, true, true])
  // the same date is not sooner
  assert.equal(extendChoices([30], '2026-12-23T00:00:00.000Z', now)[0]!.shorter, false)
})
