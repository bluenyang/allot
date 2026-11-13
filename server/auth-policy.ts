// Sign-up policy, rules, approval and account linking (spec 006 S-2, S-4, S-11).
//
// Better Auth calls user.validateUserInfo with the provider's raw profile whenever an external
// login would create a user, sign one in, or link an account. The decision for a new user is
// kept for this request (by its endpoint context) and applied by user.create.before.
//   create-user  closed → SIGNUP_CLOSED · approval → pending · rules → active, or NOT_ALLOWED
//   sign-in      an account admitted by a rule is checked against the rules again
//   link-account explicit (link-social from the account screen) → allowed; implicit (an
//                existing account found by email) → only an admin-created account that has no
//                login yet, else account_not_linked
// The bootstrap admin (ADMIN_OIDC_SUBJECT) gets in whatever the policy says.
import { APIError, getOAuthState } from 'better-auth/api'
import { eq, sql } from 'drizzle-orm'
import { usable, type AuthConfig, type ExternalId } from './auth-config'
import { db } from './db/client'
import * as a from './db/auth-schema'

export type Status = 'active' | 'pending'
export type Admission = 'seed' | 'admin' | 'approval' | 'rule' | 'bootstrap'
interface Decision { status: Status; admission: Admission; admin?: boolean }

type Profile = Record<string, unknown>
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])

/** Does this login match any of the provider's rules? An empty rule set matches nobody. */
export function ruleMatch(cfg: AuthConfig, id: ExternalId, profile: Profile, email: string | undefined, emailVerified: boolean): boolean {
  const r = cfg.providers[id].rules
  const mail = email?.toLowerCase()
  if (mail && emailVerified && r.emails.includes(mail)) return true
  if (id === 'oidc') {
    const groups = strings(profile[cfg.providers.oidc.groupsClaim])
    if (groups.some((g) => r.groups.includes(g))) return true
  }
  if (id === 'github') {
    const orgs = strings(profile.orgs).map((o) => o.toLowerCase())
    if (orgs.some((o) => r.orgs.map((x) => x.toLowerCase()).includes(o))) return true
  }
  if (id === 'google') {
    const hd = typeof profile.hd === 'string' ? profile.hd.toLowerCase() : undefined
    if (hd && emailVerified && r.domains.includes(hd)) return true
  }
  return false
}

/** ADMIN_OIDC_SUBJECT: the OIDC subject (at the configured issuer) of the first admin. */
const bootstrapSubject = () => process.env.ADMIN_OIDC_SUBJECT?.trim() || undefined

const decisions = new WeakMap<object, Decision>()

type ValidateData = {
  user: { id?: string; email?: string | null; emailVerified?: boolean | null }
  source: { action?: string; method: string; oauth?: { providerId: string; profile?: unknown } }
}

const refuse = (error: string, errorDescription: string) => ({ error, errorDescription })

/** user.validateUserInfo. `getCfg` returns the latest configuration. */
export function makeValidateUserInfo(getCfg: () => AuthConfig) {
  return async (data: ValidateData, ctx: unknown) => {
    const src = data.source
    if (src.method !== 'oauth' || !src.oauth) return // admin create-user; password sign-up is closed
    const id = src.oauth.providerId as ExternalId
    const cfg = getCfg()
    if (!['oidc', 'github', 'google'].includes(id) || !usable(cfg, id)) return refuse('METHOD_DISABLED', '사용할 수 없는 로그인 방식이에요.')
    const profile = (src.oauth.profile ?? {}) as Profile
    const email = data.user.email ?? undefined
    const verified = data.user.emailVerified === true
    const p = cfg.providers[id]

    if (src.action === 'create-user') {
      const sub = bootstrapSubject()
      if (id === 'oidc' && sub && profile.sub === sub) {
        decisions.set(ctx as object, { status: 'active', admission: 'bootstrap', admin: true })
        return
      }
      if (p.signup === 'closed') return refuse('SIGNUP_CLOSED', '이 로그인 방식으로는 새 계정을 만들 수 없어요.')
      if (p.signup === 'approval') {
        decisions.set(ctx as object, { status: 'pending', admission: 'approval' })
        return
      }
      if (!ruleMatch(cfg, id, profile, email, verified)) return refuse('NOT_ALLOWED', '허용된 사용자가 아니에요.')
      decisions.set(ctx as object, { status: 'active', admission: 'rule' })
      return
    }

    const uid = data.user.id
    if (!uid) return refuse('validation_failed', '사용자를 찾을 수 없어요.')
    const [row] = await db.select({ admission: a.user.admission }).from(a.user).where(eq(a.user.id, uid))
    if (!row) return refuse('validation_failed', '사용자를 찾을 수 없어요.')

    if (src.action === 'sign-in') {
      // While the provider admits by rules, an account that came in by a rule keeps needing one.
      if (row.admission === 'rule' && p.signup === 'rules' && !ruleMatch(cfg, id, profile, email, verified)) {
        return refuse('NOT_ALLOWED', '허용된 사용자가 아니에요.')
      }
      return
    }

    if (src.action === 'link-account') {
      const state = await getOAuthState()
      if (state?.link) return // link-social: the signed-in user links their own account
      // Found by email only: allowed for an account the admin created and nobody signed in to yet.
      const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from "account" where "user_id" = ${uid}`) as unknown as [{ n: number }]
      if (row.admission === 'admin' && n === 0) return
      return refuse('account_not_linked', '이미 있는 계정과 연결되어 있지 않아요.')
    }
  }
}

/** user.create.before: status and admission for the new user. */
export function newUserFields(ctx: { path?: string } | null): Decision {
  if (ctx?.path === '/callback/:id') return decisions.get(ctx) ?? { status: 'pending', admission: 'approval' }
  if (ctx?.path === '/admin/create-user') return { status: 'active', admission: 'admin' }
  return { status: 'pending', admission: 'approval' } // anything else starts closed
}

/** user.create.after: the bootstrap admin gets the admin role. */
export async function afterNewUser(user: { id: string }, ctx: { path?: string } | null) {
  if (ctx?.path === '/callback/:id' && decisions.get(ctx)?.admin) {
    await db.update(a.user).set({ role: 'admin' }).where(eq(a.user.id, user.id))
    console.log(`auth: bootstrap admin created from ADMIN_OIDC_SUBJECT (user ${user.id})`)
  }
}

/** session.create.before: an account waiting for approval gets no session. */
export async function refusePending(session: { userId: string }) {
  const [row] = await db.select({ status: a.user.status }).from(a.user).where(eq(a.user.id, session.userId))
  if (row?.status !== 'active') {
    throw APIError.from('FORBIDDEN', { code: 'PENDING_APPROVAL', message: '관리자 승인을 기다리고 있어요.' })
  }
}

/** At start: the ADMIN_EMAIL account, if it exists, is an active admin. Never demotes anyone. */
export async function promoteEnvAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) return
  const done = await db.update(a.user).set({ role: 'admin', status: 'active' })
    .where(eq(a.user.email, email)).returning({ id: a.user.id })
  if (done.length) console.log('auth: ADMIN_EMAIL account is admin')
}
