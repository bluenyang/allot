// The accounts table of 월급 분배 (spec 013 S-5, S-8, S-13): pure helpers, no store, so the unit tests can
// call them. What goes into an account this month mirrors the inflows of the projection (calc.ts movesIn).
import { groupAt, monthMoney, type AccountState, type Distribution } from './calc'
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
 * projection counts them). Both also get the month's buffer refills through the cards it pays (S-8).
 * `dist` may be passed when the caller has the month's distribution already.
 */
export function accountMonthIn(acc: Account, st: AccountState, ym: string, dist?: Distribution): number {
  let sum = 0
  if (acc.group) {
    sum += groupAt(acc.group, st.accounts, st.phases, st.targets, st.settings, ym).rows.find((r) => r.account.id === acc.id)?.amount ?? 0
  } else {
    const d = dist ?? monthMoney(st, ym).dist
    for (const r of d.rows) {
      const t = st.targets.find((x) => x.id === r.key)
      if (t?.accountId === acc.id && r.amount > 0) sum += r.amount
    }
  }
  const cards = new Set(st.cards.filter((c) => c.accountId === acc.id).map((c) => c.id))
  for (const sp of st.spendings ?? []) {
    if (sp.how !== 'buffer' || !sp.cardId || !cards.has(sp.cardId)) continue
    for (const r of sp.rounds) {
      if (r.state === 'merged' || (sp.cancelled && r.state === 'left')) continue
      if (r.date.slice(0, 7) === ym) sum += r.amount
    }
  }
  return sum
}

/** "bank …1234", "bank", "…1234" or '' — the line under an account's name. */
export function bankLine(a: Pick<Account, 'bank' | 'last4'>): string {
  return [a.bank?.trim() ?? '', a.last4 ? `…${a.last4}` : ''].filter(Boolean).join(' ')
}
