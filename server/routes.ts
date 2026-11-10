// Data API. Every route sits behind the session check in app.ts.
//   GET    /api/state                 everything the app shows, lists in insertion order
//   PUT    /api/settings | /api/living  the single-row records
//   POST   /api/<resource>            create (server assigns the id)
//   PUT    /api/<resource>/:id        replace
//   DELETE /api/<resource>/:id
import { randomUUID } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from './app-env'
import { db, type Db } from './db/client'
import * as t from './db/schema'
import * as v from './validation'

type ListTable = PgTable & { id: PgColumn; seq: PgColumn }

/** Drop `seq` and turn SQL nulls of optional text fields into absent keys, as the client types expect. */
function out<R extends Record<string, unknown>>(row: R, optional: string[] = []): Omit<R, 'seq'> {
  const { seq: _seq, ...rest } = row
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

/** Phases may not overlap: [from, to] with an open end meaning "forever". */
async function phaseOverlap(q: Db, p: { from: string; to: string | null }, exceptId?: string) {
  const others = await (exceptId ? q.select().from(t.phase).where(ne(t.phase.id, exceptId)) : q.select().from(t.phase))
  const end = (x: string | null) => x ?? '9999-12'
  const hit = others.find((o) => o.from <= end(p.to) && p.from <= end(o.to))
  return hit ? `'${hit.label} ${hit.name}' 구간(${hit.from}~${hit.to ?? ''})과 겹쳐요.` : null
}

/** A rule the request breaks: the transaction rolls back and the client gets 400 with this message. */
class Rejected extends Error {}

interface CrudOptions<S extends z.ZodType> {
  optional?: string[]
  /** Runs in the same transaction as the write; with `lock`, the table is locked first so checks cannot race. */
  check?: (q: Db, input: z.infer<S>, id?: string) => Promise<string | null>
  lock?: boolean
  toRow?: (input: z.infer<S>) => Record<string, unknown>
  /** Same transaction, after the row is written; returns extra fields for the response (e.g. phase amounts). */
  afterWrite?: (q: Db, id: string, input: z.infer<S>) => Promise<Record<string, unknown>>
  /** Same transaction (and lock) as the delete; a message refuses it with 400. */
  beforeDelete?: (q: Db, id: string) => Promise<string | null>
}

function crud<T extends ListTable, S extends z.ZodType>(r: Hono<AppEnv>, path: string, table: T, schema: S, o: CrudOptions<S> = {}) {
  const toRow = o.toRow ?? ((x: z.infer<S>) => x as Record<string, unknown>)
  const shape = (row: unknown) => out(row as Record<string, unknown>, o.optional)

  /** check + write in one transaction; a failed check rolls back and becomes a 400. */
  const guarded = async <R>(input: z.infer<S>, id: string | undefined, write: (q: Db) => Promise<R>) =>
    db.transaction(async (tx) => {
      const q = tx as unknown as Db
      if (o.lock) await q.execute(sql`lock table ${table} in share row exclusive mode`)
      const problem = await o.check?.(q, input, id)
      if (problem) throw new Rejected(problem)
      return write(q)
    })

  r.post(path, body(schema), async (c) => {
    const input = c.req.valid('json' as never) as z.infer<S>
    try {
      const row = await guarded(input, undefined, async (q) => {
        const [written] = await q.insert(table).values({ ...toRow(input), id: randomUUID() } as T['$inferInsert']).returning()
        const extra = o.afterWrite ? await o.afterWrite(q, (written as { id: string }).id, input) : {}
        return { ...shape(written), ...extra }
      })
      return c.json(row, 201)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: e.message }, 400)
      return dbError(c, e)
    }
  })

  r.put(`${path}/:id`, body(schema), async (c) => {
    const id = c.req.param('id')
    const input = c.req.valid('json' as never) as z.infer<S>
    try {
      // Clear optional fields the client left out, so "deleting" a note sticks.
      const cleared = Object.fromEntries((o.optional ?? []).map((k) => [k, null]))
      const row = await guarded(input, id, async (q) => {
        const [written] = await q.update(table).set({ ...cleared, ...toRow(input) } as never).where(eq(table.id, id)).returning()
        if (!written) return null
        const extra = o.afterWrite ? await o.afterWrite(q, id, input) : {}
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
    const id = c.req.param('id')
    try {
      const rows = await db.transaction(async (tx) => {
        const q = tx as unknown as Db
        if (o.lock) await q.execute(sql`lock table ${table} in share row exclusive mode`)
        const problem = await o.beforeDelete?.(q, id)
        if (problem) throw new Rejected(problem)
        return q.delete(table).where(eq(table.id, id)).returning({ id: table.id })
      })
      if (rows.length === 0) return c.json({ error: '항목을 찾을 수 없어요.' }, 404)
      return c.body(null, 204)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: e.message }, 400)
      return dbError(c, e)
    }
  })
}

export const routes = new Hono<AppEnv>()

