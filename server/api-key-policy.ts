// API key expiry policy (spec 008 S-3): may a key be created without an expiry date?
// defaults (off) ← database (admin screen) ← env ALLOT_API_KEY_NO_EXPIRY; the value says where it came from,
// and a value set by env is locked in the admin screen (like the login methods, server/auth-config.ts).
// Switching on → off gives every key without an expiry one year from that moment.
import { eq, isNull, sql } from 'drizzle-orm'
import { db, type Db } from './db/client'
import * as a from './db/auth-schema'
import * as t from './db/schema'

export type PolicySource = 'default' | 'db' | 'env'
export interface KeyPolicy { noExpiry: boolean; source: PolicySource }

const ROW = 'api_keys'
const ENV = 'ALLOT_API_KEY_NO_EXPIRY'
export const MAX_KEY_DAYS = 365

/** The env value, or undefined when unset or empty. A value that is not true/false is an error at start. */
export function envNoExpiry(raw = process.env[ENV]): boolean | undefined {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return undefined
  if (['true', 'on', '1', 'yes'].includes(v)) return true
  if (['false', 'off', '0', 'no'].includes(v)) return false
  throw new Error(`${ENV}: use true or false, got "${raw}"`)
}

export async function loadKeyPolicy(q: Db = db): Promise<KeyPolicy> {
  const env = envNoExpiry()
  if (env !== undefined) return { noExpiry: env, source: 'env' }
  const [row] = await q.select().from(t.appSetting).where(eq(t.appSetting.id, ROW))
  if (row && typeof row.value.noExpiry === 'boolean') return { noExpiry: row.value.noExpiry, source: 'db' }
  return { noExpiry: false, source: 'default' }
}

/** Give every key without an expiry date one year from now. Returns how many keys it changed. */
export async function applyExpiryCap(q: Db = db): Promise<number> {
  const rows = await q.update(a.apikey)
    .set({ expiresAt: sql`now() + interval '365 days'`, updatedAt: new Date() })
    .where(isNull(a.apikey.expiresAt)).returning({ id: a.apikey.id })
  return rows.length
}

/** Admin screen: store the setting. When it is off afterwards, cap the keys in the same transaction. */
export async function saveNoExpiry(noExpiry: boolean, by: string): Promise<number> {
  return db.transaction(async (tx) => {
    const q = tx as unknown as Db
    const value = { noExpiry }
    await q.insert(t.appSetting).values({ id: ROW, value, updatedBy: by })
      .onConflictDoUpdate({ target: t.appSetting.id, set: { value, updatedAt: new Date(), updatedBy: by } })
    return noExpiry ? 0 : applyExpiryCap(q)
  })
}

/** Server start: when the effective policy is off, keys without an expiry get their year. */
export async function enforceKeyPolicyAtStart(): Promise<void> {
  const p = await loadKeyPolicy()
  if (p.noExpiry) return
  const n = await db.transaction((tx) => applyExpiryCap(tx as unknown as Db))
  if (n) console.log(`api keys: ${n} key(s) without an expiry date now expire in one year (no-expiry keys are off)`)
}
