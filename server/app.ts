import { Hono, type Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { adminRoutes } from './admin-routes'
import { allowedReturn } from './app-login'
import { publicMethods } from './auth-config'
import { docsPage } from './docs'
import { keyRoutes } from './keys'
import { oauthAppRoutes } from './oauth-apps'
import { noticeMarkRoutes } from './notice-marks'
import { accountPasswordRoutes } from './account-password'
import { mountMcp, mountRootMcp } from './mcp'
import { oauthOn } from './oauth'
import { CLIENT_IP_HEADER, getAuth, getAuthConfig } from './auth'
import type { AppEnv } from './app-env'
import { routes } from './routes'
import { msg } from './messages'
import { loadPasswordPolicy } from './password-policy'

/**
 * The client IP that the login rate limit counts by (Better Auth reads only CLIENT_IP_HEADER).
 * - TRUSTED_PROXY_IP_HEADER unset: the socket address. Any client-sent header is ignored.
 * - TRUSTED_PROXY_IP_HEADER set (e.g. X-Real-IP behind a reverse proxy, or x-allot-client-ip
 *   behind the Vite dev proxy): that header, last value if it is a list, else the socket address.
 * Set it only when every request reaches the server through that proxy.
 */
export function clientIp(c: Context): string {
  const trusted = process.env.TRUSTED_PROXY_IP_HEADER?.trim()
  if (trusted) {
    const v = c.req.header(trusted)
    const last = v?.split(',').map((s) => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // not running on the Node adapter (e.g. app.request() in tests)
  }
}

// Container healthcheck, outside /api (the dev proxy forwards only /api, so the LAN cannot reach it).
export const root = new Hono()
root.get('/healthz', (c) => c.json({ ok: true }))

// The Hono app, separate from the Node listener so tests can call app.request().
export const app = new Hono<AppEnv>().basePath('/api')

// Better Auth handles /api/auth/* (sign-in, sign-out, get-session; password sign-up is disabled).
// The client IP header is always overwritten here, so a client cannot choose its rate-limit bucket.
app.on(['GET', 'POST'], '/auth/*', (c) => {
  const headers = new Headers(c.req.raw.headers)
  headers.set(CLIENT_IP_HEADER, clientIp(c))
  return getAuth().handler(new Request(c.req.raw, { headers }))
})

// The login screen's list of methods (spec 006 S-1): ids and display names only, no session needed.
app.get('/auth-methods', (c) => c.json({ methods: publicMethods(getAuthConfig()) }))

// The MCP endpoint takes an API key, not a session (spec 008): it sits before the session check.
mountMcp(app, clientIp)

// Everything else under /api needs a session.
app.use('*', async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  // Second layer (spec 006 S-2): a session of an account that is not active never reaches data.
  if (session.user.status !== 'active') return c.json({ error: msg(c, 'pendingApproval'), code: 'PENDING_APPROVAL' }, 403)
  c.set('session', session)
  await next()
})

app.get('/me', (c) => c.json({ user: c.get('session').user }))

// spec 013 S-24: the minimum length of a new password, for any signed-in user (nothing else of the policy).
app.get('/password-policy', async (c) => c.json({ minLength: (await loadPasswordPolicy()).policy.minLength }))

// spec 013 S-21: the API documentation, a page for the signed-in user (server/docs.ts), listing this app's routes.
// No script on it: the policy allows inline styles only.
app.get('/docs', async (c) => c.html(await docsPage(app.routes), 200, {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
}))

// spec 006 S-6: a one-time token for a listed app URL, for the signed-in browser (server/app-login.ts).
app.post('/app-login/ticket', async (c) => {
  const body = await c.req.json().catch(() => null) as { returnTo?: unknown } | null
  const to = allowedReturn(body?.returnTo)
  if (!to) return c.json({ error: msg(c, 'appUnlisted') }, 400)
  const { token } = await getAuth().api.generateOneTimeToken({ headers: c.req.raw.headers })
  const url = new URL(to)
  url.searchParams.set('ott', token)
  return c.json({ url: url.toString() })
})
app.route('/keys', keyRoutes)
app.route('/oauth-apps', oauthAppRoutes)
app.route('/notices/marks', noticeMarkRoutes)
app.route('/account/password', accountPasswordRoutes)
app.route('/admin', adminRoutes)
app.route('/', routes)

root.route('/', app)
root.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// spec 015 S-2, S-6: the OAuth discovery documents and the MCP endpoint at the root, where MCP clients look
// for them. Better Auth serves them (the issuer is the origin: server/auth.ts); while external app connections
// are off they are 404. Before the front end's files and the SPA fallback.
const forwardToAuth = (c: Context) => {
  if (!oauthOn()) return c.json({ error: 'not found' }, 404)
  const headers = new Headers(c.req.raw.headers)
  headers.set(CLIENT_IP_HEADER, clientIp(c))
  return getAuth().handler(new Request(c.req.raw, { headers }))
}
root.on(['GET', 'HEAD'], '/.well-known/oauth-protected-resource', forwardToAuth)
root.on(['GET', 'HEAD'], '/.well-known/oauth-protected-resource/mcp', forwardToAuth)
root.on(['GET', 'HEAD'], '/.well-known/oauth-authorization-server', forwardToAuth)
root.on(['GET', 'HEAD'], '/.well-known/openid-configuration', forwardToAuth)
root.all('/.well-known/*', (c) => c.json({ error: 'not found' }, 404))
mountRootMcp(root, clientIp)

// spec 015, review 1 R1-3: the OAuth sign-in and consent screens are never shown inside another site's frame
// (their Allow button must not be clickjacked). Only these paths: framing elsewhere is unchanged.
root.use('/oauth/*', async (c, next) => {
  await next()
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
  c.header('X-Frame-Options', 'DENY')
})

// Production image: serve the built front end, and index.html for any other path (SPA).
const staticDir = process.env.STATIC_DIR
if (staticDir) {
  root.use('/*', serveStatic({ root: staticDir }))
  root.get('*', serveStatic({ path: `${staticDir}/index.html` }))
}
