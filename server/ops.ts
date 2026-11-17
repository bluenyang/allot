// Writes as operations (spec 009 S-1): one place for the rules of every write to a user's data.
// The screen's routes (server/routes.ts) apply one operation per request, an AI proposal applies a
// list of them in one transaction (server/proposals.ts): same validation, same locks, same overlap
// and kind rules, same change-set records. An operation is { resource, action, id?, data? };
// `data` is the resource's request body. Call everything here inside asUser(uid, …).
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { getTableName } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { childrenOf, keyOf, readRow, Recorder, whereKey, type RowKey } from './changes'
import type { Db } from './db/client'
import type { OwnedTable } from './db/owned'
import * as t from './db/schema'
import { lockFor } from './db/scope'
import { m, issueMessage, MsgError, text, type Msg } from './messages'
import { out, type ListTable } from './state'
import * as v from './validation'

type Row = Record<string, unknown>

/** A rule the request breaks: the transaction rolls back and the client gets 400 with this message. */
export class Rejected extends MsgError {}

/** Phases may not overlap (per user): [from, to] with an open end meaning "forever". */
export async function phaseOverlap(q: Db, uid: string, p: { from: string; to: string | null }, exceptId?: string): Promise<Msg | null> {
  const mine = eq(t.phase.userId, uid)
  const others = await q.select().from(t.phase).where(exceptId ? and(mine, ne(t.phase.id, exceptId)) : mine)
  const end = (x: string | null) => x ?? '9999-12'
  const hit = others.find((o) => o.from <= end(p.to) && p.from <= end(o.to))
  return hit ? m('phaseOverlap', { label: hit.label, name: hit.name, from: hit.from, to: hit.to ?? '' }) : null
}

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

/**
 * Replace a phase's amounts; only fixed targets may carry one.
 * Target writes hold the user's allocation_target lock; taking it here means a target cannot
 * change kind between this check and the insert. Lock order is always phase → allocation_target
 * (target writes never take the phase lock), so the two cannot deadlock.
 */
