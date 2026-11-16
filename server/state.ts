// Everything a user's screens show, read in one go (spec 008 S-7). GET /api/state sends it as it is,
// and the MCP tools (server/mcp/) compute from the same rows, so the screen and the AI see the same numbers.
// Call it inside asUser(uid, …): the queries run one after another on that transaction.
import { asc, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from './db/client'
import * as t from './db/schema'
import { DEFAULT_LIVING, DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from '../src/data/defaults'

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
  const [[settings], [living], subscriptions, planChanges, phases, events, checks, accounts, debts, remainderSplit, targets, amounts, [prefs], holidaySets] = await Promise.all([
    q.select().from(t.settings).where(eq(t.settings.userId, uid)),
    q.select().from(t.living).where(eq(t.living.userId, uid)),
    list(t.subscription),
    list(t.planChange),
    list(t.phase),
    list(t.planEvent),
    list(t.checkItem),
    list(t.bankAccount),
    list(t.debt),
    list(t.remainderSplit),
    list(t.allocationTarget),
    q.select().from(t.phaseAmount).where(eq(t.phaseAmount.userId, uid)),
    q.select().from(t.preference).where(eq(t.preference.userId, uid)),
    list(t.holidaySet),
  ])
  const amountsOf = (phaseId: string) =>
    Object.fromEntries(amounts.filter((a) => a.phaseId === phaseId).map((a) => [a.targetId, a.amount]))
  // A new account has no rows yet: it gets the defaults until its first save (spec 006 S-7).
  const { userId: _s, ...s } = settings ?? { userId: uid, ...DEFAULT_SETTINGS }
  const { userId: _l, ...l } = living ?? { userId: uid, ...DEFAULT_LIVING }
  const { userId: _p, ...p } = prefs ?? { userId: uid, ...DEFAULT_PREFERENCES }
  return {
    settings: s,
    living: l,
    subscriptions: subscriptions.map((x) => out(x, ['note'])),
    planChanges: planChanges.map((x) => out(x)),
    targets: targets.map((x) => out(x, ['note'])),
    phases: phases.map((x) => ({ ...out(x, ['note']), amounts: amountsOf(x.id) })),
    events: events.map((x) => out(x)),
    checks: checks.map((x) => out(x)),
    accounts: accounts.map((x) => out(x)),
    debts: debts.map((x) => out(x)),
    remainderSplit: remainderSplit.map((x) => out(x)),
    preferences: p,
    holidaySets: holidaySets.map((x) => out(x)),
  }
}
