// Holiday rule sets (spec 007 S-9). Pure: shared by the server (validation) and the front end.
// Gregorian rules go to rrule-temporal; Korean lunar rules (RSCALE=DANGI) are ours, because the
// library does not know DANGI and would silently compute them as Gregorian.
import { RRuleTemporal } from 'rrule-temporal'
import { Temporal } from 'temporal-polyfill/full'
import type { HolidayRule, HolidaySet } from '../data/types'
import { BUILTIN_SETS } from '../data/holidays-kr'

const DAY = /^-?\d{1,2}$/

/** Split an RRULE body (FREQ=YEARLY;BYMONTH=1;…) into upper-case keys. */
export function parseRule(rrule: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of rrule.trim().replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue
    const i = part.indexOf('=')
    out.set((i < 0 ? part : part.slice(0, i)).trim().toUpperCase(), i < 0 ? '' : part.slice(i + 1).trim().toUpperCase())
  }
  return out
}

// Yearly holidays need no INTERVAL (its result would depend on the start year) and no SKIP (only
// meaningful with RSCALE, which a Gregorian rule drops): both are refused (review 1, R1/R2).
const GREGORIAN_KEYS = new Set(['FREQ', 'RSCALE', 'BYMONTH', 'BYMONTHDAY', 'BYDAY', 'BYSETPOS'])

/** The RRULE body the library gets for a Gregorian rule: the same for the check and the computation. */
const gregorianBody = (r: Map<string, string>) => [...r].filter(([k]) => k !== 'RSCALE').map(([k, v]) => `${k}=${v}`).join(';')
/** A fixed start, so a rule gives the same dates whatever range is asked (review 1, R2). */
const DTSTART = 'DTSTART;VALUE=DATE:19000101'
const DANGI_KEYS = new Set(['FREQ', 'RSCALE', 'BYMONTH', 'BYMONTHDAY'])

/** Why this RRULE body cannot be a holiday rule, or null when it can. */
export function ruleProblem(rrule: string): string | null {
  if (rrule.length > 200) return '규칙이 너무 길어요.'
  const r = parseRule(rrule)
  if (r.get('FREQ') !== 'YEARLY') return '공휴일 규칙은 FREQ=YEARLY만 쓸 수 있어요.'
  const scale = r.get('RSCALE') ?? 'GREGORIAN'
  if (scale === 'DANGI') {
    for (const k of r.keys()) if (!DANGI_KEYS.has(k)) return `음력 규칙(RSCALE=DANGI)에는 ${k}를 쓸 수 없어요.`
    const m = r.get('BYMONTH') ?? ''
    const d = r.get('BYMONTHDAY') ?? ''
    if (!/^\d{1,2}$/.test(m) || +m < 1 || +m > 12) return '음력 규칙의 BYMONTH는 1~12 하나예요(윤달은 쓸 수 없어요).'
    if (!DAY.test(d) || +d === 0 || +d > 30 || +d < -2) return '음력 규칙의 BYMONTHDAY는 1~30 또는 -1, -2 하나예요.'
    return null
  }
  if (scale !== 'GREGORIAN') return `RSCALE=${scale}는 쓸 수 없어요. 양력은 생략, 음력은 DANGI예요.`
  for (const k of r.keys()) if (!GREGORIAN_KEYS.has(k)) return `규칙에 ${k}를 쓸 수 없어요.`
  // The library accepts some out-of-range values silently (BYMONTH=13 gives no date): check them here.
  const list = (k: string) => (r.get(k) ?? '').split(',').filter(Boolean)
  const intIn = (v: string, lo: number, hi: number) => /^[+-]?\d+$/.test(v) && +v !== 0 && Math.abs(+v) >= lo && Math.abs(+v) <= hi
  if (!list('BYMONTH').length) return '양력 규칙에는 BYMONTH(1~12)가 있어야 해요.'
  if (list('BYMONTH').some((v) => !/^\d+$/.test(v) || +v < 1 || +v > 12)) return 'BYMONTH는 1~12예요.'
  if (list('BYMONTHDAY').some((v) => !intIn(v, 1, 31))) return 'BYMONTHDAY는 1~31 또는 -1~-31이에요.'
  if (list('BYDAY').some((v) => !/^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.test(v))) return 'BYDAY는 MO~SU, 몇째 주는 1MO·-1FR처럼 써요.'
  if (list('BYSETPOS').some((v) => !intIn(v, 1, 366))) return 'BYSETPOS 값이 범위를 벗어났어요.'
  try {
    const rule = new RRuleTemporal({ rruleString: `${DTSTART}\nRRULE:${gregorianBody(r)}` })
    // 2000 is a leap year, so 2/29 rules count.
    if (!rule.between(new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2003, 11, 31)), true).length) return '이 규칙으로는 날짜가 나오지 않아요.'
  } catch (e) {
    return `규칙을 읽지 못했어요: ${(e as Error).message}`
  }
  return null
}

// ── Holiday dates ──

export interface Holiday {
  date: string // YYYY-MM-DD
  name: string
  setId: string
  substitute: boolean
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const yearOf = (s: string) => Number(s.slice(0, 4))
/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date (no time zone involved). */
export const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay()
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Korean lunar month/day of lunar year `y` as a Gregorian date. Temporal's 'dangi' calendar (ICU,
 * through the polyfill so every runtime agrees); year = the Gregorian year the lunar year starts in.
 * A negative day counts from the end of the month (-1 = last day).
 */
function dangi(y: number, month: number, day: number): string | null {
  try {
    const first = Temporal.PlainDate.from({ calendar: 'dangi', year: y, monthCode: `M${String(month).padStart(2, '0')}`, day: 1 })
    const d = day > 0 ? day : first.daysInMonth + day + 1
    if (d < 1 || d > first.daysInMonth) return null
    return first.with({ day: d }).withCalendar('iso8601').toString()
  } catch {
    return null
  }
}

