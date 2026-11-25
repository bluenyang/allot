// Allot's own routes for OAuth connections (spec 015 S-5, S-10), behind the session check in app.ts:
//   GET    /api/oauth-apps/request?q=<signed query>  the consent screen: which app asks, where it goes back, which
//                                                    permissions it asked for. The query is the one the
//                                                    authorization endpoint signed; a bad signature is a 400.
//   GET    /api/oauth-apps                            the signed-in user's connected apps
//   DELETE /api/oauth-apps/:clientId                  disconnect one: its consent, refresh tokens and access
//                                                    tokens go; the next /mcp call with its token is a 401 (S-7)
// The plugin's own client and consent paths are closed for HTTP (server/oauth.ts). Auth tables have no row-level
// security: every query here is filtered by the session's user id.
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from './app-env'
import { db } from './db/client'
import * as a from './db/auth-schema'
import { msg } from './messages'
import { ALLOT_SCOPES, allotScopeOf, appName, oauthOn, type AllotScope } from './oauth'

export const oauthAppRoutes = new Hono<AppEnv>()

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const hostOf = (uri: string) => { try { return new URL(uri).host } catch { return '' } }
const isLoopback = (uri: string) => { try { return LOOPBACK.has(new URL(uri).hostname) } catch { return false } }

oauthAppRoutes.get('/request', async (c) => {
  const q = c.req.query('q') ?? ''
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  if (!q || !(await verifyOAuthQueryParams(q, secret).catch(() => false))) return c.json({ error: msg(c, 'oauthRequestBad') }, 400)
  const p = new URLSearchParams(q)
  const clientId = p.get('client_id') ?? ''
  const [client] = await db.select({ clientId: a.oauthClient.clientId, name: a.oauthClient.name, redirectUris: a.oauthClient.redirectUris, disabled: a.oauthClient.disabled })
    .from(a.oauthClient).where(eq(a.oauthClient.clientId, clientId))
  if (!client || client.disabled) return c.json({ error: msg(c, 'oauthRequestBad') }, 400)
  const redirectUri = p.get('redirect_uri') ?? client.redirectUris[0] ?? ''
  const scopes = (p.get('scope') ?? '').split(' ').filter(Boolean)
  const requested = ALLOT_SCOPES.filter((s) => scopes.includes(s))
  return c.json({
    clientId: client.clientId,
    name: appName(client),
    redirectHost: hostOf(redirectUri),
    redirectUri,
    // S-5: a client that only ever goes back to this machine (CLI apps, or someone pretending to be one)
    localhostOnly: client.redirectUris.length > 0 && client.redirectUris.every(isLoopback),
    requested,
    // granted along with the chosen permission, when the app asked for them (the consent may only narrow the request)
    extra: ['openid', 'offline_access'].filter((x) => scopes.includes(x)),
  })
})

oauthAppRoutes.get('/', async (c) => {
  const uid = c.get('session').user.id
  const rows = await db.select({
    clientId: a.oauthConsent.clientId, scopes: a.oauthConsent.scopes, createdAt: a.oauthConsent.createdAt, updatedAt: a.oauthConsent.updatedAt,
    name: a.oauthClient.name,
  }).from(a.oauthConsent).innerJoin(a.oauthClient, eq(a.oauthClient.clientId, a.oauthConsent.clientId))
    .where(eq(a.oauthConsent.userId, uid))
  const uses = rows.length
    ? await db.select().from(a.oauthAppUse).where(and(eq(a.oauthAppUse.userId, uid), inArray(a.oauthAppUse.clientId, rows.map((r) => r.clientId))))
    : []
  const apps = rows.map((r) => ({
    clientId: r.clientId,
    name: appName(r),
    scope: (allotScopeOf(r.scopes) ?? null) as AllotScope | null,
    connectedAt: r.createdAt.toISOString(),
    lastUsedAt: uses.find((u) => u.clientId === r.clientId)?.lastUsedAt.toISOString() ?? null,
  })).sort((x, y) => y.connectedAt.localeCompare(x.connectedAt))
  // enabled: may an app connect right now (the switch, and a public URL that can carry it)
  return c.json({ enabled: oauthOn(), apps })
})

/** Remove one user's connection to one app: consent, refresh tokens, access tokens, last use. */
export async function disconnect(uid: string, clientId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const gone = await tx.delete(a.oauthConsent).where(and(eq(a.oauthConsent.userId, uid), eq(a.oauthConsent.clientId, clientId))).returning({ id: a.oauthConsent.id })
    // access tokens first: they point at the refresh tokens
    await tx.delete(a.oauthAccessToken).where(and(eq(a.oauthAccessToken.userId, uid), eq(a.oauthAccessToken.clientId, clientId)))
    await tx.delete(a.oauthRefreshToken).where(and(eq(a.oauthRefreshToken.userId, uid), eq(a.oauthRefreshToken.clientId, clientId)))
    await tx.delete(a.oauthAppUse).where(and(eq(a.oauthAppUse.userId, uid), eq(a.oauthAppUse.clientId, clientId)))
    return gone.length > 0
  })
}

oauthAppRoutes.delete('/:clientId', async (c) => {
  const uid = c.get('session').user.id
  if (!(await disconnect(uid, c.req.param('clientId')))) return c.json({ error: msg(c, 'oauthAppNotFound') }, 404)
  return c.json({ ok: true })
})
