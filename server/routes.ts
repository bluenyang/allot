// Data API. Every route sits behind the session check in app.ts and works on the session user's
// rows only: every select, update and delete is filtered by user_id, and inserts set it here
// (a client never sends it). Each request runs in one transaction as that user, so the
// row-level security policies check the same thing again in the database.
//   GET    /api/state                 everything the app shows, lists in insertion order
//   PUT    /api/settings | /api/living  the single-row records
//   POST   /api/<resource>            create (server assigns the id)
//   PUT    /api/<resource>/:id        replace
//   DELETE /api/<resource>/:id
import { randomUUID } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, getTableName, inArray, ne, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { childrenOf, Conflict, keyOf, listSets, NotFound, readRow, Recorder, revert, RuleBroken, whereKey, type RowKey } from './changes'
import type { OwnedTable } from './db/owned'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from './app-env'
import type { Db } from './db/client'
import { asUser } from './db/scope'
import * as t from './db/schema'
import * as v from './validation'

type ListTable = PgTable & { id: PgColumn; seq: PgColumn; userId: PgColumn }

/** Drop `seq` and `userId` and turn SQL nulls of optional text fields into absent keys, as the client types expect. */
function out<R extends Record<string, unknown>>(row: R, optional: string[] = []): Omit<R, 'seq' | 'userId'> {
  const { seq: _seq, userId: _u, ...rest } = row
  for (const k of optional) if (rest[k] === null) delete rest[k]
  return rest
}

/** zValidator with a Korean, field-level 400 body. */
const body = <S extends z.ZodType>(schema: S) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) {
      const issue = r.error.issues[0]
      return c.json({ error: issue?.message ?? '입력값을 확인해 주세요.', path: issue?.path.join('.') ?? '' }, 400)
    }
  })

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code ?? err?.cause?.code
}

/** Map known constraint errors to 400; anything else is a real 500. */
function dbError(c: Context, e: unknown) {
  const code = pgCode(e)
  if (code === '23503') return c.json({ error: '연결된 항목을 찾을 수 없어요.' }, 400)
  // check violation, bad text repr, numeric/integer overflow, bad or out-of-range date
  if (['23514', '22P02', '22003', '22007', '22008'].includes(code ?? '')) return c.json({ error: '입력값이 허용 범위를 벗어났어요.' }, 400)
  throw e
}

/** Phases may not overlap (per user): [from, to] with an open end meaning "forever". */
export async function phaseOverlap(q: Db, uid: string, p: { from: string; to: string | null }, exceptId?: string) {
  const mine = eq(t.phase.userId, uid)
  const others = await q.select().from(t.phase).where(exceptId ? and(mine, ne(t.phase.id, exceptId)) : mine)
  const end = (x: string | null) => x ?? '9999-12'
  const hit = others.find((o) => o.from <= end(p.to) && p.from <= end(o.to))
  return hit ? `'${hit.label} ${hit.name}' 구간(${hit.from}~${hit.to ?? ''})과 겹쳐요.` : null
}

/** A rule the request breaks: the transaction rolls back and the client gets 400 with this message. */
export class Rejected extends Error {}

/**
 * Serialise writes to one table for one user (replaces table-wide locks: users do not wait for
 * each other). Taken at the start of the transaction; the order phase → allocation_target holds.
 */
export async function lockFor(q: Db, table: string, uid: string) {
  await q.execute(sql`select pg_advisory_xact_lock(hashtext(${`allot:${table}:`} || ${uid}))`)
}

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

/** The change set of this request (spec 005 S-3): one write request = one set. */
const recorderFor = (c: Context<AppEnv>, q: Db) =>
  new Recorder(q, uidOf(c), { kind: 'user', id: uidOf(c) }, { method: c.req.method, path: new URL(c.req.url).pathname })

type Row = Record<string, unknown>

/** Delete one row and log it (callers delete its children first, so cascades never fire unlogged). */
async function deleteLogged(q: Db, rec: Recorder, table: OwnedTable, uid: string, key: RowKey) {
  const [gone] = await q.delete(table).where(whereKey(table, uid, key)).returning()
  if (gone) await rec.record(table, key, 'delete', gone as Row, null)
  return gone as Row | undefined
}