routes.get('/state', async (c) => {
  const [[settings], [living], subscriptions, planChanges, phases, events, checks, accounts, debts, remainderSplit, targets, amounts] = await Promise.all([
    db.select().from(t.settings).where(eq(t.settings.id, 1)),
    db.select().from(t.living).where(eq(t.living.id, 1)),
    db.select().from(t.subscription).orderBy(asc(t.subscription.seq)),
    db.select().from(t.planChange).orderBy(asc(t.planChange.seq)),
    db.select().from(t.phase).orderBy(asc(t.phase.seq)),
    db.select().from(t.planEvent).orderBy(asc(t.planEvent.seq)),
    db.select().from(t.checkItem).orderBy(asc(t.checkItem.seq)),
    db.select().from(t.bankAccount).orderBy(asc(t.bankAccount.seq)),
    db.select().from(t.debt).orderBy(asc(t.debt.seq)),
    db.select().from(t.remainderSplit).orderBy(asc(t.remainderSplit.seq)),
    db.select().from(t.allocationTarget).orderBy(asc(t.allocationTarget.seq)),
    db.select().from(t.phaseAmount),
  ])
  const amountsOf = (phaseId: string) =>
    Object.fromEntries(amounts.filter((a) => a.phaseId === phaseId).map((a) => [a.targetId, a.amount]))
  if (!settings || !living) return c.json({ error: '설정이 비어 있어요. pnpm db:seed로 처음 데이터를 넣어 주세요.' }, 409)
  const { id: _s, ...s } = settings
  const { id: _l, ...l } = living
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
  const input = c.req.valid('json')
  try {
    const [row] = await db.insert(t.settings).values({ id: 1, ...input })
      .onConflictDoUpdate({ target: t.settings.id, set: input }).returning()
    const { id: _id, ...rest } = row!
    return c.json(rest)
  } catch (e) {
    return dbError(c, e)
  }
})

routes.put('/living', body(v.living), async (c) => {
  const input = c.req.valid('json')
  try {
    const [row] = await db.insert(t.living).values({ id: 1, ...input })
      .onConflictDoUpdate({ target: t.living.id, set: input }).returning()
    const { id: _id, ...rest } = row!
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
 * Target writes hold SHARE ROW EXCLUSIVE on allocation_target; this SHARE lock conflicts with it,
 * so a target cannot change kind between this check and the insert. Lock order is always
 * phase → allocation_target (target writes never lock phase), so the two cannot deadlock.
 */
async function writeAmounts(q: Db, phaseId: string, amounts: Record<string, number>) {
  await q.execute(sql`lock table ${t.allocationTarget} in share mode`)
  const ids = Object.keys(amounts)
  if (ids.length) {
    const fixed = await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
      .where(and(inArray(t.allocationTarget.id, ids), eq(t.allocationTarget.kind, 'fixed')))
    const ok = new Set(fixed.map((f) => f.id))
    const bad = ids.filter((i) => !ok.has(i))
    if (bad.length) throw new Rejected('구간 금액은 고정 대상에만 넣을 수 있어요.')
  }
  await q.delete(t.phaseAmount).where(eq(t.phaseAmount.phaseId, phaseId))
  const rows = Object.entries(amounts).filter(([, v]) => v !== 0).map(([targetId, amount]) => ({ phaseId, targetId, amount }))
  if (rows.length) await q.insert(t.phaseAmount).values(rows)
  return { amounts: Object.fromEntries(rows.map((r) => [r.targetId, r.amount])) }
}

crud(routes, '/phases', t.phase, v.phase, {
  optional: ['note'],
  lock: true,
  check: (q, p, id) => phaseOverlap(q, p, id),
  toRow: ({ amounts: _a, ...p }) => ({ ...p, note: p.note || null }),
  afterWrite: (q, id, p) => writeAmounts(q, id, p.amounts),
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
  check: async (q, x, id) => {
    const all = await q.select().from(t.allocationTarget)
    if (x.kind !== 'fixed' && all.some((o) => o.kind === x.kind && o.id !== id)) {
      return `'${KIND_LABEL[x.kind]}' 대상은 하나만 둘 수 있어요.`
    }
    const was = all.find((o) => o.id === id)
    if (was?.kind === 'remainder' && x.kind !== 'remainder') return '나머지 대상은 하나 있어야 해서 종류를 바꿀 수 없어요. 이름은 바꿀 수 있어요.'
    return null
  },
  // A target that is no longer 'fixed' keeps no phase amounts.
  afterWrite: async (q, id, x) => {
    if (x.kind !== 'fixed') await q.delete(t.phaseAmount).where(eq(t.phaseAmount.targetId, id))
    return {}
  },
  beforeDelete: async (q, id) => {
    const [row] = await q.select().from(t.allocationTarget).where(eq(t.allocationTarget.id, id))
    return row?.kind === 'remainder' ? '나머지 대상은 지울 수 없어요. 나머지를 받을 곳이 하나는 있어야 해요.' : null
  },
})
