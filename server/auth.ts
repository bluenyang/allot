// Better Auth: email + password, sign-up closed, one account created by the seed.
// v0.2 adds OAuth / passkey / MCP as plugins on this same instance.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from './db/client'
import * as authSchema from './db/auth-schema'

const secret = process.env.BETTER_AUTH_SECRET
if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be set (32+ chars)')

/** Header the Vite proxy sets from the socket address; clients cannot reach the api directly. */
export const CLIENT_IP_HEADER = 'x-allot-client-ip'

export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  // The app is opened by localhost or a LAN address. The Vite proxy keeps the browser's Host
  // (changeOrigin: false), so trust exactly the origin the request was sent to: a page on
  // another site sends a different Origin and is rejected.
  trustedOrigins: (req) => {
    const host = req?.headers.get('host')
    return host ? [`http://${host}`, `https://${host}`] : []
  },
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
