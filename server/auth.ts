// Better Auth: email + password, sign-up closed, one account created by the seed.
// Further login and access methods are plugins on this same instance.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
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

export const auth = betterAuth({
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
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: { '/sign-in/email': { window: 60, max: 5 } },
  },
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
  telemetry: { enabled: false },
})

export type Session = typeof auth.$Infer.Session
