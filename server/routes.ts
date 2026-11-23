// Data API. Every route sits behind the session check in app.ts and works on the session user's
// rows only: every select, update and delete is filtered by user_id, and inserts set it here
// (a client never sends it). Each request runs in one transaction as that user, so the
// row-level security policies check the same thing again in the database.
// The writes themselves are operations (server/ops.ts), the same ones an AI proposal applies.
//   GET    /api/state                 everything the app shows, lists in insertion order
//   PUT    /api/settings | /api/living | /api/preferences  the single-row records
//   POST   /api/<resource>            create (server assigns the id)
//   PUT    /api/<resource>/:id        replace
//   DELETE /api/<resource>/:id
import { Conflict, getSet, listSets, NotFound, Recorder, revert, RuleBroken } from './changes'
import { Hono, type Context } from 'hono'
import type { AppEnv } from './app-env'
import type { Db } from './db/client'
import { asUser } from './db/scope'
import { body } from './body'
import { langOf, msg } from './messages'
import { applyOp, RESOURCES, Rejected, singleSchema, type ListName, type SingleName } from './ops'
import { applyProposal, getProposal, listProposals, pendingCount, ProposalError, proposalText, rejectProposal, type ProposalStatus } from './proposals'
import { readState } from './state'

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } }
  return err?.code ?? err?.cause?.code
}

/** Map known constraint errors to 400; anything else is a real 500. */
function dbError(c: Context, e: unknown) {
  const code = pgCode(e)
  if (code === '23503') return c.json({ error: msg(c, 'fkMissing') }, 400)
  // unique violation, e.g. a second 'living' target (also when a revert would bring one back)
  if (code === '23505') return c.json({ error: msg(c, 'duplicate') }, 400)
  // check violation, bad text repr, numeric/integer overflow, bad or out-of-range date
  if (['23514', '22P02', '22003', '22007', '22008'].includes(code ?? '')) return c.json({ error: msg(c, 'outOfRange') }, 400)
  throw e
}

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

/** The change set of this request (spec 005 S-3): one write request = one set. */
const recorderFor = (c: Context<AppEnv>, q: Db) =>
  new Recorder(q, uidOf(c), { kind: 'user', id: uidOf(c) }, { method: c.req.method, path: new URL(c.req.url).pathname })

/** One operation of this request, in one transaction; a rule it breaks becomes a 400. */
async function run(c: Context<AppEnv>, op: Parameters<typeof applyOp>[3]) {
  const uid = uidOf(c)
  return asUser(uid, (q) => applyOp(q, uid, recorderFor(c, q), op))
}

function crud(r: Hono<AppEnv>, path: string, resource: ListName) {
  const schema = RESOURCES[resource].schema
  r.post(path, body(schema), async (c) => {
    try {
      const res = await run(c, { resource, action: 'create', data: c.req.valid('json' as never) })
      return c.json(res.row, 201)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: msg(c, e.ref) }, 400)
      return dbError(c, e)
    }
  })

  r.put(`${path}/:id`, body(schema), async (c) => {
    try {
      const res = await run(c, { resource, action: 'update', id: c.req.param('id'), data: c.req.valid('json' as never) })
      if (!res.found) return c.json({ error: msg(c, 'itemNotFound') }, 404)
      return c.json(res.row)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: msg(c, e.ref) }, 400)
      return dbError(c, e)
    }
  })

  r.delete(`${path}/:id`, async (c) => {
    try {
      const res = await run(c, { resource, action: 'delete', id: c.req.param('id') })
      if (!res.found) return c.json({ error: msg(c, 'itemNotFound') }, 404)
      return c.body(null, 204)
    } catch (e) {
      if (e instanceof Rejected) return c.json({ error: msg(c, e.ref) }, 400)
      return dbError(c, e)
    }
  })
}

/** PUT of a one-row record. */
function single(r: Hono<AppEnv>, path: string, resource: SingleName) {
  r.put(path, body(singleSchema(resource)), async (c) => {
    try {
      const res = await run(c, { resource, action: 'update', data: c.req.valid('json' as never) })
      return c.json(res.row)
    } catch (e) {
      return dbError(c, e)
    }
  })
}

export const routes = new Hono<AppEnv>()

// `pendingProposals` is the badge's number; it is not part of readState(), which is what a proposal's fingerprint covers.
routes.get('/state', async (c) => c.json(await asUser(uidOf(c), async (q) => ({ ...(await readState(q, uidOf(c))), pendingProposals: await pendingCount(q, uidOf(c)) }))))

single(routes, '/settings', 'settings')
single(routes, '/living', 'living')
single(routes, '/preferences', 'preferences')

