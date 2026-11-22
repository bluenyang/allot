// Writes as operations (spec 009 S-1): one place for the rules of every write to a user's data.
// The screen's routes (server/routes.ts) apply one operation per request, an AI proposal applies a
// list of them in one transaction (server/proposals.ts): same validation, same locks, same overlap
// and kind rules, same change-set records. An operation is { resource, action, id?, data? };
// `data` is the resource's request body. Call everything here inside asUser(uid, …).
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { getTableName } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
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

/** A rule one operation of a list breaks; `index` is its place in the list (0-based). */
export class OpRejected extends Rejected {
  constructor(public index: number, ref: Msg) { super(ref) }
}

/** The message for a database constraint error (a bad reference, a duplicate, a value out of range); null for any other error. */
export function constraintMessage(e: unknown): Msg | null {
  const err = e as { code?: string; cause?: { code?: string } }
  const code = err?.code ?? err?.cause?.code
  if (code === '23503') return m('fkMissing')
  if (code === '23505') return m('duplicate')
  if (['23514', '22P02', '22003', '22007', '22008'].includes(code ?? '')) return m('outOfRange')
  return null
}

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

/** Target kinds that may carry phase amounts: fixed, and the Savings / Investment totals (spec 013 S-3). */
export const AMOUNT_KINDS = ['fixed', 'saving', 'invest'] as const

/**
 * Replace a phase's amounts; only fixed, saving and invest targets may carry one.
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
      .where(and(eq(t.allocationTarget.userId, uid), inArray(t.allocationTarget.id, ids), inArray(t.allocationTarget.kind, [...AMOUNT_KINDS])))
    const ok = new Set(fixed.map((f) => f.id))
    const bad = ids.filter((i) => !ok.has(i))
    if (bad.length) throw new Rejected(m('amountsTargetsOnly'))
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

/**
 * Replace the per-phase amounts of a living item or a Savings / Investment account (spec 013 S-4): only what
 * differs is written (and logged). `amounts` is phaseId → amount; 0 is kept (it means "nothing in that phase").
 */
async function writeItemAmounts(q: Db, rec: Recorder, uid: string, table: typeof t.livingPhaseAmount | typeof t.accountPhaseAmount, itemId: string, amounts: Record<string, number>) {
  const living = table === t.livingPhaseAmount
  const itemCol = living ? t.livingPhaseAmount.itemId : t.accountPhaseAmount.accountId
  const itemKey = living ? 'itemId' : 'accountId'
  const have = (await q.select().from(table).where(and(eq(table.userId, uid), eq(itemCol, itemId)))) as Row[]
  for (const old of have) {
    const phaseId = String(old.phaseId)
    const key = { phaseId, [itemKey]: itemId }
    if (!(phaseId in amounts)) await deleteLogged(q, rec, table, uid, key)
    else if (amounts[phaseId] !== old.amount) {
      const [written] = await q.update(table).set({ amount: amounts[phaseId]! }).where(whereKey(table, uid, key)).returning()
      await rec.record(table, key, 'update', old, written as Row)
    }
  }
  for (const [phaseId, amount] of Object.entries(amounts)) {
    if (have.some((h) => h.phaseId === phaseId)) continue
    const [written] = await q.insert(table).values({ userId: uid, phaseId, [itemKey]: itemId, amount } as never).returning()
    await rec.record(table, { phaseId, [itemKey]: itemId }, 'insert', null, written as Row)
  }
  return { amounts: { ...amounts } }
}

/** Set `col` to null, with logs, in every row of `table` where it is `id` (a card's or a target's account, a spending's card). */
async function unlink(q: Db, rec: Recorder, uid: string, table: OwnedTable & { id: PgColumn }, col: PgColumn, id: string) {
  const rows = await q.select().from(table as never).where(and(eq(table.userId, uid), eq(col, id))) as Row[]
  for (const old of rows) {
    const key = { id: String(old.id) }
    const [written] = await q.update(table).set({ [colName(table, col)]: null } as never).where(whereKey(table, uid, key)).returning()
    await rec.record(table, key, 'update', old, written as Row)
  }
}
const colName = (table: PgTable, col: PgColumn) => Object.entries(table as unknown as Record<string, unknown>).find(([, c]) => c === col)![0]

/** Is a buffer use paid through `cardIds` (S-8)? */
async function bufferUses(q: Db, uid: string, cardIds: string[]) {
  if (!cardIds.length) return false
  const [hit] = await q.select({ id: t.spending.id }).from(t.spending)
    .where(and(eq(t.spending.userId, uid), eq(t.spending.how, 'buffer'), inArray(t.spending.cardId, cardIds))).limit(1)
  return !!hit
}

