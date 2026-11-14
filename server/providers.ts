// External login providers for the auth instance (spec 006 S-1, S-10, S-11).
// Generic OIDC uses only the standard: discovery, authorization code + PKCE, ID token checked
// against the provider's JWKS (issuer, audience, expiry). No provider-specific code: Dex,
// Authentik and Keycloak differ only in settings (scopes, the groups claim).
import type { GenericOAuthConfig } from 'better-auth/plugins/generic-oauth'
import type { AuthConfig } from './auth-config'
import { usable } from './auth-config'

/** The OIDC account key: issuer and subject, so another issuer's subject never matches. */
export const SUBJECT_SEPARATOR = ' ' // cannot appear in an issuer URL
export const oidcAccountKey = (issuer: string, sub: string) => `${issuer}${SUBJECT_SEPARATOR}${sub}`

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }

/** Fetch and check an OIDC discovery document. Throws a short, user-facing reason. */
export async function fetchDiscovery(url: string, production: boolean): Promise<Discovery> {
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new Error('discovery URL에 연결하지 못했어요.')
  }
  if (!res.ok) throw new Error(`discovery URL이 ${res.status}로 답했어요.`)
  let d: Partial<Discovery>
  try { d = await res.json() as Partial<Discovery> } catch { throw new Error('discovery 응답이 JSON이 아니에요.') }
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof d[k] !== 'string' || !d[k]) throw new Error(`discovery 문서에 ${k}가 없어요.`)
  }
  if (production && !d.issuer!.startsWith('https://')) throw new Error('운영에서는 issuer가 https여야 해요.')
  return d as Discovery
}

interface GithubEmail { email: string; primary: boolean; verified: boolean }
interface GithubProfile { id: number; login: string; name: string | null; email: string | null; avatar_url: string }

/** GitHub profile like Better Auth's own, plus the user's organisation logins (needs read:org). */
async function githubUserInfo(accessToken: string | undefined) {
  if (!accessToken) return null
  const get = async <T>(path: string): Promise<T | null> => {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'allot', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    return r.ok ? (await r.json() as T) : null
  }
  const profile = await get<GithubProfile>('/user')
  if (!profile) return null
  const emails = (await get<GithubEmail[]>('/user/emails')) ?? []
  const orgs = (await get<{ login: string }[]>('/user/orgs?per_page=100')) ?? []
  const email = profile.email ?? (emails.find((e) => e.primary) ?? emails[0])?.email ?? undefined
  return {
    user: {
      id: String(profile.id),
      name: profile.name || profile.login || '',
      email,
      image: profile.avatar_url,
      emailVerified: emails.find((e) => e.email === email)?.verified ?? false,
    },
    data: { ...profile, orgs: orgs.map((o) => o.login) },
  }
}

/** Better Auth socialProviders for GitHub and Google, only those usable now. */
export function socialProviders(cfg: AuthConfig) {
  const out: Record<string, unknown> = {}
  if (usable(cfg, 'github')) {
    const p = cfg.providers.github
    const orgs = p.rules.orgs.length > 0
    out.github = {
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      disableIdTokenSignIn: true,
      // Organisation rules need the membership list: ask for read:org and fetch it ourselves.
      ...(orgs ? { scope: ['read:org'], getUserInfo: (t: { accessToken?: string }) => githubUserInfo(t.accessToken) } : {}),
    }
  }
  if (usable(cfg, 'google')) {
    const p = cfg.providers.google
    out.google = { clientId: p.clientId, clientSecret: p.clientSecret, disableIdTokenSignIn: true, prompt: 'select_account' }
  }
  return out
}

/** genericOAuth config: the one OIDC provider, when usable and its discovery is known. */
export function oidcProviders(cfg: AuthConfig, discovery: Discovery | undefined): GenericOAuthConfig[] {
  if (!usable(cfg, 'oidc') || !discovery) return []
  const p = cfg.providers.oidc
  return [{
    providerId: 'oidc',
    name: p.name,
    discoveryUrl: p.discoveryUrl,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: p.scopes,
    pkce: true,
    requireIdTokenVerification: true,
    accountSubject: ({ profile }) => {
      const sub = (profile as { sub?: unknown }).sub
      if (typeof sub !== 'string' || !sub) throw new Error('OIDC profile has no sub')
      return oidcAccountKey(discovery.issuer, sub)
    },
  }]
}
