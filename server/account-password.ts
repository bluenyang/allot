// Adding a password to an account that signs in with OIDC, GitHub or Google only (spec 016 S-5, S-8), behind the
// session check in app.ts:
//   POST /api/account/password  { newPassword } → { ok: true }
// Better Auth's `setPassword` is server-only; this route is the way to it. It refuses, in this order:
//   409 PASSWORD_OFF        the admin turned password login off (the screen dims the form; the server agrees)
//   403 REAUTH              the session was signed in longer ago than Better Auth's `freshAge` (1 day by default). Better
//                           Auth's setPassword itself only needs a session (sensitiveSessionMiddleware), so the check is here.
//   400 PASSWORD_TOO_SHORT  below the admin's minimum (the auth hook's policy check, server/password-policy.ts)
//   409 PASSWORD_ALREADY_SET the account has a password: change it with the password form instead
// Removing it is the existing unlink of the 'credential' account (S-6), which never removes the last way in.
import { Hono } from 'hono'
import { APIError } from 'better-auth/api'
import type { AppEnv } from './app-env'
import { getAuth, getAuthConfig } from './auth'
import { usable } from './auth-config'
import { body } from './body'
import { msg } from './messages'
import { newPassword as schema } from './validation'

export const accountPasswordRoutes = new Hono<AppEnv>()

const codeOf = (e: unknown) => (e instanceof APIError ? (e.body as { code?: string } | undefined)?.code : undefined)

accountPasswordRoutes.post('/', body(schema), async (c) => {
  // S-8: only while password login is usable (the admin may have turned it off)
  if (!usable(getAuthConfig(), 'password')) return c.json({ error: msg(c, 'passwordOff'), code: 'PASSWORD_OFF' }, 409)
  // S-5: signed in (the session made) within freshAge — the time since sign-in, not since the last use
  const fresh = (await getAuth().$context).sessionConfig.freshAge * 1000
  const signedIn = new Date(c.get('session').session.createdAt).getTime()
  if (fresh > 0 && Date.now() - signedIn >= fresh) return c.json({ error: msg(c, 'passwordReauth'), code: 'REAUTH' }, 403)
  const { newPassword } = c.req.valid('json')
  try {
    await getAuth().api.setPassword({ body: { newPassword }, headers: c.req.raw.headers })
  } catch (e) {
    const code = codeOf(e)
    if (code === 'SESSION_NOT_FRESH') return c.json({ error: msg(c, 'passwordReauth'), code: 'REAUTH' }, 403)
    if (code === 'PASSWORD_ALREADY_SET') return c.json({ error: msg(c, 'passwordAlreadySet'), code }, 409)
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return c.json({ error: (e as APIError).message, code }, 400)
    throw e
  }
  return c.json({ ok: true })
})