/** The three coded living items as the old living row (spec 013 S-2): what /api/state answers as `living`. */
export async function livingOf(q: Db, uid: string) {
  const rows = await q.select().from(t.livingItem).where(and(eq(t.livingItem.userId, uid), isNotNull(t.livingItem.code)))
  const of = (c: string) => rows.find((r) => r.code === c)?.amount ?? 0
  return { food: of('food'), transit: of('transit'), allowance: of('allowance') }
}

const LIVING_NAMES = { ko: { food: '식비', transit: '교통', allowance: '용돈' }, en: { food: 'Food', transit: 'Transport', allowance: 'Allowance' } } as const

/**
 * PUT /api/living and the AI resource `living` (spec 013 S-2): the old three values are still accepted and
 * set the amounts of the three coded items; one that was deleted is made again, named in the user's language.
 */
async function applyLiving(q: Db, uid: string, rec: Recorder, input: { food: number; transit: number; allowance: number }): Promise<OpResult> {
  await lockFor(q, 'living', uid)
  const li = t.livingItem
  const [pref] = await q.select({ language: t.preference.language }).from(t.preference).where(eq(t.preference.userId, uid))
  const names = LIVING_NAMES[pref?.language === 'en' ? 'en' : 'ko']
  for (const code of ['food', 'transit', 'allowance'] as const) {
    const [old] = await q.select().from(li).where(and(eq(li.userId, uid), eq(li.code, code))).for('update')
    if (old) {
      if (old.amount === input[code]) continue
      const [written] = await q.update(li).set({ amount: input[code] }).where(whereKey(li, uid, { id: old.id })).returning()
      await rec.record(li, { id: old.id }, 'update', old as Row, written as Row)
    } else {
      const [written] = await q.insert(li).values({ userId: uid, id: randomUUID(), name: names[code], kind: names[code], amount: input[code], code }).returning()
      await rec.record(li, { id: written!.id }, 'insert', null, written as Row)
    }
  }
  return { found: true, row: await livingOf(q, uid) }
}

/**
 * Replace a spending's rounds with the given ones: only what differs is written (and logged).
 * A round is a row of its spending alone, so the spending's own lock (`data`) is all it needs.
 */