/** Delete, with logs, every row that references `id` in `table` (plan changes of a subscription, amounts of a phase or target). */
async function deleteChildren(q: Db, rec: Recorder, uid: string, table: PgTable, id: string) {
  for (const [child, fk] of childrenOf(table)) {
    const rows = await q.delete(child).where(and(eq(child.userId, uid), eq(fk, id))).returning()
    for (const r of rows as Row[]) await rec.record(child, keyOf(child, r), 'delete', r, null)
  }
}

interface CrudOptions<S extends z.ZodType> {
  optional?: string[]
  /** Runs in the same transaction as the write; with `lock`, the table is locked first so checks cannot race. */
  check?: (q: Db, uid: string, input: z.infer<S>, id?: string) => Promise<string | null>
  lock?: boolean
  toRow?: (input: z.infer<S>) => Record<string, unknown>
  /** Same transaction, after the row is written; returns extra fields for the response (e.g. phase amounts). */
  afterWrite?: (q: Db, rec: Recorder, uid: string, id: string, input: z.infer<S>) => Promise<Record<string, unknown>>
  /** Same transaction (and lock) as the delete; a message refuses it with 400. */
  beforeDelete?: (q: Db, uid: string, id: string) => Promise<string | null>
}

function crud<T extends ListTable, S extends z.ZodType>(r: Hono<AppEnv>, path: string, table: T, schema: S, o: CrudOptions<S> = {}) {
  const toRow = o.toRow ?? ((x: z.infer<S>) => x as Record<string, unknown>)
  const shape = (row: unknown) => out(row as Record<string, unknown>, o.optional)
  const name = getTableName(table)
  const owned = table as unknown as OwnedTable
  const own = (uid: string, id: string) => and(eq(table.userId, uid), eq(table.id, id))

  /** check + write in one transaction; a failed check rolls back and becomes a 400. */
  const guarded = async <R>(c: Context<AppEnv>, input: z.infer<S>, id: string | undefined, write: (q: Db, rec: Recorder) => Promise<R>) => {
    const uid = uidOf(c)
    return asUser(uid, async (q) => {
      if (o.lock) await lockFor(q, name, uid)
      const problem = await o.check?.(q, uid, input, id)
      if (problem) throw new Rejected(problem)
      return write(q, recorderFor(c, q))
    })
  }

  r.post(path, body(schema), async (c) => {
    const uid = uidOf(c)
    const input = c.req.valid('json' as never) as z.infer<S>
    try {
      const row = await guarded(c, input, undefined, async (q, rec) => {
        const [written] = await q.insert(table).values({ ...toRow(input), id: randomUUID(), userId: uid } as T['$inferInsert']).returning()
        const id = (written as { id: string }).id
        await rec.record(table, { id }, 'insert', null, written as Row)
        const extra = o.afterWrite ? await o.afterWrite(q, rec, uid, id, input) : {}
        return { ...shape(written), ...extra }
      })
      return c.json(row, 201)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: e.message }, 400)
      return dbError(c, e)
    }
  })

  r.put(`${path}/:id`, body(schema), async (c) => {
    const uid = uidOf(c)
    const id = c.req.param('id')
    const input = c.req.valid('json' as never) as z.infer<S>
    try {
      // Clear optional fields the client left out, so "deleting" a note sticks.
      const cleared = Object.fromEntries((o.optional ?? []).map((k) => [k, null]))
      const row = await guarded(c, input, id, async (q, rec) => {
        const before = await readRow(q, owned, uid, { id })
        if (!before) return null
        const [written] = await q.update(table).set({ ...cleared, ...toRow(input) } as never).where(own(uid, id)).returning()
        await rec.record(table, { id }, 'update', before, written as Row)
        const extra = o.afterWrite ? await o.afterWrite(q, rec, uid, id, input) : {}
        return { ...shape(written), ...extra }
      })
      if (!row) return c.json({ error: '항목을 찾을 수 없어요.' }, 404)
      return c.json(row)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: e.message }, 400)
      return dbError(c, e)
    }
  })

  r.delete(`${path}/:id`, async (c) => {
    const uid = uidOf(c)
    const id = c.req.param('id')
    try {
      const gone = await asUser(uid, async (q) => {
        if (o.lock) await lockFor(q, name, uid)
        const problem = await o.beforeDelete?.(q, uid, id)
        if (problem) throw new Rejected(problem)
        if (!(await readRow(q, owned, uid, { id }))) return undefined
        const rec = recorderFor(c, q)
        await deleteChildren(q, rec, uid, table, id)
        return deleteLogged(q, rec, owned, uid, { id })
      })
      if (!gone) return c.json({ error: '항목을 찾을 수 없어요.' }, 404)
      return c.body(null, 204)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: e.message }, 400)
      return dbError(c, e)
    }
  })
}