for (const [path, resource] of [
  ['/subscriptions', 'subscriptions'], ['/plan-changes', 'plan-changes'], ['/phases', 'phases'], ['/events', 'events'],
  ['/checks', 'checks'], ['/accounts', 'accounts'], ['/debts', 'debts'], ['/remainder-split', 'remainder-split'],
  ['/holiday-sets', 'holiday-sets'], ['/targets', 'targets'], ['/spendings', 'spendings'],
  ['/living-items', 'living-items'], ['/balances', 'balances'], ['/cards', 'cards'], ['/month-adjusts', 'month-adjusts'], // spec 013
  ['/currencies', 'currencies'], ['/schedules', 'schedules'], // spec 013 rc.3
] as const) crud(routes, path, resource)

// ── Proposals from an AI key (spec 009 S-4, S-9): the screen confirms or rejects them (a session only) ──
//   GET  /api/proposals?status=pending|handled|…&limit=100&before=<createdAt>&beforeId=<id>   newest first, with their previews;
//        `handled` is every status but pending; the next page starts after the last one shown
//   GET  /api/proposals/:id
//   POST /api/proposals/:id/apply        confirm: applies the proposal as one change set → { changeSet }
//   POST /api/proposals/:id/reject
const STATUSES = ['pending', 'applied', 'rejected', 'expired', 'stale', 'handled'] as const
const proposalFail = (c: Context<AppEnv>, e: unknown) => {
  if (e instanceof ProposalError) return c.json({ error: proposalText(e, langOf(c)), code: e.code }, e.status as 400 | 404 | 409)
  return dbError(c, e)
}

routes.get('/proposals', async (c) => {
  const status = c.req.query('status')
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) return c.json({ error: msg(c, 'invalidInput'), path: 'status' }, 400)
  const at = c.req.query('before') || undefined
  const id = c.req.query('beforeId') || undefined
  if (at && Number.isNaN(Date.parse(at))) return c.json({ error: msg(c, 'beforeNotTime') }, 400)
  if (!!at !== !!id) return c.json({ error: msg(c, 'beforeBoth') }, 400)
  const limit = Number(c.req.query('limit') ?? 100) || 100
  return c.json(await listProposals(uidOf(c), { status: status as ProposalStatus | 'handled' | undefined, limit, before: at && id ? { at, id } : undefined }))
})

routes.get('/proposals/:id', async (c) => {
  try {
    return c.json(await getProposal(uidOf(c), c.req.param('id')))
  } catch (e) {
    return proposalFail(c, e)
  }
})

routes.post('/proposals/:id/apply', async (c) => {
  try {
    const done = await applyProposal(uidOf(c), c.req.param('id'), { kind: 'user' })
    return c.json({ changeSet: done.changeSetId })
  } catch (e) {
    return proposalFail(c, e)
  }
})

routes.post('/proposals/:id/reject', async (c) => {
  try {
    await rejectProposal(uidOf(c), c.req.param('id'))
    return c.body(null, 204)
  } catch (e) {
    return proposalFail(c, e)
  }
})

// ── Change sets (spec 005 S-3) ──
//   GET  /api/changes?before=<at>&beforeId=<id>&limit=50   newest first, with their row changes;
//        the next page starts after the last set shown (its at and id)
//   GET  /api/changes/:id                    one set
//   POST /api/changes/:id/revert             the opposite change, as a new set
routes.get('/changes', async (c) => {
  const uid = uidOf(c)
  const at = c.req.query('before') || undefined
  const id = c.req.query('beforeId') || undefined
  if (at && Number.isNaN(Date.parse(at))) return c.json({ error: msg(c, 'beforeNotTime') }, 400)
  if (!!at !== !!id) return c.json({ error: msg(c, 'beforeBoth') }, 400)
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200)
  // a period (spec 013 S-18): since (inclusive) and until (exclusive), ISO times
  const since = c.req.query('since') || undefined
  const until = c.req.query('until') || undefined
  if ((since && Number.isNaN(Date.parse(since))) || (until && Number.isNaN(Date.parse(until)))) return c.json({ error: msg(c, 'beforeNotTime') }, 400)
  return c.json(await asUser(uid, (q) => listSets(q, uid, at && id ? { at, id } : undefined, limit, { since, until })))
})

routes.get('/changes/:id', async (c) => {
  const uid = uidOf(c)
  const set = await asUser(uid, (q) => getSet(q, uid, c.req.param('id')))
  return set ? c.json(set) : c.json({ error: msg(c, 'changeNotFound') }, 404)
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
    if (e instanceof NotFound) return c.json({ error: msg(c, e.ref) }, 404)
    if (e instanceof Conflict) return c.json({ error: msg(c, e.ref), table: e.table, key: e.key }, 409)
    if (e instanceof RuleBroken) return c.json({ error: msg(c, e.ref) }, 400)
    return dbError(c, e)
  }
})
