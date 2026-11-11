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
  Account, AllocationTarget, CheckItem, Debt, Living, Phase, PlanChange, PlanEvent, RemainderSplit, Settings, Subscription,
} from '../../src/data/types'
import { db, sqlClient, type Db } from './client'
import { runMigrations } from './migrate'
import { auth } from '../auth'
import * as t from './schema'
import * as authSchema from './auth-schema'
import { moveOwner } from './owned'
import { asUser } from './scope'

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
    await d.insert(t.settings).values({ userId: uid, ...data.settings }).onConflictDoUpdate({ target: t.settings.userId, set: data.settings })
    await d.insert(t.living).values({ userId: uid, ...data.living }).onConflictDoUpdate({ target: t.living.userId, set: data.living })
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
    await upsert(d, uid, t.bankAccount, data.accounts as never)
    await upsert(d, uid, t.debt, data.debts as never)
    await upsert(d, uid, t.remainderSplit, data.remainderSplit as never)
  }, tx)
}

/**
 * The single login account. Sign-up is closed (disableSignUp), so the seed writes the
 * user and its credential row itself, with Better Auth's own password hashing.
 * If the email exists, the password is reset to ADMIN_PASSWORD and its sessions are revoked.
 *
 * There is only ever one account: if another email already has one, this fails, unless
 * `replace` is set — then the old account's data moves to this account and the old account
 * is deleted (its sessions and credentials cascade; its data does not, user_id is restrict).
 * Everything runs in one transaction under an advisory lock: two seeds cannot both create
 * an account, and a failure part-way leaves the previous account untouched.
 */
export async function ensureAdmin(email: string, password: string, replace = false) {
  const ctx = await auth.$context
  const target = email.toLowerCase()
  const hash = await ctx.password.hash(password) // before anything is written or deleted
  const u = authSchema.user
  const a = authSchema.account
  return db.transaction(async (q) => {
    await q.execute(sql`select pg_advisory_xact_lock(hashtext('allot:admin'))`)
    const others = await q.select({ id: u.id, email: u.email }).from(u).where(ne(u.email, target))
    if (others.length && !replace) {
      throw new Error(`another login account exists (${others.map((o) => o.email).join(', ')}); `
        + 'rerun with --replace-admin to delete it and use ADMIN_EMAIL instead')
    }
    const note = others.length ? ' (old account removed)' : ''
    const [found] = await q.select({ id: u.id }).from(u).where(eq(u.email, target))
    let userId = found?.id
    if (userId) {
      const updated = await q.update(a).set({ password: hash, updatedAt: new Date() })
        .where(and(eq(a.userId, userId), eq(a.providerId, 'credential'))).returning({ id: a.id })
      if (!updated.length) await q.insert(a).values({ id: randomUUID(), userId, providerId: 'credential', accountId: userId, password: hash })
      await q.delete(authSchema.session).where(eq(authSchema.session.userId, userId))
    } else {
      userId = randomUUID()
      await q.insert(u).values({ id: userId, email: target, name: 'Allot', emailVerified: true })
      await q.insert(a).values({ id: randomUUID(), userId, providerId: 'credential', accountId: userId, password: hash })
    }
    // Last, so the old account is only gone once the new one is in place (same transaction).
    for (const o of others) {
      await moveOwner(q as unknown as Db, o.id, userId)
      await q.delete(u).where(eq(u.id, o.id))
    }
    return { status: (found ? 'updated' : 'created') + note, userId }
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const replaceAdmin = args.includes('--replace-admin')
  const file = resolve(args.find((a) => !a.startsWith('--')) ?? '.loctx/scripts/seed-data.ts')
  const data = (await import(pathToFileURL(file).href)) as SeedData
  await runMigrations()
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password || password.length < 8) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) must be set')
  const admin = await ensureAdmin(email, password, replaceAdmin)
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
