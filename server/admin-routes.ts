// Admin API (spec 006 S-3, S-5, S-8), behind the session check in app.ts and an active-admin check:
//   GET    /api/admin/providers       login methods: values, where each came from, problems
//                                     (client secrets only as { secretSet })
//   PUT    /api/admin/providers/:id   change what env does not set; the auth instance is rebuilt
//   POST   /api/admin/users/:id/role  { role }       — never the last active admin to 'user'
//   POST   /api/admin/users/:id/ban   { reason? }    — not yourself, never the last active admin
//   DELETE /api/admin/users/:id       { confirmEmail } — an account and all its data
// Listing, creation, approval, unban, passwords and sessions go through Better Auth's admin
// plugin at /api/auth/admin/* (guarded in server/admin.ts).
import { and, count, eq, ne, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import { body } from './body'
import { langOf, m, msg, MsgError, text, type Lang, type Msg } from './messages'
import { loadKeyPolicy, saveNoExpiry } from './api-key-policy'
import { adminCanSignInWithout, isActiveAdmin, logAdmin } from './admin'
import type { AppEnv } from './app-env'
import { getAuthConfig, getOidcIssuer, reloadAuth, withAuthLock } from './auth'
import {
  EXTERNAL, PROVIDERS, problemOf, readProviderRow, RULES_OF, secretRef, usable,
  type AuthConfig, type Field, type ProviderConfig, type ProviderId, type RuleKind,
} from './auth-config'
import { encryptField, forgetUserKey, SYSTEM } from './crypto/keys'
import { db, type Db } from './db/client'
import * as a from './db/auth-schema'
import { OWNED } from './db/owned'
import { lockFor, setUser } from './db/scope'
import * as t from './db/schema'
import { fetchDiscovery } from './providers'
import * as v from './validation'

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

export const adminRoutes = new Hono<AppEnv>()

// Checked against the database on every request, not the session's copy of the user.
adminRoutes.use('*', async (c, next) => {
  if (!(await isActiveAdmin(uidOf(c)))) return c.json({ error: msg(c, 'adminOnly') }, 403)
  await next()
})

/** What the admin screen shows for one provider. Never the client secret itself. */
function view(cfg: AuthConfig, id: ProviderId, lang: Lang) {
  const p = cfg.providers[id]
  const { clientSecret, ...values } = p
  return {
    id, values, secretSet: clientSecret !== '', source: cfg.source[id], problem: cfg.problems[id] ? text(lang, cfg.problems[id]) : null,
    usable: usable(cfg, id), ruleKinds: id === 'password' ? [] : RULES_OF[id],
  }
}

adminRoutes.get('/providers', (c) => {
  const cfg = getAuthConfig()
  return c.json({ providers: PROVIDERS.map((id) => view(cfg, id, langOf(c))) })
})

// API key expiry policy (spec 008 S-3): "may a key have no expiry date". env locks it.
adminRoutes.get('/api-keys', async (c) => {
  const p = await loadKeyPolicy()
  return c.json({ noExpiry: p.noExpiry, source: p.source, locked: p.source === 'env' })
})

adminRoutes.put('/api-keys', body(v.keyPolicy), async (c) => {
  const cur = await loadKeyPolicy()
  if (cur.source === 'env') return c.json({ error: msg(c, 'envLocked') }, 409)
  const { noExpiry } = c.req.valid('json')
  const capped = await saveNoExpiry(noExpiry, uidOf(c))
  logAdmin(uidOf(c), `api-keys noExpiry=${noExpiry} capped=${capped}`, 'api_keys')
  const p = await loadKeyPolicy()
  return c.json({ noExpiry: p.noExpiry, source: p.source, locked: p.source === 'env', capped })
})

type Update = z.infer<typeof v.providerUpdate>

/** The fields a request touches, in the configuration's field names (for the env lock). */
function fieldsOf(u: Update): Field[] {
  const f: Field[] = []
  if (u.enabled !== undefined) f.push('enabled')
  if (u.signup !== undefined) f.push('signup')
  for (const k of Object.keys(u.rules ?? {}) as RuleKind[]) f.push(`rules.${k}`)
  for (const k of Object.keys(u.options ?? {})) f.push(k as Field)
  if (u.clientSecret !== undefined) f.push('clientSecret')
  return f
}

/** The provider as it would be after the update. */
function apply(p: ProviderConfig, u: Update): ProviderConfig {
  const next: ProviderConfig = { ...p, rules: { ...p.rules }, scopes: [...p.scopes] }
  if (u.enabled !== undefined) next.enabled = u.enabled
  if (u.signup !== undefined) next.signup = u.signup
  for (const [k, list] of Object.entries(u.rules ?? {}) as [RuleKind, string[]][]) next.rules[k] = [...new Set(list)]
  const o = u.options ?? {}
  if (o.name !== undefined) next.name = o.name
  if (o.clientId !== undefined) next.clientId = o.clientId
  if (o.discoveryUrl !== undefined) next.discoveryUrl = o.discoveryUrl
  if (o.scopes !== undefined) next.scopes = o.scopes
  if (o.groupsClaim !== undefined) next.groupsClaim = o.groupsClaim
  if (u.clientSecret !== undefined) next.clientSecret = u.clientSecret ?? ''
  return next
}

adminRoutes.put('/providers/:id', body(v.providerUpdate), (c) => withAuthLock(async () => {
  // Read, check, write, rebuild and (on failure) restore as one step (review 1, R2).
  const id = c.req.param('id') as ProviderId
  if (!PROVIDERS.includes(id)) return c.json({ error: msg(c, 'providerUnknown') }, 404)
  const u = c.req.valid('json')
  const cfg = getAuthConfig()
  const fields = fieldsOf(u)
  if (!fields.length) return c.json({ error: msg(c, 'nothingToChange') }, 400)
  if (id === 'password' && fields.some((f) => f !== 'enabled')) return c.json({ error: msg(c, 'passwordToggleOnly') }, 400)
  if (id !== 'password') {
    const allowed = new Set(RULES_OF[id])
    const badRule = Object.keys(u.rules ?? {}).find((k) => !allowed.has(k as RuleKind))
    if (badRule) return c.json({ error: msg(c, 'ruleNotAllowed', { id, rule: badRule }), path: `rules.${badRule}` }, 400)
    const oidcOnly = ['name', 'discoveryUrl', 'scopes', 'groupsClaim'] as const
    const badOpt = id !== 'oidc' && oidcOnly.find((k) => u.options?.[k] !== undefined)
    if (badOpt) return c.json({ error: msg(c, 'oidcOnly', { opt: badOpt }), path: `options.${badOpt}` }, 400)
  }
  const locked = fields.filter((f) => cfg.source[id][f] === 'env')
  if (locked.length) return c.json({ error: msg(c, 'envLocked'), fields: locked }, 409)

  const next = apply(cfg.providers[id], u)
  const problem = problemOf(next)
  if (problem) return c.json({ error: text(langOf(c), problem) }, 400)
  // The OIDC issuer after the change: newly discovered when OIDC is the one being changed.
  let issuer = id === 'oidc' ? undefined : getOidcIssuer()
  if (id === 'oidc' && next.enabled) {
    try {
      issuer = (await fetchDiscovery(next.discoveryUrl, !!process.env.TRUSTED_ORIGINS?.trim())).issuer
    } catch (e) {
      return c.json({ error: e instanceof MsgError ? msg(c, e.ref) : (e as Error).message, path: 'options.discoveryUrl' }, 400)
    }
  }
  // An admin must still be able to sign in once the change is made (spec 006 S-11).
  const after = { ...cfg, providers: { ...cfg.providers, [id]: next } }
  const passwordAfter = after.providers.password.enabled
  if (!passwordAfter) {
    const externals = EXTERNAL.filter((x) => after.providers[x].enabled && !problemOf(after.providers[x]))
    if (!(await adminCanSignInWithout(externals, issuer))) {
      return c.json({ error: msg(c, 'passwordOffNoAdmin') }, 409)
    }
  }

  const before = await readProviderRow(id)
  const o = { ...(before?.options ?? {}) } as Record<string, unknown>
  for (const [k, val] of Object.entries(u.options ?? {})) o[k] = val
  const rules = { ...(before?.rules ?? {}) } as Record<string, string[]>
  for (const [k, list] of Object.entries(u.rules ?? {})) rules[k] = [...new Set(list as string[])]
  const row = {
    id,
    enabled: u.enabled ?? before?.enabled ?? null,
    signup: u.signup ?? before?.signup ?? null,
    rules: Object.keys(rules).length ? rules : null,
    options: Object.keys(o).length ? o : null,
    clientSecretEnc: u.clientSecret === undefined ? (before?.clientSecretEnc ?? null)
      : u.clientSecret === null ? null : await encryptField(SYSTEM, secretRef(id), u.clientSecret),
    updatedAt: new Date(),
    updatedBy: uidOf(c),
  }
  await db.insert(t.authProvider).values(row).onConflictDoUpdate({ target: t.authProvider.id, set: row })
  try {
    await reloadAuth()
  } catch (e) {
    // Put the previous settings back; the current instance was never replaced.
    if (before) await db.insert(t.authProvider).values(before).onConflictDoUpdate({ target: t.authProvider.id, set: before })
    else await db.delete(t.authProvider).where(eq(t.authProvider.id, id))
    console.warn(`auth: reload failed, settings for ${id} restored: ${(e as Error).message}`)
    return c.json({ error: msg(c, 'applyFailed') }, 400)
  }
  logAdmin(uidOf(c), `provider ${id} (${fields.join(', ')})`, id)
  return c.json(view(getAuthConfig(), id, langOf(c)))
}))

// ── Changes that can take away an admin: role, ban, delete (review 1, R3) ──
// The check ("not the last active admin", "not yourself") and the change run in one transaction
// under one advisory lock, so two admins demoting each other at the same moment cannot both pass.
// Better Auth's set-role and ban-user are closed (server/admin.ts) so these are the only ways.

class Refused extends MsgError {
  constructor(public status: 400 | 404 | 409, ref: Msg, public path?: string) { super(ref) }
}

/** Run `fn` with the admin lock held, in one transaction. */
function underAdminLock<R>(fn: (q: Db) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Db
    await q.execute(sql`select pg_advisory_xact_lock(hashtext('allot:admins'))`)
    return fn(q)
  })
}

