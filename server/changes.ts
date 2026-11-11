// Change sets (spec 005 S-3, S-4): every write request records what it changed, row by row,
// in the same transaction; a set can be reverted like `git revert` (the opposite change, as a
// new set). Recording is in the app, not in triggers, so the rows are stored exactly as the
// API reads them and the revert writes them back through the same rules.
import { randomUUID } from 'node:crypto'
import { and, desc, eq, getTableName, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from './db/client'
import { hasIdentity, OWNED, type OwnedTable } from './db/owned'
import * as t from './db/schema'

export type RowKey = Record<string, string>
type Row = Record<string, unknown>

export interface Actor { kind: 'user' | 'api_key'; id: string }

/** Collects one request's row changes into one change set (created on the first change). */
export class Recorder {
  private setId: string | null = null
  constructor(
    private q: Db,
    private uid: string,
    private actor: Actor,
    private meta: { method: string; path: string; revertOf?: string },
  ) {}

  get id() { return this.setId }

  async record(table: PgTable, key: RowKey, op: 'insert' | 'update' | 'delete', before: Row | null, after: Row | null) {
    if (op === 'update' && same(before, after)) return
    if (!this.setId) {
      this.setId = randomUUID()
      await this.q.insert(t.changeSet).values({
        userId: this.uid, id: this.setId, actorKind: this.actor.kind, actorId: this.actor.id,
        method: this.meta.method, path: this.meta.path, revertOf: this.meta.revertOf ?? null,
      })
    }
    await this.q.insert(t.changeLog).values({
      userId: this.uid, setId: this.setId, tableName: getTableName(table), rowKey: key, op,
      before: before ? plain(before) : null, after: after ? plain(after) : null,
    })
  }
}

/** JSON-safe copy (what jsonb will hold), so comparisons see the same values. */
const plain = (r: Row): Row => JSON.parse(JSON.stringify(r)) as Row

/** Same row content, key order ignored. The owner is not content (data can move to another account). */
export function same(a: Row | null | undefined, b: Row | null | undefined): boolean {
  if (!a || !b) return !a && !b
  const norm = (r: Row) => JSON.stringify(Object.keys(r).filter((k) => k !== 'userId').sort().map((k) => [k, r[k]]))
  return norm(plain(a)) === norm(plain(b))
}

// ── Row keys ──
const byName = new Map<string, OwnedTable>(OWNED.map((x) => [getTableName(x), x]))
const col = (table: PgTable, k: string) => (table as unknown as Record<string, PgColumn>)[k]!

/** The key of a row in its table: id, or userId (settings, living), or phaseId+targetId (phase_amount). */
export function keyOf(table: PgTable, row: Row): RowKey {
  if (table === t.phaseAmount) return { phaseId: String(row.phaseId), targetId: String(row.targetId) }
  if (table === t.settings || table === t.living) return { userId: String(row.userId) }
  return { id: String(row.id) }
}

export function whereKey(table: OwnedTable, uid: string, key: RowKey): SQL {
  return and(eq(table.userId, uid), ...Object.entries(key).map(([k, v]) => eq(col(table, k), v)))!
}

export async function readRow(q: Db, table: OwnedTable, uid: string, key: RowKey): Promise<Row | null> {
  const [row] = await q.select().from(table as never).where(whereKey(table, uid, key)).for('update')
  return (row as Row | undefined) ?? null
}

// ── Revert ──
export class Conflict extends Error {
  constructor(message: string, public table: string, public key: RowKey) { super(message) }
}
export class NotFound extends Error {}
export class RuleBroken extends Error {}

/** Locks every write path takes, in their order (phase → allocation_target), so a revert cannot race them. */
async function lockAll(q: Db, uid: string) {
  for (const name of ['phase', 'allocation_target']) {
    await q.execute(sql`select pg_advisory_xact_lock(hashtext(${`allot:${name}:`} || ${uid}))`)
  }
}

/**
 * Undo set `id` as a new set. Each logged row must still look exactly as the set left it,
 * else Conflict (nothing changes). The rules the API enforces are checked again afterwards.
 */
export async function revert(q: Db, uid: string, id: string, rec: Recorder) {
  await lockAll(q, uid)
  const [set] = await q.select().from(t.changeSet).where(and(eq(t.changeSet.userId, uid), eq(t.changeSet.id, id))).for('update')
  if (!set) throw new NotFound('변경 묶음을 찾을 수 없어요.')
  if (set.revertedBy) throw new Conflict('이미 되돌린 변경이에요. 되돌린 묶음을 되돌리면 다시 적용돼요.', 'change_set', { id })
  const logs = await q.select().from(t.changeLog).where(and(eq(t.changeLog.userId, uid), eq(t.changeLog.setId, id))).orderBy(desc(t.changeLog.id))
  const hadRemainder = await remainderCount(q, uid)

  for (const log of logs) {
    const table = byName.get(log.tableName)
    if (!table) throw new Error(`unknown table in change log: ${log.tableName}`)
    const current = await readRow(q, table, uid, log.rowKey)
    const expected = log.op === 'delete' ? null : log.after
    if (!same(current, expected)) {
      throw new Conflict('이후에 바뀐 항목이 있어 되돌릴 수 없어요.', log.tableName, log.rowKey)
    }
    if (log.op === 'insert') {
      // Rows of this set that hang off this one were removed first (reverse order); any left came later.
      if (await hasChildren(q, uid, table, log.rowKey)) {
        throw new Conflict('이후에 연결된 항목이 생겨서 되돌릴 수 없어요.', log.tableName, log.rowKey)
      }
      await q.delete(table).where(whereKey(table, uid, log.rowKey))
      await rec.record(table, log.rowKey, 'delete', current, null)
    } else if (log.op === 'delete') {
      const row = { ...log.before!, userId: uid }
      const ins = hasIdentity(table) ? q.insert(table).overridingSystemValue() : q.insert(table)
      const [written] = await ins.values(row as never).returning()
      await rec.record(table, log.rowKey, 'insert', null, written as Row)
    } else {
      const { userId: _u, seq: _s, ...set } = log.before! // seq is an identity: never updated
      const [written] = await q.update(table).set(set as never).where(whereKey(table, uid, log.rowKey)).returning()
      await rec.record(table, log.rowKey, 'update', current, written as Row)
    }
  }
  await checkRules(q, uid, hadRemainder)
  if (rec.id) await q.update(t.changeSet).set({ revertedBy: rec.id }).where(and(eq(t.changeSet.userId, uid), eq(t.changeSet.id, id)))
}

/** Rows that reference this one (the cascades the API otherwise handles itself). */
const CHILDREN = new Map<PgTable, [OwnedTable, PgColumn][]>([
  [t.subscription, [[t.planChange, t.planChange.subId]]],
  [t.phase, [[t.phaseAmount, t.phaseAmount.phaseId]]],
  [t.allocationTarget, [[t.phaseAmount, t.phaseAmount.targetId]]],
])

export const childrenOf = (table: PgTable) => CHILDREN.get(table) ?? []

async function hasChildren(q: Db, uid: string, table: PgTable, key: RowKey) {
  for (const [child, fk] of childrenOf(table)) {
    const [hit] = await q.select({ n: sql<number>`1` }).from(child as never).where(and(eq(child.userId, uid), eq(fk, key.id!))).limit(1)
    if (hit) return true
  }
  return false
}

const remainderCount = async (q: Db, uid: string) =>
  (await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
    .where(and(eq(t.allocationTarget.userId, uid), eq(t.allocationTarget.kind, 'remainder')))).length

/** The API's own rules, over the user's whole data (the database checks the rest). */
async function checkRules(q: Db, uid: string, hadRemainder: number) {
  const phases = await q.select().from(t.phase).where(eq(t.phase.userId, uid))
  const end = (x: string | null) => x ?? '9999-12'
  for (const [i, a] of phases.entries()) {
    const b = phases.slice(i + 1).find((o) => o.from <= end(a.to) && a.from <= end(o.to))
    if (b) throw new RuleBroken(`되돌리면 '${a.label} ${a.name}' 구간과 '${b.label} ${b.name}' 구간이 겹쳐요.`)
  }
  const amounts = await q.select({ targetId: t.phaseAmount.targetId }).from(t.phaseAmount).where(eq(t.phaseAmount.userId, uid))
  if (amounts.length) {
    const ids = [...new Set(amounts.map((a) => a.targetId))]
    const fixed = await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
      .where(and(eq(t.allocationTarget.userId, uid), inArray(t.allocationTarget.id, ids), eq(t.allocationTarget.kind, 'fixed')))
    if (fixed.length !== ids.length) throw new RuleBroken('되돌리면 고정 대상이 아닌 곳에 구간 금액이 생겨요.')
  }
  if (hadRemainder > 0 && (await remainderCount(q, uid)) === 0) throw new RuleBroken('되돌리면 나머지 대상이 없어져요.')
}

// ── Listing ──
export async function listSets(q: Db, uid: string, before: string | undefined, limit: number) {
  const where = before ? and(eq(t.changeSet.userId, uid), lt(t.changeSet.at, before)) : eq(t.changeSet.userId, uid)
  const sets = await q.select().from(t.changeSet).where(where).orderBy(desc(t.changeSet.at), desc(t.changeSet.id)).limit(limit)
  if (!sets.length) return []
  const logs = await q.select().from(t.changeLog)
    .where(and(eq(t.changeLog.userId, uid), inArray(t.changeLog.setId, sets.map((s) => s.id)))).orderBy(t.changeLog.id)
  return sets.map(({ userId: _u, ...s }) => ({
    ...s,
    changes: logs.filter((l) => l.setId === s.id).map(({ userId: _l, setId: _s, ...l }) => l),
  }))
}

// ── Retention (S-4) ──
/** Delete this user's sets older than `days` (their logs cascade). Not recorded as a set. */
export async function pruneSets(q: Db, uid: string, days: number) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString()
  const gone = await q.delete(t.changeSet).where(and(eq(t.changeSet.userId, uid), lt(t.changeSet.at, cut))).returning({ id: t.changeSet.id })
  return gone.length
}
