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
import { admin } from 'better-auth/plugins/admin'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { ADMIN_CLOSED_PATHS, adminCanSignInWithout, afterAdminPath, guardAdminPath } from './admin'
import { EXTERNAL, loadAuthConfig, usable, type AuthConfig, type ProviderId } from './auth-config'
import { afterNewUser, makeValidateUserInfo, newUserFields, refusePending } from './auth-policy'
import { fetchDiscovery, oidcProviders, socialProviders, type Discovery } from './providers'
import { dropTokenUpdates, sealNewAccountTokens } from './token-crypto'
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

/** Better Auth endpoints that hand out stored provider tokens: nothing uses them in 0.1.2 and the tokens are sealed. */
const CLOSED_PATHS = ['/get-access-token', '/refresh-token', '/account-info']

export function buildAuth(cfg: AuthConfig, discovery?: Discovery) {
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
    user: {
      additionalFields: {
        status: { type: 'string', input: false, required: false, defaultValue: 'pending' },
        admission: { type: 'string', input: false, required: false, defaultValue: 'approval' },
      },
      // Sign-up policy, rules and linking (server/auth-policy.ts), against the latest configuration.
      validateUserInfo: makeValidateUserInfo(() => currentConfig ?? cfg),
    },
    // OAuth errors (SIGNUP_CLOSED, PENDING_APPROVAL, …) go back to the app's login screen.
    onAPIError: { errorURL: `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '')}/` },
    socialProviders: socialProviders(cfg),
    plugins: [
      genericOAuth({ config: oidcProviders(cfg, discovery) }),
      // Roles, bans, admin-created accounts. Impersonation and remove-user are closed (server/admin.ts).
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    ],
    disabledPaths: [...CLOSED_PATHS, ...ADMIN_CLOSED_PATHS],
    account: {
      // Tokens are sealed when an account is linked and never rewritten in clear (token-crypto.ts).
      updateAccountOnSignIn: false,
      accountLinking: {
        enabled: true,
        // No provider is trusted to vouch for an email: an existing account is joined only by
        // the rules in validateUserInfo (link-account), never by a matching email alone.
        trustedProviders: [],
        // Linking from the account screen is the signed-in user's own choice.
        allowDifferentEmails: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (u, ctx) => {
            const { status, admission } = newUserFields(ctx)
            // An account the admin creates is vouched for: its email counts as verified.
            const verified = admission === 'admin' ? { emailVerified: true } : {}
            return { data: { ...u, ...verified, status, admission } }
          },
          after: async (u, ctx) => afterNewUser(u, ctx),
        },
      },
      session: { create: { before: async (s) => { await refusePending(s) } } },
      account: {
        create: { before: async (acc) => ({ data: await sealNewAccountTokens(acc) }) },
        update: { before: async (data) => ({ data: dropTokenUpdates(data) }) },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 10 },
        '/link-social': { window: 60, max: 10 },
        '/callback/*': { window: 60, max: 20 },
      },
    },
    hooks: {
      // Second layer (spec 006 S-1): a method that is off is refused on every path it uses,
      // checked against the latest configuration, also for an instance that is being replaced.
      before: createAuthMiddleware(async (ctx) => {
        await guardAdminPath(ctx)
        if (CLOSED_PATHS.includes(ctx.path)) throw APIError.from('NOT_FOUND', { code: 'NOT_FOUND', message: 'Not found' })
        const m = methodOf(ctx)
        if (!m) return
        // Code flow only: a client-supplied ID token is never a way in.
        if (ctx.path === '/sign-in/social' && (ctx.body as { idToken?: unknown } | undefined)?.idToken) {
          throw deny('ID_TOKEN_SIGN_IN_DISABLED', '이 방식으로는 로그인할 수 없어요.')
        }
        const latest = currentConfig ?? cfg
        if (m === 'unknown' || !usable(latest, m)) throw deny('METHOD_DISABLED', '사용할 수 없는 로그인 방식이에요.')
      }),
      // Admin actions: end sessions after a password reset, one log line per action.
      after: createAuthMiddleware(async (ctx) => {
        await afterAdminPath(ctx as never)
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
  // The OIDC issuer is part of every OIDC account key: without a valid discovery, OIDC stays off.
  let discovery: Discovery | undefined
  if (usable(cfg, 'oidc')) {
    try {
      discovery = await fetchDiscovery(cfg.providers.oidc.discoveryUrl, !!TRUSTED_ORIGINS)
    } catch (e) {
      cfg.problems.oidc = (e as Error).message
    }
  }
  // Password login stays on while no admin could sign in any other way (spec 006 S-11).
  if (!usable(cfg, 'password')) {
    const externals = EXTERNAL.filter((x) => usable(cfg, x))
    if (!(await adminCanSignInWithout(externals))) {
      cfg.providers.password.enabled = true
      delete cfg.problems.password
      console.warn('WARNING: password login is set off, but no active admin has another login method linked: kept on.')
    }
  }
  const auth = buildAuth(cfg, discovery)
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
