import { Hono } from 'hono'
import { auth } from './auth'
import type { AppEnv } from './app-env'
import { routes } from './routes'

// Container healthcheck, outside /api (Vite proxies only /api, so it is not reachable from the LAN).
export const root = new Hono()
root.get('/healthz', (c) => c.json({ ok: true }))

// The Hono app, separate from the Node listener so tests can call app.request().
export const app = new Hono<AppEnv>().basePath('/api')

// Better Auth handles /api/auth/* (sign-in, sign-out, get-session; sign-up is disabled).
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw))

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