async function writeRounds(q: Db, rec: Recorder, uid: string, spendingId: string, rounds: z.infer<typeof v.spending>['rounds']) {
  const sr = t.spendingRound
  const have = await q.select().from(sr).where(and(eq(sr.userId, uid), eq(sr.spendingId, spendingId)))
  const want = new Map(rounds.map((r) => [r.no, r]))
  for (const old of have) {
    const key = { spendingId, no: String(old.no) }
    const next = want.get(old.no)
    if (!next) await deleteLogged(q, rec, sr, uid, key)
    else {
      const [written] = await q.update(sr).set({ date: next.date, amount: next.amount, state: next.state, edited: next.edited }).where(whereKey(sr, uid, key)).returning()
      await rec.record(sr, key, 'update', old, written as Row)
    }
  }
  for (const r of rounds) {
    if (have.some((h) => h.no === r.no)) continue
    const [written] = await q.insert(sr).values({ ...r, userId: uid, spendingId }).returning()
    await rec.record(sr, { spendingId, no: String(r.no) }, 'insert', null, written as Row)
  }
  return { rounds: [...rounds].sort((a, b) => a.no - b.no).map(({ no, date, amount, state, edited }) => ({ no, date, amount, state, edited })) }
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
  /** `optional` fields left out of an update keep their stored value instead of being cleared (spec 013 S-11). */
  keepOmitted?: boolean
  /** Locks taken (in the global order) before the first write, besides the table's own. */
  alsoLocks?: string[]
  toRow?: (input: never) => Record<string, unknown>
  /** Same transaction, after the row is written; returns extra fields for the response (e.g. phase amounts). */
  afterWrite?: (q: Db, rec: Recorder, uid: string, id: string, input: never) => Promise<Record<string, unknown>>
  /** Same transaction (and lock) as the delete; a message refuses it with 400. */
  beforeDelete?: (q: Db, uid: string, id: string) => Promise<Msg | null>
  /** Same transaction, after beforeDelete and before the row goes: unlink rows that point at it (logged). */
  onDelete?: (q: Db, rec: Recorder, uid: string, id: string) => Promise<void>
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

const ONE_ONLY = { living: 'oneLiving', subscriptions: 'oneSubscriptions', remainder: 'oneRemainder', saving: 'oneSaving', invest: 'oneInvest' } as const

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
  accounts: list(t.bankAccount, v.account, {
    // `note` is not cleared when it is left out: a client in the 0.1.6 shape keeps it (S-11, review 1 F-7);
    // an empty one is still answered as absent, as before (review 2 F-1).
    optional: ['note'],
    keepOmitted: true,
    toRow: ({ amounts: _a, ...x }) => ({ ...x, ...(x.note === undefined ? {} : { note: x.note || null }) }),
    // Only a Savings / Investment item carries a monthly amount, a ratio or per-phase amounts (S-9): the group it
    // will have after this write, also when the body leaves the group out (review 1 F-8).
    check: async (q, uid, x, id) => {
      const carries = (x.amount ?? 0) !== 0 || (x.ratio ?? null) !== null || Object.keys(x.amounts ?? {}).length > 0
      if (!carries) return null
      let group = x.group
      if (group === undefined && id) {
        const [row] = await q.select({ group: t.bankAccount.group }).from(t.bankAccount).where(and(eq(t.bankAccount.userId, uid), eq(t.bankAccount.id, id)))
        group = row?.group ?? null
      }
      return group ? null : m('groupOnly')
    },
    afterWrite: async (q, rec, uid, id, x) => (x.amounts ? writeItemAmounts(q, rec, uid, t.accountPhaseAmount, id, x.amounts) : {}),
    // An account whose buffer pays a buffer use (through one of its cards) cannot go (S-9).
    beforeDelete: async (q, uid, id) => {
      const cards = await q.select({ id: t.card.id }).from(t.card).where(and(eq(t.card.userId, uid), eq(t.card.accountId, id)))
      return (await bufferUses(q, uid, cards.map((c) => c.id))) ? m('accountBufferInUse') : null
    },
    onDelete: async (q, rec, uid, id) => {
      await unlink(q, rec, uid, t.card, t.card.accountId, id)
      await unlink(q, rec, uid, t.allocationTarget, t.allocationTarget.accountId, id)
    },
  }),
  balances: list(t.accountBalance, v.balance, {
    optional: ['note'],
    toRow: (x) => ({ ...x, note: x.note || null }),
  }),
  cards: list(t.card, v.card, {
    optional: ['note'],
    toRow: (x) => ({ ...x, note: x.note || null }),
    // A card that a buffer use goes through keeps a paying account: clearing it is refused, moving it to another
    // account is not (the buffer use then uses that account's buffer). User, review 1 F-1: "비우기만 거부 (Recommended)".
    check: async (q, uid, x, id) => (id && x.accountId === null && (await bufferUses(q, uid, [id])) ? m('cardBufferInUse') : null),
    beforeDelete: async (q, uid, id) => ((await bufferUses(q, uid, [id])) ? m('cardBufferInUse') : null),
    onDelete: (q, rec, uid, id) => unlink(q, rec, uid, t.spending, t.spending.cardId, id),
  }),
  'living-items': list(t.livingItem, v.livingItem, {
    optional: ['note'],
    toRow: ({ amounts: _a, ...x }) => ({ ...x, note: x.note || null }),
    afterWrite: (q, rec, uid, id, x) => writeItemAmounts(q, rec, uid, t.livingPhaseAmount, id, x.amounts),
  }),
  debts: list(t.debt, v.debt),
  'remainder-split': list(t.remainderSplit, v.remainderSplit),
  'holiday-sets': list(t.holidaySet, v.holidaySet),
  spendings: list(t.spending, v.spending, {
    optional: ['note'],
    // A card only on a card spending, a refill start only on a buffer use, also when the body leaves them out
    // and the stored ones would stay (review 1 F-5).
    toRow: ({ rounds: _r, ...x }) => ({
      ...x, note: x.note || null,
      ...(x.payBy === 'card' ? {} : { cardId: null }),
      ...(x.how === 'buffer' ? {} : { refillFrom: null }),
    }),
    // A buffer use is paid from its card's account (S-8): the card must have one. A card change on
    // update that leaves `cardId` out keeps the stored card, so check that one.
    check: async (q, uid, x, id) => {
      if (x.how !== 'buffer') return null
      let cardId = x.cardId
      if (cardId === undefined && id) {
        const [row] = await q.select({ cardId: t.spending.cardId }).from(t.spending).where(and(eq(t.spending.userId, uid), eq(t.spending.id, id)))
        cardId = row?.cardId ?? null
      }
      if (!cardId) return m('bufferNeedsCard')
      const [c] = await q.select({ accountId: t.card.accountId }).from(t.card).where(and(eq(t.card.userId, uid), eq(t.card.id, cardId)))
      return c?.accountId ? null : m('bufferNeedsCard')
    },
    afterWrite: (q, rec, uid, id, x) => writeRounds(q, rec, uid, id, x.rounds),
  }),
  targets: list(t.allocationTarget, v.target, {
    optional: ['note'],
    lock: true,
    toRow: (x) => ({ ...x, note: x.note || null }),
    check: async (q, uid, x, id) => {
      const all = await q.select().from(t.allocationTarget).where(eq(t.allocationTarget.userId, uid))
      if (x.kind !== 'fixed' && all.some((o) => o.kind === x.kind && o.id !== id)) {
        return m(ONE_ONLY[x.kind as keyof typeof ONE_ONLY])
      }
      return null
    },
    // A target whose kind takes no phase amounts keeps none (fixed, saving and invest keep theirs, S-3).
    afterWrite: async (q, rec, uid, id, x) => {
      if (!(AMOUNT_KINDS as readonly string[]).includes(x.kind)) await deleteChildren(q, rec, uid, t.allocationTarget, id)
      return {}
    },
  }),
} satisfies Record<string, ListResource>

