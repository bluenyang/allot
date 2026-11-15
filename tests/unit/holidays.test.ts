// spec 007 V-3 (a)(b)(d): holiday rule sets, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import KoreanLunarCalendar from 'korean-lunar-calendar'
import { enabledSets, holidaysIn, ruleDates, ruleProblem } from '../../src/lib/holidays'
import { KR_RULES } from '../../src/data/holidays-kr'
import type { HolidaySet } from '../../src/data/types'

const pad = (n: number) => String(n).padStart(2, '0')
/** Lunar → solar from the Korea Astronomy and Space Science Institute tables (korean-lunar-calendar). */
function kasi(lunarYear: number, month: number, day: number): string {
  const c = new KoreanLunarCalendar()
  assert.ok(c.setLunarDate(lunarYear, month, day, false), `lunar ${lunarYear}-${month}-${day} exists`)
  const s = c.getSolarCalendar()
  return `${s.year}-${pad(s.month)}-${pad(s.day)}`
}
/** Last day of a lunar month = the day before the 1st of the next month. */
function kasiLast(lunarYear: number, month: number): string {
  const next = month === 12 ? kasi(lunarYear + 1, 1, 1) : kasi(lunarYear, month + 1, 1)
  return new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}
const rule = (name: string) => KR_RULES.find((r) => r.name === name)!
const onlyIn = (name: string, y: number) => ruleDates(rule(name), `${y}-01-01`, `${y}-12-31`)

test('(a) lunar holidays 2025–2050 match the KASI tables', () => {
  const misses: string[] = []
  for (let y = 2025; y <= 2050; y++) {
    const want: [string, string[]][] = [
      ['설날 전날', [kasiLast(y - 1, 12)]], ['설날', [kasi(y, 1, 1)]], ['설날 다음날', [kasi(y, 1, 2)]],
      ['부처님오신날', [kasi(y, 4, 8)]],
      ['추석 전날', [kasi(y, 8, 14)]], ['추석', [kasi(y, 8, 15)]], ['추석 다음날', [kasi(y, 8, 16)]],
    ]
    for (const [name, dates] of want) {
      const got = onlyIn(name, y)
      // 설날 전날 of lunar year y-1 is in Gregorian year y (late Jan or Feb).
      if (JSON.stringify(got) !== JSON.stringify(dates)) misses.push(`${y} ${name}: got ${got} want ${dates}`)
    }
  }
  assert.deepEqual(misses, [])
})

// Expected lists: 「관공서의 공휴일에 관한 규정」 (제2조, 제3조) applied by hand to the calendar, the
// same as the KASI 월력요항 for those years, without election days and one-off holidays
// (2025-01-27, 2025-06-03, 2026-06-03 are not rules).
const EXPECTED: Record<number, string[]> = {
  2025: ['01-01', '01-28', '01-29', '01-30', '03-01', '03-03', '05-05', '05-06', '06-06', '08-15', '10-03', '10-05', '10-06', '10-07', '10-08', '10-09', '12-25'],
  2026: ['01-01', '02-16', '02-17', '02-18', '03-01', '03-02', '05-05', '05-24', '05-25', '06-06', '08-15', '08-17', '09-24', '09-25', '09-26', '10-03', '10-05', '10-09', '12-25'],
  2027: ['01-01', '02-06', '02-07', '02-08', '02-09', '03-01', '05-05', '05-13', '06-06', '08-15', '08-16', '09-14', '09-15', '09-16', '10-03', '10-04', '10-09', '10-11', '12-25', '12-27'],
}

test('(b) the built-in set gives the whole year, substitutes included, 2025–2027', () => {
  for (const [y, want] of Object.entries(EXPECTED)) {
    const got = [...new Set(holidaysIn(enabledSets([]), `${y}-01-01`, `${y}-12-31`).map((h) => h.date.slice(5)))]
    assert.deepEqual(got, want, `year ${y}`)
  }
})

