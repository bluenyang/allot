import { Hono, type Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { adminRoutes } from './admin-routes'
import { allowedReturn } from './app-login'
import { publicMethods } from './auth-config'
import { keyRoutes } from './keys'
import { mountMcp } from './mcp'
import { CLIENT_IP_HEADER, getAuth, getAuthConfig } from './auth'
import type { AppEnv } from './app-env'
import { routes } from './routes'

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
  if (session.user.status !== 'active') return c.json({ error: '관리자 승인을 기다리고 있어요.', code: 'PENDING_APPROVAL' }, 403)
  c.set('session', session)
  await next()
})

app.get('/me', (c) => c.json({ user: c.get('session').user }))

// spec 006 S-6: a one-time token for a listed app URL, for the signed-in browser (server/app-login.ts).
app.post('/app-login/ticket', async (c) => {
  const body = await c.req.json().catch(() => null) as { returnTo?: unknown } | null
  const to = allowedReturn(body?.returnTo)
  if (!to) return c.json({ error: '등록되지 않은 앱 주소예요.' }, 400)
  const { token } = await getAuth().api.generateOneTimeToken({ headers: c.req.raw.headers })
  const url = new URL(to)
  url.searchParams.set('ott', token)
  return c.json({ url: url.toString() })
})
app.route('/keys', keyRoutes)
app.route('/admin', adminRoutes)
app.route('/', routes)

root.route('/', app)
root.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// Production image: serve the built front end, and index.html for any other path (SPA).
const staticDir = process.env.STATIC_DIR
if (staticDir) {
  root.use('/*', serveStatic({ root: staticDir }))
  root.get('*', serveStatic({ path: `${staticDir}/index.html` }))
}
