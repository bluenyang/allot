// Display formats (spec 007 S-8): amounts in summary cards and tables, dates in tables, lists and
// the schedule follow the user's display settings. Pure: the settings are an argument. Inputs,
// editors and the JSON view keep plain won (calc.ts `won`).
import type { Preferences } from '../data/types'

type Fmt = Pick<Preferences, 'amountUnit' | 'negative' | 'dateFormat'>

const MINUS = '−'

/** The amount's absolute value in the chosen unit, with its unit. */
function magnitude(n: number, unit: Fmt['amountUnit']): string {
  const a = Math.abs(n)
  if (unit === 'thousand') return Math.round(a / 1000).toLocaleString('ko-KR') + '천원'
  if (unit === 'man') return (a / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '만원'
  return '₩' + Math.round(a).toLocaleString('ko-KR')
}

/**
 * An amount as the user wants it: unit (won / thousand / man) and negatives as −1,000, (1,000)
 * or red. Red keeps the minus sign too, so a negative never depends on colour alone.
 */
export function money(n: number, p: Fmt): string {
  const body = magnitude(n, p.amountUnit)
  // Rounding can turn a tiny negative into zero: no sign then.
  if (n >= 0 || body.replace(/[^1-9]/g, '') === '') return body
  return p.negative === 'paren' ? `(${body})` : MINUS + body
}

/** Class for a negative amount when the user chose red. */
export const moneyClass = (n: number, p: Fmt) => (n < 0 && p.negative === 'red' ? 'neg-amt' : '')

/** A date (YYYY-MM-DD or Date) as 2026-11-14, 2026. 11. 14. or 11/14/2026. */
export function dateText(d: string | Date, p: Fmt): string {
  const s = typeof d === 'string' ? d : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return s
  const [, y, mo, da] = m
  if (p.dateFormat === 'dot') return `${y}. ${mo}. ${da}.`
  if (p.dateFormat === 'us') return `${mo}/${da}/${y}`
  return s
}
