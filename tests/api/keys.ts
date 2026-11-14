// spec 006 V-3 (d), V-16 and review 1 R6/R7: data keys in the database, master-key rotation,
// row-level security on user_key, and losing a master key. Run in the api container against a
// throw-away database, one step per process (the master key is read once per process):
//   ALLOT_MASTER_KEY=A                             tsx tests/api/keys.ts seal  /tmp/keys.json
//   ALLOT_MASTER_KEY=B ALLOT_MASTER_KEY_PREVIOUS=A tsx server/index.ts keys:rotate
//   ALLOT_MASTER_KEY=B                             tsx tests/api/keys.ts check /tmp/keys.json
//   ALLOT_MASTER_KEY=C                             tsx tests/api/keys.ts lost  /tmp/keys.json   (A and B lost)
//   any key                                        tsx tests/api/keys.ts cleanup /tmp/keys.json
// The row-level-security check needs a role that is not a superuser (DATABASE_URL); as a
// superuser it reports BLOCKED and the step fails — RLS is never checked by superusers.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { loadAuthConfig, secretRef } from '../../server/auth-config'
import { masterKeys } from '../../server/crypto/envelope'
import { decryptField, encryptField, forgetLostKeys, SYSTEM } from '../../server/crypto/keys'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'
import { runMigrations } from '../../server/db/migrate'
import { asUser } from '../../server/db/scope'
import * as t from '../../server/db/schema'

const [mode, file] = process.argv.slice(2)
if (!mode || !file) throw new Error('usage: keys.ts seal|check|lost|cleanup <file>')
const ref = (column: string, row: string) => ({ table: 'test', column, row })
let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
type Saved = { uids: string[]; values: Record<string, string>; kid: string }

