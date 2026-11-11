// The tables whose rows belong to a user, parents before children (insert in this order,
// delete in reverse). Shared by the seed (moving data to another account) and, later, revert.
import { eq, getTableColumns } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from './client'
import * as t from './schema'
import { setUser } from './scope'

export type OwnedTable = PgTable & { userId: PgColumn }

export const OWNED: OwnedTable[] = [
  t.settings, t.living, t.subscription, t.phase, t.allocationTarget, t.planEvent,
  t.checkItem, t.bankAccount, t.debt, t.remainderSplit, t.planChange, t.phaseAmount,
]

/** Moved with the data when an account is replaced: the data tables, then the change history. */
const MOVED: OwnedTable[] = [...OWNED, t.changeSet, t.changeLog]

/**
 * Has a GENERATED ALWAYS identity column (`seq`, change_log.id): re-inserting a row with its
 * own value needs OVERRIDING SYSTEM VALUE.
 */
export const hasIdentity = (table: PgTable) => Object.values(getTableColumns(table)).some((c) => c.generatedIdentity !== undefined)

/**
 * Move every row of one user to another (same transaction as the caller). Row-level security
 * sees one user at a time: read and delete as `from`, then insert as `to`.
 */
export async function moveOwner(q: Db, from: string, to: string) {
  await setUser(q, from)
  const rows = new Map<OwnedTable, Record<string, unknown>[]>()
  for (const table of MOVED) rows.set(table, await q.select().from(table as never).where(eq(table.userId, from)) as Record<string, unknown>[])
  for (const table of [...MOVED].reverse()) await q.delete(table).where(eq(table.userId, from))
  await setUser(q, to)
  for (const table of MOVED) {
    const list = rows.get(table)!.map((r) => ({ ...r, userId: to }))
    if (!list.length) continue
    const ins = hasIdentity(table) ? q.insert(table).overridingSystemValue() : q.insert(table)
    await ins.values(list as never)
  }
}
