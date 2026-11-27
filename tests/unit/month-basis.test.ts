// What a month is (spec 018 S-3, S-12, W-3): the settings body and the functions that name a month and give its dates.
//   pnpm test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { DayShift, MonthBasis, MonthNaming, Settings } from '../../src/data/types'
import { addYm, dayIn, monthCtx, monthDay, parseDate, periodOf, usagePeriod, ymd, ymOfDate, ymRange, type MonthCtx } from '../../src/lib/calc'
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

// ── the functions ──
const S: Settings = { ...DEFAULT_SETTINGS, payDay: 25, transferDay: 26, billingDay: 14 }
const none: ReadonlySet<string> = new Set()
const RULES: DayShift[] = ['none', 'before', 'after']
const NAMINGS: MonthNaming[] = ['auto', 'start', 'end']
const WHICH = ['pay', 'transfer', 'billing'] as const
const CARD = 'card-1'
const cards = (usageFrom: number | null) => [{ id: CARD, usageFrom }]
const plus = (date: string, n: number) => { const d = parseDate(date); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) }
const days = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = plus(d, 1)) out.push(d); return out }
const lastOf = (ym: string) => plus(addYm(ym, 1) + '-01', -1)
const span = (ym: string, ctx: MonthCtx) => { const p = periodOf(ym, ctx); return `${p.start}..${p.end}` }
const pay = (payDay: number, o: Partial<Settings> = {}) => monthCtx({ ...S, payDay, monthBasis: 'pay', ...o }, [], none)
const byCard = (usageFrom: number | null, o: Partial<Settings> = {}, off = none) => monthCtx({ ...S, monthBasis: 'card', monthBasisCardId: CARD, ...o }, cards(usageFrom), off)

/**
 * Made-up holidays, 2026-2029, many of them next to a weekend: a Friday late in each odd month, a Monday in the second
 * week of each even month, the days around each new year (a run of closed days with the weekend), and a midweek day.
 */
const HOLIDAYS: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const d of days('2026-01-01', '2029-12-31')) {
    const date = parseDate(d)
    const [dom, month, wd] = [date.getDate(), date.getMonth() + 1, date.getDay()]
    if (month % 2 === 1 && wd === 5 && dom >= 22 && dom <= 28) set.add(d)
    if (month % 2 === 0 && wd === 1 && dom >= 8 && dom <= 14) set.add(d)
    if ((month === 12 && dom >= 30) || (month === 1 && dom <= 2)) set.add(d)
    if (month === 6 && dom === 10) set.add(d)
  }
  return set
})()

test('monthCtx: the basis in use, the naming and the first day', () => {
  const of = (o: Partial<Settings>, list: { id: string; usageFrom?: number | null }[] = cards(12)) => { const c = monthCtx({ ...S, ...o }, list, none); return [c.basis, c.naming, c.day] }
  // a state saved before 0.1.10 has none of the three keys: the calendar month
  const { monthBasis: _b, monthBasisCardId: _c, monthNaming: _n, ...old } = S
  assert.deepEqual([monthCtx(old, [], none).basis, monthCtx(old, [], none).naming, monthCtx(old, [], none).day], ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'calendar' }), ['calendar', 'start', 1])
  // the calendar month has no naming to pick, and a card kept under it is not read
  assert.deepEqual(of({ monthBasis: 'calendar', monthNaming: 'end', monthBasisCardId: CARD }), ['calendar', 'start', 1])
  // a card basis needs its card and the card's first day
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD }), ['card', 'start', 12])
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: null }), ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'card' }), ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: 'gone' }), ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD }, cards(null)), ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD, monthNaming: 'end' }, cards(null)), ['calendar', 'start', 1])
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD }, [{ id: CARD, usageFrom: undefined }]), ['calendar', 'start', 1])
  // a first day of 1 is a card basis of its own (the same dates as the calendar month while it is named by its start)
  assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD }, cards(1)), ['card', 'start', 1])
  // a pay basis reads the pay day, never a card
  assert.deepEqual(of({ monthBasis: 'pay' }), ['pay', 'end', 25])
  assert.deepEqual(of({ monthBasis: 'pay', monthBasisCardId: CARD }), ['pay', 'end', 25])
  // auto: a first day of the 15th or earlier names the month by its start, the 16th or later by its end
  for (const [day, naming] of [[1, 'start'], [10, 'start'], [15, 'start'], [16, 'end'], [25, 'end'], [31, 'end']] as const) {
    assert.deepEqual(of({ monthBasis: 'pay', payDay: day }), ['pay', naming, day], `pay day ${day}`)
    assert.deepEqual(of({ monthBasis: 'pay', payDay: day, monthNaming: 'auto' }), ['pay', naming, day])
    assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD }, cards(day)), ['card', naming, day], `first day ${day}`)
    // picked by hand, it is as picked
    for (const picked of ['start', 'end'] as const) {
      assert.deepEqual(of({ monthBasis: 'pay', payDay: day, monthNaming: picked }), ['pay', picked, day])
      assert.deepEqual(of({ monthBasis: 'card', monthBasisCardId: CARD, monthNaming: picked }, cards(day)), ['card', picked, day])
    }
  }
})

