// The daily rate refresh against the database (spec 013 S-23, A-38): at start (after a short delay) and then once a day,
// every user with an auto rate gets the public rate (server/fx-rates.ts). Row-level security sees one user at a time, so
// each user is read and written as that user. A changed rate is one change set of the server itself (actor 'system'),
// in the change history and revertible like any set; the refresh columns (`*_auto_at`, `*_auto_error`) stay out of it.
// ALLOT_FX_REFRESH=off switches the job off; POST /api/currencies/refresh (server/fx-routes.ts) runs one user now.
import { and, eq } from 'drizzle-orm'
import { Recorder } from './changes'
import { db, type Db } from './db/client'
import { user } from './db/auth-schema'
import { asUser, lockFor } from './db/scope'
import * as t from './db/schema'
import { fxBase, fxEnabled, refreshAll, refreshUser, type FetchFn, type FxResult, type FxState, type FxStore, planWrites } from './fx-rates'
import { readState } from './state'
import { cachedFetch } from './fx-cache'

/** The set's actor and its method and path (shown in the change history). */
const ACTOR = { kind: 'system', id: 'fx-refresh' } as const
const META = { method: 'POST', path: 'fx-refresh' }
const START_DELAY_MS = 60_000
const DAY_MS = 86_400_000

async function readFx(q: Db, uid: string): Promise<FxState> {
  const [s] = await q.select({ fxRate: t.settings.fxRate, fxAuto: t.settings.fxAuto }).from(t.settings).where(eq(t.settings.userId, uid))
  const currencies = await q.select({ id: t.foreignCurrency.id, code: t.foreignCurrency.code, rate: t.foreignCurrency.rate, auto: t.foreignCurrency.auto })
    .from(t.foreignCurrency).where(eq(t.foreignCurrency.userId, uid))
  return { settings: s ?? null, currencies }
}

/** Write the results for one user, in one transaction under the user's locks (the rows are read again there). */
async function writeFx(uid: string, results: ReadonlyMap<string, FxResult>) {
  await asUser(uid, async (q) => {
    await lockFor(q, 'data', uid) // the same order as every writer: data → settings
    await lockFor(q, 'settings', uid)
    const plan = planWrites(await readFx(q, uid), results, new Date().toISOString())
    const rec = new Recorder(q, uid, ACTOR, META)
    if (plan.settings) {
      const [before] = await q.select().from(t.settings).where(eq(t.settings.userId, uid)).for('update')
      const [after] = await q.update(t.settings).set(plan.settings).where(eq(t.settings.userId, uid)).returning()
      // only the rate is recorded: the recorder leaves the refresh columns out (server/changes.ts)
      if (before && after) await rec.record(t.settings, {}, 'update', before, after)
    }
    for (const c of plan.currencies) {
      const { id, ...set } = c
      const where = and(eq(t.foreignCurrency.userId, uid), eq(t.foreignCurrency.id, id))
      const [before] = await q.select().from(t.foreignCurrency).where(where).for('update')
      const [after] = await q.update(t.foreignCurrency).set(set).where(where).returning()
      if (before && after) await rec.record(t.foreignCurrency, { id }, 'update', before, after)
    }
  })
}

export const fxStore: FxStore = {
  users: async () => (await db.select({ id: user.id }).from(user)).map((u) => u.id),
  read: (uid) => asUser(uid, (q) => readFx(q, uid)),
  write: writeFx,
}

// the answers of the last minutes are reused by "지금 갱신" and the daily job alike (server/fx-cache.ts, review rc3-1 F-8)
const realFetch: FetchFn = cachedFetch((url, init) => fetch(url, init))

/**
 * Refresh the signed-in user's auto rates now; answers the settings and the currency list as /api/state does, and
 * `off: true` (nothing fetched) when ALLOT_FX_REFRESH=off.
 */
export async function refreshNow(uid: string, fetchFn: FetchFn = realFetch) {
  const off = !fxEnabled()
  if (!off) await refreshUser(uid, fxStore, fetchFn, undefined, fxBase())
  return asUser(uid, async (q) => {
    const { settings, currencies } = await readState(q, uid)
    return { settings, currencies, off }
  })
}

/** Start the daily job (off with ALLOT_FX_REFRESH=off). Nothing is fetched while no user has an auto rate. */
export function startFxRefresh() {
  if (!fxEnabled()) {
    console.log('rate refresh: off (ALLOT_FX_REFRESH=off)')
    return
  }
  const run = async () => {
    try {
      const n = await refreshAll(fxStore, realFetch, fxBase())
      if (n) console.log(`rate refresh: ${n} user(s) refreshed`)
    } catch (e) {
      console.error('rate refresh failed', e)
    }
  }
  setTimeout(() => {
    void run()
    setInterval(() => void run(), DAY_MS).unref()
  }, START_DELAY_MS).unref()
}