test('(b) substitute days are marked and named after their holiday', () => {
  const subs = holidaysIn(enabledSets([]), '2027-01-01', '2027-12-31').filter((h) => h.substitute)
  assert.deepEqual(subs.map((h) => [h.date, h.name]), [
    ['2027-02-09', '대체공휴일(설날)'], ['2027-08-16', '대체공휴일(광복절)'], ['2027-10-04', '대체공휴일(개천절)'],
    ['2027-10-11', '대체공휴일(한글날)'], ['2027-12-27', '대체공휴일(기독탄신일)'],
  ])
})

test('(b) a range across the new year still sees a block that starts before it', () => {
  // 2027-02-06 is a Saturday, 02-07 (설날) a Sunday: the substitute 02-09 is found from a range starting 02-09.
  assert.deepEqual(holidaysIn(enabledSets([]), '2027-02-09', '2027-02-09').map((h) => h.name), ['대체공휴일(설날)'])
})

const own = (over: Partial<HolidaySet> = {}): HolidaySet => ({
  id: 'mine', name: '내 휴일', enabled: true, builtin: null,
  rules: [{ name: '창립기념일', rdate: ['2026-07-17'] }, { name: '둘째 월요일', rrule: 'FREQ=YEARLY;BYMONTH=4;BYDAY=2MO' }], ...over,
})

test('(d) a user set adds its days; turning it off removes them; the built-in set can be turned off', () => {
  const on = holidaysIn(enabledSets([own()]), '2026-01-01', '2026-12-31')
  assert.ok(on.some((h) => h.date === '2026-07-17' && h.name === '창립기념일'))
  assert.ok(on.some((h) => h.date === '2026-04-13' && h.name === '둘째 월요일'))
  const off = holidaysIn(enabledSets([own({ enabled: false })]), '2026-01-01', '2026-12-31')
  assert.ok(!off.some((h) => h.setId === 'mine'))
  const krOff = enabledSets([{ id: 'x', name: 'kr', enabled: false, builtin: 'kr', rules: [] }])
  assert.deepEqual(holidaysIn(krOff, '2026-01-01', '2026-12-31'), [])
})

test('(d) EXDATE removes a day of the rule', () => {
  const r = { name: 'x', rrule: 'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17', exdate: ['2027-07-17'] }
  assert.deepEqual(ruleDates(r, '2026-01-01', '2028-12-31'), ['2026-07-17', '2028-07-17'])
})

test('(c) rule check: refused and accepted rules', () => {
  for (const bad of [
    'RSCALE=CHINESE;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1', 'RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1',
    'FREQ=MONTHLY;BYMONTHDAY=1', 'FREQ=YEARLY;BYMONTH=13;BYMONTHDAY=1', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
    'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=5L;BYMONTHDAY=1', 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=31',
    'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYDAY=MO', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1;COUNT=3',
    // review 1: SKIP and INTERVAL (R1, R2), a Gregorian rule without BYMONTH
    'FREQ=YEARLY;RSCALE=GREGORIAN;BYMONTH=2;BYMONTHDAY=29;SKIP=OMIT', 'FREQ=YEARLY;INTERVAL=2;BYMONTH=7;BYMONTHDAY=17',
    'FREQ=YEARLY;BYMONTHDAY=1',
  ]) assert.notEqual(ruleProblem(bad), null, bad)
  assert.equal(ruleProblem('FREQ=YEARLY;RSCALE=GREGORIAN;BYMONTH=2;BYMONTHDAY=29'), null)
  for (const r of KR_RULES) assert.equal(ruleProblem(r.rrule!), null, r.name)
  assert.equal(ruleProblem('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29'), null)
  assert.equal(ruleProblem('FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO'), null)
})

test('review 1: every rule the check accepts also computes, and gives the same days for any range', () => {
  const rules = [...KR_RULES.map((r) => r.rrule!), 'FREQ=YEARLY;RSCALE=GREGORIAN;BYMONTH=2;BYMONTHDAY=29', 'FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO', 'FREQ=YEARLY;BYMONTH=11;BYDAY=TH;BYSETPOS=4']
  for (const rrule of rules) {
    assert.equal(ruleProblem(rrule), null, rrule)
    const wide = ruleDates({ name: 'x', rrule }, '2020-01-01', '2032-12-31')
    for (const y of [2026, 2027, 2028]) {
      assert.deepEqual(ruleDates({ name: 'x', rrule }, `${y}-01-01`, `${y}-12-31`), wide.filter((d) => d.startsWith(`${y}-`)), `${rrule} ${y}`)
    }
  }
})