test('calendar basis: periodOf is the calendar month, ymOfDate the first seven characters, dayIn is monthDay', () => {
  const { monthBasis: _b, monthBasisCardId: _c, monthNaming: _n, ...old } = S
  const calendars: [Partial<Settings>, { id: string; usageFrom?: number | null }[]][] = [
    [{}, []],
    [{ monthBasis: 'calendar' }, cards(12)],
    [{ monthBasis: 'calendar', monthNaming: 'end', monthBasisCardId: CARD }, cards(12)],
    [{ monthBasis: 'card', monthBasisCardId: null, monthNaming: 'end' }, cards(12)],
    [{ monthBasis: 'card', monthBasisCardId: 'gone', monthNaming: 'start' }, cards(12)],
    [{ monthBasis: 'card', monthBasisCardId: CARD, monthNaming: 'end' }, cards(null)],
  ]
  const months = ymRange('2026-01', 36)
  const dates = days('2026-01-01', '2028-12-31')
  for (const [o, list] of calendars) {
    for (const rule of RULES) {
      for (const off of [none, HOLIDAYS]) {
        // each date its own rule, so a mix-up of the three would show
        const rules = { payShift: rule, transferShift: RULES[(RULES.indexOf(rule) + 1) % 3]!, billingShift: RULES[(RULES.indexOf(rule) + 2) % 3]! }
        const s = { ...old, ...rules, ...o }
        const ctx = monthCtx(s, list, off)
        for (const ym of months) {
          assert.deepEqual(periodOf(ym, ctx), { ym, start: ym + '-01', end: lastOf(ym) })
          for (const which of WHICH) {
            for (let day = 1; day <= 31; day++) assert.deepEqual(dayIn(ym, day, which, ctx), monthDay(ym, day, rules[`${which}Shift`], off), `${ym} ${day} ${which}`)
          }
        }
        for (const d of dates) assert.equal(ymOfDate(d, ctx), d.slice(0, 7))
      }
    }
  }
})

test('pay basis: pay day 25 names a month by its end, pay day 10 by its start (spec 018 S-3)', () => {
  // auto, pay day 25: "2026-12" is 11-25 … 12-24
  assert.equal(span('2026-12', pay(25)), '2026-11-25..2026-12-24')
  assert.equal(span('2026-12', pay(25, { monthNaming: 'end' })), '2026-11-25..2026-12-24')
  assert.equal(span('2026-12', pay(25, { monthNaming: 'start' })), '2026-12-25..2027-01-24')
  // auto, pay day 10: "2026-12" is 12-10 … 01-09
  assert.equal(span('2026-12', pay(10)), '2026-12-10..2027-01-09')
  assert.equal(span('2026-12', pay(10, { monthNaming: 'start' })), '2026-12-10..2027-01-09')
  assert.equal(span('2026-12', pay(10, { monthNaming: 'end' })), '2026-11-10..2026-12-09')
  // the names of dates around a first day
  const c = pay(25)
  assert.deepEqual(['2026-11-24', '2026-11-25', '2026-12-01', '2026-12-24', '2026-12-25'].map((d) => ymOfDate(d, c)), ['2026-11', '2026-12', '2026-12', '2026-12', '2027-01'])
  const c10 = pay(10)
  assert.deepEqual(['2026-12-09', '2026-12-10', '2026-12-31', '2027-01-09', '2027-01-10'].map((d) => ymOfDate(d, c10)), ['2026-11', '2026-12', '2026-12', '2026-12', '2027-01'])
})

