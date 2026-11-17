// API check for spec 009 W-1 (V-2 part): a list of operations applies in order and, when one breaks a
// rule, nothing of the list stays. Runs against the database of the dev stack inside one outer
// transaction that is always rolled back, so no data is left behind.
//   docker exec -w /app allot-dev-api-1 pnpm exec tsx tests/api/ops.ts
import { randomUUID } from 'node:crypto'
import { Recorder } from '../../server/changes'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'
import { asUser, setUser } from '../../server/db/scope'
import { applyOps, OpInvalid, parseOp, Rejected, type Op } from '../../server/ops'
import { readState } from '../../server/state'

let failed = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }

const sub = (name: string) => ({ name, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false })
const phase = (name: string, from: string, to: string | null) => ({ label: 'P', name, from, to, amounts: {} })
const parsed = (ops: Op[]) => ops.map((o, i) => parseOp(o, i))

class Done extends Error {}

try {
  await db.transaction(async (tx) => {
    const q = tx as never as typeof db
    const uid = randomUUID()
    await q.insert(a.user).values({ id: uid, email: `ops-${uid}@example.com`, name: 'Ops', emailVerified: true, status: 'active', admission: 'admin' })
    await setUser(q, uid)
    const rec = () => new Recorder(q, uid, { kind: 'user', id: uid }, { method: 'TEST', path: '/ops' })
    const state = () => readState(q, uid)

    // 1. two operations apply in order, as one change set
    const r1 = rec()
    await applyOps(q, uid, r1, parsed([
      { resource: 'subscriptions', action: 'create', data: sub('ops-a') },
      { resource: 'living', action: 'update', data: { food: 1, transit: 2, allowance: 3 } },
    ]))
    let s = await state()
    ok(s.subscriptions.length === 1 && s.subscriptions[0]!.name === 'ops-a', 'create applied')
    ok(s.living.food === 1 && s.living.allowance === 3, 'single-row update applied')
    ok(!!r1.id, 'one change set')

    // 2. a list with a broken rule leaves nothing (the savepoint of asUser rolls the list back)
    let rejected = false
    try {
      await asUser(uid, async (qq) => {
        await applyOps(qq, uid, rec(), parsed([
          { resource: 'subscriptions', action: 'create', data: sub('ops-b') },
          { resource: 'phases', action: 'create', data: phase('x', '2031-01', '2031-06') },
          { resource: 'phases', action: 'create', data: phase('y', '2031-03', null) },
        ]))
      }, q)
    } catch (e) { rejected = e instanceof Rejected }
    s = await state()
    ok(rejected, 'overlapping phase is a rejection')
    ok(s.subscriptions.length === 1 && s.phases.length === 0, 'nothing of the failed list stays')

    // 3. update and delete name a row; a missing row rejects the list
    const id = s.subscriptions[0]!.id
    await applyOps(q, uid, rec(), parsed([{ resource: 'subscriptions', action: 'update', id, data: sub('ops-a2') }]))
    ok((await state()).subscriptions[0]!.name === 'ops-a2', 'update applied')
    let missing = false
    try {
      await asUser(uid, (qq) => applyOps(qq, uid, rec(), parsed([{ resource: 'subscriptions', action: 'delete', id: randomUUID() }])), q)
    } catch (e) { missing = e instanceof Rejected }
    ok(missing, 'a missing row rejects')
    await applyOps(q, uid, rec(), parsed([{ resource: 'subscriptions', action: 'delete', id }]))
    ok((await state()).subscriptions.length === 0, 'delete applied')

    // 4. parseOp refuses what an AI may not do
    const bad = (op: Op) => { try { parseOp(op, 0); return false } catch (e) { return e instanceof OpInvalid } }
    ok(bad({ resource: 'accounts', action: 'create', data: {} }), 'accounts are not for an AI')
    ok(bad({ resource: 'living', action: 'create', data: { food: 1, transit: 1, allowance: 1 } }), 'living is update only')
    ok(bad({ resource: 'subscriptions', action: 'update', data: sub('x') }), 'update needs an id')
    ok(bad({ resource: 'subscriptions', action: 'create', data: { name: '' } }), 'data is validated')
    throw new Done()
  })
} catch (e) {
  if (!(e instanceof Done)) { console.log(`FAIL ${(e as Error).stack}`); failed++ }
}
await sqlClient.end()
process.exit(failed ? 1 : 0)
