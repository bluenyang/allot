// Proposals from an AI key (spec 009 S-3, S-4, S-7, S-8). An AI never writes directly: it proposes a
// list of operations (or the revert of a change set); the proposal is stored with a preview that is
// computed by really applying the operations and rolling the transaction back, so the preview and
// the later apply are the same code. Applying re-checks everything: status, expiry, the key, the
// fingerprint of the data, and every rule again.
import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, getTableName, gt, inArray, lt, lte, ne, or } from 'drizzle-orm'
import type { Collected } from './changes'
import { Conflict, lockAll, NotFound, Recorder, revert, RuleBroken } from './changes'
import { db, type Db } from './db/client'
import * as a from './db/auth-schema'
import * as t from './db/schema'
import { asUser, lockFor } from './db/scope'
import { m, text, type Msg } from './messages'
import type { Data } from './mcp/views'
import { AI_LISTS, AI_SINGLES, applyOps, constraintMessage, OpInvalid, OpRejected, parseOp, Rejected, RESOURCES, SINGLES, type Op } from './ops'
import { hashState, monthPreview } from './preview'
import { readState } from './state'
import { addYm, todayIn, ymOf } from '../src/lib/calc'

/** Operations in one proposal, and proposals waiting per user. */
export const MAX_OPS = 20
export const MAX_PENDING = 20
/** How long a proposal can be confirmed (spec 009 S-3): longer on the screen, short in the chat. */
export const TTL_MS = { ui: 24 * 3_600_000, chat: 15 * 60_000 } as const

export type Confirm = 'ui' | 'chat'
export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'stale'
export type ProposalCode = 'not_found' | 'not_pending' | 'expired' | 'stale' | 'key_unusable' | 'wrong_confirm' | 'too_many' | 'invalid' | 'rule' | 'conflict'

/** Why a proposal could not be made, applied or rejected. `ref` is worded in the language of whoever asked. */
export class ProposalError extends Error {
  constructor(public code: ProposalCode, public ref: Msg, public index?: number, public detail?: string) {
    super(detail ?? text('en', ref))
  }
  /** HTTP status for the screen API. */
  get status() { return this.code === 'not_found' ? 404 : this.code === 'invalid' || this.code === 'rule' ? 400 : 409 }
}

/** The sentence for a ProposalError in `lang` (the screen's) — the MCP tools use English, with the detail an AI needs. */
export function proposalText(e: ProposalError, lang: 'ko' | 'en'): string {
  if (e.detail && lang === 'en') return e.detail
  const at = e.index === undefined ? '' : text(lang, 'proposalAt', { n: e.index + 1 })
  return at + text(lang, e.ref)
}

/** The key a proposal is made with, as the MCP endpoint knows it. */
export interface KeyInfo { id: string; name: string; confirm: Confirm }

export interface ProposalView {
  id: string
  keyId: string
  keyName: string
  confirm: Confirm
  ops: unknown[]
  note: string | null
  status: ProposalStatus
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  decidedBy: 'user' | 'key' | null
  changeSetId: string | null
  revertOf: string | null
  preview: Record<string, unknown>
  /** Can the key still be used to apply it (not revoked, expired, nor without write scope)? */
  keyUsable: boolean
}

const view = (p: typeof t.mcpProposal.$inferSelect, keyUsable: boolean): ProposalView => ({
  id: p.id, keyId: p.keyId, keyName: p.keyName, confirm: p.confirm as Confirm, ops: p.ops, note: p.note,
  status: p.status as ProposalStatus, createdAt: p.createdAt, expiresAt: p.expiresAt, decidedAt: p.decidedAt,
  decidedBy: p.decidedBy as 'user' | 'key' | null, changeSetId: p.changeSetId, revertOf: p.revertOf, preview: p.preview, keyUsable,
})

// ── Keys ──
interface LiveKey { id: string; name: string }

/** Is the key on, not expired and with the write scope? */
function keyCanWrite(k: { enabled: boolean | null; expiresAt: Date | null; permissions: string | null }): boolean {
  if (k.enabled === false) return false
  if (k.expiresAt && k.expiresAt.getTime() <= Date.now()) return false
  let perms: { mcp?: string[] } = {}
  try { perms = JSON.parse(k.permissions ?? '{}') as typeof perms } catch { /* no scope */ }
  return !!perms.mcp?.includes('write')
}

