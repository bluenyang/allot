// spec 006 V-3 (d): data keys in the database and master-key rotation. Run in the api container
// against a throw-away database, one step per process (the master key is read once per process):
//   ALLOT_MASTER_KEY=A                             tsx tests/api/keys.ts seal  /tmp/keys.json
//   ALLOT_MASTER_KEY=B ALLOT_MASTER_KEY_PREVIOUS=A tsx server/index.ts keys:rotate
//   ALLOT_MASTER_KEY=B                             tsx tests/api/keys.ts check /tmp/keys.json
//   any key                                        tsx tests/api/keys.ts cleanup /tmp/keys.json
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { masterKeys } from '../../server/crypto/envelope'
import { decryptField, encryptField, SYSTEM } from '../../server/crypto/keys'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'
import { runMigrations } from '../../server/db/migrate'
import { asUser } from '../../server/db/scope'
import * as t from '../../server/db/schema'

const [mode, file] = process.argv.slice(2)
if (!mode || !file) throw new Error('usage: keys.ts seal|check|cleanup <file>')
const ref = (column: string, row: string) => ({ table: 'test', column, row })
let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`)
  if (!cond) failed++
}

if (mode === 'seal') {
  await runMigrations()
  const uids = [randomUUID(), randomUUID()]
  for (const id of uids) await db.insert(a.user).values({ id, email: `${id}@keys.test`, name: 'keys test' })
  const values = {
    u0: await encryptField(uids[0]!, ref('c', 'r1'), 'user zero secret'),
    u1: await encryptField(uids[1]!, ref('c', 'r1'), 'user one secret'),
    sys: await encryptField(SYSTEM, ref('client_secret', 'oidc'), 'system secret'),
  }
  // a second use reuses the stored key (one row per user)
  await encryptField(uids[0]!, ref('c', 'r2'), 'again')
  const n = await asUser(uids[0]!, (q) => q.select().from(t.userKey).where(eq(t.userKey.userId, uids[0]!)))
  ok(n.length === 1, 'one data key per user')
  // the other user's key is not visible as this user (row-level security; superusers bypass it)
  const [{ superuser }] = await db.execute<{ superuser: boolean }>(sql`select rolsuper as superuser from pg_roles where rolname = current_user`) as never
  const seen = await asUser(uids[0]!, (q) => q.select().from(t.userKey))
  ok(superuser || seen.every((r) => r.userId === uids[0]), `user_key rows visible as user 0: ${seen.length}${superuser ? ' (superuser: RLS not applied, checked in V-16)' : ''}`)
  // cross-owner: user 1's value does not open as user 0
  let crossed = false
  try { await decryptField(uids[0]!, ref('c', 'r1'), values.u1); crossed = true } catch { /* expected */ }
  ok(!crossed, "user 1's value does not open with user 0's key")
  ok(Object.values(values).every((v) => v.startsWith('v1.')), 'sealed values are v1')
  writeFileSync(file, JSON.stringify({ uids, values, kid: masterKeys().current.kid }))
} else if (mode === 'check') {
  const s = JSON.parse(readFileSync(file, 'utf8')) as { uids: string[]; values: Record<string, string>; kid: string }
  const cur = masterKeys().current.kid
  ok(cur !== s.kid, `master key changed (${s.kid} → ${cur})`)
  const kids: string[] = []
  for (const uid of s.uids) {
    const rows = await asUser(uid, (q) => q.select({ kid: t.userKey.kid }).from(t.userKey).where(eq(t.userKey.userId, uid)))
    kids.push(...rows.map((r) => r.kid))
  }
  const sys = await db.select({ kid: t.systemKey.kid }).from(t.systemKey)
  kids.push(...sys.map((r) => r.kid))
  ok(kids.length === 3 && kids.every((k) => k === cur), `every data key wrapped by the current master key: ${kids.join(',')}`)
  ok(await decryptField(s.uids[0]!, ref('c', 'r1'), s.values.u0!) === 'user zero secret', 'user 0 value opens after rotation')
  ok(await decryptField(s.uids[1]!, ref('c', 'r1'), s.values.u1!) === 'user one secret', 'user 1 value opens after rotation')
  ok(await decryptField(SYSTEM, ref('client_secret', 'oidc'), s.values.sys!) === 'system secret', 'system value opens after rotation')
} else if (mode === 'cleanup') {
  const s = JSON.parse(readFileSync(file, 'utf8')) as { uids: string[] }
  for (const uid of s.uids) {
    await asUser(uid, (q) => q.delete(t.userKey).where(eq(t.userKey.userId, uid)))
    await db.delete(a.user).where(eq(a.user.id, uid))
  }
  await db.delete(t.systemKey)
  console.log('cleaned up')
}
await sqlClient.end()
process.exit(failed ? 1 : 0)
