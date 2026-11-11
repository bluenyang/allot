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

/** Has an identity `seq` column: re-inserting a row keeps its order only with OVERRIDING SYSTEM VALUE. */
export const hasSeq = (table: PgTable) => 'seq' in getTableColumns(table)

/**
 * Move every row of one user to another (same transaction as the caller). Row-level security
 * sees one user at a time: read and delete as `from`, then insert as `to`.
 */
export async function moveOwner(q: Db, from: string, to: string) {
  await setUser(q, from)
  const rows = new Map<OwnedTable, Record<string, unknown>[]>()
  for (const table of OWNED) rows.set(table, await q.select().from(table as never).where(eq(table.userId, from)) as Record<string, unknown>[])
  for (const table of [...OWNED].reverse()) await q.delete(table).where(eq(table.userId, from))
  await setUser(q, to)
  for (const table of OWNED) {
    const list = rows.get(table)!.map((r) => ({ ...r, userId: to }))
    if (!list.length) continue
    const ins = hasSeq(table) ? q.insert(table).overridingSystemValue() : q.insert(table)
    await ins.values(list as never)
  }
}
