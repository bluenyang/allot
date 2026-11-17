// API check for spec 009 W-3 (V-4, V-5, V-6, V-7, V-8, V-9 at the function level): proposals, previews,
// the fingerprint, expiry, revoked keys, revert, isolation. Runs against the database of the dev stack
// with two fresh users and removes everything it made (the way the admin "delete user" does).
//   docker exec -w /app allot-dev-api-1 pnpm exec tsx tests/api/proposals.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { OWNED } from '../../server/db/owned'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'
import * as t from '../../server/db/schema'
import { asUser } from '../../server/db/scope'
import { Recorder } from '../../server/changes'
import { applyOps, parseOp } from '../../server/ops'
import { applyProposal, getProposal, listProposals, MAX_PENDING, propose, ProposalError, rejectProposal, type KeyInfo } from '../../server/proposals'
import { readState } from '../../server/state'
import { overview } from '../../server/mcp/views'
import { today, ymOf } from '../../src/lib/calc'

let failed = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const code = async (p: Promise<unknown>) => { try { await p; return 'ok' } catch (e) { return e instanceof ProposalError ? e.code : `error:${(e as Error).message}` } }

const sub = (name: string, over: Record<string, unknown> = {}) => ({ name, category: 'tool', plan: 'p', amount: 12000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false, ...over })
const living = (food: number) => ({ food, transit: 2, allowance: 3 })


// ── two connections and a barrier (review 2, 3) ──
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Is some session waiting for an advisory lock? (the apply under test, held back by the write below) */
async function waitBlocked() {
  for (let i = 0; i < 100; i++) {
    const [r] = await sqlClient`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`
    if ((r as { n: number }).n > 0) return true
    await sleep(50)
  }
  return false
}
/** An ordinary write (the screen's path) that stays open, holding what it locked, until release(). */
async function holdWrite(uid: string, op: import('../../server/ops').Op) {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let held!: () => void
  const heldP = new Promise<void>((r) => { held = r })
  const done = asUser(uid, async (q) => {
    await applyOps(q, uid, new Recorder(q, uid, { kind: 'user', id: uid }, { method: 'PUT', path: '/api/test' }), [parseOp(op, 0)])
    held()
    await gate
  })
  await heldP
  return { release, done }
}

const made: string[] = []
async function newUser(tag: string) {
  const id = randomUUID()
  await db.insert(a.user).values({ id, email: `p9-${tag}-${id}@example.com`, name: `P9 ${tag}`, emailVerified: true, status: 'active', admission: 'admin' })
  made.push(id)
  return id
}
async function newKey(uid: string, name: string, confirm: 'ui' | 'chat', write = true): Promise<KeyInfo> {
  const id = randomBytes(12).toString('hex')
  const raw = `allot_${randomBytes(16).toString('hex')}`
  await sqlClient`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, metadata, expires_at, created_at, updated_at)
    values (${id}, 'default', ${name}, ${raw.slice(0, 6)}, ${uid}, 'allot_', ${createHash('sha256').update(raw).digest('base64url')}, true, true, 60000, 120, 0,
      ${write ? '{"mcp":["read","write"]}' : '{"mcp":["read"]}'}, ${JSON.stringify({ confirm })}, ${new Date(Date.now() + 30 * 86_400_000).toISOString()}, now(), now())`
  return { id, name, confirm }
}
const state = (uid: string) => asUser(uid, (q) => readState(q, uid))
const counts = (uid: string) => asUser(uid, async (q) => ({
  sets: (await q.select().from(t.changeSet).where(eq(t.changeSet.userId, uid))).length,
  props: (await q.select().from(t.mcpProposal).where(eq(t.mcpProposal.userId, uid))).length,
}))
const { userId: _u, seq: _s, id: _i, ...none } = {} as Record<string, never>
void none

