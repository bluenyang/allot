// Seed runner: loads a data module and upserts it into the database.
//   pnpm db:seed [path/to/data.ts]   (default: .loctx/scripts/seed-data.ts, local only)
// The data module exports the same names the old src/data/seed.ts did:
// settings, living, targets, subscriptions, planChanges, phases (with amounts), events, checks, accounts, debts, remainderSplit.
// Running it again gives the same result: rows are upserted by id.
// The login account is written first; every row belongs to it (user_id).
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { and, eq, getTableColumns, inArray, ne, notInArray, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type {
  Account, AllocationTarget, CheckItem, DayShift, Debt, Living, Phase, PlanChange, PlanEvent, RemainderSplit, Settings, Subscription,
} from '../../src/data/types'
import { settingsRow } from '../validation'
import { db, sqlClient, type Db } from './client'
import { runMigrations } from './migrate'
import { hashPassword } from 'better-auth/crypto'
import * as t from './schema'
import * as authSchema from './auth-schema'
import { moveOwner } from './owned'
import { asUser, lockFor } from './scope'

/** Names of the three coded living items when the seed makes them (spec 013 S-2). */
const SEED_LIVING = { food: '식비', transit: '교통', allowance: '용돈' } as const

export interface SeedData {
  settings: Settings
  living: Living
  targets: AllocationTarget[]
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  phases: Phase[]
  events: PlanEvent[]
  checks: CheckItem[]
  accounts: Account[]
  debts: Debt[]
  remainderSplit: RemainderSplit[]
}

/** `set` clause that copies every non-key, non-generated column from the conflicting row. */
function excludedSet(table: PgTable): Record<string, SQL> {
  const set: Record<string, SQL> = {}
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (col.primary || key === 'seq' || key === 'userId') continue
    set[key] = sql.raw(`excluded."${col.name}"`)
  }
  return set
}

/**
 * Insert or update by id, as `uid`. Ids are global keys: a seed id that already belongs to
 * another account is an error, never a silent take-over.
 */
async function upsert<T extends PgTable & { id: PgColumn; userId: PgColumn }>(tx: Db, uid: string, table: T, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const ids = rows.map((r) => r.id as string)
  const taken = (await tx.select({ id: table.id }).from(table as never).where(and(inArray(table.id, ids), ne(table.userId, uid)))) as { id: string }[]
  if (taken.length) throw new Error(`seed ids already used by another account: ${taken.map((x) => x.id).join(', ')}`)
  await tx.insert(table).values(rows.map((r) => ({ ...r, userId: uid })) as never).onConflictDoUpdate({ target: table.id, set: excludedSet(table) })
}

export async function seed(data: SeedData, uid: string, tx: Db = db) {
  await asUser(uid, async (d) => {
    await lockFor(d, 'data', uid)
    // The same conversion as the API's (spec 018 S-1, review 1 finding 3): a data file written for 0.1.9 has the one
    // rule `dayShift`, which is no column any more — it becomes the rule of each date the file does not name itself.
    const settings = settingsRow(data.settings as Settings & { dayShift?: DayShift })
    await d.insert(t.settings).values({ userId: uid, ...settings }).onConflictDoUpdate({ target: t.settings.userId, set: settings })
    // The old living row is the three coded living items now (spec 013 S-2).
    for (const code of ['food', 'transit', 'allowance'] as const) {
      const li = t.livingItem
      const [have] = await d.select({ id: li.id }).from(li).where(and(eq(li.userId, uid), eq(li.code, code)))
      if (have) await d.update(li).set({ amount: data.living[code] }).where(and(eq(li.userId, uid), eq(li.id, have.id)))
      else await d.insert(li).values({ userId: uid, id: randomUUID(), name: SEED_LIVING[code], kind: SEED_LIVING[code], amount: data.living[code], code })
    }
    // The accounts first: a subscription may name one as its way of paying (spec 018 S-8) and a target the account its
    // money goes to, and the foreign keys hold at once — on a database without rows the order is all there is (review 5
    // finding 3). A card a subscription names is not in a data file (the seed writes no cards): it is one made in the app.
    await upsert(d, uid, t.bankAccount, data.accounts as never)
    await upsert(d, uid, t.subscription, data.subscriptions.map((s) => ({ ...s, note: s.note ?? null })))
    await upsert(d, uid, t.planChange, data.planChanges as never)
    // The seed's targets are the target set: others go (their phase amounts cascade).
    const targetIds = data.targets.map((x) => x.id)
    const mineT = eq(t.allocationTarget.userId, uid)
    await d.delete(t.allocationTarget).where(targetIds.length ? and(mineT, notInArray(t.allocationTarget.id, targetIds)) : mineT)
    // Kinds are unique except 'fixed'; clear kinds first so a re-seed may move a kind to another id.
    for (const x of data.targets) await d.update(t.allocationTarget).set({ kind: 'fixed' }).where(and(mineT, eq(t.allocationTarget.id, x.id)))
    await upsert(d, uid, t.allocationTarget, data.targets.map((x) => ({ ...x, note: x.note ?? null })))
    await upsert(d, uid, t.phase, data.phases.map(({ amounts: _a, ...p }) => ({ ...p, note: p.note ?? null })))
    for (const p of data.phases) {
      await d.delete(t.phaseAmount).where(and(eq(t.phaseAmount.userId, uid), eq(t.phaseAmount.phaseId, p.id)))
      const rows = Object.entries(p.amounts).filter(([, v]) => v !== 0).map(([targetId, amount]) => ({ userId: uid, phaseId: p.id, targetId, amount }))
      if (rows.length) await d.insert(t.phaseAmount).values(rows)
    }
    await upsert(d, uid, t.planEvent, data.events as never)
    await upsert(d, uid, t.checkItem, data.checks as never)
    await upsert(d, uid, t.debt, data.debts as never)
    await upsert(d, uid, t.remainderSplit, data.remainderSplit as never)
  }, tx)
}

