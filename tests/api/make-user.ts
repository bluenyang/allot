// Test helper (spec 005 V-5): create a second login account directly in the database, the way
// the seed does (sign-up is closed). Never deletes or changes another account.
//   docker compose -f docker/compose.dev.yaml exec -T api pnpm exec tsx tests/api/make-user.ts <email> <password>
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { auth } from '../../server/auth'
import { db, sqlClient } from '../../server/db/client'
import * as a from '../../server/db/auth-schema'

const [email, password] = process.argv.slice(2)
if (!email || !password || password.length < 8) throw new Error('usage: make-user.ts <email> <password (8+)>')
const ctx = await auth.$context
const hash = await ctx.password.hash(password)
const [found] = await db.select({ id: a.user.id }).from(a.user).where(eq(a.user.email, email.toLowerCase()))
if (found) {
  console.log(`exists ${found.id}`)
} else {
  const id = randomUUID()
  // one transaction: never a user without its credential
  await db.transaction(async (q) => {
    await q.insert(a.user).values({ id, email: email.toLowerCase(), name: 'Test', emailVerified: true })
    await q.insert(a.account).values({ id: randomUUID(), userId: id, providerId: 'credential', accountId: id, password: hash })
  })
  console.log(`created ${id}`)
}
await sqlClient.end()