try {
  const A = await newUser('a')
  const B = await newUser('b')
  const kChat = await newKey(A, 'chat-key', 'chat')
  const kUi = await newKey(A, 'ui-key', 'ui')
  const kB = await newKey(B, 'b-key', 'ui')

  // ── V-4: a proposal changes nothing, and carries row and month changes ──
  const s0 = JSON.stringify(await state(A))
  const c0 = await counts(A)
  const p1 = await propose(A, kChat, { changes: [
    { resource: 'subscriptions', action: 'create', data: sub('v4-sub') },
    { resource: 'living', action: 'update', data: living(100_000) },
  ], note: 'v4' })
  ok(p1.status === 'pending' && p1.confirm === 'chat' && p1.keyName === 'chat-key', 'a proposal is stored pending with its key and method')
  const pr = p1.preview as { rows: { table: string; op: string; before: unknown; after: Record<string, unknown> | null }[]; months: { month: string; transferKrw: { before: number; after: number } }[] }
  ok(pr.rows.length === 2 && pr.rows.some((r) => r.table === 'subscription' && r.op === 'insert') && pr.rows.some((r) => r.table === 'living' && r.op === 'insert'), 'the preview has the row changes')
  ok(pr.months.length === 2 && pr.months[0]!.month === ymOf(today()), 'the preview has this month and the next')
  ok(JSON.stringify(await state(A)) === s0, 'the data is unchanged after proposing')
  const c1 = await counts(A)
  ok(c1.sets === c0.sets && c1.props === c0.props + 1, 'no change set was written, one proposal was')
  ok(new Date(p1.expiresAt).getTime() - Date.now() <= 15 * 60_000 + 5000 && new Date(p1.expiresAt).getTime() - Date.now() > 14 * 60_000, 'a chat proposal lives 15 minutes')

  const bad = await code(propose(A, kChat, { changes: [
    { resource: 'phases', action: 'create', data: { label: 'P', name: 'x', from: '2031-01', to: '2031-06', amounts: {} } },
    { resource: 'phases', action: 'create', data: { label: 'P', name: 'y', from: '2031-03', to: null, amounts: {} } },
  ] }))
  ok(bad === 'rule', `an overlapping phase is refused with its reason → ${bad}`)
  try { await propose(A, kChat, { changes: [{ resource: 'phases', action: 'create', data: { label: 'P', name: 'x', from: '2031-01', to: '2031-06', amounts: {} } }, { resource: 'phases', action: 'create', data: { label: 'P', name: 'y', from: '2031-03', to: null, amounts: {} } }] }) } catch (e) {
    ok(e instanceof ProposalError && e.index === 1 && /overlap|Overlap|겹/.test(e.message), `the reason names the change (${(e as Error).message})`)
  }
  ok((await counts(A)).props === c1.props, 'a refused proposal is not stored')
  ok(await code(propose(A, kChat, { changes: Array.from({ length: 21 }, (_, i) => ({ resource: 'events', action: 'create', data: { when: '2031-01', kind: 'k', title: `e${i}`, state: 'todo' } })) })) === 'invalid', '21 changes are refused')
  ok(await code(propose(A, kChat, { changes: [] })) === 'invalid', 'no changes are refused')
  ok(await code(propose(A, kChat, { changes: [{ resource: 'accounts', action: 'create', data: { name: 'x', role: '', inflow: '', outflow: '' } }] })) === 'invalid', 'accounts are not for an AI')

  // ── V-5: applying gives the preview's "after", as one change set by the key ──
  const sub2 = await code(applyProposal(A, p1.id, { kind: 'key', keyId: kUi.id }))
  ok(sub2 === 'not_found', `another key cannot apply it → ${sub2}`)
  const done = await applyProposal(A, p1.id, { kind: 'key', keyId: kChat.id })
  const s1 = await state(A)
  const made1 = s1.subscriptions.find((x) => x.name === 'v4-sub')
  const rowAfter = pr.rows.find((r) => r.table === 'subscription')!.after!
  const { id: _pid, ...previewSub } = rowAfter
  const { id: _rid, ...realSub } = made1 as Record<string, unknown>
  const norm = (r: Record<string, unknown>) => JSON.stringify(Object.entries(r).filter(([, v]) => v !== null).sort(([x], [y]) => (x < y ? -1 : 1)))
  ok(!!made1 && norm(previewSub) === norm(realSub), 'the applied row is the preview row')
  ok(s1.living.food === 100_000, 'the single-row change was applied')
  const ym = ymOf(today())
  const real = overview(s1 as never, ym)
  ok(real.subscriptionTransfer.transferKrw === pr.months[0]!.transferKrw.after, `this month's transfer: preview after ${pr.months[0]!.transferKrw.after} = real ${real.subscriptionTransfer.transferKrw}`)
  const set = (await asUser(A, (q) => q.select().from(t.changeSet).where(eq(t.changeSet.id, done.changeSetId!))))[0]!
  ok(set.actorKind === 'api_key' && set.actorId === kChat.id && set.actorLabel === 'chat-key' && set.proposalId === p1.id, 'one change set: api_key, key id, key name, proposal id')
  ok((await counts(A)).sets === c1.sets + 1, 'exactly one set')
  const got = await getProposal(A, p1.id)
  ok(got.status === 'applied' && got.decidedBy === 'key' && got.changeSetId === done.changeSetId, 'the proposal is applied by the key')
  ok(await code(applyProposal(A, p1.id, { kind: 'key', keyId: kChat.id })) === 'not_pending', 'applying twice is refused (not_pending)')

  ok(await code(propose(A, kChat, { changes: [{ resource: 'living', action: 'update', data: living(100_000) }] })) === 'invalid', 'a proposal that changes nothing is refused')

  // ── V-6: a screen-confirm proposal is not applied by the key; the user applies or rejects it ──
  const p2 = await propose(A, kUi, { changes: [{ resource: 'subscriptions', action: 'create', data: sub('v6-sub') }] })
  ok(new Date(p2.expiresAt).getTime() - Date.now() > 23 * 3_600_000, 'a screen proposal lives 24 hours')
  ok(await code(applyProposal(A, p2.id, { kind: 'key', keyId: kUi.id })) === 'wrong_confirm', 'the key cannot apply a screen-confirm proposal')
  await applyProposal(A, p2.id, { kind: 'user' })
  ok((await state(A)).subscriptions.some((x) => x.name === 'v6-sub') && (await getProposal(A, p2.id)).decidedBy === 'user', 'the user applies it')
  const p3 = await propose(A, kUi, { changes: [{ resource: 'subscriptions', action: 'create', data: sub('v6-rej') }] })
  await rejectProposal(A, p3.id)
  ok((await getProposal(A, p3.id)).status === 'rejected' && (await code(applyProposal(A, p3.id, { kind: 'user' }))) === 'not_pending', 'a rejected proposal cannot be applied')
  ok(await code(rejectProposal(A, p3.id)) === 'not_pending', 'a handled proposal cannot be rejected')

  // ── V-7: stale, expired, revoked key, the pending cap ──
  const p4 = await propose(A, kUi, { changes: [{ resource: 'living', action: 'update', data: living(200_000) }] })
  await asUser(A, async (q) => { await applyOps(q, A, new Recorder(q, A, { kind: 'user', id: A }, { method: 'PUT', path: '/api/living' }), [parseOp({ resource: 'living', action: 'update', data: living(150_000) }, 0)]) })
  ok(await code(applyProposal(A, p4.id, { kind: 'user' })) === 'stale', 'data changed after proposing → stale')
  ok((await getProposal(A, p4.id)).status === 'stale' && (await state(A)).living.food === 150_000, 'the proposal is marked stale and nothing was applied')
  const p5 = await propose(A, kUi, { changes: [{ resource: 'living', action: 'update', data: living(160_000) }] })
  await asUser(A, (q) => q.update(t.mcpProposal).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(t.mcpProposal.id, p5.id)))
  ok(await code(applyProposal(A, p5.id, { kind: 'user' })) === 'expired' && (await getProposal(A, p5.id)).status === 'expired', 'past its time → expired')
  const kGone = await newKey(A, 'gone-key', 'ui')
  const p6 = await propose(A, kGone, { changes: [{ resource: 'living', action: 'update', data: living(170_000) }] })
  await sqlClient`delete from apikey where id = ${kGone.id}`
  ok(await code(applyProposal(A, p6.id, { kind: 'user' })) === 'key_unusable', 'a revoked key: the screen cannot apply its proposal')
  ok((await getProposal(A, p6.id)).status === 'pending' && (await listProposals(A, { status: 'pending' })).find((x) => x.id === p6.id)?.keyUsable === false, 'it stays pending and is marked as having no usable key')
  const kRead = await newKey(A, 'read-only', 'ui', false)
  const p7 = await propose(A, kRead, { changes: [{ resource: 'living', action: 'update', data: living(180_000) }] })
  ok(await code(applyProposal(A, p7.id, { kind: 'user' })) === 'key_unusable', 'a key without write scope: its proposal cannot be applied')
  for (const p of [p6, p7]) await rejectProposal(A, p.id)
  const pend = (await listProposals(A, { status: 'pending' })).length
  for (let i = pend; i < MAX_PENDING; i++) await propose(A, kUi, { changes: [{ resource: 'events', action: 'create', data: { when: '2031-01', kind: 'k', title: `cap${i}`, state: 'todo' } }] })
  ok(await code(propose(A, kUi, { changes: [{ resource: 'events', action: 'create', data: { when: '2031-01', kind: 'k', title: 'cap-over', state: 'todo' } }] })) === 'too_many', `the ${MAX_PENDING + 1}th pending proposal is refused`)
  for (const p of await listProposals(A, { status: 'pending' })) await rejectProposal(A, p.id)

  // ── review 2: a write that commits while an apply waits makes the apply stale; it is not overwritten ──
  {
    const target = (await state(A)).subscriptions.find((x) => x.name === 'v6-sub')!
    const pp = await propose(A, kUi, { changes: [{ resource: 'subscriptions', action: 'update', id: target.id, data: sub('v6-sub', { amount: 77_000 }) }] })
    const w = await holdWrite(A, { resource: 'subscriptions', action: 'update', id: target.id, data: sub('v6-sub', { amount: 55_000 }) })
    const pending = code(applyProposal(A, pp.id, { kind: 'user' }))
    ok(await waitBlocked(), 'the apply waits for the open write (ordinary writers take the data lock)')
    w.release()
    await w.done
    ok(await pending === 'stale', 'the apply ends stale after the write commits')
    const now = (await state(A)).subscriptions.find((x) => x.id === target.id)!
    ok(now.amount === 55_000 && (await getProposal(A, pp.id)).status === 'stale', "the screen's write is kept, not overwritten")
  }

  // ── review 3: what is checked is checked after the wait for the lock ──
  {
    const waiting = async (tag: string, change: (keyId: string, proposalId: string) => Promise<void>) => {
      const k = await newKey(A, `wait-${tag}`, 'ui')
      const pp = await propose(A, k, { changes: [{ resource: 'living', action: 'update', data: living(910_000 + tag.length) }] })
      const w = await holdWrite(A, { resource: 'checks', action: 'create', data: { text: `hold-${tag}`, done: false } })
      const result = code(applyProposal(A, pp.id, { kind: 'user' }))
      const blocked = await waitBlocked()
      await change(k.id, pp.id)
      w.release()
      await w.done
      return { blocked, result: await result, pp }
    }
    const rk = await waiting('revoked', async (keyId) => { await sqlClient`delete from apikey where id = ${keyId}` })
    ok(rk.blocked && rk.result === 'key_unusable', `a key revoked while the apply waits: refused → ${rk.result}`)
    const ex = await waiting('expired', async (_k, pid) => { await sqlClient`update mcp_proposal set expires_at = now() - interval '1 second' where id = ${pid}` })
    ok(ex.blocked && ex.result === 'expired' && (await getProposal(A, ex.pp.id)).status === 'expired', `a proposal that expires while the apply waits: refused → ${ex.result}`)
    const kx = await waiting('keyexp', async (keyId) => { await sqlClient`update apikey set expires_at = now() - interval '1 second' where id = ${keyId}` })
    ok(kx.blocked && kx.result === 'key_unusable', `a key that expires while the apply waits: refused → ${kx.result}`)
    const nw = await waiting('nowrite', async (keyId) => { await sqlClient`update apikey set permissions = '{"mcp":["read"]}' where id = ${keyId}` })
    ok(nw.blocked && nw.result === 'key_unusable', `a key that loses write while the apply waits: refused → ${nw.result}`)
    let banned: Awaited<ReturnType<typeof waiting>>
    try {
      banned = await waiting('banned', async () => { await sqlClient`update "user" set status = 'pending' where id = ${A}` })
    } finally {
      await sqlClient`update "user" set status = 'active' where id = ${A}`
    }
    ok(banned.blocked && banned.result === 'key_unusable', `an account that is disabled while the apply waits: refused → ${banned.result}`)
    for (const p of await listProposals(A, { status: 'pending' })) await rejectProposal(A, p.id)
  }

  // ── review 4: handled proposals never hide a pending one; they are paged ──
  {
    const old = await propose(A, kUi, { changes: [{ resource: 'living', action: 'update', data: living(920_000) }] })
    for (let i = 0; i < 105; i++) {
      await sqlClient`insert into mcp_proposal (user_id, id, key_id, key_name, confirm, ops, base_hash, preview, status, expires_at, created_at, decided_at)
        values (${A}, ${`bulk-${String(i).padStart(3, '0')}`}, 'k', 'bulk', 'ui', '[]'::jsonb, 'h', '{"rows":[],"months":[]}'::jsonb, 'rejected', now() + interval '1 day', now() + ${i + 1} * interval '1 second', now())`
    }
    ok((await listProposals(A, { status: 'pending' })).some((x) => x.id === old.id), 'a pending proposal is listed after 105 newer handled ones')
    const page1 = await listProposals(A, { status: 'handled', limit: 100 })
    const last = page1[page1.length - 1]!
    const page2 = await listProposals(A, { status: 'handled', limit: 100, before: { at: last.createdAt, id: last.id } })
    ok(page1.length === 100 && page1.every((x) => x.status !== 'pending'), 'the handled list is a page of 100, none of them pending')
    ok(page2.length > 0 && page2.every((x) => !page1.some((y) => y.id === x.id)), 'the next page continues after the last one shown, without repeats')
    await rejectProposal(A, old.id)
  }

  // ── V-8: a revert is proposed and applied like any change ──
  const before8 = JSON.stringify(await state(A))
  const p8 = await propose(A, kChat, { changes: [
    { resource: 'subscriptions', action: 'create', data: sub('v8-sub') },
    { resource: 'living', action: 'update', data: living(300_000) },
  ] })
  const ap8 = await applyProposal(A, p8.id, { kind: 'key', keyId: kChat.id })
  ok(JSON.stringify(await state(A)) !== before8, 'the change set changed the data')
  const r8 = await propose(A, kChat, { revertOf: ap8.changeSetId! })
  ok(r8.revertOf === ap8.changeSetId && (r8.preview as { rows: unknown[] }).rows.length === 2, 'a revert proposal has the rows it would undo')
  const rr = await applyProposal(A, r8.id, { kind: 'key', keyId: kChat.id })
  ok(JSON.stringify(await state(A)) === before8, 'after the revert the data is as before')
  const rset = (await asUser(A, (q) => q.select().from(t.changeSet).where(eq(t.changeSet.id, rr.changeSetId!))))[0]!
  ok(rset.revertOf === ap8.changeSetId && rset.actorKind === 'api_key' && rset.proposalId === r8.id, 'the revert set records revert_of and the proposal')
  ok(await code(propose(A, kChat, { revertOf: ap8.changeSetId! })) === 'conflict', 'reverting it again is refused')
  ok(await code(propose(A, kChat, { revertOf: 'nope' })) === 'not_found', 'an unknown change set is refused')

  // ── review 1: an AI may revert only what it may change (spec 009 S-2) ──
  const direct = async (ops: { resource: string; action: 'create' | 'update' | 'delete'; id?: string; data?: unknown }[]) => {
    // written like the screen would (no AI allowlist), as one change set
    let setId: string | null = null
    await asUser(A, async (q) => {
      const rec = new Recorder(q, A, { kind: 'user', id: A }, { method: 'POST', path: '/api/x' })
      await applyOps(q, A, rec, ops)
      setId = rec.id
    })
    return setId!
  }
  const excluded: [string, { resource: string; action: 'create'; data: unknown }][] = [
    ['accounts', { resource: 'accounts', action: 'create', data: { name: 'rv-acc', role: '', inflow: '', outflow: '' } }],
    ['debts', { resource: 'debts', action: 'create', data: { name: 'rv-debt', principal: 1, rate: '', method: '', plan: '' } }],
    ['holiday sets', { resource: 'holiday-sets', action: 'create', data: { name: 'rv-hol', enabled: true, builtin: null, rules: [{ name: 'h', rdate: ['2031-05-05'] }] } }],
  ]
  for (const [label, op] of excluded) {
    const sid = await direct([op])
    ok(await code(propose(A, kChat, { revertOf: sid })) === 'rule', `reverting a change set of ${label} is refused when proposing`)
  }
  const prefSet = await direct([{ resource: 'preferences', action: 'update', data: { themeMode: 'dark', primary: null, accent: null, radius: 'base', density: 'base', dateFormat: 'iso', amountUnit: 'won', negative: 'minus' } }])
  ok(await code(propose(A, kChat, { revertOf: prefSet })) === 'rule', 'reverting a change set of display settings is refused')
  const mixed = await direct([{ resource: 'subscriptions', action: 'create', data: sub('rv-mixed') }, excluded[0]![1]])
  ok(await code(propose(A, kChat, { revertOf: mixed })) === 'rule', 'a mixed change set is refused whole')
  // the apply path checks too: a revert proposal stored before (planted as a row) is refused when applied
  const allowedSet = await direct([{ resource: 'subscriptions', action: 'create', data: sub('rv-ok') }])
  const planted = await propose(A, kUi, { revertOf: allowedSet })
  const stateMixed = JSON.stringify(await state(A))
  await asUser(A, (q) => q.update(t.mcpProposal).set({ revertOf: mixed }).where(eq(t.mcpProposal.id, planted.id)))
  ok(await code(applyProposal(A, planted.id, { kind: 'user' })) === 'rule' && JSON.stringify(await state(A)) === stateMixed, 'applying a revert of an excluded change set is refused and changes nothing')
  await rejectProposal(A, planted.id)
  const okRevert = await propose(A, kUi, { revertOf: allowedSet })
  ok((okRevert.preview as { rows: unknown[] }).rows.length === 1, 'a change set of allowed tables can still be reverted')
  await rejectProposal(A, okRevert.id)

  // ── V-9: another user's proposal and change set ──
  const pa = await propose(A, kUi, { changes: [{ resource: 'living', action: 'update', data: living(400_000) }] })
  // B's baseline is taken BEFORE the attempts (review 5)
  const sb0 = JSON.stringify(await state(B))
  const cb0 = await counts(B)
  ok(await code(getProposal(B, pa.id)) === 'not_found', "B cannot read A's proposal")
  ok(await code(applyProposal(B, pa.id, { kind: 'user' })) === 'not_found', "B cannot apply A's proposal")
  ok(await code(rejectProposal(B, pa.id)) === 'not_found', "B cannot reject A's proposal")
  ok((await listProposals(B)).length === 0, "B's list holds none of A's")
  ok(await code(propose(B, kB, { revertOf: ap8.changeSetId! })) === 'not_found', "B cannot propose reverting A's change set")
  ok(await code(getProposal(A, pa.id, kChat.id)) === 'not_found', "a key sees only its own proposals")
  ok(sb0 === JSON.stringify(await state(B)) && JSON.stringify(cb0) === JSON.stringify(await counts(B)), "B's data, history and proposals were not touched by those attempts")
  await rejectProposal(A, pa.id)

  // ── review 5: the table's row-level security is FORCEd, and holds for a role that owns it ──
  {
    const [cls] = await sqlClient`select relrowsecurity as on, relforcerowsecurity as forced from pg_class where relname = 'mcp_proposal'`
    ok((cls as { on: boolean }).on === true && (cls as { forced: boolean }).forced === true, 'mcp_proposal has row-level security enabled and forced')
    const [cu] = await sqlClient`select current_user as name`
    await sqlClient`do $$ begin if not exists (select 1 from pg_roles where rolname = 'allot_rls_owner') then create role allot_rls_owner nologin nosuperuser nobypassrls; end if; end $$`
    await sqlClient.unsafe(`grant "${(cu as { name: string }).name}" to allot_rls_owner`)
    // a member of the owning role counts as the owner for RLS (without FORCE it would see every row); it has no BYPASSRLS
    const seen = await sqlClient.begin(async (tx) => {
      await tx`set local role allot_rls_owner`
      await tx`select set_config('app.user_id', ${B}, true)`
      const other = await tx`select count(*)::int as n from mcp_proposal where user_id = ${A}`
      const everything = await tx`select count(*)::int as n from mcp_proposal`
      await tx`select set_config('app.user_id', ${A}, true)`
      const own = await tx`select count(*)::int as n from mcp_proposal`
      return { other: (other[0] as { n: number }).n, everything: (everything[0] as { n: number }).n, own: (own[0] as { n: number }).n }
    })
    ok(seen.other === 0 && seen.everything === 0 && seen.own > 0, `as a role that owns the table and has no BYPASSRLS: B sees ${seen.everything} rows of A's, A sees ${seen.own}`)
  }

  // ── review 5: a stored operation that is invalid at apply time is refused (the apply validates again) ──
  {
    const stateBefore = JSON.stringify(await state(A))
    const pv = await propose(A, kUi, { changes: [{ resource: 'subscriptions', action: 'create', data: sub('planted') }] })
    await sqlClient`update mcp_proposal set ops = ${JSON.stringify([{ resource: 'subscriptions', action: 'create', data: { plan: 'p' } }])}::jsonb where id = ${pv.id}`
    ok(await code(applyProposal(A, pv.id, { kind: 'user' })) === 'invalid' && JSON.stringify(await state(A)) === stateBefore, 'a stored operation that no longer validates is refused and nothing is applied')
    await sqlClient`update mcp_proposal set ops = ${JSON.stringify([{ resource: 'accounts', action: 'create', data: { name: 'x', role: '', inflow: '', outflow: '' } }])}::jsonb where id = ${pv.id}`
    ok(await code(applyProposal(A, pv.id, { kind: 'user' })) === 'invalid' && JSON.stringify(await state(A)) === stateBefore, 'a stored operation on a resource the AI may not change is refused')
    await rejectProposal(A, pv.id)
  }
} catch (e) {
  console.log(`FAIL ${(e as Error).stack}`)
  failed++
} finally {
  for (const uid of made) {
    await sqlClient`delete from apikey where reference_id = ${uid}`
    await asUser(uid, async (q) => {
      for (const table of [...OWNED].reverse()) await q.delete(table).where(eq(table.userId, uid))
      await q.delete(t.changeLog).where(eq(t.changeLog.userId, uid))
      await q.delete(t.changeSet).where(eq(t.changeSet.userId, uid))
    })
    await db.delete(a.user).where(eq(a.user.id, uid))
  }
  void sql
  await sqlClient.end()
}
process.exit(failed ? 1 : 0)
