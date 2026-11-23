// spec 013 S-18: the period filter of 변경 내역 sends day boundaries as ISO times — in the user's time zone
// (S-22, review rc3-1 F-4), Asia/Seoul when none is set (the rc.2 behaviour).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayAfter, dayIn, dayStart, periodBounds, periodQuery } from '../../src/lib/history-period'

test('KST days (the default zone): the day starts at 15:00 UTC the day before', () => {
  assert.equal(dayStart('2026-11-01'), '2026-10-31T15:00:00.000Z')
  assert.equal(dayAfter('2026-11-30'), '2026-11-30T15:00:00.000Z')
  assert.equal(dayAfter('2026-12-31', 'Asia/Seoul'), '2026-12-31T15:00:00.000Z')
  assert.equal(dayIn(new Date('2026-11-30T14:59:59Z')), '2026-11-30')
  assert.equal(dayIn(new Date('2026-11-30T15:00:00Z')), '2026-12-01')
  // an unknown zone reads as the default
  assert.equal(dayStart('2026-11-01', 'Not/AZone'), '2026-10-31T15:00:00.000Z')
})

test('other zones: offsets, clock changes, a skipped midnight', () => {
  assert.equal(dayStart('2026-12-01', 'America/New_York'), '2026-12-01T05:00:00.000Z') // EST
  assert.equal(dayStart('2026-07-01', 'America/New_York'), '2026-07-01T04:00:00.000Z') // EDT
  assert.equal(dayStart('2026-11-01', 'America/New_York'), '2026-11-01T04:00:00.000Z') // the day the clocks go back
  assert.equal(dayAfter('2026-11-01', 'America/New_York'), '2026-11-02T05:00:00.000Z')
  assert.equal(dayStart('2026-03-08', 'America/New_York'), '2026-03-08T05:00:00.000Z') // the day the clocks go forward
  assert.equal(dayStart('2026-01-01', 'UTC'), '2026-01-01T00:00:00.000Z')
  assert.equal(dayStart('2026-01-01', 'Asia/Kolkata'), '2025-12-31T18:30:00.000Z')
  // Santiago skips 00:00–01:00 on its spring change (2026-09-06): the day starts at 01:00 local, 04:00 UTC
  assert.equal(dayStart('2026-09-06', 'America/Santiago'), '2026-09-06T04:00:00.000Z')
  assert.equal(dayIn(new Date(dayStart('2026-09-06', 'America/Santiago')), 'America/Santiago'), '2026-09-06')
  assert.equal(dayIn(new Date('2026-12-01T04:59:59Z'), 'America/New_York'), '2026-11-30')
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

test('periodBounds in the user\'s zone (review rc3-1 F-4)', () => {
  // New York, 2026-12-01 09:00 local (23:00 KST): 이번 달 is December in New York, from its midnight
  const now = new Date('2026-12-01T14:00:00Z')
  assert.deepEqual(periodBounds('month', now, '', '', 'America/New_York'), { since: '2026-12-01T05:00:00.000Z' })
  assert.deepEqual(periodBounds('months3', now, '', '', 'America/New_York'), { since: '2026-10-01T04:00:00.000Z' })
  assert.deepEqual(periodBounds('custom', now, '2026-11-30', '2026-11-30', 'America/New_York'), { since: '2026-11-30T05:00:00.000Z', until: '2026-12-01T05:00:00.000Z' })
  // the evening of 30 Nov in New York is already 1 Dec in Seoul: still November there
  assert.deepEqual(periodBounds('month', new Date('2026-12-01T02:00:00Z'), '', '', 'America/New_York'), { since: '2026-11-01T04:00:00.000Z' })
})

test('periodQuery', () => {
  assert.equal(periodQuery({}), '')
  assert.equal(periodQuery({ since: '2026-10-31T15:00:00.000Z' }), '&since=2026-10-31T15%3A00%3A00.000Z')
  assert.equal(periodQuery({ since: 'a', until: 'b' }), '&since=a&until=b')
})