export const routes = new Hono<AppEnv>()

routes.get('/state', async (c) => {
  const uid = uidOf(c)
  // One transaction (one connection) as the user; the queries run one after another on it.
  const [[settings], [living], subscriptions, planChanges, phases, events, checks, accounts, debts, remainderSplit, targets, amounts] = await asUser(uid, (q) => {
  const list = <T extends ListTable>(table: T) =>
    q.select().from(table as never).where(eq(table.userId, uid)).orderBy(asc(table.seq)) as unknown as Promise<T['$inferSelect'][]>
  return Promise.all([
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
  ])
  })
  const amountsOf = (phaseId: string) =>
    Object.fromEntries(amounts.filter((a) => a.phaseId === phaseId).map((a) => [a.targetId, a.amount]))
  if (!settings || !living) return c.json({ error: '설정이 비어 있어요. pnpm db:seed로 처음 데이터를 넣어 주세요.' }, 409)
  const { userId: _s, ...s } = settings
  const { userId: _l, ...l } = living
  return c.json({
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
  })
})

routes.put('/settings', body(v.settings), async (c) => {
  const uid = uidOf(c)
  const input = c.req.valid('json')
  try {
    const [row] = await asUser(uid, async (q) => {
      const before = await readRow(q, t.settings, uid, { userId: uid })
      const written = await q.insert(t.settings).values({ userId: uid, ...input })
        .onConflictDoUpdate({ target: t.settings.userId, set: input }).returning()
      await recorderFor(c, q).record(t.settings, { userId: uid }, before ? 'update' : 'insert', before, written[0] as Row)
      return written
    })
    const { userId: _id, ...rest } = row!
    return c.json(rest)
  } catch (e) {
    return dbError(c, e)
  }
})

routes.put('/living', body(v.living), async (c) => {
  const uid = uidOf(c)
  const input = c.req.valid('json')
  try {
    const [row] = await asUser(uid, async (q) => {
      const before = await readRow(q, t.living, uid, { userId: uid })
      const written = await q.insert(t.living).values({ userId: uid, ...input })
        .onConflictDoUpdate({ target: t.living.userId, set: input }).returning()
      await recorderFor(c, q).record(t.living, { userId: uid }, before ? 'update' : 'insert', before, written[0] as Row)
      return written
    })
    const { userId: _id, ...rest } = row!
    return c.json(rest)
  } catch (e) {
    return dbError(c, e)
  }
})

crud(routes, '/subscriptions', t.subscription, v.subscription, {
  optional: ['note'],
  // KRW items carry no VAT (the same rule the editor applied before).
  toRow: (s) => ({ ...s, vat: s.currency === 'KRW' ? 0 : s.vat, note: s.note || null }),
})
crud(routes, '/plan-changes', t.planChange, v.planChange)
/**
 * Replace a phase's amounts; only fixed targets may carry one.
 * Target writes hold the user's allocation_target lock; taking it here means a target cannot
 * change kind between this check and the insert. Lock order is always phase → allocation_target
 * (target writes never take the phase lock), so the two cannot deadlock.
 */
async function writeAmounts(q: Db, rec: Recorder, uid: string, phaseId: string, amounts: Record<string, number>) {
  await lockFor(q, 'allocation_target', uid)
  const want = Object.fromEntries(Object.entries(amounts).filter(([, v]) => v !== 0))
  const ids = Object.keys(want)
  if (ids.length) {
    const fixed = await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
      .where(and(eq(t.allocationTarget.userId, uid), inArray(t.allocationTarget.id, ids), eq(t.allocationTarget.kind, 'fixed')))
    const ok = new Set(fixed.map((f) => f.id))
    const bad = ids.filter((i) => !ok.has(i))
    if (bad.length) throw new Rejected('구간 금액은 고정 대상에만 넣을 수 있어요.')
  }
  // Only what differs is written (and logged): removed, changed, added.
  const pa = t.phaseAmount
  const have = await q.select().from(pa).where(and(eq(pa.userId, uid), eq(pa.phaseId, phaseId)))
  for (const old of have) {
    const key = { phaseId, targetId: old.targetId }
    if (!(old.targetId in want)) await deleteLogged(q, rec, pa, uid, key)
    else if (want[old.targetId] !== old.amount) {
      const [written] = await q.update(pa).set({ amount: want[old.targetId]! }).where(whereKey(pa, uid, key)).returning()
      await rec.record(pa, key, 'update', old, written as Row)
    }
  }
  for (const [targetId, amount] of Object.entries(want)) {
    if (have.some((h) => h.targetId === targetId)) continue
    const [written] = await q.insert(pa).values({ userId: uid, phaseId, targetId, amount }).returning()
    await rec.record(pa, { phaseId, targetId }, 'insert', null, written as Row)
  }
  return { amounts: want }
}

