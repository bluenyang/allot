// spec 007 V-4 (a)(b)(c): monthly dates moved off weekends and holidays, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monthDates, monthDay, ymRange } from '../../src/lib/calc'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import { enabledSets, holidaysIn } from '../../src/lib/holidays'

const off = new Set(holidaysIn(enabledSets([]), '2025-01-01', '2050-12-31').map((h) => h.date))
const dow = (s: string) => new Date(`${s}T00:00:00`).getDay()
const closed = (s: string) => dow(s) === 0 || dow(s) === 6 || off.has(s)
const plusDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('(a) none: every month 2025-01…2050-12 keeps the set day', () => {
  for (const ym of ymRange('2025-01', 26 * 12)) {
    for (const day of [1, 14, 25, 26, 28, 31]) {
      const r = monthDay(ym, day, 'none', off)
      assert.equal(r.date, r.nominal, `${ym} ${day}`)
      assert.equal(r.shifted, null)
    }
  }
})

test('(b) before/after: the nearest business day on that side, for every month and day 2025–2050', () => {
  for (const ym of ymRange('2025-01', 26 * 12)) {
    for (let day = 1; day <= 31; day++) {
      for (const shift of ['before', 'after'] as const) {
        const r = monthDay(ym, day, shift, off)
        assert.ok(!closed(r.date), `${ym} ${day} ${shift} → ${r.date} is a business day`)
        // nothing open between the set day and the result
        const step = shift === 'before' ? -1 : 1
        for (let d = r.nominal; d !== r.date; d = plusDays(d, step)) assert.ok(closed(d), `${ym} ${day} ${shift}: ${d} was open`)
        assert.equal(r.shifted, r.date === r.nominal ? null : shift)
      }
    }
  }
})

test('(b) known cases: Saturday, Sunday, 설 block with a weekend, crossing a month', () => {
  // 2026-02-14 Sat, 2026-02-16..18 설날 연휴 (Mon–Wed), 2026-02-15 Sun
  assert.equal(monthDay('2026-02', 14, 'before', off).date, '2026-02-13')
  assert.equal(monthDay('2026-02', 14, 'after', off).date, '2026-02-19')
  assert.equal(monthDay('2026-02', 17, 'before', off).date, '2026-02-13')
  // 2026-08-01 is a Saturday: 'before' lands in July
  assert.equal(monthDay('2026-08', 1, 'before', off).date, '2026-07-31')
  // 2027-10-09 한글날 (Sat) → substitute 10-11 (Mon): 'after' goes to Tuesday 10-12
  assert.equal(monthDay('2027-10', 9, 'after', off).date, '2027-10-12')
})

test('(c) day 31 in short months is the last day, then shifted', () => {
  assert.equal(monthDay('2026-04', 31, 'none', off).nominal, '2026-04-30')
  assert.equal(monthDay('2026-02', 31, 'none', off).nominal, '2026-02-28')
  assert.equal(monthDay('2028-02', 31, 'none', off).nominal, '2028-02-29')
  // 2026-02-28 is a Saturday
  assert.equal(monthDay('2026-02', 31, 'before', off).date, '2026-02-27')
  assert.equal(monthDay('2026-02', 30, 'after', off).date, '2026-03-03') // 03-01 Sun, 03-02 substitute
})

test('monthDates uses the settings and keeps none as before', () => {
  const s = { ...DEFAULT_SETTINGS, payDay: 25, transferDay: 26, billingDay: 14 }
  const plain = monthDates('2026-10', s, off)
  assert.deepEqual([plain.pay.date, plain.transfer.date, plain.billing.date], ['2026-10-25', '2026-10-26', '2026-10-14'])
  const moved = monthDates('2026-10', { ...s, dayShift: 'before' }, off)
  assert.equal(moved.pay.date, '2026-10-23') // 10-25 is a Sunday
  assert.equal(moved.pay.shifted, 'before')
})

test('review 1 R5 / review 2 F3: no business day within 31 days → the set day, marked unresolved, never a closed day', () => {
  const days = (n: number) => new Set(Array.from({ length: n }, (_, i) => { const d = new Date(2027, 0, 1 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }))
  const r = monthDay('2027-01', 1, 'after', days(40))
  assert.equal(r.unresolved, true)
  assert.equal(r.date, r.nominal)
  assert.equal(r.shifted, null)
  const short = days(20)
  const ok = monthDay('2027-01', 1, 'after', short)
  assert.ok(!short.has(ok.date) && ok.unresolved === undefined)
})