if (mode === 'seal') {
  await runMigrations()
  const uids = [randomUUID(), randomUUID()]
  for (const id of uids) await db.insert(a.user).values({ id, email: `${id}@keys.test`, name: 'keys test' })
  const values = {
    u0: await encryptField(uids[0]!, ref('c', 'r1'), 'user zero secret'),
    u1: await encryptField(uids[1]!, ref('c', 'r1'), 'user one secret'),
    sys: await encryptField(SYSTEM, ref('client_secret', 'oidc'), 'system secret'),
  }
  // a stored client secret for a provider that is on (for the lost-key step)
  const gh = await encryptField(SYSTEM, secretRef('github'), 'github secret')
  await db.insert(t.authProvider).values({ id: 'github', enabled: true, options: { clientId: 'keys-test' }, clientSecretEnc: gh })
  // an external login of user 0 with sealed tokens (cleared by the lost-key step)
  await db.insert(a.account).values({ id: randomUUID(), userId: uids[0]!, providerId: 'github', accountId: '1', accessToken: await encryptField(uids[0]!, ref('access_token', 'github/1'), 'token') })
  // a second use reuses the stored key (one row per user)
  await encryptField(uids[0]!, ref('c', 'r2'), 'again')
  const n = await asUser(uids[0]!, (q) => q.select().from(t.userKey).where(eq(t.userKey.userId, uids[0]!)))
  ok(n.length === 1, 'one data key per user')
  // the other user's key is not visible as this user (row-level security)
  const [{ superuser }] = await db.execute<{ superuser: boolean }>(sql`select rolsuper as superuser from pg_roles where rolname = current_user`) as never
  if (superuser) {
    ok(false, 'BLOCKED: row-level security on user_key cannot be checked as a superuser; run with a non-superuser DATABASE_URL')
  } else {
    const seen = await asUser(uids[0]!, (q) => q.select().from(t.userKey))
    ok(seen.length === 1 && seen[0]!.userId === uids[0], `user_key rows visible as user 0: ${seen.length} (want only its own)`)
    const none = await db.select().from(t.userKey)
    ok(none.length === 0, `user_key rows visible without a user: ${none.length} (want 0)`)
  }
  // cross-owner: user 1's value does not open as user 0
  let crossed = false
  try { await decryptField(uids[0]!, ref('c', 'r1'), values.u1); crossed = true } catch { /* expected */ }
  ok(!crossed, "user 1's value does not open with user 0's key")
  ok(Object.values(values).every((v) => v.startsWith('v1.')), 'sealed values are v1')
  writeFileSync(file, JSON.stringify({ uids, values, kid: masterKeys().current.kid }))
} else if (mode === 'check') {
  const s = JSON.parse(readFileSync(file, 'utf8')) as Saved
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
  // review 2: forget-lost judges by opening, not by the kid column — a key that opens stays
  await asUser(s.uids[1]!, (q) => q.update(t.userKey).set({ kid: 'deadbeef' }).where(eq(t.userKey.userId, s.uids[1]!)))
  const kept = await forgetLostKeys()
  ok(kept.users === 0 && kept.system === 0, `forget-lost with every key openable (one kid column wrong): ${kept.users}/${kept.system} forgotten (want 0/0)`)
  ok(await decryptField(s.uids[1]!, ref('c', 'r1'), s.values.u1!) === 'user one secret', 'that key still opens its value')
  await asUser(s.uids[1]!, (q) => q.update(t.userKey).set({ kid: cur }).where(eq(t.userKey.userId, s.uids[1]!)))
} else if (mode === 'lost') {
  const s = JSON.parse(readFileSync(file, 'utf8')) as Saved
  // (R6) the configuration still loads: only the provider with the unopenable secret is unusable
  let cfg: Awaited<ReturnType<typeof loadAuthConfig>> | undefined
  try { cfg = await loadAuthConfig({}) } catch (e) { ok(false, `loadAuthConfig threw: ${(e as Error).message}`) }
  ok(!!cfg && !!cfg.problems.github?.includes('풀 수 없어요') && cfg.providers.password.enabled, `config loads; github: ${cfg?.problems.github ?? 'no problem'}`)
  const envSecret = await loadAuthConfig({ AUTH_GITHUB_CLIENT_SECRET: 'from-env' })
  ok(!envSecret.problems.github && envSecret.providers.github.clientSecret === 'from-env', 'an env secret replaces the unopenable one')
  let explained = ''
  try { await encryptField(s.uids[0]!, ref('c', 'r3'), 'x') } catch (e) { explained = (e as Error).message }
  ok(explained.includes('keys:forget-lost'), 'using a lost data key says what to do')
  const n = await forgetLostKeys()
  ok(n.users === 2 && n.system === 1, `forget-lost: ${n.users} user keys, ${n.system} system key (want 2, 1)`)
  const [row] = await db.select({ enc: t.authProvider.clientSecretEnc }).from(t.authProvider).where(eq(t.authProvider.id, 'github'))
  ok(row?.enc === null, 'the stored client secret is cleared')
  const [acc] = await db.select({ tok: a.account.accessToken }).from(a.account).where(eq(a.account.userId, s.uids[0]!))
  ok(acc?.tok === null, "user 0's login token is cleared")
  const again = await encryptField(s.uids[0]!, ref('c', 'r4'), 'new')
  ok(await decryptField(s.uids[0]!, ref('c', 'r4'), again) === 'new', 'a new data key works afterwards')
  const twice = await forgetLostKeys()
  ok(twice.users === 0 && twice.system === 0, 'a second run forgets nothing')
} else if (mode === 'cleanup') {
  const s = JSON.parse(readFileSync(file, 'utf8')) as { uids: string[] }
  for (const uid of s.uids) {
    await asUser(uid, (q) => q.delete(t.userKey).where(eq(t.userKey.userId, uid)))
    await db.delete(a.user).where(eq(a.user.id, uid))
  }
  await db.delete(t.systemKey)
  await db.delete(t.authProvider).where(eq(t.authProvider.id, 'github'))
  console.log('cleaned up')
}
await sqlClient.end()
process.exit(failed ? 1 : 0)
