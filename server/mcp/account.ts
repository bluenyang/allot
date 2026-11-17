// Whether a verified key's owner may use the app right now, shared by the MCP endpoint and the
// proposals (an account that is pending, banned or gone cannot act through a key either).
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import * as a from '../db/auth-schema'

/** The user a verified key belongs to, when that user may use the app: active and not banned. */
export async function usableUser(id: string): Promise<boolean> {
  const [u] = await db.select({ status: a.user.status, banned: a.user.banned, banExpires: a.user.banExpires }).from(a.user).where(eq(a.user.id, id))
  if (!u || u.status !== 'active') return false
  return !(u.banned && (!u.banExpires || u.banExpires.getTime() > Date.now()))
}
