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
import { allotScopeOf, appName, oauthOn, scopesCanWrite } from './oauth'
import { m, text, type Msg } from './messages'
import { thisMonth, type Data } from './mcp/views'
import { AI_LISTS, AI_SINGLES, applyOps, constraintMessage, OpInvalid, OpRejected, parseOp, Rejected, RESOURCES, SINGLES, type Op } from './ops'
import { hashState, incomeLine, monthPreview } from './preview'
import { readState } from './state'
import { addYm, todayIn } from '../src/lib/calc'

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

/**
 * What a proposal is made with, as the MCP endpoint knows it: an API key, or an app connected with OAuth (spec 015
 * S-9; then `id` is the OAuth client id and `name` the app's name). The proposal keeps both in key_id / key_name.
 */
export interface KeyInfo { id: string; name: string; confirm: Confirm; source?: Source }
export type Source = 'api_key' | 'oauth'
const sourceOf = (k: { source?: Source }): Source => k.source ?? 'api_key'
/** Who a change set is by, for what a proposal does. */
const actorOf = (source: Source, id: string) => ({ kind: source === 'oauth' ? 'oauth_app' as const : 'api_key' as const, id })

export interface ProposalView {
  id: string
  /** spec 015 S-9: 'api_key', or 'oauth' for an app connected with OAuth */
  source: Source
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
  /** Can the key (or the app's connection) still be used to apply it (not revoked, expired, nor without write scope)? */
  keyUsable: boolean
}