test('pay basis: the month starts on the actual pay date, moved by the pay rule alone', () => {
  // 2027-01-10 is a Sunday, 2026-10-10 a Saturday: the months around them move with the pay date
  assert.equal(span('2026-12', pay(10, { payShift: 'before' })), '2026-12-10..2027-01-07')
  assert.equal(span('2027-01', pay(10, { payShift: 'before' })), '2027-01-08..2027-02-09')
  assert.equal(span('2026-12', pay(10, { payShift: 'after' })), '2026-12-10..2027-01-10')
  assert.equal(span('2027-01', pay(10, { payShift: 'after' })), '2027-01-11..2027-02-09')
  assert.equal(span('2026-10', pay(10, { payShift: 'before' })), '2026-10-09..2026-11-09')
  assert.equal(span('2026-10', pay(10, { payShift: 'after' })), '2026-10-12..2026-11-09')
  // 2026-10-25 is a Sunday (pay day 25, named by its end: "2026-11")
  assert.equal(span('2026-11', pay(25, { payShift: 'before' })), '2026-10-23..2026-11-24')
  assert.equal(span('2026-11', pay(25, { payShift: 'after' })), '2026-10-26..2026-11-24')
  assert.equal(span('2026-10', pay(25, { payShift: 'before' })), '2026-09-25..2026-10-22')
  // the transfer and billing rules do not move a month's first day
  assert.equal(span('2026-11', pay(25, { transferShift: 'before', billingShift: 'after' })), '2026-10-25..2026-11-24')
  // a holiday moves it too: the Friday before the weekend is closed, so 'before' goes to the Thursday
  const off = new Set(['2026-10-23'])
  assert.equal(span('2026-11', monthCtx({ ...S, monthBasis: 'pay', payShift: 'before' }, [], off)), '2026-10-22..2026-11-24')
  // the date of a moved first day belongs to the month it starts, the day before to the month before
  const c = pay(25, { payShift: 'before' })
  assert.deepEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map((d) => ymOfDate(d, c)), ['2026-10', '2026-11', '2026-11', '2026-11'])
  // a pay day on the 1st moved back lands in the calendar month before: 2026-11-01 is a Sunday
  const first = pay(1, { payShift: 'before' })
  assert.equal(span('2026-11', first), '2026-10-30..2026-11-30')
  assert.deepEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d) => ymOfDate(d, first)), ['2026-10', '2026-11', '2026-11', '2026-11'])
})

test('pay basis: pay day 31 in short months starts on the last day', () => {
  const c = pay(31)
  assert.deepEqual(ymRange('2027-01', 5).map((ym) => span(ym, c)), [
    '2026-12-31..2027-01-30', '2027-01-31..2027-02-27', '2027-02-28..2027-03-30', '2027-03-31..2027-04-29', '2027-04-30..2027-05-30',
  ])
  // a leap year
  assert.equal(span('2028-02', c), '2028-01-31..2028-02-28')
  assert.equal(span('2028-03', c), '2028-02-29..2028-03-30')
  const byStart = pay(31, { monthNaming: 'start' })
  assert.deepEqual(ymRange('2027-01', 3).map((ym) => span(ym, byStart)), ['2027-01-31..2027-02-27', '2027-02-28..2027-03-30', '2027-03-31..2027-04-29'])
  assert.deepEqual(['2027-02-27', '2027-02-28', '2027-03-30', '2027-03-31'].map((d) => ymOfDate(d, c)), ['2027-02', '2027-03', '2027-03', '2027-04'])
})

