import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WHEN_RE, composeWhen, inMonth, whenParts, whenShort, whenSpan, whenYears } from '../../src/lib/event-when'

test('whenParts: one month, a range, a range into another year and anything else', () => {
  assert.deepEqual(whenParts('2027-03'), { mode: 'one', one: '2027-03', from: '2027-03', to: '2027-03', raw: '2027-03' })
  const r = whenParts('2027-01~02')
  assert.equal(r.mode, 'range'); assert.equal(r.from, '2027-01'); assert.equal(r.to, '2027-02')
  const x = whenParts('2026-11~2027-02')
  assert.equal(x.mode, 'range'); assert.equal(x.from, '2026-11'); assert.equal(x.to, '2027-02')
  assert.equal(whenParts('soon').mode, 'raw')
  assert.equal(whenParts('2027-05~3').mode, 'raw')
})

test('composeWhen gives back every value the pattern takes, also a range that ends before it starts (spec 013 S-18: old forms stored the same way)', () => {
  for (const w of ['2027-03', '2027-01~02', '2027-05~03', '2027-12~12', '2026-11~2027-02', '2026-12~2028-01']) {
    assert.ok(WHEN_RE.test(w), w)
    assert.equal(composeWhen(whenParts(w)), w)
  }
})

test('composeWhen: a range in one year keeps the short form, into another year the long one', () => {
  const p = whenParts('2026-12~12')
  assert.equal(composeWhen({ ...p, to: '2027-02' }), '2026-12~2027-02')
  assert.equal(composeWhen({ ...p, to: '2026-03' }), '2026-12~03')
  assert.equal(composeWhen({ ...p, to: '' }), '2026-12')
  assert.equal(composeWhen({ ...p, mode: 'one', one: '2026-12' }), '2026-12')
  // an empty start stays as the old form made it (and the pattern refuses it, as before)
  assert.equal(composeWhen({ ...p, from: '', to: '2027-02' }), '~02')
})

test('whenParts: what the server pattern takes but a picker cannot hold stays as text, verbatim', () => {
  for (const w of ['2027-00', '2027-13', '2027-11~99', '2027-00~01', '0000-01', '2027-11~2028-13', '0000-01~2027-01']) {
    assert.ok(WHEN_RE.test(w), w)
    const p = whenParts(w)
    assert.equal(p.mode, 'raw', w)
    assert.equal(composeWhen(p), w)
  }
  assert.equal(whenParts('2027-11~02').mode, 'range')
})

test('WHEN_RE is the server pattern', () => {
  for (const w of ['2027-03', '2027-01~02', '2026-11~2027-02']) assert.ok(WHEN_RE.test(w), w)
  for (const w of ['2027-3', '2027-03~2', '2027-03~27-02', '2027-03~', 'soon']) assert.ok(!WHEN_RE.test(w), w)
})

test('whenSpan, inMonth and whenYears: a range into a later year covers every month of it', () => {
  assert.deepEqual(whenSpan('2026-11~2027-02'), { from: '2026-11', to: '2027-02' })
  for (const m of ['2026-11', '2026-12', '2027-01', '2027-02']) assert.ok(inMonth('2026-11~2027-02', m), m)
  for (const m of ['2026-10', '2027-03']) assert.ok(!inMonth('2026-11~2027-02', m), m)
  assert.deepEqual(whenYears('2026-11~2027-02'), ['2026', '2027'])
  assert.deepEqual(whenYears('2026-11~2028-01'), ['2026', '2027', '2028'])
  // the old forms
  assert.deepEqual(whenSpan('2027-03'), { from: '2027-03', to: '2027-03' })
  assert.deepEqual(whenSpan('2027-01~02'), { from: '2027-01', to: '2027-02' })
  assert.deepEqual(whenYears('2027-01~02'), ['2027'])
  // a range that ends before it starts covers its start month only
  assert.deepEqual(whenSpan('2027-05~03'), { from: '2027-05', to: '2027-05' })
  assert.deepEqual(whenSpan('2027-05~2026-03'), { from: '2027-05', to: '2027-05' })
  assert.ok(inMonth('2027-05~03', '2027-05'))
  assert.ok(!inMonth('2027-05~03', '2027-04'))
  assert.equal(whenSpan('soon'), null)
  assert.deepEqual(whenYears('soon'), ['soon'])
})

test('whenShort: the overview label', () => {
  assert.equal(whenShort('2027-03'), '27.03')
  assert.equal(whenShort('2027-01~02'), '27.01~02')
  assert.equal(whenShort('2026-11~2027-02'), '26.11~27.02')
})
