// spec 013 S-22 (W-18): the time zone picker's options, each zone labelled with its UTC offset. No database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { utcOffset, zoneLabel, zoneOptions } from '../../src/lib/timezones'

const at = new Date('2026-11-23T12:00:00Z')

test('a zone is labelled with its UTC offset at that moment', () => {
  assert.equal(utcOffset('Asia/Seoul', at), 'UTC+09:00')
  assert.equal(utcOffset('Asia/Kolkata', at), 'UTC+05:30')
  assert.equal(utcOffset('UTC', at), 'UTC+00:00')
  // daylight saving moves the offset: New York is -05:00 in November, -04:00 in July
  assert.equal(utcOffset('America/New_York', at), 'UTC-05:00')
  assert.equal(utcOffset('America/New_York', new Date('2026-07-01T12:00:00Z')), 'UTC-04:00')
  assert.equal(zoneLabel('Asia/Seoul', at), 'Asia/Seoul (UTC+09:00)')
  // a zone this runtime does not know has no offset: the bare name
  assert.equal(utcOffset('Nowhere/Town', at), null)
  assert.equal(zoneLabel('Nowhere/Town', at), 'Nowhere/Town')
})

test('the options: the listed zones, plus the default and a saved zone the list lacks, by name', () => {
  const listed = ['Europe/Paris', 'America/New_York']
  assert.deepEqual(zoneOptions(undefined, listed, at).map((o) => o.value), ['America/New_York', 'Asia/Seoul', 'Europe/Paris'])
  // a saved zone the browser does not list still shows (it is not refused, and stays selected)
  const withSaved = zoneOptions('UTC', listed, at)
  assert.deepEqual(withSaved.map((o) => o.value), ['America/New_York', 'Asia/Seoul', 'Europe/Paris', 'UTC'])
  assert.equal(withSaved.find((o) => o.value === 'UTC')!.label, 'UTC (UTC+00:00)')
  // no duplicate when the saved one is listed
  assert.equal(zoneOptions('Europe/Paris', listed, at).length, 3)
  // an empty list (a browser that cannot list zones) still offers the default
  assert.deepEqual(zoneOptions(undefined, [], at), [{ value: 'Asia/Seoul', label: 'Asia/Seoul (UTC+09:00)' }])
})