test('card basis: the month is the usage period of the basis card, never moved', () => {
  // first day 12 (the 15th or earlier): named by its start
  assert.equal(span('2026-12', byCard(12)), '2026-12-12..2027-01-11')
  assert.equal(span('2026-12', byCard(12, { monthNaming: 'start' })), '2026-12-12..2027-01-11')
  assert.equal(span('2026-12', byCard(12, { monthNaming: 'end' })), '2026-11-12..2026-12-11')
  // first day 18: named by its end
  assert.equal(span('2026-12', byCard(18)), '2026-11-18..2026-12-17')
  assert.equal(span('2026-12', byCard(18, { monthNaming: 'start' })), '2026-12-18..2027-01-17')
  assert.equal(span('2026-12', byCard(18, { monthNaming: 'end' })), '2026-11-18..2026-12-17')
  // 2026-12-12 is a Saturday: no rule and no holiday moves a usage period
  for (const rule of RULES) {
    assert.equal(span('2026-12', byCard(12, { payShift: rule, transferShift: rule, billingShift: rule }, HOLIDAYS)), '2026-12-12..2027-01-11')
  }
  // the pay day is not read
  assert.equal(span('2026-12', byCard(12, { payDay: 3 })), '2026-12-12..2027-01-11')
  // a first day of 1 named by its start is the calendar month; named by its end it is the month before
  assert.equal(span('2026-12', byCard(1)), '2026-12-01..2026-12-31')
  assert.equal(span('2026-12', byCard(1, { monthNaming: 'end' })), '2026-11-01..2026-11-30')
  assert.deepEqual(['2026-12-11', '2026-12-12', '2027-01-11', '2027-01-12'].map((d) => ymOfDate(d, byCard(12))), ['2026-11', '2026-12', '2026-12', '2027-01'])
  // every month is the usage period (spec 018 S-2) of its dates, for every first day and naming
  const dates = days('2026-03-01', '2028-04-30')
  for (let from = 1; from <= 31; from++) {
    for (const monthNaming of NAMINGS) {
      const ctx = byCard(from, { monthNaming })
      for (const d of dates) {
        const p = periodOf(ymOfDate(d, ctx), ctx)
        assert.deepEqual({ start: p.start, end: p.end }, usagePeriod(d, from), `${d} first day ${from} ${monthNaming}`)
      }
    }
  }
})

/** Every month's period is at least a day, follows the one before without a gap or an overlap, and names its own dates. */
function checkMonths(make: () => MonthCtx, label: string) {
  const ctx = make()
  const months = ymRange('2026-02', 46)
  let prev = periodOf('2026-01', ctx)
  for (const ym of months) {
    const p = periodOf(ym, ctx)
    assert.equal(p.ym, ym)
    assert.ok(p.start <= p.end, `${label} ${ym}: ${p.start}..${p.end}`)
    assert.equal(p.start, plus(prev.end, 1), `${label} ${ym} starts the day after ${prev.ym} ends`)
    assert.equal(ymOfDate(p.start, ctx), ym, `${label} the first day of ${ym}`)
    assert.equal(ymOfDate(p.end, ctx), ym, `${label} the last day of ${ym}`)
    prev = p
  }
  // every date lies in the period of the month it is named after: with the lines above, in exactly one. A fresh
  // context, asked date by date, gives the same months as the one asked month by month.
  const fresh = make()
  for (const d of days('2026-03-01', '2029-09-30')) {
    const ym = ymOfDate(d, fresh)
    const p = periodOf(ym, ctx)
    assert.ok(p.start <= d && d <= p.end, `${label} ${d} is in ${ym} (${p.start}..${p.end})`)
  }
}

test('pay basis: no gap and no overlap between months, for every pay day, rule and naming, with holidays', () => {
  for (let payDay = 1; payDay <= 31; payDay++) {
    for (const payShift of RULES) {
      for (const monthNaming of NAMINGS) {
        for (const off of [none, HOLIDAYS]) {
          const make = () => monthCtx({ ...S, payDay, payShift, monthBasis: 'pay', monthNaming }, [], off)
          checkMonths(make, `pay day ${payDay} ${payShift} ${monthNaming}${off === none ? '' : ' holidays'}`)
        }
      }
    }
  }
})

