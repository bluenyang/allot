// Row-level security context. Every query on a user's data runs in a transaction that first
// tells PostgreSQL who the user is; the policies in schema.ts compare user_id with it.
// Without it (no set_config), the policies see null and no row matches: reads are empty,
// writes fail. That is the safe default.
import { sql } from 'drizzle-orm'
import { db, type Db } from './client'

/** Make `uid` the row-level-security user for the rest of the current transaction. */
export const setUser = (q: Db, uid: string) => q.execute(sql`select set_config('app.user_id', ${uid}, true)`)

/** Run `fn` in a transaction (a savepoint if `q` already is one) as `uid`. */
export function asUser<R>(uid: string, fn: (q: Db) => Promise<R>, q: Db = db): Promise<R> {
  return q.transaction(async (tx) => {
    const t = tx as unknown as Db
    await setUser(t, uid)
    return fn(t)
  })
}