/** The key, when it can still be used to apply a proposal of `uid`: it exists, is on, has not expired and may write. */
async function liveKeys(uid: string, ids: string[]): Promise<Map<string, LiveKey>> {
  if (!ids.length) return new Map()
  const rows = await db.select().from(a.apikey).where(and(eq(a.apikey.referenceId, uid), inArray(a.apikey.id, ids)))
  const live = new Map<string, LiveKey>()
  for (const k of rows) if (keyCanWrite(k)) live.set(k.id, { id: k.id, name: k.name ?? '' })
  return live
}

/** Is a verified key's owner active and not banned? Read in the transaction and locked (FOR SHARE) until it ends. */
async function accountUsable(q: Db, uid: string): Promise<boolean> {
  const [u] = await q.select({ status: a.user.status, banned: a.user.banned, banExpires: a.user.banExpires }).from(a.user).where(eq(a.user.id, uid)).for('share')
  if (!u || u.status !== 'active') return false
  return !(u.banned && (!u.banExpires || u.banExpires.getTime() > Date.now()))
}

/** The key of a proposal, when it can still apply it, read in the transaction and locked (FOR SHARE) until it ends. */
async function keyFor(q: Db, uid: string, keyId: string): Promise<LiveKey | null> {
  const [k] = await q.select().from(a.apikey).where(and(eq(a.apikey.referenceId, uid), eq(a.apikey.id, keyId))).for('share')
  return k && keyCanWrite(k) ? { id: k.id, name: k.name ?? '' } : null
}

// ── Expiry ──
/** A pending proposal past its time is expired (done whenever proposals are read or counted). */
async function expireDue(q: Db, uid: string) {
  await q.update(t.mcpProposal).set({ status: 'expired', decidedAt: new Date().toISOString() })
    .where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.status, 'pending'), lte(t.mcpProposal.expiresAt, new Date().toISOString())))
}

/** How many proposals wait for the user (shown as the badge). */
export async function pendingCount(q: Db, uid: string): Promise<number> {
  const [r] = await q.select({ n: count() }).from(t.mcpProposal)
    .where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.status, 'pending'), gt(t.mcpProposal.expiresAt, new Date().toISOString())))
  return r?.n ?? 0
}

// ── Making the operations real, for a preview and for an apply ──
const AI_META = { method: 'MCP', path: '/api/mcp' }

/**
 * The tables an AI may revert: those of the resources it may change (spec 009 S-2) and their child tables.
 * A change set that touches any other table is refused whole.
 */
export const AI_REVERT_TABLES: ReadonlySet<string> = new Set(
  [...AI_LISTS.map((r) => RESOURCES[r].table), ...AI_SINGLES.map((r) => (r === 'living' ? t.livingItem : SINGLES[r].table)),
    t.phaseAmount, t.spendingRound, t.livingPhaseAmount, t.accountPhaseAmount].map((x) => getTableName(x)),
)

/** Refuse a revert whose change set touches a table the AI may not change. A set that does not exist is left to revert() to report. */
async function checkRevertScope(q: Db, uid: string, setId: string) {
  const rows = await q.selectDistinct({ table: t.changeLog.tableName }).from(t.changeLog)
    .where(and(eq(t.changeLog.userId, uid), eq(t.changeLog.setId, setId)))
  if (rows.some((r) => !AI_REVERT_TABLES.has(r.table))) throw new ProposalError('rule', m('proposalRevertScope'))
}

/** Run the proposal's operations (or its revert) in `q`; what they break becomes a ProposalError. */
async function run(q: Db, uid: string, rec: Recorder, ops: Op[], revertOf: string | null) {
  try {
    if (revertOf) {
      await checkRevertScope(q, uid, revertOf)
      await revert(q, uid, revertOf, rec)
    } else await applyOps(q, uid, rec, ops)
  } catch (e) {
    if (e instanceof OpRejected) throw new ProposalError('rule', e.ref, e.index)
    if (e instanceof Rejected || e instanceof RuleBroken) throw new ProposalError('rule', e.ref)
    if (e instanceof NotFound) throw new ProposalError('not_found', e.ref)
    if (e instanceof Conflict) throw new ProposalError('conflict', e.ref)
    const known = constraintMessage(e)
    if (known) throw new ProposalError('rule', known)
    throw e
  }
}

class PreviewDone extends Error {}

const stripRow = (r: Record<string, unknown> | null) => {
  if (!r) return null
  const { userId: _u, seq: _s, ...rest } = r
  return rest
}