async function targetOf(q: Db, id: string) {
  const [u] = await q.select({ id: a.user.id, email: a.user.email, role: a.user.role, banned: a.user.banned, status: a.user.status })
    .from(a.user).where(eq(a.user.id, id))
  if (!u) throw new Refused(404, m('userMissing'))
  return u
}

/** Refuse when `u` is an active admin and no other active admin would remain. */
async function keepAnAdmin(q: Db, u: { id: string; role: string; banned: boolean; status: string }, why: 'lastAdminDemote' | 'lastAdminBan' | 'lastAdminDelete') {
  if (u.role !== 'admin' || u.banned || u.status !== 'active') return
  const [r] = await q.select({ n: count() }).from(a.user)
    .where(and(eq(a.user.role, 'admin'), eq(a.user.banned, false), eq(a.user.status, 'active'), ne(a.user.id, u.id)))
  if ((r?.n ?? 0) === 0) throw new Refused(409, m(why))
}

const refusal = (c: Context<AppEnv>, e: unknown) => {
  if (e instanceof Refused) return c.json({ error: msg(c, e.ref), ...(e.path ? { path: e.path } : {}) }, e.status)
  throw e
}

adminRoutes.post('/users/:id/role', body(v.userRole), async (c) => {
  const target = c.req.param('id')
  const { role } = c.req.valid('json')
  try {
    await underAdminLock(async (q) => {
      const u = await targetOf(q, target)
      if (u.role === role) return
      if (role === 'user') await keepAnAdmin(q, u, 'lastAdminDemote')
      await q.update(a.user).set({ role, updatedAt: new Date() }).where(eq(a.user.id, target))
    })
  } catch (e) {
    return refusal(c, e)
  }
  logAdmin(uidOf(c), `set-role ${role}`, target)
  return c.json({ ok: true })
})

