// Admin API (spec 006 S-3, S-5, S-8), behind the session check in app.ts and an active-admin check:
//   GET    /api/admin/providers       login methods: values, where each came from, problems
//                                     (client secrets only as { secretSet })
//   PUT    /api/admin/providers/:id   change what env does not set; the auth instance is rebuilt
//   DELETE /api/admin/users/:id       delete an account and all its data ({ confirmEmail })
// User listing, creation, approval, roles, bans and passwords go through Better Auth's admin
// plugin at /api/auth/admin/* (guarded in server/admin.ts).
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import { adminCanSignInWithout, assertNotLastAdmin, isActiveAdmin, logAdmin } from './admin'
import type { AppEnv } from './app-env'
import { getAuthConfig, reloadAuth, withAuthLock } from './auth'
import {
  EXTERNAL, PROVIDERS, problemOf, readProviderRow, RULES_OF, secretRef, usable,
  type AuthConfig, type Field, type ProviderConfig, type ProviderId, type RuleKind,
} from './auth-config'
import { encryptField, forgetUserKey, SYSTEM } from './crypto/keys'
import { db, type Db } from './db/client'
import * as a from './db/auth-schema'
import { OWNED } from './db/owned'
import { setUser } from './db/scope'
import * as t from './db/schema'
import { fetchDiscovery } from './providers'
import * as v from './validation'

const body = <S extends z.ZodType>(schema: S) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) {
      const issue = r.error.issues[0]
      return c.json({ error: issue?.message ?? '입력값을 확인해 주세요.', path: issue?.path.join('.') ?? '' }, 400)
    }
  })

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

export const adminRoutes = new Hono<AppEnv>()

// Checked against the database on every request, not the session's copy of the user.
adminRoutes.use('*', async (c, next) => {
  if (!(await isActiveAdmin(uidOf(c)))) return c.json({ error: '관리자만 쓸 수 있어요.' }, 403)
  await next()
})

/** What the admin screen shows for one provider. Never the client secret itself. */
function view(cfg: AuthConfig, id: ProviderId) {
  const p = cfg.providers[id]
  const { clientSecret, ...values } = p
  return {
    id, values, secretSet: clientSecret !== '', source: cfg.source[id], problem: cfg.problems[id] ?? null,
    usable: usable(cfg, id), ruleKinds: id === 'password' ? [] : RULES_OF[id],
  }
}

adminRoutes.get('/providers', (c) => {
  const cfg = getAuthConfig()
  return c.json({ providers: PROVIDERS.map((id) => view(cfg, id)) })
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
  if (!PROVIDERS.includes(id)) return c.json({ error: '없는 로그인 방식이에요.' }, 404)
  const u = c.req.valid('json')
  const cfg = getAuthConfig()
  const fields = fieldsOf(u)
  if (!fields.length) return c.json({ error: '바꿀 항목이 없어요.' }, 400)
  if (id === 'password' && fields.some((f) => f !== 'enabled')) return c.json({ error: '비밀번호는 켜고 끄기만 할 수 있어요.' }, 400)
  if (id !== 'password') {
    const allowed = new Set(RULES_OF[id])
    const badRule = Object.keys(u.rules ?? {}).find((k) => !allowed.has(k as RuleKind))
    if (badRule) return c.json({ error: `${id}에는 ${badRule} 규칙을 쓸 수 없어요.`, path: `rules.${badRule}` }, 400)
    const oidcOnly = ['name', 'discoveryUrl', 'scopes', 'groupsClaim'] as const
    const badOpt = id !== 'oidc' && oidcOnly.find((k) => u.options?.[k] !== undefined)
    if (badOpt) return c.json({ error: `${badOpt}는 OIDC에만 있어요.`, path: `options.${badOpt}` }, 400)
  }
  const locked = fields.filter((f) => cfg.source[id][f] === 'env')
  if (locked.length) return c.json({ error: 'env로 정한 항목은 화면에서 바꿀 수 없어요.', fields: locked }, 409)

  const next = apply(cfg.providers[id], u)
  const problem = problemOf(next)
  if (problem) return c.json({ error: problem }, 400)
  if (id === 'oidc' && next.enabled) {
    try {
      await fetchDiscovery(next.discoveryUrl, !!process.env.TRUSTED_ORIGINS?.trim())
    } catch (e) {
      return c.json({ error: (e as Error).message, path: 'options.discoveryUrl' }, 400)
    }
  }
  // An admin must still be able to sign in once the change is made (spec 006 S-11).
  const after = { ...cfg, providers: { ...cfg.providers, [id]: next } }
  const passwordAfter = after.providers.password.enabled
  if (!passwordAfter) {
    const externals = EXTERNAL.filter((x) => after.providers[x].enabled && !problemOf(after.providers[x]))
    if (!(await adminCanSignInWithout(externals))) {
      return c.json({ error: '비밀번호를 끄면 관리자가 로그인할 방법이 없어요. 관리자 계정에 다른 로그인 방식을 먼저 연결해 주세요.' }, 409)
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
    return c.json({ error: '설정을 적용하지 못했어요. 이전 설정으로 되돌렸어요.' }, 400)
  }
  logAdmin(uidOf(c), `provider ${id} (${fields.join(', ')})`, id)
  return c.json(view(getAuthConfig(), id))
}))

/** Delete every row of `uid` (children first), then the account itself; one transaction. */
async function deleteAccount(uid: string) {
  await db.transaction(async (tx) => {
    const q = tx as unknown as Db
    await setUser(q, uid)
    for (const table of [...OWNED].reverse()) await q.delete(table).where(eq(table.userId, uid))
    await q.delete(t.changeLog).where(eq(t.changeLog.userId, uid))
    await q.delete(t.changeSet).where(eq(t.changeSet.userId, uid))
    await q.delete(t.userKey).where(eq(t.userKey.userId, uid))
    await q.delete(a.user).where(eq(a.user.id, uid)) // sessions and accounts cascade
  })
  forgetUserKey(uid)
}

adminRoutes.delete('/users/:id', body(v.userDelete), async (c) => {
  const target = c.req.param('id')
  const me = uidOf(c)
  if (target === me) return c.json({ error: '자기 자신은 지울 수 없어요.' }, 409)
  const [u] = await db.select({ email: a.user.email }).from(a.user).where(eq(a.user.id, target))
  if (!u) return c.json({ error: '없는 사용자예요.' }, 404)
  try {
    await assertNotLastAdmin(target)
  } catch {
    return c.json({ error: '마지막 관리자는 지울 수 없어요.' }, 409)
  }
  if (c.req.valid('json').confirmEmail.toLowerCase() !== u.email.toLowerCase()) {
    return c.json({ error: '확인 이메일이 그 사용자의 이메일과 달라요.', path: 'confirmEmail' }, 400)
  }
  await deleteAccount(target)
  logAdmin(me, 'delete-user', target)
  return c.body(null, 204)
})