const single = <S extends z.ZodType>(table: OwnedTable, schema: S, lockName: string, full: (input: z.infer<S>, before: Row | null) => Row): SingleResource =>
  ({ kind: 'single', table, schema, lockName, full }) as SingleResource

export const SINGLES = {
  settings: single(t.settings, v.settings, 'settings', (input, before) => ({ ...input, dayShift: input.dayShift ?? (before?.dayShift as typeof input.dayShift) ?? 'none' })),
  // A client that does not send the language keeps the saved one (spec 008 S-9).
  preferences: single(t.preference, v.preferences, 'preference', (input, before) => ({
    ...input,
    language: input.language === undefined ? ((before?.language as 'ko' | 'en' | null | undefined) ?? null) : input.language,
  })),
} satisfies Record<string, SingleResource>

/** The old living row, kept as an adapter over the three coded items (spec 013 S-2). */
interface LivingResource { kind: 'living'; schema: typeof v.living }
const LIVING: LivingResource = { kind: 'living', schema: v.living }

/** The request schema of a one-row record (the living adapter included). */
export const singleSchema = (name: SingleName): z.ZodType => (name === 'living' ? LIVING.schema : SINGLES[name].schema)

export type ListName = keyof typeof RESOURCES
export type SingleName = keyof typeof SINGLES | 'living'
export const resourceOf = (name: string): ListResource | SingleResource | LivingResource | undefined =>
  (Object.hasOwn(RESOURCES, name) ? RESOURCES[name as ListName]
    : name === 'living' ? LIVING
    : Object.hasOwn(SINGLES, name) ? SINGLES[name as keyof typeof SINGLES] : undefined)

/** What an AI may change (spec 009 S-2, spec 013 S-10): not debts, holiday sets or display settings. */
export const AI_LISTS = ['subscriptions', 'plan-changes', 'phases', 'targets', 'remainder-split', 'events', 'checks', 'spendings', 'living-items', 'accounts', 'balances', 'cards'] as const
export const AI_SINGLES = ['settings', 'living'] as const
export type AiResource = (typeof AI_LISTS)[number] | (typeof AI_SINGLES)[number]
export const AI_RESOURCES: readonly string[] = [...AI_LISTS, ...AI_SINGLES]

// ── Operations ──
export interface Op { resource: string; action: 'create' | 'update' | 'delete'; id?: string; data?: unknown }

/** `row` is what the request answers with (absent for a delete); `found` is false when update/delete named no row. */
export interface OpResult { found: boolean; row?: Row }

/** The locks an operation needs, in the global order (data → phase → allocation_target → settings → living → preference). Every operation takes `data`. */
const LOCK_ORDER = ['data', 'phase', 'allocation_target', 'settings', 'living', 'preference']
function locksOf(op: Op): string[] {
  const r = resourceOf(op.resource)
  if (!r) return ['data']
  if (r.kind === 'living') return ['data', 'living']
  if (r.kind === 'single') return ['data', r.lockName]
  const name = getTableName(r.table)
  return r.lock ? ['data', name, ...(r.alsoLocks ?? [])] : ['data']
}

/** Apply one validated operation (`data` already parsed with the resource's schema). Throws Rejected for a rule it breaks. */
export async function applyOp(q: Db, uid: string, rec: Recorder, op: Op): Promise<OpResult> {
  const r = resourceOf(op.resource)
  if (!r) throw new Error(`unknown resource: ${op.resource}`)
  await lockFor(q, 'data', uid) // first, before any other lock (spec 009 review 2)
  if (r.kind === 'living') return applyLiving(q, uid, rec, op.data as never)
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
    await r.onDelete?.(q, rec, uid, id)
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
  const cleared = r.keepOmitted ? {} : Object.fromEntries((r.optional ?? []).map((k) => [k, null]))
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
  if (r.kind === 'single' || r.kind === 'living') {
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
  for (const [i, op] of ops.entries()) {
    let res: OpResult
    try {
      res = await applyOp(q, uid, rec, op)
    } catch (e) {
      if (e instanceof Rejected) throw new OpRejected(i, e.ref)
      const known = constraintMessage(e)
      if (known) throw new OpRejected(i, known)
      throw e
    }
    if (!res.found) throw new OpRejected(i, m('itemNotFound'))
    results.push(res)
  }
  return results
}

/** A rejection as one English sentence for an AI client. */
export const rejectionText = (e: MsgError) => text('en', e.ref)