test('pay basis: a long run of closed days moves a first day far, and the months still follow each other', () => {
  // eleven closed days in a row, and a pay date carried over the end of its calendar month
  const off = new Set([...days('2027-02-04', '2027-02-14'), ...days('2027-07-24', '2027-08-03')])
  assert.equal(span('2027-02', monthCtx({ ...S, payDay: 10, payShift: 'after', monthBasis: 'pay' }, [], off)), '2027-02-15..2027-03-09')
  assert.equal(span('2027-02', monthCtx({ ...S, payDay: 10, payShift: 'before', monthBasis: 'pay' }, [], off)), '2027-02-03..2027-03-09')
  const late = monthCtx({ ...S, payDay: 28, payShift: 'after', monthBasis: 'pay', monthNaming: 'start' }, [], off)
  assert.equal(span('2027-07', late), '2027-08-04..2027-08-29')
  assert.deepEqual(['2027-07-28', '2027-08-03', '2027-08-04', '2027-08-29', '2027-08-30'].map((d) => ymOfDate(d, late)), ['2027-06', '2027-06', '2027-07', '2027-07', '2027-08'])
  for (let payDay = 1; payDay <= 31; payDay++) {
    for (const payShift of RULES) {
      for (const monthNaming of NAMINGS) checkMonths(() => monthCtx({ ...S, payDay, payShift, monthBasis: 'pay', monthNaming }, [], off), `closed run: pay day ${payDay} ${payShift} ${monthNaming}`)
    }
  }
})

test('card basis: no gap and no overlap between months, for every first day and naming', () => {
  for (let from = 1; from <= 31; from++) {
    for (const monthNaming of NAMINGS) checkMonths(() => byCard(from, { monthNaming, payShift: 'before' }, HOLIDAYS), `first day ${from} ${monthNaming}`)
  }
})

test('the answers do not depend on the order of the questions', () => {
  const s = { ...S, payDay: 31, payShift: 'before' as const, monthBasis: 'pay' as const }
  const months = ymRange('2026-01', 30)
  const forward = monthCtx(s, [], HOLIDAYS)
  const a = months.map((ym) => periodOf(ym, forward))
  const backward = monthCtx(s, [], HOLIDAYS)
  const b = [...months].reverse().map((ym) => periodOf(ym, backward)).reverse()
  const mixed = monthCtx(s, [], HOLIDAYS)
  for (const d of ['2028-02-29', '2026-01-01', '2027-07-15']) ymOfDate(d, mixed)
  dayIn('2027-12', 14, 'billing', mixed)
  const c = months.map((ym) => periodOf(ym, mixed))
  assert.deepEqual(b, a)
  assert.deepEqual(c, a)
  // asked again, the same
  assert.deepEqual(months.map((ym) => periodOf(ym, forward)), a)
})

test('dayIn, pay basis: the pay day is the period\'s first day; the other days fall inside the period', () => {
  // "2026-12" is 11-25 … 12-24: the pay date 11-25, the transfer day 26 the day after, the billing day 14 in December
  const c = pay(25)
  assert.equal(dayIn('2026-12', 25, 'pay', c).date, '2026-11-25')
  assert.equal(dayIn('2026-12', 26, 'transfer', c).date, '2026-11-26')
  assert.equal(dayIn('2026-12', 14, 'billing', c).date, '2026-12-14')
  assert.equal(dayIn('2026-12', 24, 'billing', c).date, '2026-12-24')
  assert.equal(dayIn('2026-12', 31, 'billing', c).date, '2026-11-30') // no 31st in November: its last day, as monthDay
  // pay day 10 (named by its start): "2026-12" is 12-10 … 01-09
  const c10 = pay(10, { transferDay: 11, billingDay: 5 })
  assert.equal(dayIn('2026-12', 10, 'pay', c10).date, '2026-12-10')
  assert.equal(dayIn('2026-12', 11, 'transfer', c10).date, '2026-12-11')
  assert.equal(dayIn('2026-12', 5, 'billing', c10).date, '2027-01-05')
  // it is a MonthDate like monthDay's: the day as set, the date, which way it moved (2027-01-10 is a Sunday)
  assert.deepEqual(dayIn('2027-01', 10, 'pay', pay(10, { payShift: 'before' })), { nominal: '2027-01-10', date: '2027-01-08', shifted: 'before' })
  assert.deepEqual(dayIn('2027-01', 10, 'pay', pay(10)), { nominal: '2027-01-10', date: '2027-01-10', shifted: null })
  // each date moves by its own rule: 2026-12-26 is a Saturday, 2027-02-14 a Sunday
  const mixed = pay(25, { payShift: 'none', transferShift: 'after', billingShift: 'before', monthNaming: 'start' })
  assert.deepEqual(dayIn('2026-12', 26, 'transfer', mixed), { nominal: '2026-12-26', date: '2026-12-28', shifted: 'after' })
  assert.deepEqual(dayIn('2027-01', 14, 'billing', mixed), { nominal: '2027-02-14', date: '2027-02-12', shifted: 'before' })
  // for every pay day, rule and naming: the pay day of a month is its first day
  for (let payDay = 1; payDay <= 31; payDay++) {
    for (const payShift of RULES) {
      for (const monthNaming of NAMINGS) {
        const ctx = monthCtx({ ...S, payDay, payShift, monthBasis: 'pay', monthNaming }, [], HOLIDAYS)
        for (const ym of ymRange('2026-01', 40)) assert.equal(dayIn(ym, payDay, 'pay', ctx).date, periodOf(ym, ctx).start, `${ym} pay day ${payDay} ${payShift} ${monthNaming}`)
      }
    }
  }
})