crud(routes, '/phases', t.phase, v.phase, {
  optional: ['note'],
  lock: true,
  check: (q, uid, p, id) => phaseOverlap(q, uid, p, id),
  toRow: ({ amounts: _a, ...p }) => ({ ...p, note: p.note || null }),
  afterWrite: (q, rec, uid, id, p) => writeAmounts(q, rec, uid, id, p.amounts),
})
crud(routes, '/events', t.planEvent, v.planEvent)
crud(routes, '/checks', t.checkItem, v.checkItem)
crud(routes, '/accounts', t.bankAccount, v.account)
crud(routes, '/debts', t.debt, v.debt)
crud(routes, '/remainder-split', t.remainderSplit, v.remainderSplit)

const KIND_LABEL = { living: '생활비 합계', subscriptions: '구독 이체액', remainder: '나머지' } as const
crud(routes, '/targets', t.allocationTarget, v.target, {
  optional: ['note'],
  lock: true,
  toRow: (x) => ({ ...x, note: x.note || null }),
  check: async (q, uid, x, id) => {
    const all = await q.select().from(t.allocationTarget).where(eq(t.allocationTarget.userId, uid))
    if (x.kind !== 'fixed' && all.some((o) => o.kind === x.kind && o.id !== id)) {
      return `'${KIND_LABEL[x.kind]}' 대상은 하나만 둘 수 있어요.`
    }
    const was = all.find((o) => o.id === id)
    if (was?.kind === 'remainder' && x.kind !== 'remainder') return '나머지 대상은 하나 있어야 해서 종류를 바꿀 수 없어요. 이름은 바꿀 수 있어요.'
    return null
  },
  // A target that is no longer 'fixed' keeps no phase amounts.
  afterWrite: async (q, rec, uid, id, x) => {
    if (x.kind !== 'fixed') await deleteChildren(q, rec, uid, t.allocationTarget, id)
    return {}
  },
  beforeDelete: async (q, uid, id) => {
    const [row] = await q.select().from(t.allocationTarget).where(and(eq(t.allocationTarget.userId, uid), eq(t.allocationTarget.id, id)))
    return row?.kind === 'remainder' ? '나머지 대상은 지울 수 없어요. 나머지를 받을 곳이 하나는 있어야 해요.' : null
  },
})

// ── Change sets (spec 005 S-3) ──
//   GET  /api/changes?before=<at>&limit=50   newest first, with their row changes
//   POST /api/changes/:id/revert             the opposite change, as a new set
routes.get('/changes', async (c) => {
  const uid = uidOf(c)
  const before = c.req.query('before') || undefined
  if (before && Number.isNaN(Date.parse(before))) return c.json({ error: 'before는 시각이어야 해요.' }, 400)
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200)
  return c.json(await asUser(uid, (q) => listSets(q, uid, before, limit)))
})

routes.post('/changes/:id/revert', async (c) => {
  const uid = uidOf(c)
  const id = c.req.param('id')
  try {
    const setId = await asUser(uid, async (q) => {
      const rec = new Recorder(q, uid, { kind: 'user', id: uid }, { method: c.req.method, path: new URL(c.req.url).pathname, revertOf: id })
      await revert(q, uid, id, rec)
      return rec.id
    })
    return c.json({ reverted: id, changeSet: setId })
  } catch (e) {
    if (e instanceof NotFound) return c.json({ error: e.message }, 404)
    if (e instanceof Conflict) return c.json({ error: e.message, table: e.table, key: e.key }, 409)
    if (e instanceof RuleBroken) return c.json({ error: e.message }, 400)
    return dbError(c, e)
  }
})
