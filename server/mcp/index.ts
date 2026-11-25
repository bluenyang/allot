// POST /api/mcp — the MCP endpoint (spec 008 S-5, S-8; write tools for a write key, spec 009 S-6): Streamable HTTP, stateless,
// JSON responses. `Authorization: Bearer <API key>` is the only way in; a key is no session and
// works nowhere else. Every failure to authenticate is the same 401, whatever the reason, and is
// counted per client address.
// POST /mcp (spec 015 S-6, S-7) — the same endpoint at the root; while external app connections are on it also takes an
// OAuth access token (a JWT this server signed for the resource <BETTER_AUTH_URL>/mcp), and its 401 names the protected
// resource metadata so an MCP client can start the authorization. A token works only while its connection (the user's
// consent for that app) is there: disconnecting refuses it at once, though the JWT has not expired.
import { createHash } from 'node:crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { requireMcpAuth } from '@better-auth/mcp'
import { and } from 'drizzle-orm'
import { getAuth, parseOrigins } from '../auth'
import { ALLOT_SCOPES, effectiveScope, appName, confirmOfScope, mcpResource, oauthOn, publicBase } from '../oauth'
import type { KeyInfo } from '../proposals'

/** The verified token's claims, as the package hands them over. */
type Claims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1]
import { db } from '../db/client'
import * as a from '../db/auth-schema'
import { usableUser } from './account'
import { hostAndOriginOk } from './guard'
import { FailureLimiter } from './limiter'
import { confirmOf } from '../keys'
import { buildMcpServer } from './tools'

/** A request body over this is refused (413). */
export const MAX_BODY = 64 * 1024
const KEY_SCOPE = { mcp: ['read'] }
const failures = new FailureLimiter(20, 600_000)
/** spec 015 S-12: calls per OAuth connection (user and app), as many as a key's (server/auth.ts apiKey rateLimit). */
const appCalls = new FailureLimiter(120, 60_000)

/** The root /mcp's 401 points at its protected resource metadata (RFC 9728) while OAuth is on; /api/mcp's stays as it was. */
const challenge = (withMetadata: boolean, extra = '') =>
  withMetadata ? `Bearer ${extra}resource_metadata="${publicBase()}/.well-known/oauth-protected-resource/mcp"` : 'Bearer'
const unauthorized = (c: Context, withMetadata = false) => c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': challenge(withMetadata) })

/** An OAuth access token is a JWT (three parts); an API key never has a dot. DPoP-bound tokens use the DPoP scheme. */
const looksLikeJwt = (h: string) => /^(Bearer|DPoP) +[\w-]+\.[\w-]+\.[\w-]+$/i.test(h) && h.length <= 8192

/** The owner of a key by its stored form (SHA-256, base64url; the plugin's default hash), without counting a use. */
async function keyOwner(key: string): Promise<string | null> {
  const [row] = await db.select({ owner: a.apikey.referenceId }).from(a.apikey).where(eq(a.apikey.key, createHash('sha256').update(key).digest('base64url')))
  return row?.owner ?? null
}

/** `clientIp` is app.ts's (handed in: app.ts imports this module). `oauth`: the root /mcp, which also takes OAuth tokens. */
async function handle(c: Context, clientIp: (c: Context) => string, oauth = false): Promise<Response> {
  if (c.req.method !== 'POST') return c.json({ error: 'method not allowed' }, 405, { Allow: 'POST' })

  const ip = clientIp(c)
  const wait = failures.blockedFor(ip)
  if (wait) return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': String(wait) })

  const origins = parseOrigins(process.env.TRUSTED_ORIGINS)
  if (!hostAndOriginOk(c.req.header('host'), c.req.header('origin'), { trustedOrigins: origins, publicUrl: process.env.BETTER_AUTH_URL })) {
    return c.json({ error: 'forbidden' }, 403)
  }
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_BODY) return c.json({ error: 'payload too large' }, 413)

  const withMetadata = oauth && oauthOn()
  const header = c.req.header('authorization') ?? ''
  if (withMetadata && looksLikeJwt(header)) return handleOAuth(c, ip)
  const bearer = /^Bearer +(\S{1,256})$/i.exec(header)
  if (!bearer) {
    // the first call of an MCP client that will authorize with OAuth has no token: not counted as a failure then
    if (!(withMetadata && !header)) failures.fail(ip)
    return unauthorized(c, withMetadata)
  }
  const checked = await getAuth().api.verifyApiKey({ body: { key: bearer[1]!, permissions: KEY_SCOPE } })
  if (!checked.valid || !checked.key) {
    // The key itself is fine (the plugin checks the rate last) but used too often: the one answer that
    // is not a plain 401, and only for an account that may use the app. Whoever may not gets the 401.
    if (checked.error?.code === 'RATE_LIMITED') {
      const owner = await keyOwner(bearer[1]!)
      if (owner && (await usableUser(owner))) return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': '60' })
    }
    failures.fail(ip)
    return unauthorized(c, withMetadata)
  }
  const uid = checked.key.referenceId
  if (!(await usableUser(uid))) {
    failures.fail(ip)
    return unauthorized(c, withMetadata)
  }

  const confirm = confirmOf({ permissions: checked.key.permissions, metadata: checked.key.metadata as never })
  return serve(c, c.req.raw, uid, confirm ? { id: checked.key.id, name: checked.key.name ?? '', confirm } : null)
}