const view = (p: typeof t.mcpProposal.$inferSelect, keyUsable: boolean): ProposalView => ({
  id: p.id, source: p.sourceKind as Source, keyId: p.keyId, keyName: p.keyName, confirm: p.confirm as Confirm, ops: p.ops, note: p.note,
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

/**
 * spec 015 S-9: the apps connected with OAuth whose connection can still apply a proposal of `uid`: external app
 * connections are on, and the user's consent for that app is there with a write permission.
 */
async function liveApps(q: Db, uid: string, ids: string[], lock = false, mayApply = false): Promise<Map<string, LiveKey>> {
  if (!ids.length || !oauthOn()) return new Map()
  const query = q.select({ clientId: a.oauthConsent.clientId, scopes: a.oauthConsent.scopes, name: a.oauthClient.name })
    .from(a.oauthConsent).innerJoin(a.oauthClient, eq(a.oauthClient.clientId, a.oauthConsent.clientId))
    .where(and(eq(a.oauthConsent.userId, uid), inArray(a.oauthConsent.clientId, ids)))
  const rows = lock ? await query.for('share', { of: a.oauthConsent }) : await query
  const live = new Map<string, LiveKey>()
  // mayApply: the app applies a chat proposal itself, so its connection must still confirm in the chat (review 1 R1-1)
  for (const r of rows) if (mayApply ? allotScopeOf(r.scopes) === 'allot:apply' : scopesCanWrite(r.scopes)) live.set(r.clientId, { id: r.clientId, name: appName(r) })
  return live
}

/** Which of these proposals can still be applied with what made them (key or app), as `source:id`. */
async function liveSources(uid: string, rows: { keyId: string; sourceKind: string }[]): Promise<Set<string>> {
  const ids = (s: Source) => [...new Set(rows.filter((r) => r.sourceKind === s).map((r) => r.keyId))]
  const keys = await liveKeys(uid, ids('api_key'))
  const apps = await liveApps(db, uid, ids('oauth'))
  return new Set([...[...keys.keys()].map((k) => `api_key:${k}`), ...[...apps.keys()].map((k) => `oauth:${k}`)])
}
const sourceKey = (r: { keyId: string; sourceKind: string }) => `${r.sourceKind}:${r.keyId}`

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

/** What made a proposal (its key, or its app's connection: spec 015 S-9), when it can still apply it; locked as keyFor. */
async function sourceFor(q: Db, uid: string, p: { keyId: string; sourceKind: string }, byApp = false): Promise<LiveKey | null> {
  if (p.sourceKind === 'oauth') return (await liveApps(q, uid, [p.keyId], true, byApp)).get(p.keyId) ?? null
  return keyFor(q, uid, p.keyId)
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
      await run(q, uid, new Recorder(q, uid, actorOf(sourceOf(key), key.id), { ...AI_META, actorLabel: key.name }, rows), ops, revertOf)
      after = (await readState(q, uid)) as unknown as Data
      throw new PreviewDone() // always: nothing stays
    })
  } catch (e) {
    if (!(e instanceof PreviewDone)) throw e
  }
  if (!rows.length || !before || !after) throw new ProposalError('invalid', m('proposalNoEffect'))

  // this month in the user's time zone (spec 013 S-22), by the month basis the user has now (spec 018 S-3): each side
  // of the preview then reads that month name by its own basis
  const ym = thisMonth(before, todayIn(before.preferences?.timezone))
  const preview = {
    // an income row also has a line in words with the left over of its month (spec 014 S-10)
    rows: rows.map((r) => {
      const line = incomeLine(r, before!, after!)
      return { table: r.table, op: r.op, key: r.key, before: stripRow(r.before), after: stripRow(r.after), ...(line ? { line } : {}) }
    }),
    months: [ym, addYm(ym, 1)].map((x) => monthPreview(before!, after!, x)),
  }
  const now = Date.now()
  return asUser(uid, async (q) => {
    await lockFor(q, 'proposal', uid)
    await expireDue(q, uid)
    if ((await pendingCount(q, uid)) >= MAX_PENDING) throw new ProposalError('too_many', m('proposalTooMany', { max: MAX_PENDING }))
    const [row] = await q.insert(t.mcpProposal).values({
      userId: uid, id: randomUUID(), sourceKind: sourceOf(key), keyId: key.id, keyName: key.name, confirm: key.confirm, ops, note: input.note?.trim() || null,
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
  const live = await liveSources(uid, rows)
  return rows.map((r) => view(r, live.has(sourceKey(r))))
}

/** What a proposal was made with: a key, or an app connected with OAuth (spec 015 S-9). */
export interface MadeBy { id: string; source: Source }
const madeBy = (p: { keyId: string; sourceKind: string }, by: MadeBy) => p.keyId === by.id && p.sourceKind === by.source

/** One proposal; with `byKey`, only if that key (or app) made it (an AI sees its own proposals only). */
export async function getProposal(uid: string, id: string, byKey?: MadeBy): Promise<ProposalView> {
  const row = await asUser(uid, async (q) => {
    await expireDue(q, uid)
    const [r] = await q.select().from(t.mcpProposal).where(and(eq(t.mcpProposal.userId, uid), eq(t.mcpProposal.id, id)))
    return r
  })
  if (!row || (byKey && !madeBy(row, byKey))) throw new ProposalError('not_found', m('proposalNotFound'))
  const live = await liveSources(uid, [row])
  return view(row, live.has(sourceKey(row)))
}

// ── Decide ──
/** `confirm`: how the caller's key or connection confirms now (an app's token may have been narrowed since it proposed). */
export type Decider = { kind: 'user' } | { kind: 'key'; keyId: string; source?: Source; confirm?: Confirm }

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
    if (!p || (by.kind === 'key' && !madeBy(p, { id: by.keyId, source: by.source ?? 'api_key' }))) throw new ProposalError('not_found', m('proposalNotFound'))
    if (p.status !== 'pending') throw new ProposalError('not_pending', m('proposalNotPending'), undefined, `${text('en', m('proposalNotPending'))} Its state is ${p.status}.`)
    if (by.kind === 'key' && p.confirm !== 'chat') throw new ProposalError('wrong_confirm', m('proposalUiOnly'), undefined, 'This proposal is confirmed in the Allot screen (Pending changes), not by the AI. Ask the user to confirm it there.')
    const decided = { decidedAt: new Date().toISOString() }
    if (!(await accountUsable(q, uid))) throw new ProposalError('key_unusable', m('proposalAccount'))
    // spec 015 A-9, review 1 R1-1: an app applies only while both its token and its connection confirm in the chat
    if (by.kind === 'key' && p.sourceKind === 'oauth' && by.confirm !== 'chat') throw new ProposalError('wrong_confirm', m('proposalUiOnly'), undefined, 'This connection now confirms proposals in the Allot screen (Pending changes), not in the chat. Ask the user to confirm it there.')
    const key = await sourceFor(q, uid, p, by.kind === 'key')
    if (!key) throw new ProposalError('key_unusable', m(p.sourceKind === 'oauth' ? 'proposalAppGone' : 'proposalKeyGone'))
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
    const rec = new Recorder(q, uid, actorOf(p.sourceKind as Source, p.keyId), { ...AI_META, revertOf: p.revertOf ?? undefined, actorLabel: key.name, proposalId: p.id })
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