test('review 1 (R4): a long user block gets its substitute whatever range is asked', () => {
  const long = Array.from({ length: 22 }, (_, i) => `2027-01-${String(4 + i).padStart(2, '0')}`)
  const sets = [{ id: 'mine', rules: [
    { name: '일요일 휴일', rdate: ['2027-01-03'], substitute: { on: ['SU' as const] } },
    { name: '긴 휴가', rdate: long, substitute: { on: ['SU' as const] } },
  ] }]
  const month = holidaysIn(sets, '2027-01-01', '2027-01-31').filter((h) => h.substitute).map((h) => h.date)
  const day = holidaysIn(sets, '2027-01-26', '2027-01-26').filter((h) => h.substitute).map((h) => h.date)
  assert.ok(month.length > 0)
  assert.deepEqual(day, month.filter((d) => d === '2027-01-26'))
})

test('review 2 (F2): substitutes never depend on the range asked, also around blocks longer than the limit', () => {
  const span = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
  const chunks = (list: string[]) => Array.from({ length: Math.ceil(list.length / 100) }, (_, i) => ({ name: `긴 휴가 ${i}`, rdate: list.slice(i * 100, i * 100 + 100), substitute: { on: ['SU' as const] } }))
  const cases = [
    [{ name: '일', rdate: ['2025-11-30'], substitute: { on: ['SU' as const] } }, ...chunks(span('2025-12-01', 411))], // > limit: no substitute
    [{ name: '일', rdate: ['2027-01-03'], substitute: { on: ['SU' as const] } }, ...chunks(span('2027-01-04', 20))], // within the limit
  ]
  for (const rules of cases) {
    const sets = [{ id: 'mine', rules }]
    const wide = holidaysIn(sets, '2025-01-01', '2027-12-31').filter((h) => h.substitute).map((h) => h.date)
    for (const d of ['2027-01-18', '2027-01-25', '2027-01-26', '2027-02-01']) {
      assert.deepEqual(holidaysIn(sets, d, d).filter((h) => h.substitute).map((h) => h.date), wide.filter((x) => x === d), d)
    }
  }
  // within the limit there is a substitute; beyond it there is none
  assert.ok(holidaysIn([{ id: 'm', rules: cases[1]! }], '2027-01-01', '2027-02-28').some((h) => h.substitute))
  assert.ok(!holidaysIn([{ id: 'm', rules: cases[0]! }], '2025-11-01', '2027-02-28').some((h) => h.substitute))
})

test('review 3: substitutes pushed week after week by the previous block are the same for any range', () => {
  // 52 four-day blocks (Fri–Mon) from 2025-01-03, substitute on SA/SU; every Friday and the first Monday
  // are also holidays of another rule, so each block's substitutes push the next block's.
  const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const blocks = Array.from({ length: 52 }, (_, w) => ({ name: `b${w}`, rdate: [0, 1, 2, 3].map((i) => day('2025-01-03', w * 7 + i)), substitute: { on: ['SA' as const, 'SU' as const] } }))
  const fridays = { name: 'fri', rdate: [...Array.from({ length: 52 }, (_, w) => day('2025-01-03', w * 7)).slice(0, 99), '2025-01-06'] }
  const sets = [{ id: 'chain', rules: [...blocks, fridays] }]
  const wide = holidaysIn(sets, '2025-01-01', '2026-03-31').filter((h) => h.substitute)
  for (const d of ['2025-06-03', '2025-12-30', '2026-01-02', '2026-01-06']) {
    assert.deepEqual(holidaysIn(sets, d, d).filter((h) => h.substitute), wide.filter((h) => h.date === d), d)
  }
  assert.ok(wide.length > 52)
})