/**
 * The admin login account from ADMIN_EMAIL / ADMIN_PASSWORD (spec 006 S-7). The seed writes the
 * user and its credential row itself, with Better Auth's own password hashing.
 * If the email exists, its password is reset, its sessions are revoked, and it is an active admin.
 * Other accounts are left alone (there may be many since 0.1.2).
 *
 * `replaceEmail` (`--replace-admin <old email>`): that account's data moves to this one and the
 * old account is deleted (its sessions and credentials cascade; its data does not: user_id is
 * restrict). Everything runs in one transaction under an advisory lock: two seeds cannot both
 * create the account, and a failure part-way leaves the previous accounts untouched.
 */
export async function ensureAdmin(email: string, password: string, replaceEmail?: string) {
  const target = email.toLowerCase()
  const old = replaceEmail?.toLowerCase()
  if (old === target) throw new Error('--replace-admin: give the old account\'s email, not ADMIN_EMAIL')
  const hash = await hashPassword(password) // before anything is written or deleted
  const u = authSchema.user
  const a = authSchema.account
  return db.transaction(async (q) => {
    await q.execute(sql`select pg_advisory_xact_lock(hashtext('allot:admin'))`)
    const [from] = old ? await q.select({ id: u.id }).from(u).where(eq(u.email, old)) : []
    if (old && !from) throw new Error(`--replace-admin: no account with the email ${old}`)
    const [found] = await q.select({ id: u.id }).from(u).where(eq(u.email, target))
    // Data locks first (spec 009 review): an apply holds a user's data lock and then reads that user's row,
    // so nothing here may touch an account row and only then ask for the data lock. Both users, in a fixed order.
    for (const id of [...new Set([from?.id, found?.id].filter((x): x is string => !!x))].sort()) await lockFor(q as unknown as Db, 'data', id)
    let userId = found?.id
    if (userId) {
      const updated = await q.update(a).set({ password: hash, updatedAt: new Date() })
        .where(and(eq(a.userId, userId), eq(a.providerId, 'credential'))).returning({ id: a.id })
      if (!updated.length) await q.insert(a).values({ id: randomUUID(), userId, providerId: 'credential', accountId: userId, password: hash })
      await q.delete(authSchema.session).where(eq(authSchema.session.userId, userId))
      await q.update(u).set({ status: 'active', role: 'admin', banned: false }).where(eq(u.id, userId))
    } else {
      userId = randomUUID()
      await q.insert(u).values({ id: userId, email: target, name: 'Allot', emailVerified: true, status: 'active', admission: 'seed', role: 'admin' })
      await q.insert(a).values({ id: randomUUID(), userId, providerId: 'credential', accountId: userId, password: hash })
    }
    // Last, so the old account is only gone once the new one is in place (same transaction).
    if (from) {
      await moveOwner(q as unknown as Db, from.id, userId)
      await q.execute(sql`select set_config('app.user_id', ${from.id}, true)`)
      await q.delete(t.userKey).where(eq(t.userKey.userId, from.id))
      await q.delete(u).where(eq(u.id, from.id))
    }
    return { status: (found ? 'updated' : 'created') + (from ? ` (data moved from ${old}, old account removed)` : ''), userId }
  })
}

/** `--replace-admin <old email>` from the arguments. */
export function replaceArg(args: string[]): string | undefined {
  const i = args.indexOf('--replace-admin')
  if (i < 0) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) throw new Error('--replace-admin needs the old account\'s email')
  return v
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const replace = replaceArg(args)
  const file = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--replace-admin') ?? '.loctx/scripts/seed-data.ts')
  const data = (await import(pathToFileURL(file).href)) as SeedData
  await runMigrations()
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password || password.length < 8) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) must be set')
  const admin = await ensureAdmin(email, password, replace)
  await seed(data, admin.userId)
  const counts = await asUser(admin.userId, (q) => q.execute<{ t: string; n: number }>(sql`
    select 'subscription' t, count(*)::int n from subscription union all
    select 'plan_change', count(*)::int from plan_change union all
    select 'phase', count(*)::int from phase union all
    select 'plan_event', count(*)::int from plan_event union all
    select 'check_item', count(*)::int from check_item union all
    select 'bank_account', count(*)::int from bank_account union all
    select 'debt', count(*)::int from debt union all
    select 'remainder_split', count(*)::int from remainder_split union all
    select 'allocation_target', count(*)::int from allocation_target union all
    select 'phase_amount', count(*)::int from phase_amount`))
  console.log(`admin account ${email}: ${admin.status}`)
  console.log(`seeded from ${file}`)
  for (const r of counts) console.log(`  ${r.t}: ${r.n}`)
  await sqlClient.end()
}
