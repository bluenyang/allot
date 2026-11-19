import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WHEN_RE, composeWhen, whenParts } from '../../src/lib/event-when'

test('whenParts: one month, a range and anything else', () => {
  assert.deepEqual(whenParts('2027-03'), { mode: 'one', one: '2027-03', from: '2027-03', to: '2027-03', raw: '2027-03' })
  const r = whenParts('2027-01~02')
  assert.equal(r.mode, 'range'); assert.equal(r.from, '2027-01'); assert.equal(r.to, '2027-02')
  assert.equal(whenParts('soon').mode, 'raw')
  assert.equal(whenParts('2027-05~3').mode, 'raw')
})

test('composeWhen gives back every value the pattern takes, also a range that ends before it starts', () => {
  for (const w of ['2027-03', '2027-01~02', '2027-05~03', '2027-12~12']) {
    assert.ok(WHEN_RE.test(w))
    assert.deepEqual(composeWhen(whenParts(w)), { when: w, crossYear: false })
  }
})

test('composeWhen: a range into another year is not stored (준비 중)', () => {
  const p = { ...whenParts('2026-12~12'), to: '2027-02' }
  assert.deepEqual(composeWhen(p), { when: '', crossYear: true })
  assert.deepEqual(composeWhen({ ...p, mode: 'one', one: '2026-12' }), { when: '2026-12', crossYear: false })
})
