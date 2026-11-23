// Everything a user's screens show, read in one go (spec 008 S-7). GET /api/state sends it as it is,
// and the MCP tools (server/mcp/) compute from the same rows, so the screen and the AI see the same numbers.
// Call it inside asUser(uid, …): the queries run one after another on that transaction.
import { asc, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from './db/client'
import * as t from './db/schema'
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from '../src/data/defaults'

export type ListTable = PgTable & { id: PgColumn; seq: PgColumn; userId: PgColumn }

/** Drop `seq` and `userId` and turn SQL nulls of optional text fields into absent keys, as the client types expect. */
export function out<R extends Record<string, unknown>>(row: R, optional: string[] = []): Omit<R, 'seq' | 'userId'> {
  const { seq: _seq, userId: _u, ...rest } = row
  for (const k of optional) if (rest[k] === null) delete rest[k]
  return rest
}

/** The user's data in the shape of GET /api/state (lists in insertion order). */
export async function readState(q: Db, uid: string) {
  const list = <T extends ListTable>(table: T) =>
    q.select().from(table as never).where(eq(table.userId, uid)).orderBy(asc(table.seq)) as unknown as Promise<T['$inferSelect'][]>
  const [[settings], livingItems, livingAmounts, subscriptions, planChanges, phases, events, checks, accounts, accountAmounts, balances, cards, monthAdjusts, currencies, schedules, debts, remainderSplit, targets, amounts, [prefs], holidaySets, spendings, spendingRounds] = await Promise.all([
    q.select().from(t.settings).where(eq(t.settings.userId, uid)),
    list(t.livingItem),
    q.select().from(t.livingPhaseAmount).where(eq(t.livingPhaseAmount.userId, uid)),
    list(t.subscription),
    list(t.planChange),
    list(t.phase),
    list(t.planEvent),
    list(t.checkItem),
    list(t.bankAccount),
    q.select().from(t.accountPhaseAmount).where(eq(t.accountPhaseAmount.userId, uid)),
    list(t.accountBalance),
    list(t.card),
    list(t.monthAdjust),
    list(t.foreignCurrency),
    list(t.scheduleItem),
    list(t.debt),
    list(t.remainderSplit),
    list(t.allocationTarget),
    q.select().from(t.phaseAmount).where(eq(t.phaseAmount.userId, uid)),
    q.select().from(t.preference).where(eq(t.preference.userId, uid)),
    list(t.holidaySet),
    list(t.spending),
    q.select().from(t.spendingRound).where(eq(t.spendingRound.userId, uid)).orderBy(asc(t.spendingRound.no)),
  ])
  const amountsOf = (phaseId: string) =>
    Object.fromEntries(amounts.filter((a) => a.phaseId === phaseId).map((a) => [a.targetId, a.amount]))
  // A new account has no rows yet: it gets the defaults until its first save (spec 006 S-7).
  const { userId: _s, ...s } = settings ?? { userId: uid, ...DEFAULT_SETTINGS }
  // The old living row (spec 013 S-2): the three coded items, 0 for one that is not there.
  const coded = (c: string) => livingItems.find((x) => x.code === c)?.amount ?? 0
  const l = { food: coded('food'), transit: coded('transit'), allowance: coded('allowance') }
  const byPhase = <R extends { phaseId: string; amount: number }>(rows: R[], key: (r: R) => string, id: string) =>
    Object.fromEntries(rows.filter((r) => key(r) === id).map((r) => [r.phaseId, r.amount]))
  const { userId: _p, ...p } = prefs ?? { userId: uid, ...DEFAULT_PREFERENCES }
  return {
    settings: s,
    living: l,
    livingItems: livingItems.map((x) => ({ ...out(x, ['note']), amounts: byPhase(livingAmounts, (r) => r.itemId, x.id) })),
    subscriptions: subscriptions.map((x) => out(x, ['note'])),
    planChanges: planChanges.map((x) => out(x)),
    targets: targets.map((x) => out(x, ['note'])),
    phases: phases.map((x) => ({ ...out(x, ['note']), amounts: amountsOf(x.id) })),
    events: events.map((x) => out(x)),
    checks: checks.map((x) => out(x)),
    accounts: accounts.map((x) => ({ ...out(x, ['note']), amounts: byPhase(accountAmounts, (r) => r.accountId, x.id) })),
    balances: balances.map((x) => out(x, ['note'])),
    cards: cards.map((x) => out(x, ['note'])),
    monthAdjusts: monthAdjusts.map((x) => out(x, ['reason'])),
    currencies: currencies.map((x) => out(x)),
    schedules: schedules.map((x) => out(x, ['note'])),
    debts: debts.map((x) => out(x)),
    remainderSplit: remainderSplit.map((x) => out(x)),
    preferences: p,
    holidaySets: holidaySets.map((x) => out(x)),
    spendings: spendings.map((x) => ({
      ...out(x, ['note']),
      rounds: spendingRounds.filter((r) => r.spendingId === x.id).map(({ userId: _u, spendingId: _s, ...r }) => r),
    })),
  }
}
