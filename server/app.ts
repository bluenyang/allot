import { Hono, type Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { auth, CLIENT_IP_HEADER } from './auth'
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

// Better Auth handles /api/auth/* (sign-in, sign-out, get-session; sign-up is disabled).
// The client IP header is always overwritten here, so a client cannot choose its rate-limit bucket.
app.on(['GET', 'POST'], '/auth/*', (c) => {
  const headers = new Headers(c.req.raw.headers)
  headers.set(CLIENT_IP_HEADER, clientIp(c))
  return auth.handler(new Request(c.req.raw, { headers }))
})

// Everything else under /api needs a session.
app.use('*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  c.set('session', session)
  await next()
})

app.get('/me', (c) => c.json({ user: c.get('session').user }))
app.route('/', routes)

root.route('/', app)
root.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

// Production image: serve the built front end, and index.html for any other path (SPA).
const staticDir = process.env.STATIC_DIR
if (staticDir) {
  root.use('/*', serveStatic({ root: staticDir }))
  root.get('*', serveStatic({ path: `${staticDir}/index.html` }))
}
