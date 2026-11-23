// Change sets (spec 005 S-3, S-4): every write request records what it changed, row by row,
// in the same transaction; a set can be reverted like `git revert` (the opposite change, as a
// new set). Recording is in the app, not in triggers, so the rows are stored exactly as the
// API reads them and the revert writes them back through the same rules.
import { randomUUID } from 'node:crypto'
import { and, desc, eq, getTableName, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from './db/client'
import { hasIdentity, OWNED, type OwnedTable } from './db/owned'
import * as t from './db/schema'
import { lockFor } from './db/scope'
import { m, MsgError, type Msg } from './messages'
import { roundsProblem } from '../src/lib/spending-rules'

export type RowKey = Record<string, string>
type Row = Record<string, unknown>

export interface Actor { kind: 'user' | 'api_key'; id: string }

/** One row change as the recorder saw it. */
export interface Collected { table: string; key: RowKey; op: 'insert' | 'update' | 'delete'; before: Row | null; after: Row | null }

/**
 * Collects one request's row changes into one change set (created on the first change).
 * With `collect` (a preview, spec 009 S-3) nothing is stored: the changes are pushed to that list.
 */
export class Recorder {
  private setId: string | null = null
  constructor(
    private q: Db,
    private uid: string,
    private actor: Actor,
    private meta: { method: string; path: string; revertOf?: string; actorLabel?: string; proposalId?: string },
    private collect?: Collected[],
  ) {}

  get id() { return this.setId }

  async record(table: PgTable, key: RowKey, op: 'insert' | 'update' | 'delete', before: Row | null, after: Row | null) {
    if (op === 'update' && same(before, after)) return
    if (this.collect) {
      this.setId ??= 'preview'
      this.collect.push({ table: getTableName(table), key, op, before: before ? plain(before) : null, after: after ? plain(after) : null })
      return
    }
    if (!this.setId) {
      this.setId = randomUUID()
      await this.q.insert(t.changeSet).values({
        userId: this.uid, id: this.setId, actorKind: this.actor.kind, actorId: this.actor.id,
        method: this.meta.method, path: this.meta.path, revertOf: this.meta.revertOf ?? null,
        actorLabel: this.meta.actorLabel ?? null, proposalId: this.meta.proposalId ?? null,
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

/**
 * The key of a row in its table, without the owner (the owner is the user doing the request):
 * id, or phaseId+targetId (phase_amount), or nothing for the one-per-user rows (settings, living, preference).
 * So history keeps pointing at the right row when data moves to another account.
 */
export function keyOf(table: PgTable, row: Row): RowKey {
  if (table === t.phaseAmount) return { phaseId: String(row.phaseId), targetId: String(row.targetId) }
  if (table === t.livingPhaseAmount) return { phaseId: String(row.phaseId), itemId: String(row.itemId) }
  if (table === t.accountPhaseAmount) return { phaseId: String(row.phaseId), accountId: String(row.accountId) }
  if (table === t.spendingRound) return { spendingId: String(row.spendingId), no: String(row.no) }
  if (table === t.settings || table === t.preference) return {}
  return { id: String(row.id) }
}

export function whereKey(table: OwnedTable, uid: string, key: RowKey): SQL {
  // userId in a key is the owner, which is always `uid` here (keys written before 0.1.1 shipped had it).
  const rest = Object.entries(key).filter(([k]) => k !== 'userId')
  return and(eq(table.userId, uid), ...rest.map(([k, v]) => eq(col(table, k), v)))!
}

export async function readRow(q: Db, table: OwnedTable, uid: string, key: RowKey): Promise<Row | null> {
  const [row] = await q.select().from(table as never).where(whereKey(table, uid, key)).for('update')
  return (row as Row | undefined) ?? null
}

// ── Revert ──
// These carry a message to be worded in the request's language (server/messages.ts).
export class Conflict extends MsgError {
  constructor(ref: Msg, public table: string, public key: RowKey) { super(ref) }
}
export class NotFound extends MsgError {}
export class RuleBroken extends MsgError {}

/**
 * Every lock the write paths take, in their order (data → phase → allocation_target → settings → living →
 * preference), so a revert, a preview or an apply cannot race them (a missing settings/living row cannot be
 * locked by FOR UPDATE; the advisory lock covers it). `data` comes first: every writer of user data takes it.
 */
export async function lockAll(q: Db, uid: string) {
  for (const name of ['data', 'phase', 'allocation_target', 'settings', 'living', 'preference']) await lockFor(q, name, uid)
}

/**
 * Undo set `id` as a new set. Each logged row must still look exactly as the set left it,
 * else Conflict (nothing changes). The rules the API enforces are checked again afterwards.
 */
export async function revert(q: Db, uid: string, id: string, rec: Recorder) {
  await lockAll(q, uid)
  // the buffer uses already without a paying card: the revert is refused only for one it breaks (review rc2-1 F-7)
  const looseBefore = await looseBuffers(q, uid)
  const [set] = await q.select().from(t.changeSet).where(and(eq(t.changeSet.userId, uid), eq(t.changeSet.id, id))).for('update')
  if (!set) throw new NotFound(m('changeNotFound'))
  if (set.revertedBy) throw new Conflict(m('changeReverted'), 'change_set', { id })
  const logs = await q.select().from(t.changeLog).where(and(eq(t.changeLog.userId, uid), eq(t.changeLog.setId, id))).orderBy(desc(t.changeLog.id))

  for (const log of logs) {
    const table = byName.get(log.tableName)
    // The old living row became living items (spec 013 S-2): its history stays readable but cannot be undone.
    if (!table && GONE.has(log.tableName)) throw new Conflict(m('changeGone'), log.tableName, log.rowKey)
    if (!table) throw new Error(`unknown table in change log: ${log.tableName}`)
    const current = await readRow(q, table, uid, log.rowKey)
    const expected = log.op === 'delete' ? null : log.after
    if (!same(current, expected)) {
      throw new Conflict(m('changeLater'), log.tableName, log.rowKey)
    }
    if (log.op === 'insert') {
      // Rows of this set that hang off this one were removed first (reverse order); any left came later.
      if (await hasChildren(q, uid, table, log.rowKey)) {
        throw new Conflict(m('changeChild'), log.tableName, log.rowKey)
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
  await checkRules(q, uid, looseBefore)
  if (rec.id) await q.update(t.changeSet).set({ revertedBy: rec.id }).where(and(eq(t.changeSet.userId, uid), eq(t.changeSet.id, id)))
}

/**
 * Rows that point at this one without being deleted with it (the API unlinks them on a delete, spec 013 S-9, S-13):
 * reverting the insert of a row they point at is a conflict, like a child (review 1 F-11).
 */
const LINKS = new Map<PgTable, [OwnedTable, PgColumn][]>([
  [t.bankAccount, [[t.card, t.card.accountId], [t.allocationTarget, t.allocationTarget.accountId]]],
  [t.card, [[t.spending, t.spending.cardId]]],
])

/** Tables that are gone; their logged changes cannot be reverted. */
const GONE = new Set(['living'])

/** Rows that reference this one (the cascades the API otherwise handles itself). */
const CHILDREN = new Map<PgTable, [OwnedTable, PgColumn][]>([
  [t.subscription, [[t.planChange, t.planChange.subId]]],
  [t.phase, [[t.phaseAmount, t.phaseAmount.phaseId], [t.livingPhaseAmount, t.livingPhaseAmount.phaseId], [t.accountPhaseAmount, t.accountPhaseAmount.phaseId]]],
  [t.allocationTarget, [[t.phaseAmount, t.phaseAmount.targetId], [t.monthAdjust, t.monthAdjust.targetId]]],
  [t.spending, [[t.spendingRound, t.spendingRound.spendingId]]],
  [t.livingItem, [[t.livingPhaseAmount, t.livingPhaseAmount.itemId]]],
  [t.bankAccount, [[t.accountBalance, t.accountBalance.accountId], [t.accountPhaseAmount, t.accountPhaseAmount.accountId]]],
])

export const childrenOf = (table: PgTable) => CHILDREN.get(table) ?? []

async function hasChildren(q: Db, uid: string, table: PgTable, key: RowKey) {
  for (const [child, fk] of [...childrenOf(table), ...(LINKS.get(table) ?? [])]) {
    const [hit] = await q.select({ n: sql<number>`1` }).from(child as never).where(and(eq(child.userId, uid), eq(fk, key.id!))).limit(1)
    if (hit) return true
  }
  return false
}

/**
 * The buffer uses (spec 013 S-8) whose card is gone or has no paying account, as a save refuses them, and their names. A
 * save keeps them valid, but rc.1 had no revert check, so data may already hold such a row.
 */
async function looseBuffers(q: Db, uid: string): Promise<Map<string, string>> {
  const buffers = await q.select({ id: t.spending.id, name: t.spending.name, cardId: t.spending.cardId }).from(t.spending)
    .where(and(eq(t.spending.userId, uid), eq(t.spending.how, 'buffer')))
  if (!buffers.length) return new Map()
  const cards = await q.select({ id: t.card.id, accountId: t.card.accountId }).from(t.card).where(eq(t.card.userId, uid))
  return new Map(buffers.filter((s) => !cards.find((c) => c.id === s.cardId)?.accountId).map((s) => [s.id, s.name]))
}

/**
 * The API's own rules, over the user's whole data (the database checks the rest). `looseBefore` are the buffer uses that
 * had no paying card before the revert: only a buffer use the revert leaves without one refuses it.
 */
async function checkRules(q: Db, uid: string, looseBefore: ReadonlyMap<string, string>) {
  const phases = await q.select().from(t.phase).where(eq(t.phase.userId, uid))
  const end = (x: string | null) => x ?? '9999-12'
  for (const [i, a] of phases.entries()) {
    const b = phases.slice(i + 1).find((o) => o.from <= end(a.to) && a.from <= end(o.to))
    if (b) throw new RuleBroken(m('revertOverlap', { a: `${a.label} ${a.name}`, b: `${b.label} ${b.name}` }))
  }
  const amounts = await q.select({ targetId: t.phaseAmount.targetId }).from(t.phaseAmount).where(eq(t.phaseAmount.userId, uid))
  if (amounts.length) {
    const ids = [...new Set(amounts.map((a) => a.targetId))]
    const fixed = await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
      .where(and(eq(t.allocationTarget.userId, uid), inArray(t.allocationTarget.id, ids), inArray(t.allocationTarget.kind, ['fixed', 'saving', 'invest'])))
    if (fixed.length !== ids.length) throw new RuleBroken(m('revertAmounts'))
  }
  // Spendings: the same rule a save keeps for the rounds against count and how (src/lib/spending-rules.ts).
  const spendings = await q.select().from(t.spending).where(eq(t.spending.userId, uid))
  if (spendings.length) {
    const rounds = await q.select().from(t.spendingRound).where(eq(t.spendingRound.userId, uid)).orderBy(t.spendingRound.no)
    for (const s of spendings) {
      if (roundsProblem({ how: s.how, count: s.count, rounds: rounds.filter((r) => r.spendingId === s.id) })) {
        throw new RuleBroken(m('revertSpending', { name: s.name }))
      }
    }
    // A buffer use keeps a card with a paying account (spec 013 S-8, S-9; review 2 F-6, user: "거부하도록 고침 (Recommended)"):
    // refused when the revert makes one newly invalid, not for one that was so already (review rc2-1 F-7).
    for (const [sid, name] of await looseBuffers(q, uid)) {
      if (!looseBefore.has(sid)) throw new RuleBroken(m('revertBuffer', { name }))
    }
  }
}

// ── Listing ──
/** A page cursor: the last set shown (its time and id; sets are ordered by both). */
export interface Cursor { at: string; id: string }

/** A period of the history (spec 013 S-18): `since` and `until` are ISO times, either may be left out. */
export interface Period { since?: string; until?: string }

export async function listSets(q: Db, uid: string, before: Cursor | undefined, limit: number, period: Period = {}) {
  const cs = t.changeSet
  const mine = and(eq(cs.userId, uid), period.since ? gte(cs.at, period.since) : undefined, period.until ? lt(cs.at, period.until) : undefined)!
  const where = before ? and(mine, or(lt(cs.at, before.at), and(eq(cs.at, before.at), lt(cs.id, before.id)))) : mine
  const sets = await q.select().from(cs).where(where).orderBy(desc(cs.at), desc(cs.id)).limit(limit)
  return withLogs(q, uid, sets)
}

export async function getSet(q: Db, uid: string, id: string) {
  const sets = await q.select().from(t.changeSet).where(and(eq(t.changeSet.userId, uid), eq(t.changeSet.id, id)))
  return (await withLogs(q, uid, sets))[0] ?? null
}

async function withLogs(q: Db, uid: string, sets: (typeof t.changeSet.$inferSelect)[]) {
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