/** The dates one rule gives between from and to (inclusive), before substitutes. */
export function ruleDates(rule: HolidayRule, from: string, to: string): string[] {
  const out = new Set<string>()
  if (rule.rrule) {
    const r = parseRule(rule.rrule)
    if ((r.get('RSCALE') ?? 'GREGORIAN') === 'DANGI') {
      // A lunar year starts in Jan/Feb, so lunar year y-1 can still fall in Gregorian year y.
      for (let y = yearOf(from) - 1; y <= yearOf(to); y++) {
        const d = dangi(y, Number(r.get('BYMONTH')), Number(r.get('BYMONTHDAY')))
        if (d && d >= from && d <= to) out.add(d)
      }
    } else {
      const rr = new RRuleTemporal({ rruleString: `${DTSTART}\nRRULE:${gregorianBody(r)}` })
      const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
      const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
      for (const z of rr.between(new Date(Date.UTC(fy, fm - 1, fd)), new Date(Date.UTC(ty, tm - 1, td, 23, 59)), true)) {
        const p = z.toPlainDate()
        const d = iso(p.year, p.month, p.day)
        if (d >= from && d <= to) out.add(d)
      }
    }
  }
  for (const d of rule.rdate ?? []) if (d >= from && d <= to) out.add(d)
  for (const d of rule.exdate ?? []) out.delete(d)
  return [...out].sort()
}

/** The rules of a set: a built-in set's come from code, a user's own from the row. */
export const rulesOf = (set: Pick<HolidaySet, 'builtin' | 'rules'>): HolidayRule[] =>
  set.builtin ? (BUILTIN_SETS[set.builtin]?.rules ?? []) : set.rules

/**
 * The sets the user has on. Built-in sets have a row only once turned off (or on again), so a
 * built-in set without a row counts as on.
 */
export function enabledSets(rows: HolidaySet[]): { id: string; name: string; rules: HolidayRule[] }[] {
  const out = rows.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name, rules: rulesOf(s) }))
  for (const [id, b] of Object.entries(BUILTIN_SETS)) {
    if (!rows.some((s) => s.builtin === id)) out.unshift({ id, name: b.name, rules: b.rules })
  }
  return out
}

/**
 * Every holiday of the given sets between from and to (inclusive), with substitute holidays
 * (대체공휴일): a block of consecutive days from rules with the same substitute rule (설날·추석 = 3 days)
 * gets one substitute day for each of its days that falls on one of `on` weekdays or on another
 * holiday; the substitutes are the first days after the block that are neither weekend nor holiday.
 */
export function holidaysIn(sets: { id: string; rules: HolidayRule[] }[], from: string, to: string): Holiday[] {
  // Whole years around the range: a block can start well before `from` and its substitute land after
  // `to`, and the answer for a day must not depend on the range asked (review 1, R4).
  const lo = `${yearOf(from) - 1}-01-01`
  const hi = `${yearOf(to) + 1}-12-31`
  const base: (Holiday & { rule: HolidayRule })[] = []
  for (const s of sets) for (const rule of s.rules) {
    for (const date of ruleDates(rule, lo, hi)) base.push({ date, name: rule.name, setId: s.id, substitute: false, rule })
  }
  const byDate = new Map<string, typeof base>()
  for (const h of base) byDate.set(h.date, [...(byDate.get(h.date) ?? []), h])
  const isHoliday = (d: string) => byDate.has(d)
  const key = (r: HolidayRule) => (r.substitute ? `${[...r.substitute.on].sort().join(',')}@${r.substitute.since ?? 0}` : '')
  const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

  const subs: Holiday[] = []
  const taken = new Set<string>()
  const done = new Set<string>()
  const counted = new Set<string>() // a day gives at most one substitute, however many holidays fall on it
  for (const h of [...base].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const sub = h.rule.substitute
    if (!sub || done.has(`${h.date}|${key(h.rule)}`)) continue
    // The block: consecutive days that have a holiday with the same substitute rule.
    const k = key(h.rule)
    const inBlock = (d: string) => (byDate.get(d) ?? []).some((x) => key(x.rule) === k)
    let end = h.date
    while (inBlock(addDays(end, 1))) end = addDays(end, 1)
    let n = 0
    let label = h.name // the block's shortest name: 설날 for 설날 전날·설날·설날 다음날
    for (let d = h.date; d <= end; d = addDays(d, 1)) {
      for (const x of byDate.get(d) ?? []) if (key(x.rule) === k && x.name.length < label.length) label = x.name
      done.add(`${d}|${k}`)
      if (yearOf(d) < (sub.since ?? 0)) continue
      const hits = (sub.on as string[]).includes(WD[weekday(d)]!) || (byDate.get(d) ?? []).length > 1
      if (hits && !counted.has(d)) { counted.add(d); n++ }
    }
    let d = end
    while (n > 0) {
      d = addDays(d, 1)
      const wd = weekday(d)
      if (wd === 0 || wd === 6 || isHoliday(d) || taken.has(d)) continue
      taken.add(d)
      subs.push({ date: d, name: `대체공휴일(${label})`, setId: h.setId, substitute: true })
      n--
    }
  }
  const all = [...base.map(({ rule: _r, ...x }) => x), ...subs].filter((x) => x.date >= from && x.date <= to)
  return all.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))
}

/** Saturday, Sunday or a holiday date in the set. */
export const isOffDay = (d: string, holidays: ReadonlySet<string>) => weekday(d) === 0 || weekday(d) === 6 || holidays.has(d)
