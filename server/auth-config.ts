// Login methods and sign-up policy (spec 006 S-1, S-2): defaults ← database (admin screen) ← env.
// Every field remembers where its value came from; a field set by env is locked in the admin
// screen. With nothing configured only password login is on, and every sign-up is closed.
import { eq } from 'drizzle-orm'
import { decryptField, SYSTEM } from './crypto/keys'
import { db } from './db/client'
import * as t from './db/schema'

export const PROVIDERS = ['password', 'oidc', 'github', 'google'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export type ExternalId = Exclude<ProviderId, 'password'>
export const EXTERNAL: ExternalId[] = ['oidc', 'github', 'google']
export const SIGNUPS = ['closed', 'approval', 'rules'] as const
export type Signup = (typeof SIGNUPS)[number]
export const RULE_KINDS = ['emails', 'groups', 'orgs', 'domains'] as const
export type RuleKind = (typeof RULE_KINDS)[number]
export type Rules = Record<RuleKind, string[]>

/** Which rule kinds a provider can check (emails everywhere). */
export const RULES_OF: Record<ExternalId, RuleKind[]> = {
  oidc: ['emails', 'groups'],
  github: ['emails', 'orgs'],
  google: ['emails', 'domains'],
}

export interface ProviderConfig {
  id: ProviderId
  enabled: boolean
  signup: Signup
  rules: Rules
  /** Shown on the login button. */
  name: string
  clientId: string
  /** Plaintext, in memory only. */
  clientSecret: string
  discoveryUrl: string
  scopes: string[]
  /** OIDC claim that lists the user's groups. */
  groupsClaim: string
}

export type Field = 'enabled' | 'signup' | 'name' | 'clientId' | 'clientSecret' | 'discoveryUrl' | 'scopes' | 'groupsClaim' | `rules.${RuleKind}`
export type Source = 'default' | 'db' | 'env'

export interface AuthConfig {
  providers: Record<ProviderId, ProviderConfig>
  source: Record<ProviderId, Partial<Record<Field, Source>>>
  /** Why an enabled provider cannot be used (it is then treated as off). */
  problems: Partial<Record<ProviderId, string>>
}

const NAMES: Record<ProviderId, string> = { password: '비밀번호', oidc: 'OIDC', github: 'GitHub', google: 'Google' }
const DEFAULT_SCOPES: Record<ProviderId, string[]> = { password: [], oidc: ['openid', 'email', 'profile'], github: [], google: [] }

function defaults(id: ProviderId): ProviderConfig {
  return {
    id, enabled: id === 'password', signup: 'closed', rules: { emails: [], groups: [], orgs: [], domains: [] },
    name: NAMES[id], clientId: '', clientSecret: '', discoveryUrl: '', scopes: DEFAULT_SCOPES[id], groupsClaim: 'groups',
  }
}

const list = (raw: string) => raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
const lowerList = (raw: string) => list(raw).map((s) => s.toLowerCase())

function bool(name: string, raw: string): boolean {
  const v = raw.trim().toLowerCase()
  if (['true', 'on', '1', 'yes'].includes(v)) return true
  if (['false', 'off', '0', 'no'].includes(v)) return false
  throw new Error(`${name}: use true or false, got "${raw}"`)
}

function signupOf(name: string, raw: string): Signup {
  const v = raw.trim().toLowerCase()
  if ((SIGNUPS as readonly string[]).includes(v)) return v as Signup
  throw new Error(`${name}: use one of ${SIGNUPS.join(', ')}, got "${raw}"`)
}

const ENV_RULE: Record<RuleKind, string> = { emails: 'ALLOW_EMAILS', groups: 'ALLOW_GROUPS', orgs: 'ALLOW_ORGS', domains: 'ALLOW_DOMAINS' }

/** Apply the env values for one provider; returns the fields they set. */
function applyEnv(p: ProviderConfig, env: Record<string, string | undefined>): Field[] {
  const pre = `AUTH_${p.id.toUpperCase()}_`
  const get = (k: string) => {
    const v = env[pre + k]
    return v !== undefined && v.trim() !== '' ? v : undefined
  }
  const set: Field[] = []
  const take = <K extends Field>(f: K, k: string, apply: (v: string) => void) => {
    const v = get(k)
    if (v === undefined) return
    apply(v)
    set.push(f)
  }
  take('enabled', 'ENABLED', (v) => { p.enabled = bool(pre + 'ENABLED', v) })
  if (p.id === 'password') return set
  take('signup', 'SIGNUP', (v) => { p.signup = signupOf(pre + 'SIGNUP', v) })
  take('clientId', 'CLIENT_ID', (v) => { p.clientId = v.trim() })
  take('clientSecret', 'CLIENT_SECRET', (v) => { p.clientSecret = v.trim() })
  for (const k of RULES_OF[p.id]) take(`rules.${k}`, ENV_RULE[k], (v) => { p.rules[k] = k === 'groups' || k === 'orgs' ? list(v) : lowerList(v) })
  if (p.id === 'oidc') {
    take('name', 'NAME', (v) => { p.name = v.trim() })
    take('discoveryUrl', 'DISCOVERY_URL', (v) => { p.discoveryUrl = v.trim() })
    take('scopes', 'SCOPES', (v) => { p.scopes = list(v) })
    take('groupsClaim', 'GROUPS_CLAIM', (v) => { p.groupsClaim = v.trim() })
  }
  return set
}

type Row = typeof t.authProvider.$inferSelect

/** Apply one stored row; returns the fields it set. */
async function applyRow(p: ProviderConfig, row: Row): Promise<Field[]> {
  const set: Field[] = []
  if (row.enabled !== null) { p.enabled = row.enabled; set.push('enabled') }
  if (p.id === 'password') return set
  if (row.signup) { p.signup = row.signup as Signup; set.push('signup') }
  for (const k of RULES_OF[p.id]) {
    const v = row.rules?.[k]
    if (Array.isArray(v)) { p.rules[k] = v.map(String); set.push(`rules.${k}`) }
  }
  const o = row.options ?? {}
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() !== '' ? (o[k] as string).trim() : undefined)
  const s1 = str('clientId'); if (s1 !== undefined) { p.clientId = s1; set.push('clientId') }
  if (p.id === 'oidc') {
    const n = str('name'); if (n !== undefined) { p.name = n; set.push('name') }
    const d = str('discoveryUrl'); if (d !== undefined) { p.discoveryUrl = d; set.push('discoveryUrl') }
    const g = str('groupsClaim'); if (g !== undefined) { p.groupsClaim = g; set.push('groupsClaim') }
    if (Array.isArray(o.scopes) && o.scopes.length) { p.scopes = o.scopes.map(String); set.push('scopes') }
  }
  if (row.clientSecretEnc) {
    p.clientSecret = await decryptField(SYSTEM, secretRef(p.id), row.clientSecretEnc)
    set.push('clientSecret')
  }
  return set
}

