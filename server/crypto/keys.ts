// Data keys in the database and field encryption on top of envelope.ts (spec 006 S-5).
// A user's data key is read and created as that user (row-level security on user_key); the
// system key (provider client secrets) has no owner. Data keys are cached in memory, unwrapped.
import { eq, sql } from 'drizzle-orm'
import { db, type Db } from '../db/client'
import { asUser } from '../db/scope'
import * as t from '../db/schema'
import { fieldAad, kidOfSealed, masterKeys, newDataKey, open, seal, unwrapDataKey, wrapDataKey, type FieldRef } from './envelope'

export const SYSTEM = 'system'
const SYSTEM_KEY_ID = 'default'

const cache = new Map<string, { id: string; key: Buffer }>()

/** For tests and key rotation: forget cached data keys. */
export const clearKeyCache = () => cache.clear()

/** A deleted user's data key must not linger in memory. */
export const forgetUserKey = (uid: string) => cache.delete(uid)

async function userDek(uid: string): Promise<{ id: string; key: Buffer }> {
  const hit = cache.get(uid)
  if (hit) return hit
  const mk = masterKeys()
  const dek = await asUser(uid, async (q) => {
    const [row] = await q.select().from(t.userKey).where(eq(t.userKey.userId, uid))
    if (row) return { id: row.dekId, key: unwrapDataKey(mk, uid, row.dekId, row.wrapped) }
    const fresh = newDataKey()
    const w = wrapDataKey(mk, uid, fresh.id, fresh.key)
    // Two first uses at once: the second insert does nothing and the stored key wins.
    await q.insert(t.userKey).values({ userId: uid, dekId: fresh.id, kid: w.kid, wrapped: w.wrapped }).onConflictDoNothing()
    const [stored] = await q.select().from(t.userKey).where(eq(t.userKey.userId, uid))
    return { id: stored!.dekId, key: unwrapDataKey(mk, uid, stored!.dekId, stored!.wrapped) }
  })
  cache.set(uid, dek)
  return dek
}

async function systemDek(): Promise<{ id: string; key: Buffer }> {
  const hit = cache.get(SYSTEM)
  if (hit) return hit
  const mk = masterKeys()
  const read = async () => (await db.select().from(t.systemKey).where(eq(t.systemKey.id, SYSTEM_KEY_ID)))[0]
  let row = await read()
  if (!row) {
    const fresh = newDataKey()
    const w = wrapDataKey(mk, SYSTEM, fresh.id, fresh.key)
    // Two first uses at once: the second insert does nothing and the stored key wins.
    await db.insert(t.systemKey).values({ id: SYSTEM_KEY_ID, dekId: fresh.id, kid: w.kid, wrapped: w.wrapped }).onConflictDoNothing()
    row = await read()
  }
  const dek = { id: row!.dekId, key: unwrapDataKey(mk, SYSTEM, row!.dekId, row!.wrapped) }
  cache.set(SYSTEM, dek)
  return dek
}

const dekFor = (owner: string) => (owner === SYSTEM ? systemDek() : userDek(owner))

/** Encrypt one field value for `owner` (a user id, or SYSTEM). */
export async function encryptField(owner: string, f: FieldRef, plain: string): Promise<string> {
  const dek = await dekFor(owner)
  return seal(dek.key, dek.id, plain, fieldAad(owner, f))
}

/** Decrypt one field value sealed by encryptField for the same owner and place. */
export async function decryptField(owner: string, f: FieldRef, sealed: string): Promise<string> {
  const dek = await dekFor(owner)
  return open((kid) => (kid === dek.id ? dek.key : undefined), sealed, fieldAad(owner, f)).toString('utf8')
}

/** Is this value already sealed (format v1)? */
export function isSealed(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    kidOfSealed(v)
    return true
  } catch {
    return false
  }
}

/**
 * Re-wrap every data key with the current master key (`pnpm keys:rotate`). Field values are not
 * touched: they are sealed by data keys, which do not change. Returns the number of keys re-wrapped.
 */
export async function rotateDataKeys(q: Db = db): Promise<{ users: number; system: number }> {
  const mk = masterKeys()
  let users = 0
  let system = 0
  // user_key is behind row-level security: list the accounts, then read each key as its owner.
  const owners = await q.execute<{ id: string }>(sql`select id from "user"`)
  for (const { id: uid } of owners) {
    await asUser(uid, async (tx) => {
      const [row] = await tx.select().from(t.userKey).where(eq(t.userKey.userId, uid)).for('update')
      if (!row || row.kid === mk.current.kid) return
      const dek = unwrapDataKey(mk, uid, row.dekId, row.wrapped)
      const w = wrapDataKey(mk, uid, row.dekId, dek)
      await tx.update(t.userKey).set({ kid: w.kid, wrapped: w.wrapped }).where(eq(t.userKey.userId, uid))
      users++
    }, q)
  }
  await q.transaction(async (tx) => {
    const [row] = await tx.select().from(t.systemKey).where(eq(t.systemKey.id, SYSTEM_KEY_ID)).for('update')
    if (!row || row.kid === mk.current.kid) return
    const dek = unwrapDataKey(mk, SYSTEM, row.dekId, row.wrapped)
    const w = wrapDataKey(mk, SYSTEM, row.dekId, dek)
    await tx.update(t.systemKey).set({ kid: w.kid, wrapped: w.wrapped }).where(eq(t.systemKey.id, SYSTEM_KEY_ID))
    system++
  })
  clearKeyCache()
  return { users, system }
}
