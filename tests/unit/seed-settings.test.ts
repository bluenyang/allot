// Review 1 finding 3 (spec 018 S-1): `pnpm db:seed` takes a data file written for 0.1.9 — settings with the one rule
// `dayShift` — and writes that rule to each of the three dates, as the API does (`settingsRow`). No database: the seed
// runs on drizzle's proxy driver, whose callback only records the statements. Made-up values.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'

process.env.DATABASE_URL ??= 'postgres://nobody@127.0.0.1:1/none'
const { seed } = await import('../../server/db/seed')
type SeedData = Parameters<typeof seed>[0]
type Tx = Parameters<typeof seed>[2]

const OLD = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const data = (settings: Record<string, unknown>) => ({
  settings, living: { food: 1, transit: 2, allowance: 3 }, targets: [], subscriptions: [], planChanges: [], phases: [], events: [], checks: [],
  accounts: [], debts: [], remainderSplit: [],
}) as unknown as SeedData

/** The statement the seed writes the settings row with, and its parameters. */
async function settingsWrite(settings: Record<string, unknown>) {
  const seen: { sql: string; params: unknown[] }[] = []
  const proxy = drizzle(async (sql, params) => { seen.push({ sql, params }); return { rows: [] } })
  // the proxy driver has no transactions: run the body on the same recorder
  const tx: unknown = new Proxy(proxy, { get: (o, k) => (k === 'transaction' ? (fn: (q: unknown) => unknown) => fn(tx) : Reflect.get(o, k)) })
  await seed(data(settings), 'u1', tx as Tx)
  const writes = seen.filter((q) => q.sql.startsWith('insert into "settings"'))
  assert.equal(writes.length, 1, 'one settings write')
  return writes[0]
}
/** The values the statement puts in the three rule columns on an update (`"pay_shift" = $n` → the parameter). */
function rulesOf(w: { sql: string; params: unknown[] }) {
  const set = w.sql.slice(w.sql.indexOf('do update set'))
  return ['pay_shift', 'transfer_shift', 'billing_shift'].map((c) => {
    const m = set.match(new RegExp(`"${c}" = \\$(\\d+)`))
    return m ? w.params[+m[1] - 1] : undefined
  })
}

test('db:seed: a data file with the old dayShift writes it as the rule of each of the three dates', async () => {
  for (const rule of ['before', 'after', 'none']) {
    const w = await settingsWrite({ ...OLD, dayShift: rule })
    assert.deepEqual(rulesOf(w), [rule, rule, rule], rule)
    assert.equal(/day_shift/.test(w.sql), false, 'day_shift is no column')
    // a new row gets them too: the insert's values hold the rule three times more
    assert.equal(w.params.filter((p) => p === rule).length, 6, 'insert values and update set')
  }
})

test('db:seed: a rule the data file names wins over dayShift; a file with neither leaves the saved rules', async () => {
  assert.deepEqual(rulesOf(await settingsWrite({ ...OLD, dayShift: 'before', transferShift: 'after' })), ['before', 'after', 'before'])
  assert.deepEqual(rulesOf(await settingsWrite({ ...OLD, payShift: 'after', transferShift: 'none', billingShift: 'before' })), ['after', 'none', 'before'])
  const plain = await settingsWrite(OLD)
  assert.deepEqual(rulesOf(plain), [undefined, undefined, undefined], 'the update names no rule, so the saved ones stay')
  assert.match(plain.sql, /"net_pay" = \$\d+/)
})
