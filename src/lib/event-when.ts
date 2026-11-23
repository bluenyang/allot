// The 시기 of a schedule event (spec 010 S-9, S-10; spec 013 S-18): one month `YYYY-MM`, a range inside a year
// `YYYY-MM~MM` (the end may be before the start), or a range into a later year `YYYY-MM~YYYY-MM`. The two old
// forms are stored as they were; the form writes the long one only when the two months are in different years.
// Pure; no UI.
export type WhenMode = 'one' | 'range' | 'raw'
export interface WhenParts { mode: WhenMode; one: string; from: string; to: string; raw: string }

/** The pattern the server and the form accept (server/validation.ts, planEvent `when`). */
export const WHEN_RE = /^\d{4}-\d{2}(~(\d{4}-)?\d{2})?$/

// What a month picker can hold exactly: a year from 0001 and a month 01..12.
const YM = '((?!0000)\\d{4})-(0[1-9]|1[0-2])'
const ONE = new RegExp(`^${YM}$`)
const SAME = new RegExp(`^${YM}~(0[1-9]|1[0-2])$`)
const CROSS = new RegExp(`^${YM}~${YM}$`)
const isYm = (s: string) => /^\d{4}-\d{2}$/.test(s)

/** Split a stored value into the form's fields; a value that fits no shape a picker can hold stays as text (`raw`). */
export function whenParts(when: string): WhenParts {
  // `2027-13`, `2027-00`, `0000-01`, `2027-11~99` fit the server's pattern but not a picker: they stay as text, verbatim.
  const one = ONE.exec(when)
  if (one) return { mode: 'one', one: when, from: when, to: when, raw: when }
  const same = SAME.exec(when)
  if (same) return { mode: 'range', one: `${same[1]}-${same[2]}`, from: `${same[1]}-${same[2]}`, to: `${same[1]}-${same[3]}`, raw: when }
  const cross = CROSS.exec(when)
  if (cross) return { mode: 'range', one: `${cross[1]}-${cross[2]}`, from: `${cross[1]}-${cross[2]}`, to: `${cross[3]}-${cross[4]}`, raw: when }
  return { mode: 'raw', one: '', from: '', to: '', raw: when }
}

/** The stored string for the form's fields: a range in one year keeps the short form (`2027-01~02`), into another year the long one. */
export function composeWhen(p: WhenParts): string {
  if (p.mode === 'one') return p.one
  if (p.mode === 'raw') return p.raw
  if (!isYm(p.to)) return p.from
  return isYm(p.from) && p.from.slice(0, 4) !== p.to.slice(0, 4) ? `${p.from}~${p.to}` : `${p.from}~${p.to.slice(5)}`
}

/**
 * The first and last month (YYYY-MM) a stored value covers, or null when it has none. A range whose end is before
 * its start (`2027-05~03`, accepted since spec 010) has no months after its start: it covers its start month only.
 */
export function whenSpan(when: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})(?:~(?:(\d{4})-)?(\d{2}))?$/.exec(when)
  if (!m) return null
  const from = `${m[1]}-${m[2]}`
  const to = m[4] ? `${m[3] ?? m[1]}-${m[4]}` : from
  return { from, to: to < from ? from : to }
}

/** Is the month (YYYY-MM) inside the value's span? */
export function inMonth(when: string, ym: string): boolean {
  const s = whenSpan(when)
  return !!s && s.from <= ym && ym <= s.to
}

/** The years (YYYY) the value covers, in order: one for a month or a range in one year; each year of a longer range. */
export function whenYears(when: string): string[] {
  const s = whenSpan(when)
  if (!s) return [when.slice(0, 4)]
  const out: string[] = []
  for (let y = Number(s.from.slice(0, 4)); y <= Number(s.to.slice(0, 4)); y++) out.push(String(y).padStart(4, '0'))
  return out
}

/** The short label of the overview list: `27.03`, `27.01~02`, `26.11~27.02`; any other text as it was shown before. */
export function whenShort(when: string): string {
  const m = /^\d{2}(\d{2})-(\d{2})~\d{2}(\d{2})-(\d{2})$/.exec(when)
  if (m) return `${m[1]}.${m[2]}~${m[3]}.${m[4]}`
  return when.slice(2).replace('-', '.')
}
