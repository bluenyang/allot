// Adding a password to an account that signs in with OIDC, GitHub or Google only (spec 016 S-5, S-8), behind the
// session check in app.ts:
//   POST /api/account/password  { newPassword } → { ok: true }
// Better Auth's `setPassword` is server-only; this route is the way to it. It refuses, in this order:
//   409 PASSWORD_OFF        the admin turned password login off (the screen dims the form; the server agrees)
//   400 PASSWORD_TOO_SHORT  below the admin's minimum (the auth hook's policy check, server/password-policy.ts)
//   403 REAUTH              the session was signed in more than a day ago (Better Auth's freshness, kept as it is)
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