// ── Propose ──
export interface ProposeInput { changes?: unknown[]; revertOf?: string; note?: string }

/**
 * Check, try and store a proposal. Nothing of the user's data changes here: the operations are applied
 * in a transaction that is always rolled back, and what they did is the preview.
 */
export async function propose(uid: string, key: KeyInfo, input: ProposeInput): Promise<ProposalView> {
  let ops: Op[] = []
  if (input.revertOf !== undefined) {
    if (input.changes?.length) throw new ProposalError('invalid', m('invalidInput'), undefined, 'Give either changes or a change set to revert, not both.')
  } else {
    const raw = input.changes ?? []
    if (raw.length < 1 || raw.length > MAX_OPS) throw new ProposalError('invalid', m('invalidInput'), undefined, `A proposal holds 1 to ${MAX_OPS} changes.`)
    try {
      ops = raw.map((o, i) => parseOp(o as Op, i))
    } catch (e) {
      if (e instanceof OpInvalid) throw new ProposalError('invalid', m('invalidInput'), e.index, e.message)
      throw e
    }
  }
  const revertOf = input.revertOf ?? null

  const rows: Collected[] = []
  let before: Data | undefined
  let after: Data | undefined
  let baseHash = ''
  try {
    await asUser(uid, async (q) => {
      await lockAll(q, uid) // before the data is read, so what is hashed is what the operations see
      const state = await readState(q, uid)
      baseHash = hashState(state)
      before = state as unknown as Data
      await run(q, uid, new Recorder(q, uid, { kind: 'api_key', id: key.id }, { ...AI_META, actorLabel: key.name }, rows), ops, revertOf)
      after = (await readState(q, uid)) as unknown as Data
      throw new PreviewDone() // always: nothing stays
    })
  } catch (e) {
    if (!(e instanceof PreviewDone)) throw e
  }
  if (!rows.length || !before || !after) throw new ProposalError('invalid', m('proposalNoEffect'))

  // this month in the user's time zone (spec 013 S-22)
  const ym = ymOf(todayIn(before.preferences?.timezone))
  const preview = {
    rows: rows.map((r) => ({ table: r.table, op: r.op, key: r.key, before: stripRow(r.before), after: stripRow(r.after) })),
    months: [ym, addYm(ym, 1)].map((x) => monthPreview(before!, after!, x)),
  }
  const now = Date.now()
  return asUser(uid, async (q) => {
    await lockFor(q, 'proposal', uid)
    await expireDue(q, uid)
    if ((await pendingCount(q, uid)) >= MAX_PENDING) throw new ProposalError('too_many', m('proposalTooMany', { max: MAX_PENDING }))
    const [row] = await q.insert(t.mcpProposal).values({
      userId: uid, id: randomUUID(), keyId: key.id, keyName: key.name, confirm: key.confirm, ops, note: input.note?.trim() || null,
      baseHash, preview, status: 'pending', expiresAt: new Date(now + TTL_MS[key.confirm]).toISOString(), revertOf,
    }).returning()
    return view(row!, true)
  })
}

// ── Read ──
/** What to list: one status, every status, or `handled` (everything but pending), newest first, a page at a time. */
export interface ListOptions { status?: ProposalStatus | 'handled'; limit?: number; before?: { at: string; id: string } }

export async function listProposals(uid: string, o: ListOptions = {}): Promise<ProposalView[]> {
  const limit = Math.min(Math.max(o.limit ?? 100, 1), 100)
  const rows = await asUser(uid, async (q) => {
    await expireDue(q, uid)
    const p = t.mcpProposal
    const filters = [eq(p.userId, uid)]
    if (o.status === 'handled') filters.push(ne(p.status, 'pending'))
    else if (o.status) filters.push(eq(p.status, o.status))
    if (o.before) filters.push(or(lt(p.createdAt, o.before.at), and(eq(p.createdAt, o.before.at), lt(p.id, o.before.id)))!)
    return q.select().from(p).where(and(...filters)).orderBy(desc(p.createdAt), desc(p.id)).limit(limit)
  })
  const live = await liveKeys(uid, [...new Set(rows.map((r) => r.keyId))])
  return rows.map((r) => view(r, live.has(r.keyId)))
}

