// spec 013 S-18: the period filter of 변경 내역 sends KST day boundaries as ISO times.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { kstAfter, kstDay, kstStart, periodBounds, periodQuery } from '../../src/lib/history-period'

test('KST days: the day starts at 15:00 UTC the day before', () => {
  assert.equal(kstStart('2026-11-01'), '2026-10-31T15:00:00.000Z')
  assert.equal(kstAfter('2026-11-30'), '2026-11-30T15:00:00.000Z')
  assert.equal(kstAfter('2026-12-31'), '2026-12-31T15:00:00.000Z')
  assert.equal(kstDay(new Date('2026-11-30T14:59:59Z')), '2026-11-30')
  assert.equal(kstDay(new Date('2026-11-30T15:00:00Z')), '2026-12-01')
})

test('periodBounds: 이번 달, 지난 3달, 전체, 직접', () => {
  const now = new Date('2026-11-23T03:00:00Z')
  assert.deepEqual(periodBounds('month', now), { since: '2026-10-31T15:00:00.000Z' })
  assert.deepEqual(periodBounds('months3', now), { since: '2026-08-31T15:00:00.000Z' })
  assert.deepEqual(periodBounds('all', now), {})
  assert.deepEqual(periodBounds('custom', now, '2026-01-05', '2026-01-05'), { since: '2026-01-04T15:00:00.000Z', until: '2026-01-05T15:00:00.000Z' })
  assert.deepEqual(periodBounds('custom', now, '2026-01-05', ''), { since: '2026-01-04T15:00:00.000Z' })
  assert.deepEqual(periodBounds('custom', now, '', '2026-02-28'), { until: '2026-02-28T15:00:00.000Z' })
  assert.deepEqual(periodBounds('custom', now), {})
  // the month is the KST month: 1 Dec 00:30 KST is still 30 Nov in UTC
  assert.deepEqual(periodBounds('month', new Date('2026-11-30T15:30:00Z')), { since: '2026-11-30T15:00:00.000Z' })
  // 지난 3달 across a new year
  assert.deepEqual(periodBounds('months3', new Date('2027-01-10T00:00:00Z')), { since: '2026-10-31T15:00:00.000Z' })
})

test('periodQuery', () => {
  assert.equal(periodQuery({}), '')
  assert.equal(periodQuery({ since: '2026-10-31T15:00:00.000Z' }), '&since=2026-10-31T15%3A00%3A00.000Z')
  assert.equal(periodQuery({ since: 'a', until: 'b' }), '&since=a&until=b')
})