/** Where a provider's client secret is sealed (AAD). */
export const secretRef = (id: ProviderId) => ({ table: 'auth_provider', column: 'client_secret', row: id })

/** Is the app in production mode (explicit TRUSTED_ORIGINS)? Then discovery must be https. */
const production = () => !!process.env.TRUSTED_ORIGINS?.trim()

/** What stops an enabled provider from working, or undefined. */
export function problemOf(p: ProviderConfig, isProduction = production()): string | undefined {
  if (!p.enabled || p.id === 'password') return undefined
  if (!p.clientId) return 'client id가 없어요.'
  if (!p.clientSecret) return 'client secret이 없어요.'
  if (p.id === 'oidc') {
    if (!p.discoveryUrl) return 'discovery URL이 없어요.'
    let u: URL
    try { u = new URL(p.discoveryUrl) } catch { return 'discovery URL이 URL이 아니에요.' }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !isProduction)) return '운영에서는 discovery URL이 https여야 해요.'
    if (!p.scopes.includes('openid')) return "scope에 'openid'가 있어야 해요."
    if (!p.groupsClaim) return 'group 클레임 이름이 비어 있어요.'
  }
  return undefined
}

/** Load the configuration: defaults ← database ← env. Throws on a malformed env value. */
export async function loadAuthConfig(env: Record<string, string | undefined> = process.env): Promise<AuthConfig> {
  const rows = await db.select().from(t.authProvider)
  const providers = {} as AuthConfig['providers']
  const source = {} as AuthConfig['source']
  const problems: AuthConfig['problems'] = {}
  for (const id of PROVIDERS) {
    const p = defaults(id)
    const src: Partial<Record<Field, Source>> = {}
    const row = rows.find((r) => r.id === id)
    if (row) for (const f of await applyRow(p, row)) src[f] = 'db'
    for (const f of applyEnv(p, env)) src[f] = 'env'
    providers[id] = p
    source[id] = src
    const problem = problemOf(p)
    if (problem) problems[id] = problem
  }
  return { providers, source, problems }
}

/** Is this provider usable right now (on, and nothing missing)? */
export const usable = (cfg: AuthConfig, id: ProviderId) => cfg.providers[id].enabled && !cfg.problems[id]

/** The public list for the login screen: id and display name only. */
export const publicMethods = (cfg: AuthConfig) => PROVIDERS.filter((id) => usable(cfg, id)).map((id) => ({ id, name: cfg.providers[id].name }))

export async function readProviderRow(id: ProviderId) {
  return (await db.select().from(t.authProvider).where(eq(t.authProvider.id, id)))[0]
}
