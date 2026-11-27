// The accounts table of 월급 분배 (spec 013 S-5, S-8, S-13): pure helpers, no store, so the unit tests can
// call them. What goes into an account this month mirrors the inflows of the projection (calc.ts movesIn).
import { ctxOf, itemSent, monthMoney, sendsToLinked, spendingIn, type AccountState, type Distribution } from './calc'
import type { Account, AllocationTarget } from '../data/types'

/** The targets whose money goes to account `accountId` (shown read-only on the account). */
export const targetsOf = (targets: AllocationTarget[], accountId: string) => targets.filter((t) => t.accountId === accountId)

/**
 * The targets that should name an account and do not (or name one that is gone): every target but the
 * remainder (what is left stays in the pay account) and the Savings / Investment totals, whose money goes
 * to their own item accounts (S-5 "저축·투자 항목인 통장은 그 메뉴가 곧 용도다").
 */
export function unlinkedTargets(targets: AllocationTarget[], accounts: Pick<Account, 'id'>[]): AllocationTarget[] {
  const ids = new Set(accounts.map((a) => a.id))
  return targets.filter((t) => t.kind !== 'remainder' && t.kind !== 'saving' && t.kind !== 'invest' && !(t.accountId && ids.has(t.accountId)))
}

/**
 * The money sent into account `acc` in month `ym` (the 이번 달 column): a Savings / Investment item gets its
 * item amount; any other account the month's amounts of the targets linked to it (positive ones, as the
 * projection counts them). Both also get what the month sends through the cards the account pays: the month's buffer
 * refills (S-8) and the card rounds the month counts (spec 018 S-6) — the card and refill parts of the allocation
 * table's paying-account block, for the account that takes the left over too (review 3 F-1).
 * `dist` may be passed when the caller has the month's distribution already.
 * `ym` is a month of the state's basis (spec 018 S-3): a refill counts in the month whose period holds its date, a
 * card bill in the month of the last pay date before it (S-5).
 */
export function accountMonthIn(acc: Account, st: AccountState, ym: string, dist?: Distribution): number {
  const ctx = ctxOf(st)
  let sum = 0
  if (acc.group) {
    sum += itemSent(acc, st, ym)
  } else {
    const d = dist ?? monthMoney(st, ym, { ctx }).dist
    for (const r of d.rows) {
      const t = st.targets.find((x) => x.id === r.key)
      if (t?.accountId === acc.id && sendsToLinked(t) && r.amount > 0) sum += r.amount
    }
  }
  const paid = spendingIn(st.spendings ?? [], ym, ctx, st).byAccount.find((x) => x.accountId === acc.id)
  if (paid) sum += paid.refill + paid.card
  return sum
}

/** "bank …1234", "bank", "…1234" or '' — the line under an account's name. */
export function bankLine(a: Pick<Account, 'bank' | 'last4'>): string {
  return [a.bank?.trim() ?? '', a.last4 ? `…${a.last4}` : ''].filter(Boolean).join(' ')
}
