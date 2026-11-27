// Review 5 finding 3 (spec 018 S-8): a subscription may name an account (or a card) as its way of paying, and a foreign
// key holds it — so `pnpm db:seed` writes the accounts before the subscriptions, also on an empty database, where the
// order of the statements is all there is. No database: the seed runs on drizzle's proxy driver, whose callback only
// records the statements (the foreign key itself is checked on a real database by tests/api/rc1-seed.ts). Made-up values.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'

process.env.DATABASE_URL ??= 'postgres://nobody@127.0.0.1:1/none'
const { seed } = await import('../../server/db/seed')
type SeedData = Parameters<typeof seed>[0]
type Tx = Parameters<typeof seed>[2]

const data = {
  settings: { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 },
  living: { food: 1, transit: 2, allowance: 3 },
  targets: [{ id: 't-subs', name: 'Subscriptions', kind: 'subscriptions', accountId: 'a-pay' }],
  subscriptions: [
    { id: 's-acc', name: 'Paid from an account', category: 'tool', plan: 'Basic', amount: 7_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-12-05', path: 'direct', verified: false, accountId: 'a-pay' },
    { id: 's-none', name: 'Says nothing', category: 'tool', plan: 'Basic', amount: 5_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-12-20', path: 'direct', verified: false },
  ],
  planChanges: [{ id: 'c-1', subId: 's-acc', effective: '2027-01-05', to: { amount: 9_000 }, note: '' }],
  phases: [], events: [], checks: [],
  accounts: [{ id: 'a-pay', name: 'Paying account', role: '', inflow: '', outflow: '' }],
  debts: [], remainderSplit: [],
} as unknown as SeedData

/** The tables the seed inserts into, in the order of its statements. */
async function inserts() {
  const seen: string[] = []
  const proxy = drizzle(async (sql) => { seen.push(sql); return { rows: [] } })
  // the proxy driver has no transactions: run the body on the same recorder
  const tx: unknown = new Proxy(proxy, { get: (o, k) => (k === 'transaction' ? (fn: (q: unknown) => unknown) => fn(tx) : Reflect.get(o, k)) })
  await seed(data, 'u1', tx as Tx)
  return seen.map((q) => q.match(/^insert into "([a-z_]+)"/)?.[1]).filter((x): x is string => !!x)
}

test('db:seed: the accounts are written before the rows that may name one — a subscription\'s way of paying, a target\'s account', async () => {
  const order = await inserts()
  const at = (table: string) => { const i = order.indexOf(table); assert.notEqual(i, -1, `${table} is written`); return i }
  assert.ok(at('bank_account') < at('subscription'), `bank_account before subscription (${order.join(', ')})`)
  assert.ok(at('bank_account') < at('allocation_target'), 'bank_account before allocation_target')
  // the rest of the order stands: a plan change after its subscription, each table once
  assert.ok(at('subscription') < at('plan_change'), 'subscription before plan_change')
  for (const table of ['bank_account', 'subscription', 'plan_change', 'allocation_target']) assert.equal(order.filter((x) => x === table).length, 1, `${table} once`)
})

test('db:seed: a subscription\'s way of paying goes into the statement as the file has it', async () => {
  const seen: { sql: string; params: unknown[] }[] = []
  const proxy = drizzle(async (sql, params) => { seen.push({ sql, params }); return { rows: [] } })
  const tx: unknown = new Proxy(proxy, { get: (o, k) => (k === 'transaction' ? (fn: (q: unknown) => unknown) => fn(tx) : Reflect.get(o, k)) })
  await seed(data, 'u1', tx as Tx)
  const w = seen.find((q) => q.sql.startsWith('insert into "subscription"'))!
  assert.match(w.sql, /"account_id"/)
  assert.equal(w.params.filter((p) => p === 'a-pay').length, 1, 'the account id of the one subscription that names it')
})
