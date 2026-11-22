// The goal cards of 대기 중인 변경 (spec 013 S-7, W-8): an account whose projected balance has reached its goal
// asks whether to stop sending to it. The pure parts (the holiday range, what a stop changes) take the state as an
// argument so the unit tests run them without a store; `goalCards` and `goalCount` read the store for the screens
// (the page's cards, the waiting count and the sidebar badge).
import { computed } from 'vue'
import { addYm, goalAlerts, groupAt, lastBalance, monthMoney, today, ymd, type AccountState, type GoalAlert } from './calc'
import { offDays } from './holidays-lazy'
import { store } from './store'
import type { Account } from '../data/types'

/**
 * The dates the goal check needs holidays for: from the month before the earliest last balance record of an account with a
 * goal (where its projection starts) to three months after `today` (the stop month is this month or the next). Null when no
 * account has a goal and a record, or when dates are not moved for holidays.
 */
export function goalOffRange(st: Pick<AccountState, 'accounts' | 'balances' | 'settings'>, todayYmd: string): [string, string] | null {
  if ((st.settings.dayShift ?? 'none') === 'none') return null
  let first = ''
  for (const a of st.accounts) {
    if (a.goal === null || a.goal === undefined) continue
    const rec = lastBalance(st.balances, a.id)
    if (rec && (!first || rec.date < first)) first = rec.date
  }
  if (!first) return null
  const from = first.slice(0, 7) < todayYmd.slice(0, 7) ? first.slice(0, 7) : todayYmd.slice(0, 7)
  return [`${addYm(from, -1)}-01`, `${addYm(todayYmd.slice(0, 7), 3)}-01`]
}

/**
 * What account `acc` gets in month `ym`: a Savings / Investment item its item amount, any other account what the fixed
 * targets linked to it send (a stop ends exactly these, S-7).
 */
export function accountSendIn(acc: Account, st: AccountState, ym: string): number {
  const a = st.accounts.find((x) => x.id === acc.id) ?? acc
  if (a.group) return groupAt(a.group, st.accounts, st.phases, st.targets, st.settings, ym).rows.find((r) => r.account.id === a.id)?.amount ?? 0
  const linked = new Set(st.targets.filter((t) => t.kind === 'fixed' && t.accountId === a.id).map((t) => t.id))
  return monthMoney(st, ym).dist.rows.filter((r) => linked.has(r.key)).reduce((s, r) => s + r.amount, 0)
}

export interface StopPreview {
  /** the first month without the transfer */
  month: string
  /** what the account gets that month: before the stop, after it */
  send: { before: number; after: number }
  /** the remainder of that month: before the stop, after it */
  remainder: { before: number; after: number }
}
/** What "멈추기" changes (S-7): the month's item amount and remainder, worked out on a copy where the account has `stopFrom`. */
export function stopPreview(st: AccountState, alert: GoalAlert): StopPreview {
  const month = alert.stopFrom
  const after: AccountState = { ...st, accounts: st.accounts.map((a) => (a.id === alert.account.id ? { ...a, stopFrom: month } : a)) }
  return {
    month,
    send: { before: accountSendIn(alert.account, st, month), after: accountSendIn(alert.account, after, month) },
    remainder: { before: monthMoney(st, month).dist.remainder, after: monthMoney(after, month).dist.remainder },
  }
}

/** The goal cards now (read from the store): the alerts, each with what stopping it changes. */
export const goalCards = computed(() => {
  const now = ymd(today())
  const range = goalOffRange(store, now)
  const off: ReadonlySet<string> = range ? offDays(store.holidaySets, range[0], range[1]) ?? new Set() : new Set()
  return goalAlerts(store, now, off).map((alert) => ({ alert, preview: stopPreview(store, alert) }))
})

/** How many goal cards wait: counted with the AI proposals in 대기 중인 변경 and on the sidebar badge (S-7). */
export const goalCount = computed(() => goalCards.value.length)