test('dayIn, card basis: a day on or after the first day is in the first calendar month, an earlier one in the second', () => {
  // "2026-12" is 12-12 … 01-11
  const c = byCard(12)
  assert.equal(dayIn('2026-12', 12, 'billing', c).date, '2026-12-12')
  assert.equal(dayIn('2026-12', 25, 'pay', c).date, '2026-12-25')
  assert.equal(dayIn('2026-12', 26, 'transfer', c).date, '2026-12-26')
  assert.equal(dayIn('2026-12', 11, 'billing', c).date, '2027-01-11')
  assert.equal(dayIn('2026-12', 1, 'billing', c).date, '2027-01-01')
  // named by its end, "2026-12" is 11-12 … 12-11
  const e = byCard(12, { monthNaming: 'end' })
  assert.equal(dayIn('2026-12', 25, 'pay', e).date, '2026-11-25')
  assert.equal(dayIn('2026-12', 11, 'billing', e).date, '2026-12-11')
  // the pay day has no special place under a card basis, and moves by the pay rule (2026-12-25 is a Friday holiday here)
  const off = new Set(['2026-12-25'])
  assert.deepEqual(dayIn('2026-12', 25, 'pay', byCard(12, { payShift: 'before' }, off)), { nominal: '2026-12-25', date: '2026-12-24', shifted: 'before' })
})

