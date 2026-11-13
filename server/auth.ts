// Better Auth. Login and access methods are plugins and options on this instance.
//
// The instance is built from the login-method configuration (server/auth-config.ts: defaults ←
// database ← env). Better Auth fixes its provider list when an instance is created, so when an
// admin saves the configuration, reloadAuth() builds a new instance and swaps it in. Sessions
// live in the database and the secret does not change, so they stay valid across a reload.
// As a second layer, a before-hook checks every sign-in path against the latest configuration.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { loadAuthConfig, usable, type AuthConfig, type ProviderId } from './auth-config'
import { db } from './db/client'
import * as authSchema from './db/auth-schema'

const secret = process.env.BETTER_AUTH_SECRET
if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be set (32+ chars)')

/** TRUSTED_ORIGINS: comma-separated origins (scheme://host[:port]); unset or empty = development behaviour. */
export function parseOrigins(raw: string | undefined): string[] | undefined {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!list.length) return undefined
  for (const o of list) {
    let u: URL
    try { u = new URL(o) } catch { throw new Error(`TRUSTED_ORIGINS: not a URL: ${o}`) }
    if (u.origin !== o.replace(/\/$/, '')) throw new Error(`TRUSTED_ORIGINS: give only scheme://host[:port], got ${o}`)
  }
  return list.map((o) => o.replace(/\/$/, ''))
}
const TRUSTED_ORIGINS = parseOrigins(process.env.TRUSTED_ORIGINS)

/** Header the Vite proxy sets from the socket address; clients cannot reach the api directly. */
export const CLIENT_IP_HEADER = 'x-allot-client-ip'

/** The configuration the current instance was built from (the hook reads the latest one). */
let currentConfig: AuthConfig | undefined

const deny = (code: string, message: string) => APIError.from('FORBIDDEN', { code, message })

/** Which login method a Better Auth path starts or completes, if any. */
function methodOf(ctx: { path: string; body?: unknown; params?: Record<string, string | undefined> }): ProviderId | 'unknown' | undefined {
  if (ctx.path === '/sign-in/email') return 'password'
  if (ctx.path === '/sign-in/social' || ctx.path === '/link-social') {
    const p = (ctx.body as { provider?: unknown } | undefined)?.provider
    return typeof p === 'string' && ['oidc', 'github', 'google'].includes(p) ? (p as ProviderId) : 'unknown'
  }
  if (ctx.path === '/callback/:id') {
    const p = ctx.params?.id
    return p && ['oidc', 'github', 'google'].includes(p) ? (p as ProviderId) : 'unknown'
  }
  return undefined
}

export function buildAuth(cfg: AuthConfig) {
  const password = usable(cfg, 'password')
  return betterAuth({
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    // Production (TRUSTED_ORIGINS set): exactly those origins, nothing derived from the request.
    // Development (unset): the app is opened by localhost or a LAN address and the Vite proxy
    // keeps the browser's Host (changeOrigin: false), so trust the origin the request was sent
    // to; a page on another site sends a different Origin and is rejected.
    trustedOrigins: TRUSTED_ORIGINS ?? ((req) => {
      const host = req?.headers.get('host')
      return host ? [`http://${host}`, `https://${host}`] : []
    }),
    // transaction stays off: hooks write data keys in their own transaction after the user row is committed.
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: { enabled: password, disableSignUp: true, minPasswordLength: 8 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 10 },
      },
    },
    hooks: {
      // Second layer (spec 006 S-1): a method that is off is refused on every path it uses,
      // checked against the latest configuration, also for an instance that is being replaced.
      before: createAuthMiddleware(async (ctx) => {
        const m = methodOf(ctx)
        if (!m) return
        const latest = currentConfig ?? cfg
        if (m === 'unknown' || !usable(latest, m)) throw deny('METHOD_DISABLED', '사용할 수 없는 로그인 방식이에요.')
      }),
    },
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof buildAuth>
export type Session = Auth['$Infer']['Session']

let current: Auth | undefined

/** The current instance. Call initAuth() once before serving. */
export function getAuth(): Auth {
  if (!current) throw new Error('auth is not initialised: call initAuth() first')
  return current
}

/** The configuration of the current instance. */
export function getAuthConfig(): AuthConfig {
  if (!currentConfig) throw new Error('auth is not initialised: call initAuth() first')
  return currentConfig
}

/** Build the instance from the stored and env configuration and wait until it is ready. */
async function build(): Promise<{ auth: Auth; cfg: AuthConfig }> {
  const cfg = await loadAuthConfig()
  const auth = buildAuth(cfg)
  await auth.$context // providers and plugins initialise here; errors surface now
  return { auth, cfg }
}

/** First build at start. Problems with an enabled provider are logged; that provider stays off. */
export async function initAuth() {
  const { auth, cfg } = await build()
  for (const [id, why] of Object.entries(cfg.problems)) console.warn(`WARNING: login method ${id} is enabled but cannot be used: ${why}`)
  current = auth
  currentConfig = cfg
}

/** Rebuild after the configuration changed. On failure the current instance stays and the error is thrown. */
export async function reloadAuth() {
  const { auth, cfg } = await build()
  current = auth
  currentConfig = cfg
}
