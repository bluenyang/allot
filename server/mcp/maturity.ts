// The maturity of a savings product (spec 013 S-15), as the MCP tools read it: an account whose free-text `term`
// reads "N개월" / "N months" (and that has a `from` month) matures N months after `from`; one whose term reads
// "YYYY-MM까지" matures that month. Pure (no database); the unit tests run it. Any other term has no maturity.
import { addYm } from '../../src/lib/calc'
import type { Account } from '../../src/data/types'

const MONTHS = /^(\d{1,4})\s*(?:개월|months?)$/i
const UNTIL = /^(\d{4}-(?:0[1-9]|1[0-2]))\s*까지$/

/** Whole months from `a` to `b` (YYYY-MM); negative when `b` is earlier. */
export const monthsFrom = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

export interface Maturity {
  /** the month it matures (YYYY-MM) */
  month: string
  /** the months it is paid into, from `from` to the maturity month (that month not counted); 0 when that is not after `from` */
  months: number
}

/** The maturity of an account, or null when its term is not one of the forms above or it has no `from` month. */
export function maturityOf(a: Pick<Account, 'term' | 'from'>): Maturity | null {
  const term = (a.term ?? '').trim()
  if (!a.from) return null
  const n = MONTHS.exec(term)
  if (n) {
    const count = Number(n[1])
    return count > 0 ? { month: addYm(a.from, count), months: count } : null
  }
  const u = UNTIL.exec(term)
  if (u) return { month: u[1]!, months: Math.max(0, monthsFrom(a.from, u[1]!)) }
  return null
}
