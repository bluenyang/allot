// Check for spec 018 S-8 (review 5 finding 3): `pnpm db:seed` writes a data file whose subscription names one of the
// file's own accounts as its way of paying, and whose target names one too, into an account that has no rows yet — the
// foreign keys of both hold at once, so the accounts have to be written first.
//   bash scripts/test-server/disposable.sh rc1-g1-seed pnpm exec tsx tests/api/rc1-seed.ts
// It runs only on the throwaway database of disposable.sh (127.0.0.1:15183), as its role (no superuser: row-level
// security applies), and inside one transaction that is rolled back at the end: nothing it makes stays. A fresh account
// is made in that transaction, the seed runs for it twice (the second run gives the same rows), and the rows are read
// back as that account. Made-up values. Exit 0 only if every check passed.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

const url = new URL(process.env.DATABASE_URL ?? 'postgres://missing')
if (url.hostname !== '127.0.0.1' || url.port !== '15183') {
  console.log('FAIL this check writes rows directly: it runs only on the disposable database (127.0.0.1:15183)')
  process.exit(2)
}
const { db, sqlClient } = await import('../../server/db/client')
const { seed } = await import('../../server/db/seed')
const { setUser } = await import('../../server/db/scope')
const t = await import('../../server/db/schema')
const { user } = await import('../../server/db/auth-schema')
type SeedData = Parameters<typeof seed>[0]
type Tx = Parameters<typeof seed>[2]

let failed = 0
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
class Rollback extends Error {}

const run = randomUUID().slice(0, 8)
const uid = randomUUID()
const [acc, tgt, subAcc, subNone] = [`seed-${run}-acc`, `seed-${run}-tgt`, `seed-${run}-sub-acc`, `seed-${run}-sub-none`]
const plan = { category: 'tool', plan: 'Basic', amount: 7_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', path: 'direct', verified: false }
const data = {
  settings: { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 },
  living: { food: 1, transit: 2, allowance: 3 },
  targets: [{ id: tgt, name: 'Seed check subscriptions', kind: 'subscriptions', accountId: acc }],
  subscriptions: [
    { ...plan, id: subAcc, name: 'Seed check, paid from the account', nextDate: '2026-12-05', accountId: acc },
    { ...plan, id: subNone, name: 'Seed check, says nothing', nextDate: '2026-12-20' },
  ],
  planChanges: [], phases: [], events: [], checks: [],
  accounts: [{ id: acc, name: 'Seed check account', role: '', inflow: '', outflow: '' }],
  debts: [], remainderSplit: [],
} as unknown as SeedData

try {
  await db.transaction(async (q) => {
    const tx = q as unknown as Tx & typeof db
    await tx.insert(user).values({ id: uid, email: `seed-${run}@example.com`, name: 'Seed check', emailVerified: true, status: 'active', admission: 'admin' })
    const read = async () => {
      await setUser(tx, uid)
      const subs = await tx.select({ id: t.subscription.id, accountId: t.subscription.accountId, cardId: t.subscription.cardId }).from(t.subscription).where(eq(t.subscription.userId, uid))
      const targets = await tx.select({ id: t.allocationTarget.id, accountId: t.allocationTarget.accountId }).from(t.allocationTarget).where(eq(t.allocationTarget.userId, uid))
      const accounts = await tx.select({ id: t.bankAccount.id }).from(t.bankAccount).where(eq(t.bankAccount.userId, uid))
      return { subs: subs.sort((a, b) => a.id.localeCompare(b.id)), targets, accounts }
    }
    const want = {
      subs: [{ id: subAcc, accountId: acc, cardId: null }, { id: subNone, accountId: null, cardId: null }],
      targets: [{ id: tgt, accountId: acc }],
      accounts: [{ id: acc }],
    }
    const before = await read()
    ok(before.subs.length === 0 && before.accounts.length === 0 && before.targets.length === 0, 'the account has no rows before the seed')
    for (const round of ['the first seed (no rows yet)', 'the second seed (the same file again)']) {
      let error = ''
      // a savepoint: a refused statement must not end the outer transaction before the result is read
      try { await seed(data, uid, tx) } catch (e) { error = String((e as { cause?: unknown }).cause ?? e) }
      ok(error === '', `${round} goes through${error ? ` — ${error}` : ''}`)
      if (error) break
      const got = await read()
      ok(JSON.stringify(got) === JSON.stringify(want), `${round}: the subscription names the account as its way of paying, the other names nothing, the target names the account (${JSON.stringify(got)})`)
    }
    throw new Rollback()
  })
} catch (e) {
  if (!(e instanceof Rollback)) { failed++; console.log(`FAIL threw: ${(e as Error).stack ?? e}`) }
}
const left = await db.select({ id: user.id }).from(user).where(eq(user.id, uid))
ok(left.length === 0, 'nothing stays: the account made for the check is gone with the rollback')
await sqlClient.end()
console.log(failed ? `${failed} check(s) failed` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
