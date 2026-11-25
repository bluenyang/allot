// External app connections over OAuth (spec 015 S-2–S-12): Allot is the authorization server for its own
// MCP endpoint. The plugins live on the auth instance (server/auth.ts); this module holds what the app adds:
// - the switch (S-10): defaults (off) ← database (admin screen) ← env ALLOT_OAUTH_ENABLED, like the API key
//   policy (server/api-key-policy.ts); a value set by env is locked in the admin screen.
// - where it can run at all: @better-auth/mcp takes an https resource, or http only on a loopback host, so
//   with a LAN http BETTER_AUTH_URL the plugins are not installed and OAuth stays unavailable (keys still work).
// - which of the plugins' HTTP paths are open (S-12): an allow list; client and consent management is closed,
//   the connected-apps screen uses Allot's own routes (server/oauth-apps.ts).
// - the scopes (S-4) and how a scope becomes the key's confirmation method.
import { eq } from 'drizzle-orm'
import { db, type Db } from './db/client'
import * as t from './db/schema'

export type OAuthSource = 'default' | 'db' | 'env'
export interface OAuthPolicy { enabled: boolean; source: OAuthSource }

const ROW = 'oauth'
const ENV = 'ALLOT_OAUTH_ENABLED'

/** The three permissions of the consent screen, narrowest first (S-4), and what they are as a key. */
export const ALLOT_SCOPES = ['allot:read', 'allot:propose', 'allot:apply'] as const
export type AllotScope = (typeof ALLOT_SCOPES)[number]
export const OAUTH_SCOPES = ['openid', 'offline_access', ...ALLOT_SCOPES]
/** As server/keys.ts confirmOf: null = read-only, 'ui' = confirmed on the screen, 'chat' = in the chat. */
export type Confirm = 'ui' | 'chat'
const CONFIRM_OF: Record<AllotScope, Confirm | null> = { 'allot:read': null, 'allot:propose': 'ui', 'allot:apply': 'chat' }

/**
 * The token's permission: the narrowest Allot scope it holds (the consent screen grants exactly one), or
 * undefined when it holds none, which is no access.
 */
export function allotScopeOf(scopes: readonly string[]): AllotScope | undefined {
  return ALLOT_SCOPES.find((s) => scopes.includes(s))
}
/**
 * spec 015 S-7, S-9: what a token may do now: the narrower of what it was given and what the user's connection to that
 * app holds now (read < propose < apply). A later consent can narrow a token at once, never widen it.
 */
export function effectiveScope(token: readonly string[], connection: readonly string[]): AllotScope | undefined {
  const t = allotScopeOf(token)
  const c = allotScopeOf(connection)
  if (!t || !c) return undefined
  return ALLOT_SCOPES[Math.min(ALLOT_SCOPES.indexOf(t), ALLOT_SCOPES.indexOf(c))]
}
/** null = read-only, 'ui' = proposals confirmed on the screen, 'chat' = confirmed in the chat (server/keys.ts confirmOf). */
export const confirmOfScope = (s: AllotScope): Confirm | null => CONFIRM_OF[s]

/** The name an app goes by: its registered name, else the host of its client id when that is a URL (CIMD), else the id. */
export function appName(c: { name: string | null; clientId: string }) {
  if (c.name?.trim()) return c.name.trim()
  try { return new URL(c.clientId).host || c.clientId } catch { return c.clientId }
}

/** May a connection with these granted scopes propose changes (either confirmation method)? */
export const scopesCanWrite = (scopes: readonly string[]) => {
  const s = allotScopeOf(scopes)
  return s === 'allot:propose' || s === 'allot:apply'
}

/** The public origin (BETTER_AUTH_URL without a trailing slash), or '' when unset. */
export const publicBase = (raw = process.env.BETTER_AUTH_URL) => {
  try { return raw ? new URL(raw).origin : '' } catch { return '' }
}
/** The MCP resource that tokens are bound to (S-2). */
export const mcpResource = (base = publicBase()) => `${base}/mcp`

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
/** Can OAuth run with this public URL? The MCP plugin needs https, or http on a loopback host. */
export function oauthPossible(base = publicBase()): boolean {
  if (!base) return false
  const u = new URL(base)
  return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname))
}

/** The env value, or undefined when unset or empty. A value that is not true/false is an error at start. */
export function envOAuthEnabled(raw = process.env[ENV]): boolean | undefined {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return undefined
  if (['true', 'on', '1', 'yes'].includes(v)) return true
  if (['false', 'off', '0', 'no'].includes(v)) return false
  throw new Error(`${ENV}: use true or false, got "${raw}"`)
}

export async function loadOAuthPolicy(q: Db = db): Promise<OAuthPolicy> {
  const env = envOAuthEnabled()
  if (env !== undefined) return { enabled: env, source: 'env' }
  const [row] = await q.select().from(t.appSetting).where(eq(t.appSetting.id, ROW))
  if (row && typeof row.value.enabled === 'boolean') return { enabled: row.value.enabled, source: 'db' }
  return { enabled: false, source: 'default' }
}

// The switch is read on every OAuth path and every /mcp call: kept in memory, loaded at start and on every
// save (one process, like the auth instance).
let current: OAuthPolicy = { enabled: false, source: 'default' }

/** Is OAuth on right now: switched on and possible with this public URL. */
export const oauthOn = () => current.enabled && oauthPossible()
export const oauthPolicy = () => current

export async function initOAuthPolicy() {
  current = await loadOAuthPolicy()
  if (current.enabled && !oauthPossible()) {
    console.warn('WARNING: external app connections (OAuth) are on, but BETTER_AUTH_URL is not https (or http on localhost): they stay unavailable.')
  }
}

/** Admin screen: store the switch. Turning it off takes effect at once: every OAuth token is refused from then on (S-10). */
export async function saveOAuthEnabled(enabled: boolean, by: string): Promise<OAuthPolicy> {
  const value = { enabled }
  await db.insert(t.appSetting).values({ id: ROW, value, updatedBy: by })
    .onConflictDoUpdate({ target: t.appSetting.id, set: { value, updatedAt: new Date(), updatedBy: by } })
  current = await loadOAuthPolicy()
  return current
}

/**
 * The plugins' HTTP paths that are open while OAuth is on (relative to /api/auth). Everything else of the
 * plugins (client CRUD, consent CRUD, secret and key rotation, admin resources) is closed
 * for HTTP; Allot calls what it needs on the server.
 */
const OPEN = new Set([
  '/oauth2/authorize', '/oauth2/consent', '/oauth2/continue', '/oauth2/token', '/oauth2/register',
  '/oauth2/revoke', '/oauth2/introspect', '/oauth2/userinfo', '/oauth2/public-client', '/oauth2/end-session',
  '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/jwks',
])

/** Is this a path of the OAuth plugins (not of the login methods or the API key plugin)? */
export const isOAuthPath = (path: string) =>
  path.startsWith('/oauth2/') || path.startsWith('/admin/oauth2/') || path.startsWith('/.well-known/') || path === '/jwks'

/** May an HTTP request reach this OAuth path now? (Allot's own server calls have no request and are not checked.) */
export const oauthPathOpen = (path: string) => oauthOn() && OPEN.has(path)
