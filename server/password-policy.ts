// Password policy (spec 013 S-24, S-26, A-37): the stored policy, the minimum on every path that sets a password, and
// the lockout after failed password sign-ins. The rules are pure, in server/password-rules.ts; this file reads and
// writes app_setting id 'password' and the login_failure table, and holds the Better Auth hook parts.
//
// - Nothing stored = DEFAULT_POLICY = the behaviour before the policy (minimum 8, no lockout).
// - The minimum is checked in the before-hook on the paths that set a password (PASSWORD_FIELDS); a password that is
//   already stored and shorter still signs in (the policy is for new passwords).
// - Lockout, only while it is on: failed /sign-in/email are counted per email as typed (trimmed, lower case), also for
//   an email with no account. When the count reaches `attempts`, the email is refused for `minutes` with one answer
//   that does not say whether an account exists. A successful sign-in deletes the row. Turned off: nothing is counted
//   or refused, and the rows are deleted.
import { and, eq, gt, isNull, lt, lte, or } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { db, type Db } from './db/client'
import * as t from './db/schema'
import { langOfCtx, text } from './messages'
import {
  DEFAULT_POLICY, failureKey, lockedMinutes, nextFailure, parsePolicy, PASSWORD_FIELDS, STALE_MS, tooShort,
  type FailureRow, type PasswordPolicy,
} from './password-rules'

const ROW = 'password'

export interface StoredPolicy { policy: PasswordPolicy; stored: boolean }

export async function loadPasswordPolicy(q: Db = db): Promise<StoredPolicy> {
  const [row] = await q.select().from(t.appSetting).where(eq(t.appSetting.id, ROW))
  const p = row ? parsePolicy(row.value) : null
  return p ? { policy: p, stored: true } : { policy: DEFAULT_POLICY, stored: false }
}

/** Admin screen: store the policy. Turning the lockout off deletes the failure rows in the same transaction. */
export async function savePasswordPolicy(p: PasswordPolicy, by: string): Promise<void> {
  await db.transaction(async (tx) => {
    const q = tx as unknown as Db
    const value = { minLength: p.minLength, lockout: { ...p.lockout } }
    await q.insert(t.appSetting).values({ id: ROW, value, updatedBy: by })
      .onConflictDoUpdate({ target: t.appSetting.id, set: { value, updatedAt: new Date(), updatedBy: by } })
    if (!p.lockout.enabled) await q.delete(t.loginFailure)
  })
}

// ── login_failure rows ──
type Row = typeof t.loginFailure.$inferSelect
const asFailure = (r: Row): FailureRow => ({ count: r.count, lockedUntil: r.lockedUntil ? new Date(r.lockedUntil) : null, updatedAt: new Date(r.updatedAt) })

/** Delete rows that are not locked and older than a day, so the table does not grow. */
async function prune(q: Db, now: Date) {
  const nowIso = now.toISOString()
  await q.delete(t.loginFailure).where(and(
    or(isNull(t.loginFailure.lockedUntil), lte(t.loginFailure.lockedUntil, nowIso)),
    lt(t.loginFailure.updatedAt, new Date(now.getTime() - STALE_MS).toISOString()),
  ))
}

/** Minutes left of the lock on this email, or 0. */
export async function lockedFor(email: string, now = new Date()): Promise<number> {
  const [r] = await db.select().from(t.loginFailure).where(eq(t.loginFailure.email, email))
  return r ? lockedMinutes(asFailure(r), now) : 0
}

/** One more failed sign-in for this email (counted under a row lock, so parallel failures all count). */
export async function recordFailure(email: string, policy: PasswordPolicy, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const q = tx as unknown as Db
    await prune(q, now)
    await q.insert(t.loginFailure).values({ email, count: 0, updatedAt: now.toISOString() }).onConflictDoNothing()
    const [r] = await q.select().from(t.loginFailure).where(eq(t.loginFailure.email, email)).for('update')
    // A row inserted just now has count 0 and no lock: nextFailure starts it at 1.
    const cur = r && r.count > 0 ? asFailure(r) : null
    const next = nextFailure(cur, now, policy.lockout)
    await q.update(t.loginFailure).set({
      count: next.count, lockedUntil: next.lockedUntil ? next.lockedUntil.toISOString() : null, updatedAt: next.updatedAt.toISOString(),
    }).where(eq(t.loginFailure.email, email))
  })
}

export const clearFailures = (email: string) => db.delete(t.loginFailure).where(eq(t.loginFailure.email, email))

/** Admin screen: the emails locked now. */
export async function listLocks(now = new Date()): Promise<{ email: string; until: string; count: number }[]> {
  await prune(db, now)
  const rows = await db.select().from(t.loginFailure).where(gt(t.loginFailure.lockedUntil, now.toISOString()))
  return rows.map((r) => ({ email: r.email, until: new Date(r.lockedUntil!).toISOString(), count: r.count }))
    .sort((a, b) => a.until.localeCompare(b.until))
}

/** Admin screen: unlock an email. Returns whether a row was there. */
export async function unlock(email: string): Promise<boolean> {
  const done = await db.delete(t.loginFailure).where(eq(t.loginFailure.email, email)).returning({ email: t.loginFailure.email })
  return done.length > 0
}

// ── Better Auth hook parts (server/auth.ts) ──
type Ctx = { path: string; body?: unknown; headers?: Headers; request?: Request; context: unknown }
const emailOf = (ctx: Ctx) => failureKey((ctx.body as { email?: unknown } | undefined)?.email)

/** Before-hook: the minimum on a path that sets a password, and the lock on a password sign-in. */
export async function guardPasswordPath(ctx: Ctx): Promise<void> {
  const setsPassword = Object.hasOwn(PASSWORD_FIELDS, ctx.path)
  if (!setsPassword && ctx.path !== '/sign-in/email') return
  const { policy, stored } = await loadPasswordPolicy()
  const lang = langOfCtx(ctx)
  if (setsPassword) {
    const min = tooShort(ctx.path, ctx.body, policy, stored)
    if (min !== null) throw APIError.from('BAD_REQUEST', { code: 'PASSWORD_TOO_SHORT', message: text(lang, 'pwTooShort', { min }) })
    return
  }
  if (!policy.lockout.enabled) return
  const email = emailOf(ctx)
  if (!email) return // Better Auth answers a missing email itself
  const n = await lockedFor(email)
  // The same answer for any email, with or without an account; checked before the password, so a right one is refused too.
  if (n > 0) throw APIError.from('FORBIDDEN', { code: 'LOGIN_LOCKED', message: text(lang, 'loginLocked', { n }) })
}

/** After-hook: count a wrong email or password; a sign-in that went through clears the count. */
export async function afterSignIn(ctx: Ctx & { context: { returned?: unknown } }): Promise<void> {
  if (ctx.path !== '/sign-in/email') return
  const email = emailOf(ctx)
  if (!email) return
  const { policy } = await loadPasswordPolicy()
  if (!policy.lockout.enabled) return
  const r = ctx.context.returned
  const status = r instanceof Error ? (r as { statusCode?: number }).statusCode
    : r && typeof r === 'object' && 'status' in r && typeof (r as { status: unknown }).status === 'number' ? (r as { status: number }).status : 200
  // Only "invalid email or password" (401) counts: a banned or pending account gave the right password.
  if (status === 401) await recordFailure(email, policy)
  else if (!(r instanceof Error) && (status ?? 200) < 400) await clearFailures(email)
}
