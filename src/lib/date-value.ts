// String <-> date value helpers for DateInput and MonthInput (spec 010 S-14, W-12).
// The app stores dates as `YYYY-MM-DD` and months as `YYYY-MM` strings; Reka's pickers speak
// `@internationalized/date` values. Those values come from Reka's own parser (`reka-ui/date`) so no extra
// package is needed: a reference value with a Gregorian calendar makes it build plain calendar dates.
import { parseStringToDateValue } from 'reka-ui/date'
import type { DateValue } from 'reka-ui/date'

const REF = { calendar: { identifier: 'gregory' } } as unknown as DateValue
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const YM = /^(\d{4})-(\d{2})$/

const p2 = (n: number) => String(n).padStart(2, '0')
const p4 = (n: number) => String(n).padStart(4, '0')

/** `2027-03-05` -> a date value; anything that is not a real calendar day (`2027-02-30`, '', null) -> undefined. */
export function ymdToValue(s: string | null | undefined): DateValue | undefined {
  const m = YMD.exec(s ?? '')
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return undefined
  return parseStringToDateValue(`${p4(y)}-${p2(mo)}-${p2(d)}`, REF)
}

/** `2027-03` -> the first day of that month as a date value; not a month -> undefined. */
export function ymToValue(s: string | null | undefined): DateValue | undefined {
  const m = YM.exec(s ?? '')
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1) return undefined
  return ymdToValue(`${m[1]}-${m[2]}-01`)
}

export const valueToYmd = (v: { year: number; month: number; day: number }) => `${p4(v.year)}-${p2(v.month)}-${p2(v.day)}`
export const valueToYm = (v: { year: number; month: number }) => `${p4(v.year)}-${p2(v.month)}`

/**
 * What a person types into a month field -> `YYYY-MM`, or null when it is not a month.
 * Takes `2027-03`, `2027-3`, `2027.03`, `2027/3`, `202703` and `2027 03`; the month must be 1-12.
 */
export function parseMonthText(text: string): string | null {
  const m = /^\s*(\d{4})\s*[-./\s]?\s*(\d{1,2})\s*$/.exec(text)
  if (!m) return null
  const mo = Number(m[2])
  if (mo < 1 || mo > 12 || Number(m[1]) < 1) return null
  return `${m[1]}-${p2(mo)}`
}
