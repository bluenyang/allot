// Admin (spec 006 S-3, S-8). User management uses Better Auth's admin plugin; the rules it does
// not know are enforced here, in a before-hook on its paths:
//   - impersonation and remove-user are closed (remove-user would half-delete: sessions and
//     accounts first, then the user row fails on the data's restrict foreign keys)
//   - the last active admin cannot be demoted, banned or deleted; nobody bans or deletes themself
//   - update-user may only change the name, or approve (status → active)
//   - create-user takes no extra data; new accounts are active and admitted by the admin
// The admin never reads another user's data tables: only `user` account columns and the
// login-method settings. Every admin action is logged as one line (actor, action, target).
import { APIError, getSessionFromCtx } from 'better-auth/api'
import { and, count, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { db } from './db/client'
import * as a from './db/auth-schema'
import { oidcAccountKey } from './providers'

export const ADMIN_CLOSED_PATHS = ['/admin/impersonate-user', '/admin/stop-impersonating', '/admin/remove-user']

const conflict = (code: string, message: string) => APIError.from('CONFLICT', { code, message })
const bad = (code: string, message: string) => APIError.from('BAD_REQUEST', { code, message })

/** Active admins other than `except` (not banned, not pending). */
export async function otherActiveAdmins(except: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(a.user)
    .where(and(eq(a.user.role, 'admin'), eq(a.user.banned, false), eq(a.user.status, 'active'), ne(a.user.id, except)))
  return r?.n ?? 0
}

async function isAdmin(id: string) {
  const [u] = await db.select({ role: a.user.role }).from(a.user).where(eq(a.user.id, id))
  return u?.role === 'admin'
}

/** The last active admin is never demoted, banned or deleted. */
export async function assertNotLastAdmin(target: string) {
  if (await isAdmin(target) && (await otherActiveAdmins(target)) === 0) {
    throw conflict('LAST_ADMIN', '마지막 관리자는 바꾸거나 정지하거나 지울 수 없어요.')
  }
}

type Ctx = { path: string; body?: unknown; context: unknown; headers?: Headers; request?: Request }
const bodyOf = (ctx: Ctx) => (ctx.body ?? {}) as Record<string, unknown>

/** Before-hook part for /admin/* paths. */
export async function guardAdminPath(ctx: Ctx) {
  if (!ctx.path.startsWith('/admin/')) return
  if (ADMIN_CLOSED_PATHS.includes(ctx.path)) throw APIError.from('NOT_FOUND', { code: 'NOT_FOUND', message: 'Not found' })
  const b = bodyOf(ctx)
  const target = typeof b.userId === 'string' ? b.userId : undefined
  const me = (await getSessionFromCtx(ctx as never).catch(() => null))?.user.id
  // Not an admin: the plugin refuses with 403; checking anything first would tell them about the target.
  if (!me || !(await isActiveAdmin(me))) return
  switch (ctx.path) {
    case '/admin/set-role': {
      if (b.role !== 'admin' && b.role !== 'user') throw bad('BAD_ROLE', "역할은 'admin' 또는 'user'예요.")
      if (target && b.role === 'user') await assertNotLastAdmin(target)
      break
    }
    case '/admin/ban-user': {
      if (target && target === me) throw conflict('SELF', '자기 자신은 정지할 수 없어요.')
      if (target) await assertNotLastAdmin(target)
      break
    }
    case '/admin/update-user': {
      const data = (b.data ?? {}) as Record<string, unknown>
      const keys = Object.keys(data)
      if (!keys.length || keys.some((k) => k !== 'name' && k !== 'status')) throw bad('FIELD_NOT_ALLOWED', '이름과 승인만 바꿀 수 있어요.')
      if ('status' in data && data.status !== 'active') throw bad('FIELD_NOT_ALLOWED', '승인(활성)으로만 바꿀 수 있어요.')
      if ('name' in data && (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100)) throw bad('BAD_NAME', '이름을 확인해 주세요.')
      break
    }
    case '/admin/create-user': {
      if (b.data !== undefined) throw bad('FIELD_NOT_ALLOWED', '추가 필드는 받을 수 없어요.')
      if (b.role !== undefined && b.role !== 'admin' && b.role !== 'user') throw bad('BAD_ROLE', "역할은 'admin' 또는 'user'예요.")
      break
    }
  }
}

/** After-hook part: a reset password ends the user's sessions; every admin action is logged. */
export async function afterAdminPath(ctx: Ctx & { context: { returned?: unknown } }) {
  if (!ctx.path.startsWith('/admin/')) return
  const returned = ctx.context.returned
  if (returned instanceof Error || (returned && typeof returned === 'object' && 'status' in returned && typeof (returned as { status: unknown }).status === 'number' && (returned as { status: number }).status >= 400)) return
  const b = bodyOf(ctx)
  const target = typeof b.userId === 'string' ? b.userId : undefined
  if (ctx.path === '/admin/set-user-password' && target) {
    await db.delete(a.session).where(eq(a.session.userId, target))
  }
  if (['/admin/list-users', '/admin/get-user', '/admin/list-user-sessions', '/admin/has-permission'].includes(ctx.path)) return
  const me = (await getSessionFromCtx(ctx as never).catch(() => null))?.user.id ?? 'unknown'
  const createdId = (returned as { user?: { id?: unknown } } | undefined)?.user?.id
  logAdmin(me, ctx.path.slice('/admin/'.length), target ?? (typeof createdId === 'string' ? createdId : '-'))
}

export function logAdmin(actor: string, action: string, target: string) {
  console.log(`admin: ${action} by ${actor} target ${target}`)
}

/**
 * Can the password login be off? Only if some active admin has a linked login on one of the
 * given external providers (spec 006 S-11), so an admin can still get in. An OIDC login counts
 * only if it belongs to `oidcIssuer`, the issuer that will be in use: OIDC account keys start
 * with their issuer, and a link made at another issuer does not sign in (review 1, R4).
 */
export async function adminCanSignInWithout(providers: string[], oidcIssuer?: string): Promise<boolean> {
  const others = providers.filter((p) => p !== 'oidc')
  const oidc = providers.includes('oidc') && oidcIssuer ? oidcAccountKey(oidcIssuer, '') : undefined
  const which = [
    ...(others.length ? [inArray(a.account.providerId, others)] : []),
    ...(oidc ? [and(eq(a.account.providerId, 'oidc'), sql`starts_with(${a.account.accountId}, ${oidc})`)] : []),
  ]
  if (!which.length) return false
  const rows = await db.select({ n: count() }).from(a.account)
    .innerJoin(a.user, eq(a.user.id, a.account.userId))
    .where(and(or(...which), eq(a.user.role, 'admin'), eq(a.user.banned, false), eq(a.user.status, 'active')))
  return (rows[0]?.n ?? 0) > 0
}

/** Is the session user an active admin? (data from the database, not the session cache) */
export async function isActiveAdmin(id: string): Promise<boolean> {
  const [u] = await db.select({ role: a.user.role, banned: a.user.banned, status: a.user.status }).from(a.user).where(eq(a.user.id, id))
  return u?.role === 'admin' && !u.banned && u.status === 'active'
}