adminRoutes.post('/users/:id/ban', body(v.userBan), async (c) => {
  const target = c.req.param('id')
  const me = uidOf(c)
  if (target === me) return c.json({ error: msg(c, 'selfBan') }, 409)
  try {
    await underAdminLock(async (q) => {
      const u = await targetOf(q, target)
      await keepAnAdmin(q, u, 'lastAdminBan')
      await q.update(a.user).set({ banned: true, banReason: c.req.valid('json').reason ?? null, banExpires: null, updatedAt: new Date() }).where(eq(a.user.id, target))
      await q.delete(a.session).where(eq(a.session.userId, target)) // signed out everywhere, now
    })
  } catch (e) {
    return refusal(c, e)
  }
  logAdmin(me, 'ban-user', target)
  return c.json({ ok: true })
})

adminRoutes.delete('/users/:id', body(v.userDelete), async (c) => {
  const target = c.req.param('id')
  const me = uidOf(c)
  if (target === me) return c.json({ error: msg(c, 'selfDelete') }, 409)
  try {
    await underAdminLock(async (q) => {
      const u = await targetOf(q, target)
      await keepAnAdmin(q, u, 'lastAdminDelete')
      if (c.req.valid('json').confirmEmail.toLowerCase() !== u.email.toLowerCase()) {
        throw new Refused(400, m('confirmEmail'), 'confirmEmail')
      }
      // Every row of the user (children first), then the account; sessions and logins cascade.
      await setUser(q, target)
      await lockFor(q, 'data', target) // a proposal cannot apply while the data goes
      for (const table of [...OWNED].reverse()) await q.delete(table).where(eq(table.userId, target))
      await q.delete(t.changeLog).where(eq(t.changeLog.userId, target))
      await q.delete(t.changeSet).where(eq(t.changeSet.userId, target))
      await q.delete(t.userKey).where(eq(t.userKey.userId, target))
      await q.delete(a.apikey).where(eq(a.apikey.referenceId, target))
      await q.delete(a.user).where(eq(a.user.id, target))
    })
  } catch (e) {
    return refusal(c, e)
  }
  forgetUserKey(target)
  logAdmin(me, 'delete-user', target)
  return c.body(null, 204)
})