async function writeAmounts(q: Db, rec: Recorder, uid: string, phaseId: string, amounts: Record<string, number>) {
  await lockFor(q, 'allocation_target', uid)
  const want = Object.fromEntries(Object.entries(amounts).filter(([, x]) => x !== 0))
  const ids = Object.keys(want)
  if (ids.length) {
    const fixed = await q.select({ id: t.allocationTarget.id }).from(t.allocationTarget)
      .where(and(eq(t.allocationTarget.userId, uid), inArray(t.allocationTarget.id, ids), eq(t.allocationTarget.kind, 'fixed')))
    const ok = new Set(fixed.map((f) => f.id))
    const bad = ids.filter((i) => !ok.has(i))
    if (bad.length) throw new Rejected(m('amountsFixedOnly'))
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

// ── Resources ──
interface ListResource {
  kind: 'list'
  table: ListTable
  schema: z.ZodType
  optional?: string[]
  /** Runs in the same transaction as the write, after the table lock; a message refuses it with 400. */
  check?: (q: Db, uid: string, input: never, id?: string) => Promise<Msg | null>
  /** The user's lock on this table is taken first, so checks cannot race. */
  lock?: boolean
  /** Locks taken (in the global order) before the first write, besides the table's own. */
  alsoLocks?: string[]
  toRow?: (input: never) => Record<string, unknown>
  /** Same transaction, after the row is written; returns extra fields for the response (e.g. phase amounts). */
  afterWrite?: (q: Db, rec: Recorder, uid: string, id: string, input: never) => Promise<Record<string, unknown>>
  /** Same transaction (and lock) as the delete; a message refuses it with 400. */
  beforeDelete?: (q: Db, uid: string, id: string) => Promise<Msg | null>
}

/** The one-row records of a user (no id; an update creates the row when there is none). */
interface SingleResource {
  kind: 'single'
  table: OwnedTable
  schema: z.ZodType
  lockName: string
  /** The row to write from the body and the row there is now. */
  full: (input: never, before: Row | null) => Row
}

const ONE_ONLY = { living: 'oneLiving', subscriptions: 'oneSubscriptions', remainder: 'oneRemainder' } as const

const list = <T extends ListTable, S extends z.ZodType>(table: T, schema: S, o: Omit<ListResource, 'kind' | 'table' | 'schema' | 'check' | 'toRow' | 'afterWrite'> & {
  check?: (q: Db, uid: string, input: z.infer<S>, id?: string) => Promise<Msg | null>
  toRow?: (input: z.infer<S>) => Record<string, unknown>
  afterWrite?: (q: Db, rec: Recorder, uid: string, id: string, input: z.infer<S>) => Promise<Record<string, unknown>>
} = {}): ListResource => ({ kind: 'list', table, schema, ...o } as ListResource)

export const RESOURCES = {
  subscriptions: list(t.subscription, v.subscription, {
    optional: ['note'],
    // KRW items carry no VAT (the same rule the editor applied before).
    toRow: (s) => ({ ...s, vat: s.currency === 'KRW' ? 0 : s.vat, note: s.note || null }),
  }),
  'plan-changes': list(t.planChange, v.planChange),
  phases: list(t.phase, v.phase, {
    optional: ['note'],
    lock: true,
    alsoLocks: ['allocation_target'],
    check: (q, uid, p, id) => phaseOverlap(q, uid, p, id),
    toRow: ({ amounts: _a, ...p }) => ({ ...p, note: p.note || null }),
    afterWrite: (q, rec, uid, id, p) => writeAmounts(q, rec, uid, id, p.amounts),
  }),
  events: list(t.planEvent, v.planEvent),
  checks: list(t.checkItem, v.checkItem),
  accounts: list(t.bankAccount, v.account),
  debts: list(t.debt, v.debt),
  'remainder-split': list(t.remainderSplit, v.remainderSplit),
  'holiday-sets': list(t.holidaySet, v.holidaySet),
  targets: list(t.allocationTarget, v.target, {
    optional: ['note'],
    lock: true,
    toRow: (x) => ({ ...x, note: x.note || null }),
    check: async (q, uid, x, id) => {
      const all = await q.select().from(t.allocationTarget).where(eq(t.allocationTarget.userId, uid))
      if (x.kind !== 'fixed' && all.some((o) => o.kind === x.kind && o.id !== id)) {
        return m(ONE_ONLY[x.kind as keyof typeof ONE_ONLY])
      }
      const was = all.find((o) => o.id === id)
      if (was?.kind === 'remainder' && x.kind !== 'remainder') return m('remainderKindLocked')
      return null
    },
    // A target that is no longer 'fixed' keeps no phase amounts.
    afterWrite: async (q, rec, uid, id, x) => {
      if (x.kind !== 'fixed') await deleteChildren(q, rec, uid, t.allocationTarget, id)
      return {}
    },
    beforeDelete: async (q, uid, id) => {
      const [row] = await q.select().from(t.allocationTarget).where(and(eq(t.allocationTarget.userId, uid), eq(t.allocationTarget.id, id)))
      return row?.kind === 'remainder' ? m('remainderNoDelete') : null
    },
  }),
} satisfies Record<string, ListResource>

const single = <S extends z.ZodType>(table: OwnedTable, schema: S, lockName: string, full: (input: z.infer<S>, before: Row | null) => Row): SingleResource =>
  ({ kind: 'single', table, schema, lockName, full }) as SingleResource

export const SINGLES = {
  settings: single(t.settings, v.settings, 'settings', (input, before) => ({ ...input, dayShift: input.dayShift ?? (before?.dayShift as typeof input.dayShift) ?? 'none' })),
  living: single(t.living, v.living, 'living', (input) => input),
  // A client that does not send the language keeps the saved one (spec 008 S-9).
  preferences: single(t.preference, v.preferences, 'preference', (input, before) => ({
    ...input,
    language: input.language === undefined ? ((before?.language as 'ko' | 'en' | null | undefined) ?? null) : input.language,
  })),
} satisfies Record<string, SingleResource>

export type ListName = keyof typeof RESOURCES
export type SingleName = keyof typeof SINGLES
export const resourceOf = (name: string): ListResource | SingleResource | undefined =>
  (Object.hasOwn(RESOURCES, name) ? RESOURCES[name as ListName] : Object.hasOwn(SINGLES, name) ? SINGLES[name as SingleName] : undefined)

/** What an AI may change (spec 009 S-2): not accounts, debts, holiday sets or display settings. */
export const AI_LISTS = ['subscriptions', 'plan-changes', 'phases', 'targets', 'remainder-split', 'events', 'checks'] as const
export const AI_SINGLES = ['settings', 'living'] as const
export type AiResource = (typeof AI_LISTS)[number] | (typeof AI_SINGLES)[number]
export const AI_RESOURCES: readonly string[] = [...AI_LISTS, ...AI_SINGLES]

// ── Operations ──
export interface Op { resource: string; action: 'create' | 'update' | 'delete'; id?: string; data?: unknown }

/** `row` is what the request answers with (absent for a delete); `found` is false when update/delete named no row. */
export interface OpResult { found: boolean; row?: Row }

/** The table locks an operation needs, in the global order (phase → allocation_target → settings → living → preference). */
const LOCK_ORDER = ['phase', 'allocation_target', 'settings', 'living', 'preference']
function locksOf(op: Op): string[] {
  const r = resourceOf(op.resource)
  if (!r) return []
  if (r.kind === 'single') return [r.lockName]
  const name = getTableName(r.table)
  return r.lock ? [name, ...(r.alsoLocks ?? [])] : []
}

/** Apply one validated operation (`data` already parsed with the resource's schema). Throws Rejected for a rule it breaks. */
export async function applyOp(q: Db, uid: string, rec: Recorder, op: Op): Promise<OpResult> {
  const r = resourceOf(op.resource)
  if (!r) throw new Error(`unknown resource: ${op.resource}`)
  if (r.kind === 'single') return applySingle(q, uid, rec, r, op)
  return applyList(q, uid, rec, r, op)
}

async function applyList(q: Db, uid: string, rec: Recorder, r: ListResource, op: Op): Promise<OpResult> {
  const table = r.table
  const owned = table as unknown as OwnedTable
  const name = getTableName(table)
  const toRow = r.toRow ?? ((x: never) => x as Record<string, unknown>)
  const shape = (row: unknown) => out(row as Record<string, unknown>, r.optional)
  if (r.lock) await lockFor(q, name, uid)

  if (op.action === 'delete') {
    const id = op.id!
    const problem = await r.beforeDelete?.(q, uid, id)
    if (problem) throw new Rejected(problem)
    if (!(await readRow(q, owned, uid, { id }))) return { found: false }
    await deleteChildren(q, rec, uid, table, id)
    await deleteLogged(q, rec, owned, uid, { id })
    return { found: true }
  }

  const input = op.data as never
  const problem = await r.check?.(q, uid, input, op.action === 'update' ? op.id : undefined)
  if (problem) throw new Rejected(problem)

  if (op.action === 'create') {
    const [written] = await q.insert(table).values({ ...toRow(input), id: randomUUID(), userId: uid } as never).returning()
    const id = (written as { id: string }).id
    await rec.record(table, { id }, 'insert', null, written as Row)
    const extra = r.afterWrite ? await r.afterWrite(q, rec, uid, id, input) : {}
    return { found: true, row: { ...shape(written), ...extra } }
  }

  const id = op.id!
  // Clear optional fields the client left out, so "deleting" a note sticks.
  const cleared = Object.fromEntries((r.optional ?? []).map((k) => [k, null]))
  const before = await readRow(q, owned, uid, { id })
  if (!before) return { found: false }
  const [written] = await q.update(table).set({ ...cleared, ...toRow(input) } as never).where(and(eq(table.userId, uid), eq(table.id, id))).returning()
  await rec.record(table, { id }, 'update', before, written as Row)
  const extra = r.afterWrite ? await r.afterWrite(q, rec, uid, id, input) : {}
  return { found: true, row: { ...shape(written), ...extra } }
}

async function applySingle(q: Db, uid: string, rec: Recorder, r: SingleResource, op: Op): Promise<OpResult> {
  // The row may not exist yet: lock first, so two first saves cannot both see "no row".
  await lockFor(q, r.lockName, uid)
  const before = await readRow(q, r.table, uid, {})
  const full = r.full(op.data as never, before)
  const written = await q.insert(r.table).values({ userId: uid, ...full } as never)
    .onConflictDoUpdate({ target: r.table.userId, set: full as never }).returning()
  await rec.record(r.table, {}, before ? 'update' : 'insert', before, written[0] as Row)
  const { userId: _id, ...rest } = written[0] as Row
  return { found: true, row: rest }
}

// ── Lists of operations (an AI proposal) ──
/** An operation that is not valid: carries the reason, in English (it goes to an AI client). */
export class OpInvalid extends Error {
  constructor(public index: number, reason: string) { super(`change ${index + 1}: ${reason}`) }
}

/** Check an operation against its resource's schema and the shape rules (id for update/delete); returns it with `data` parsed. */
export function parseOp(raw: Op, index: number, allowed: readonly string[] = AI_RESOURCES): Op {
  const r = resourceOf(raw.resource)
  if (!r || !allowed.includes(raw.resource)) throw new OpInvalid(index, `resource "${raw.resource}" cannot be changed`)
  if (r.kind === 'single') {
    if (raw.action !== 'update') throw new OpInvalid(index, `${raw.resource} can only be updated`)
    if (raw.id !== undefined) throw new OpInvalid(index, `${raw.resource} has no id`)
  } else {
    if (raw.action !== 'create' && !raw.id) throw new OpInvalid(index, `${raw.action} needs an id`)
    if (raw.action === 'create' && raw.id !== undefined) throw new OpInvalid(index, 'create takes no id (the server assigns it)')
  }
  if (raw.action === 'delete') {
    if (raw.data !== undefined) throw new OpInvalid(index, 'delete takes no data')
    return { resource: raw.resource, action: 'delete', id: raw.id }
  }
  if (raw.data === undefined) throw new OpInvalid(index, `${raw.action} needs data`)
  const parsed = r.schema.safeParse(raw.data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
    throw new OpInvalid(index, `${where}${issueMessage('en', issue)}`)
  }
  return { resource: raw.resource, action: raw.action, ...(raw.id !== undefined ? { id: raw.id } : {}), data: parsed.data }
}

/**
 * Apply operations in order in the caller's transaction; the first problem throws and the caller's
 * transaction rolls everything back. Locks are taken first, all in one order, so two lists (or a
 * list and a screen write) cannot deadlock.
 */
export async function applyOps(q: Db, uid: string, rec: Recorder, ops: Op[]): Promise<OpResult[]> {
  const need = new Set(ops.flatMap(locksOf))
  for (const name of LOCK_ORDER) if (need.has(name)) await lockFor(q, name, uid)
  const results: OpResult[] = []
  for (const op of ops) {
    const res = await applyOp(q, uid, rec, op)
    if (!res.found) throw new Rejected(m('itemNotFound'))
    results.push(res)
  }
  return results
}

/** A rejection as one English sentence for an AI client. */
export const rejectionText = (e: MsgError) => text('en', e.ref)
