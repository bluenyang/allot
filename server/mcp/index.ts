// POST /api/mcp — the read-only MCP endpoint (spec 008 S-5, S-8): Streamable HTTP, stateless,
// JSON responses. `Authorization: Bearer <API key>` is the only way in; a key is no session and
// works nowhere else. Every failure to authenticate is the same 401, whatever the reason, and is
// counted per client address.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { getAuth, parseOrigins } from '../auth'
import { db } from '../db/client'
import * as a from '../db/auth-schema'
import { hostAndOriginOk } from './guard'
import { FailureLimiter } from './limiter'
import { buildMcpServer } from './tools'

/** A request body over this is refused (413). */
export const MAX_BODY = 64 * 1024
const KEY_SCOPE = { mcp: ['read'] }
const failures = new FailureLimiter(20, 600_000)

const unauthorized = (c: Context) => c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })

/** The user a verified key belongs to, when that user may use the app: active and not banned. */
async function usableUser(id: string): Promise<boolean> {
  const [u] = await db.select({ status: a.user.status, banned: a.user.banned, banExpires: a.user.banExpires }).from(a.user).where(eq(a.user.id, id))
  if (!u || u.status !== 'active') return false
  return !(u.banned && (!u.banExpires || u.banExpires.getTime() > Date.now()))
}

/** `clientIp` is app.ts's (handed in: app.ts imports this module). */
async function handle(c: Context, clientIp: (c: Context) => string): Promise<Response> {
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

  const bearer = /^Bearer +(\S{1,256})$/i.exec(c.req.header('authorization') ?? '')
  if (!bearer) {
    failures.fail(ip)
    return unauthorized(c)
  }
  const checked = await getAuth().api.verifyApiKey({ body: { key: bearer[1]!, permissions: KEY_SCOPE } })
  if (!checked.valid || !checked.key) {
    // The key itself is fine but used too often: the one answer that is not a plain 401.
    if (checked.error?.code === 'RATE_LIMITED') return c.json({ error: 'too_many_requests' }, 429, { 'Retry-After': '60' })
    failures.fail(ip)
    return unauthorized(c)
  }
  const uid = checked.key.referenceId
  if (!(await usableUser(uid))) {
    failures.fail(ip)
    return unauthorized(c)
  }

  // One server and one transport per request: the user is bound to the request, nothing is shared.
  const server = buildMcpServer(uid)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  })
  try {
    await server.connect(transport)
    return await transport.handleRequest(c.req.raw)
  } catch (e) {
    console.warn(`mcp: request failed: ${(e as Error).message}`)
    return c.json({ error: 'internal error' }, 500)
  } finally {
    await server.close().catch(() => undefined)
  }
}

/** Register /mcp. Called before the session check in app.ts: a key is not a session. */
export function mountMcp(app: Hono<AppEnv>, clientIp: (c: Context) => string) {
  app.all('/mcp', (c) => handle(c, clientIp))
}