test('dayIn: with no rule, every day of every month lies inside the period, also where a month is too short for it', () => {
  // first day 31: "2027-02" is 01-31 … 02-27 and has no 29th or 30th before the next period starts on 02-28
  const c = pay(31)
  assert.deepEqual(ymRange('2027-01', 5).map((ym) => dayIn(ym, 30, 'transfer', c).date), ['2027-01-30', '2027-02-27', '2027-03-30', '2027-04-29', '2027-05-30'])
  assert.deepEqual(ymRange('2027-01', 5).map((ym) => dayIn(ym, 29, 'transfer', c).date), ['2027-01-29', '2027-02-27', '2027-03-29', '2027-04-29', '2027-05-29'])
  assert.deepEqual(ymRange('2027-01', 5).map((ym) => dayIn(ym, 31, 'pay', c).date), ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  const makes: [string, (first: number, monthNaming: MonthNaming) => MonthCtx][] = [
    ['pay', (first, monthNaming) => pay(first, { monthNaming })],
    ['card', (first, monthNaming) => byCard(first, { monthNaming })],
  ]
  for (const [basis, make] of makes) {
    for (let first = 1; first <= 31; first++) {
      for (const monthNaming of NAMINGS) {
        const ctx = make(first, monthNaming)
        for (const ym of ymRange('2026-01', 40)) {
          const p = periodOf(ym, ctx)
          for (let day = 1; day <= 31; day++) {
            const d = dayIn(ym, day, 'transfer', ctx)
            assert.ok(p.start <= d.date && d.date <= p.end, `${basis} first day ${first} ${monthNaming}: day ${day} of ${ym} is ${d.date}, outside ${p.start}..${p.end}`)
            assert.equal(d.date, d.nominal)
            assert.equal(ymOfDate(d.date, ctx), ym)
          }
        }
      }
    }
  }
})

test('dayIn: in ordinary settings the transfer and billing dates fall inside the month\'s period', () => {
  // ordinary: one rule for the three dates (as up to 0.1.9), the transfer on or after the pay day
  const ordinary: [MonthBasis, Partial<Settings>, number | null][] = [
    ['pay', { payDay: 25, transferDay: 26, billingDay: 14 }, null],
    ['pay', { payDay: 10, transferDay: 10, billingDay: 1 }, null],
    ['pay', { payDay: 1, transferDay: 5, billingDay: 20 }, null],
    ['pay', { payDay: 21, transferDay: 25, billingDay: 12 }, null],
    // a card whose usage period starts on the 12th and is billed on the 25th (spec 018 S-2)
    ['card', { payDay: 21, transferDay: 22, billingDay: 25 }, 12],
    ['card', { payDay: 25, transferDay: 26, billingDay: 1 }, 18],
  ]
  for (const [monthBasis, days3, usageFrom] of ordinary) {
    for (const rule of RULES) {
      for (const monthNaming of NAMINGS) {
        const s = { ...S, ...days3, payShift: rule, transferShift: rule, billingShift: rule, monthBasis, monthBasisCardId: CARD, monthNaming }
        const ctx = monthCtx(s, cards(usageFrom), HOLIDAYS)
        for (const ym of ymRange('2026-02', 44)) {
          const p = periodOf(ym, ctx)
          for (const which of WHICH) {
            const d = dayIn(ym, s[`${which}Day`], which, ctx).date
            assert.ok(p.start <= d && d <= p.end, `${monthBasis} ${JSON.stringify(days3)} ${rule} ${monthNaming}: the ${which} date of ${ym} is ${d}, outside ${p.start}..${p.end}`)
          }
        }
      }
    }
  }
})

test('dayIn: a moved date may fall a day or two outside the period, and is left there (spec 018 concern 4)', () => {
  // pay basis, the pay date moved later than a transfer day that stays: 2027-09-25 is a Saturday, so "2027-10" starts
  // on Monday 09-27 and its transfer day 26 is the day before
  const late = pay(25, { payShift: 'after', transferShift: 'none' })
  assert.equal(span('2027-10', late), '2027-09-27..2027-10-24')
  assert.equal(dayIn('2027-10', 26, 'transfer', late).date, '2027-09-26')
  assert.equal(ymOfDate('2027-09-26', late), '2027-09')
  // pay basis, the next pay date moved earlier than a day just before it: 2027-04-25 is a Sunday, so "2027-04" ends on
  // 04-22 and its billing day 24 comes after
  const early = pay(25, { payShift: 'before', billingShift: 'none' })
  assert.equal(span('2027-04', early), '2027-03-25..2027-04-22')
  assert.equal(dayIn('2027-04', 24, 'billing', early).date, '2027-04-24')
  assert.equal(ymOfDate('2027-04-24', early), '2027-05')
  // card basis, a day on the period's first days moved back: 2026-12-12 is a Saturday
  const back = byCard(12, { billingShift: 'before' })
  assert.equal(span('2026-12', back), '2026-12-12..2027-01-11')
  assert.equal(dayIn('2026-12', 12, 'billing', back).date, '2026-12-11')
  // card basis, a day on the period's last days moved on: 2027-09-11 is a Saturday
  const on = byCard(12, { transferShift: 'after' })
  assert.equal(span('2027-08', on), '2027-08-12..2027-09-11')
  assert.equal(dayIn('2027-08', 11, 'transfer', on).date, '2027-09-13')
  // calendar basis: as today, a day at a month's edge may leave the month (2026-11-01 is a Sunday)
  const cal = monthCtx({ ...S, billingShift: 'before' }, [], none)
  assert.equal(dayIn('2026-11', 1, 'billing', cal).date, '2026-10-30')
})
