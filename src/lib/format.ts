// Display formats (spec 007 S-8): amounts in summary cards and tables, dates in tables, lists and
// the schedule follow the user's display settings. Pure: the settings are an argument. Inputs,
// editors and the JSON view keep plain won (calc.ts `won`).
import type { Preferences } from '../data/types'
import { lang, tl, type Lang } from '../i18n'

type Fmt = Pick<Preferences, 'amountUnit' | 'negative' | 'dateFormat'>

const MINUS = '−'

/**
 * The amount's absolute value in the chosen unit, with its unit. Korean: ₩1,234 · 1천원 · 0.1만원.
 * English (spec 008 S-9): ₩1,234 · ₩1,234K · ₩123.4×10K (K = thousand, ×10K = ten thousand).
 */
function magnitude(n: number, unit: Fmt['amountUnit'], l: Lang): string {
  const a = Math.abs(n)
  const loc = l === 'en' ? 'en-US' : 'ko-KR'
  if (unit === 'thousand') return tl(l, 'format.thousand', { n: Math.round(a / 1000).toLocaleString(loc) })
  if (unit === 'man') return tl(l, 'format.man', { n: (a / 10_000).toLocaleString(loc, { maximumFractionDigits: 1 }) })
  return tl(l, 'format.won', { n: Math.round(a).toLocaleString(loc) })
}

/**
 * An amount as the user wants it: unit (won / thousand / man) and negatives as −1,000, (1,000)
 * or red. Red keeps the minus sign too, so a negative never depends on colour alone.
 */
export function money(n: number, p: Fmt, l: Lang = lang.value): string {
  const body = magnitude(n, p.amountUnit, l)
  // Rounding can turn a tiny negative into zero: no sign then.
  const a = Math.abs(n)
  const zero = p.amountUnit === 'thousand' ? Math.round(a / 1000) === 0 : p.amountUnit === 'man' ? Math.round(a / 1000) === 0 : Math.round(a) === 0
  if (n >= 0 || zero) return body
  return p.negative === 'paren' ? `(${body})` : MINUS + body
}

/** Class for a negative amount when the user chose red. */
export const moneyClass = (n: number, p: Fmt) => (n < 0 && p.negative === 'red' ? 'neg-amt' : '')

/**
 * A short label for narrow charts (phone trend bars; English uses ×10K where Korean has 만): under ₩1,000 in won (₩990), then 만 with one
 * decimal below 10만 (0.1만 … 9.9만, 99,500 → 10만), whole 만 from 10만 (51만). Rounding is on whole
 * won counts; an amount that is not 0 but rounds to 0 won (a yearly ₩1 ÷ 12) reads <₩1, so only a real
 * 0 shows 0. Negatives keep the minus sign.
 */
export function moneyShort(n: number, l: Lang = lang.value): string {
  if (n === 0 || Number.isNaN(n)) return '0'
  const sign = n < 0 ? MINUS : ''
  const a = Math.round(Math.abs(n))
  if (a === 0) return `${sign}<₩1`
  if (a < 1000) return `${sign}₩${a}`
  const tenths = Math.round(a / 1000) // 0.1만 steps
  const short = (n: string) => tl(l, 'format.manShort', { n })
  const body = tenths < 100 ? short(`${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ''}`) : short(Math.round(a / 10_000).toLocaleString(l === 'en' ? 'en-US' : 'ko-KR'))
  return sign + body
}

/** A plain won amount for inputs, editors and previews: 1,234원 in Korean, ₩1,234 in English. */
export const wonText = (n: number, l: Lang = lang.value) => tl(l, 'format.wonPlain', { n: Math.round(n).toLocaleString(l === 'en' ? 'en-US' : 'ko-KR') })

/** An amount in units of 10,000 for chart axes and bars: 12.5만 in Korean, 12.5×10K in English. */
export const manText = (n: number, l: Lang = lang.value) => {
  const v = n / 10_000
  return tl(l, 'format.manShort', { n: Number.isInteger(v) ? v.toString() : v.toFixed(1) })
}

/** Short month ("11월", "Nov") and weekday ("토", "Sat") names in the screen language. */
export const monthShort = (n: number, l: Lang = lang.value) => new Date(2000, n - 1, 1).toLocaleString(l === 'en' ? 'en-US' : 'ko-KR', { month: 'short' })
export const monthLong = (n: number, l: Lang = lang.value) => new Date(2000, n - 1, 1).toLocaleString(l === 'en' ? 'en-US' : 'ko-KR', { month: 'long' })
export const weekdayShort = (d: Date, l: Lang = lang.value) => d.toLocaleString(l === 'en' ? 'en-US' : 'ko-KR', { weekday: 'short' })

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
