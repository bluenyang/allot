// Notifications (spec 013 S-20): what the bell lists, computed from the state (nothing is stored on the server and
// nothing is pushed or mailed). Pure: the bell (src/components/NoticeBell.vue, read marks in this browser) and the MCP
// tool `list_notifications` build the same list with the same calc functions the pages use.
//   pending   AI proposals, goal cards and maturity cards waiting on 대기 중인 변경
//   pay       subscription charges and one-off spending rounds in the next `days` days (today included)
//   budget    this month's remainder short, a yearly limit used 90% or more, a buffer short
import { bufferGauge, monthMoney, parseDate, priced, upcomingPayments, yearContribution, ymd, type AccountState } from './calc'
import type { PayBy, SpendHow } from '../data/types'

export type NoticeGroup = 'pending' | 'pay' | 'budget'

interface Base {
  /** stable while the notice means the same thing: the bell keeps its read mark by it */
  id: string
  group: NoticeGroup
  /** the page that shows it (an app path) */
  path: string
}
export type Notice = Base & (
  | { kind: 'proposals'; count: number }
  | { kind: 'goals'; count: number }
  | { kind: 'maturities'; count: number }
  | { kind: 'charge'; date: string; dday: number; subscriptionId: string; name: string; amount: number }
  | { kind: 'round'; date: string; dday: number; spendingId: string; name: string; amount: number; round: number; of: number; how: SpendHow; payBy: PayBy }
  | { kind: 'remainderShort'; month: string; remainder: number }
  | { kind: 'yearLimit'; accountId: string; name: string; year: number; contribution: number; limit: number; over: boolean }
  | { kind: 'bufferShort'; accountId: string; name: string; buffer: number; used: number; left: number }
)
export type NoticeKind = Notice['kind']

/**
 * What waits on 대기 중인 변경: the number of AI proposals, the accounts that have a goal card and the maturity cards (each
 * `accountId@YYYY-MM`, the maturity month; spec 013 S-15, S-20, review rc2-1 F-5).
 */
export interface PendingInput { proposals: number; goalAccounts: readonly string[]; maturities?: readonly string[] }

/** Days from `from` to `to` (YYYY-MM-DD, local calendar days). */
const daysBetween = (from: string, to: string) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000)
const plusDays = (d: string, n: number) => { const x = parseDate(d); return ymd(new Date(x.getFullYear(), x.getMonth(), x.getDate() + n)) }

/**
 * The notifications on `today` (YYYY-MM-DD): pending first, then the charges and rounds by date, then the budget ones.
 * `off` are the holiday dates the yearly contribution needs when dates move off holidays (as list_accounts uses them).
 */
export function buildNotices(st: AccountState, today: string, off: ReadonlySet<string>, pending: PendingInput, days = 3): Notice[] {
  const out: Notice[] = []
  if (pending.proposals > 0) out.push({ kind: 'proposals', id: `proposals:${pending.proposals}`, group: 'pending', path: '/pending', count: pending.proposals })
  if (pending.goalAccounts.length) {
    out.push({ kind: 'goals', id: `goals:${[...pending.goalAccounts].sort().join(',')}`, group: 'pending', path: '/pending', count: pending.goalAccounts.length })
  }
  const maturities = pending.maturities ?? []
  if (maturities.length) {
    out.push({ kind: 'maturities', id: `maturities:${[...maturities].sort().join(',')}`, group: 'pending', path: '/pending', count: maturities.length })
  }

  // ── charges and rounds from today to today + days ──
  const last = plusDays(today, days)
  const pay: Notice[] = []
  for (const p of upcomingPayments(st.subscriptions, st.planChanges, priced(st.settings, st.currencies), parseDate(today), days)) {
    const date = ymd(p.date)
    pay.push({ kind: 'charge', id: `charge:${p.sub.id}:${date}`, group: 'pay', path: '/spend/subs', date, dday: daysBetween(today, date), subscriptionId: p.sub.id, name: p.sub.name, amount: Math.round(p.krw) })
  }
  for (const sp of st.spendings ?? []) {
    if (sp.cancelled) continue
    for (const r of sp.rounds) {
      if (r.state !== 'left' || r.date < today || r.date > last) continue
      pay.push({
        kind: 'round', id: `round:${sp.id}:${r.no}:${r.date}`, group: 'pay', path: sp.how === 'lump' ? '/spend/general' : '/spend/inst',
        date: r.date, dday: daysBetween(today, r.date), spendingId: sp.id, name: sp.name, amount: r.amount, round: r.no, of: sp.count, how: sp.how, payBy: sp.payBy,
      })
    }
  }
  const dateOf = (n: Notice) => ('date' in n ? n.date : '')
  pay.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0))
  out.push(...pay)

  // ── this month's remainder, yearly limits, buffers ──
  const ym = today.slice(0, 7)
  const remainder = monthMoney(st, ym).dist.remainder
  if (remainder < 0) out.push({ kind: 'remainderShort', id: `remainder:${ym}`, group: 'budget', path: '/pay', month: ym, remainder: Math.round(remainder) })
  const year = Number(today.slice(0, 4))
  for (const a of st.accounts) {
    const limit = a.annualLimit ?? null
    if (limit === null || limit <= 0) continue
    const contribution = Math.round(yearContribution(a, st, off, year))
    if (contribution < limit * 0.9) continue
    const over = contribution > limit
    out.push({
      kind: 'yearLimit', id: `limit:${a.id}:${year}:${over ? 'over' : 'near'}`, group: 'budget', path: a.group === 'invest' ? '/invest' : a.group === 'saving' ? '/saving' : '/pay',
      accountId: a.id, name: a.name, year, contribution, limit, over,
    })
  }
  for (const a of st.accounts) {
    const g = bufferGauge(a, st, today)
    if (g.used <= 0 || g.left >= 0) continue
    out.push({ kind: 'bufferShort', id: `buffer:${a.id}`, group: 'budget', path: '/pay', accountId: a.id, name: a.name, buffer: g.buffer, used: g.used, left: g.left })
  }
  return out
}

/** How many of `list` have no read mark. */
export const unreadCount = (list: readonly Notice[], read: ReadonlySet<string>) => list.filter((n) => !read.has(n.id)).length

/** The read marks worth keeping: those of notices still listed (the bell forgets the others when it writes). */
export const keptMarks = (list: readonly Notice[], read: ReadonlySet<string>) => list.map((n) => n.id).filter((id) => read.has(id))