/** When an app last called, per connection: written at most once a minute. */
const lastUse = new Map<string, number>()
async function noteUse(uid: string, clientId: string) {
  const k = `${uid} ${clientId}`
  const now = Date.now()
  if (now - (lastUse.get(k) ?? 0) < 60_000) return
  lastUse.set(k, now)
  if (lastUse.size > 10_000) lastUse.delete(lastUse.keys().next().value as string)
  const at = new Date(now)
  await db.insert(a.oauthAppUse).values({ userId: uid, clientId, lastUsedAt: at })
    .onConflictDoUpdate({ target: [a.oauthAppUse.userId, a.oauthAppUse.clientId], set: { lastUsedAt: at } })
}

/**
 * spec 015 S-6, S-7: an OAuth access token. The package checks the signature (this server's keys), the issuer, the
 * audience (<BETTER_AUTH_URL>/mcp), the expiry and a DPoP proof when the token is bound to one. Then Allot checks
 * what a JWT cannot: the connection is still there, the account may use the app, and the call rate.
 */
function handleOAuth(c: Context, ip: string): Promise<Response> {
  const refuse = (status: 401 | 403, extra: string) => c.json({ error: status === 401 ? 'unauthorized' : 'insufficient_scope' }, status, { 'WWW-Authenticate': challenge(true, extra) })
  const verified = requireMcpAuth(getAuth(), async (req: Request, claims: Claims) => {
    const uid = typeof claims.sub === 'string' ? claims.sub : ''
    const clientId = typeof claims.azp === 'string' ? claims.azp : ''
    const [consent] = uid && clientId
      ? await db.select({ scopes: a.oauthConsent.scopes, createdAt: a.oauthConsent.createdAt, name: a.oauthClient.name }).from(a.oauthConsent)
        .innerJoin(a.oauthClient, eq(a.oauthClient.clientId, a.oauthConsent.clientId))
        .where(and(eq(a.oauthConsent.userId, uid), eq(a.oauthConsent.clientId, clientId)))
      : []
    // disconnected (or never connected): the token is refused although it has not expired (S-7)
    // a token from before the connection that is there now (disconnected, then connected again) stays refused (review 1 R1-4)
    const issuedBefore = typeof claims.iat === 'number' && consent && claims.iat < Math.floor(consent.createdAt.getTime() / 1000)
    if (!consent || issuedBefore || !(await usableUser(uid))) return refuse(401, 'error="invalid_token", ')
    // the permission is the narrower of the token's and the connection's now (server/oauth.ts effectiveScope)
    const scope = effectiveScope(typeof claims.scope === 'string' ? claims.scope.split(' ') : [], consent.scopes)
    if (!scope) return refuse(403, `error="insufficient_scope", scope="${ALLOT_SCOPES.join(' ')}", `)
    const wait = appCalls.blockedFor(`${uid} ${clientId}`)
    if (wait) return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': String(wait) })
    appCalls.fail(`${uid} ${clientId}`)
    await noteUse(uid, clientId).catch((e) => console.warn(`mcp: last use not written: ${(e as Error).message}`))
    const confirm = confirmOfScope(scope)
    const key: KeyInfo | null = confirm ? { id: clientId, name: appName({ name: consent.name, clientId }), confirm, source: 'oauth' } : null
    return serve(c, req, uid, key)
  }, { resource: mcpResource(), issuer: publicBase() })
  // every refused token counts as a failure of the address, as a refused key does
  return verified(c.req.raw).then((res) => {
    if (res.status === 401) failures.fail(ip)
    return res
  })
}

/** One server and one transport per request: the user is bound to the request, nothing is shared. */
async function serve(c: Context, req: Request, uid: string, key: KeyInfo | null): Promise<Response> {
  // A key with the write scope also gets the proposal tools (spec 009 S-6); a read key never sees them.
  const server = buildMcpServer(uid, key)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(req)
  } catch (e) {
    console.warn(`mcp: request failed: ${(e as Error).message}`)
    return c.json({ error: 'internal error' }, 500)
  } finally {
    await server.close().catch(() => undefined)
  }
}

/** Register /api/mcp (keys only, as before). Called before the session check in app.ts: a key is not a session. */
export function mountMcp(app: Hono<AppEnv>, clientIp: (c: Context) => string) {
  app.all('/mcp', (c) => handle(c, clientIp))
}

/** Register the root /mcp (spec 015 S-6): the address the connection screen shows. */
export function mountRootMcp(root: Hono, clientIp: (c: Context) => string) {
  root.all('/mcp', (c) => handle(c, clientIp, true))
}
