// The maturity of a savings product (spec 013 S-15), as the MCP tools read it: the same rule the screens use
// (`maturityOf` in src/lib/calc.ts), with the month named `month` as the tools have always answered.
import { maturityOf as calcMaturityOf } from '../../src/lib/calc'
import type { Account } from '../../src/data/types'

export interface Maturity {
  /** the month it matures (YYYY-MM) */
  month: string
  /** the months it is paid into, from `from` to the maturity month (that month not counted) */
  months: number
}

/** The maturity of an account, or null when its term is not one the screens read or it has no `from` month. */
export function maturityOf(a: Pick<Account, 'term' | 'from'>): Maturity | null {
  const m = calcMaturityOf(a)
  return m ? { month: m.ym, months: m.months } : null
}
