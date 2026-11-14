// Test helper for spec 006 V-8 (d) (review 1 R7): how many rows each account has, table by table,
// read as that account (row-level security) — after a full delete every count must be 0, and the
// other accounts' counts must be what they were before.
//   tsx tests/api/rows-of.ts <user id> [<user id> …]        → one line per account: total and per table
//   tsx tests/api/rows-of.ts --all > before.json             → every account's counts as JSON
import { eq, getTableName, sql } from 'drizzle-orm'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'
import { OWNED } from '../../server/db/owned'
import { asUser } from '../../server/db/scope'
import * as t from '../../server/db/schema'

const TABLES = [...OWNED, t.changeSet, t.changeLog, t.userKey]

async function countsOf(uid: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await asUser(uid, async (q) => {
    for (const table of TABLES) {
      const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(table as never).where(eq(table.userId, uid))
      out[getTableName(table)] = r?.n ?? 0
    }
  })
  for (const [name, table] of [['user', a.user], ['session', a.session], ['account', a.account]] as const) {
    const col = name === 'user' ? a.user.id : (table as typeof a.session).userId
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(col, uid))
    out[name] = r?.n ?? 0
  }
  return out
}

const args = process.argv.slice(2)
if (!args.length) throw new Error('usage: rows-of.ts <user id> … | --all')
if (args[0] === '--all') {
  const users = await db.select({ id: a.user.id }).from(a.user)
  const all: Record<string, Record<string, number>> = {}
  for (const u of users) all[u.id] = await countsOf(u.id)
  console.log(JSON.stringify(all))
} else {
  for (const uid of args) {
    const c = await countsOf(uid)
    const total = Object.values(c).reduce((x, y) => x + y, 0)
    console.log(`${uid} total=${total} ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  }
}
await sqlClient.end()