/** One proposal; with `byKey`, only if that key made it (an AI key sees its own proposals only). */
export async function getProposal(uid: string, id: string, byKey?: string): Promise<ProposalView> {
  const row = await asUser(uid, async (q) => {
    await expireDue(q, uid)
    const [r] = await q.select().from(t.mcpProposal).where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.id, id)))
    return r
  })
  if (!row || (byKey && row.keyId !== byKey)) throw new ProposalError('not_found', m('proposalNotFound'))
  const live = await liveKeys(uid, [row.keyId])
  return view(row, live.has(row.keyId))
}

// ── Decide ──
export type Decider = { kind: 'user' } | { kind: 'key'; keyId: string }

/**
 * Apply a proposal as one change set. The user's own confirmation on the screen works for either
 * method; the apply tool only for a key that confirms in the chat and only for its own proposals.
 * A proposal that expired or went stale is marked so and refused; one whose key is gone stays as it is.
 */
export async function applyProposal(uid: string, id: string, by: Decider): Promise<{ changeSetId: string | null }> {
  let failure: ProposalError | null = null
  const changeSetId = await asUser(uid, async (q) => {
    // Locks first. Whatever is checked is checked AFTER this wait, in this transaction (review 3): a key
    // revoked, an account banned or a proposal expired while it waited are seen, and their rows stay as read until commit.
    await lockAll(q, uid)
    await lockFor(q, 'proposal', uid)
    const [p] = await q.select().from(t.mcpProposal).where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.id, id))).for('update')
    if (!p || (by.kind === 'key' && p.keyId !== by.keyId)) throw new ProposalError('not_found', m('proposalNotFound'))
    if (p.status !== 'pending') throw new ProposalError('not_pending', m('proposalNotPending'), undefined, `${text('en', m('proposalNotPending'))} Its state is ${p.status}.`)
    if (by.kind === 'key' && p.confirm !== 'chat') throw new ProposalError('wrong_confirm', m('proposalUiOnly'), undefined, 'This proposal is confirmed in the Allot screen (Pending changes), not by the AI. Ask the user to confirm it there.')
    const decided = { decidedAt: new Date().toISOString() }
    if (!(await accountUsable(q, uid))) throw new ProposalError('key_unusable', m('proposalAccount'))
    const key = await keyFor(q, uid, p.keyId)
    if (!key) throw new ProposalError('key_unusable', m('proposalKeyGone'))
    // Expiry is checked last, after every wait for a lock above (the account and key rows can be held for a while),
    // and right before the proposal is applied.
    if (new Date(p.expiresAt).getTime() <= Date.now()) {
      await q.update(t.mcpProposal).set({ status: 'expired', ...decided }).where(eq(t.mcpProposal.id, id))
      failure = new ProposalError('expired', m('proposalExpired'))
      return null
    }
    if (hashState(await readState(q, uid)) !== p.baseHash) {
      await q.update(t.mcpProposal).set({ status: 'stale', ...decided }).where(eq(t.mcpProposal.id, id))
      failure = new ProposalError('stale', m('proposalStale'))
      return null
    }
    // Every operation is checked again, whatever passed when it was proposed.
    let ops: Op[] = []
    try { ops = p.revertOf ? [] : (p.ops as Op[]).map((o, i) => parseOp(o, i)) } catch (e) {
      if (e instanceof OpInvalid) throw new ProposalError('invalid', m('invalidInput'), e.index, e.message)
      throw e
    }
    const rec = new Recorder(q, uid, { kind: 'api_key', id: p.keyId }, { ...AI_META, revertOf: p.revertOf ?? undefined, actorLabel: key.name, proposalId: p.id })
    await run(q, uid, rec, ops, p.revertOf)
    await q.update(t.mcpProposal).set({ status: 'applied', decidedBy: by.kind, changeSetId: rec.id, ...decided }).where(eq(t.mcpProposal.id, id))
    return rec.id
  })
  if (failure) throw failure
  return { changeSetId }
}

/** The user turns a proposal down. */
export async function rejectProposal(uid: string, id: string): Promise<void> {
  await asUser(uid, async (q) => {
    await lockFor(q, 'proposal', uid)
    const [p] = await q.select().from(t.mcpProposal).where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.id, id))).for('update')
    if (!p) throw new ProposalError('not_found', m('proposalNotFound'))
    if (p.status !== 'pending') throw new ProposalError('not_pending', m('proposalNotPending'))
    await q.update(t.mcpProposal).set({ status: 'rejected', decidedBy: 'user', decidedAt: new Date().toISOString() }).where(eq(t.mcpProposal.id, id))
  })
}
