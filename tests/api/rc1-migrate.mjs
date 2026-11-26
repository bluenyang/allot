// Check for spec 018 S-11 (W-1): the data move of migration 0045 (settings.day_shift → the rule of each date and of
// every schedule item) really writes the rows of every user, under forced row-level security and a role that is not a
// superuser, which is how the app migrates.
//   bash scripts/test-server/disposable.sh rc1-w1-migrate node tests/api/rc1-migrate.mjs
// It works only on the throwaway database of disposable.sh (127.0.0.1:15183) and inside one transaction that is rolled
// back at the end: nothing it makes stays. Three fake accounts are made in that transaction — rule 'before' with two
// schedule items, rule 'after' with one, and one with a schedule item and no settings row — their new columns are left
// at the default, the migration's SQL is run as the file has it, and each account's rows are read back as that
// account. Where day_shift is already dropped (after 0046) the column is put back for the length of the transaction.
// Then the next migration (0046, the drop of day_shift) is run in the same transaction, as the migrator runs the three
// in one, and the rules are read once more.
// Exit 0 only if every check passed.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { failures, ok, threw } from './lib/check.mjs'

const url = new URL(process.env.DATABASE_URL ?? 'postgres://missing')
if (url.hostname !== '127.0.0.1' || url.port !== '15183') {
  console.log('FAIL this check changes the schema inside its transaction: it runs only on the disposable database (127.0.0.1:15183)')
  process.exit(2)
}
const MIGRATION = readFileSync(new URL('../../drizzle/0045_copy_day_shift.sql', import.meta.url), 'utf8')
const DROP = readFileSync(new URL('../../drizzle/0046_drop_day_shift.sql', import.meta.url), 'utf8')
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
class Rollback extends Error {}
const as = (q, uid) => q`select set_config('app.user_id', ${uid}, true)`

try {
  await sql.begin(async (q) => {
    const [role] = await q`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`
    ok(role && !role.rolsuper && !role.rolbypassrls, `the role is no superuser and does not bypass row-level security (${JSON.stringify(role)})`)
    const forced = await q`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('settings', 'schedule_item') order by relname`
    ok(forced.length === 2 && forced.every((r) => r.relrowsecurity && r.relforcerowsecurity), `row-level security is on and forced on settings and schedule_item (${forced.map((r) => r.relname).join(', ')})`)

    const had = (await q`select 1 from information_schema.columns where table_name = 'settings' and column_name = 'day_shift'`).length > 0
    if (!had) await q.unsafe(`alter table "settings" add column "day_shift" text default 'none' not null`)
    console.log(`settings.day_shift ${had ? 'is there' : 'was dropped already: put back for this transaction'}`)

    const users = [
      { id: randomUUID(), rule: 'before', items: 2 },
      { id: randomUUID(), rule: 'after', items: 1 },
      { id: randomUUID(), rule: null, items: 1 }, // a schedule item without a settings row
    ]
    for (const u of users) {
      await q`insert into "user" (id, name, email, email_verified, status, admission) values (${u.id}, 'Migration check', ${`mig-${u.id}@example.com`}, true, 'active', 'admin')`
      await as(q, u.id)
      if (u.rule) await q`insert into settings (user_id, net_pay, fx_rate, fx_buffer, pay_day, transfer_day, billing_day, day_shift) values (${u.id}, 1000000, 1400, 0, 25, 26, 14, ${u.rule})`
      for (let i = 0; i < u.items; i++) await q`insert into schedule_item (user_id, id, name, day, direction) values (${u.id}, ${randomUUID()}, ${`item ${i + 1}`}, ${10 + i}, 'out')`
      const [s] = await q`select pay_shift, transfer_shift, billing_shift from settings where user_id = ${u.id}`
      const items = await q`select shift from schedule_item where user_id = ${u.id}`
      ok((!u.rule || (s.pay_shift === 'none' && s.transfer_shift === 'none' && s.billing_shift === 'none')) && items.length === u.items && items.every((i) => i.shift === 'none'),
        `before the move: account with rule ${u.rule ?? '(no settings row)'} has its new columns at 'none' (${u.items} schedule item(s))`)
    }

    // Without an owner set, this role sees and writes no row: one plain UPDATE over the table would move nothing.
    await as(q, '')
    const blind = await q`update settings set pay_shift = day_shift where day_shift <> 'none'`
    ok(blind.count === 0, `a plain update without an owner writes ${blind.count} rows (row-level security hides them)`)

    await q.unsafe(MIGRATION)
    const [scope] = await q`select current_setting('app.user_id', true) as uid`
    ok((scope.uid ?? '') === '', 'the migration leaves no owner set')

    for (const u of users) {
      await as(q, u.id)
      const want = u.rule ?? 'none'
      const rows = await q`select pay_shift, transfer_shift, billing_shift, day_shift from settings where user_id = ${u.id}`
      const items = await q`select shift from schedule_item where user_id = ${u.id}`
      if (u.rule) {
        const s = rows[0]
        ok(rows.length === 1 && s.pay_shift === want && s.transfer_shift === want && s.billing_shift === want,
          `after the move: rule ${u.rule} → pay ${s?.pay_shift}, transfer ${s?.transfer_shift}, billing ${s?.billing_shift}`)
      } else {
        ok(rows.length === 0, 'after the move: the account without a settings row still has none')
      }
      ok(items.length === u.items && items.every((i) => i.shift === want), `after the move: its ${items.length} schedule item(s) have ${items.map((i) => i.shift).join(', ')} (want ${want})`)
    }
    // every other account of this database (the seeded admin): its rules equal its day_shift too
    const others = await q`select id from "user" where id <> all(${users.map((u) => u.id)})`
    let checked = 0
    for (const o of others) {
      await as(q, o.id)
      const bad = await q`select 1 from settings where user_id = ${o.id} and (pay_shift <> day_shift or transfer_shift <> day_shift or billing_shift <> day_shift)`
      const badItems = await q`select 1 from schedule_item i join settings s on s.user_id = i.user_id where i.user_id = ${o.id} and i.shift <> s.day_shift`
      if (bad.length || badItems.length) ok(false, `an account that was here before has ${bad.length} settings row(s) and ${badItems.length} schedule item(s) that differ from day_shift`)
      checked++
    }
    ok(true, `the ${checked} account(s) that were here before agree with their day_shift too`)

    // the drop that follows, in the same transaction as the rows just written (the migrator applies pending migrations in one)
    await as(q, '')
    await q.unsafe(DROP)
    const gone = (await q`select 1 from information_schema.columns where table_name = 'settings' and column_name = 'day_shift'`).length === 0
    ok(gone, '0046 drops day_shift right after the copy, in the same transaction')
    for (const u of users.filter((x) => x.rule)) {
      await as(q, u.id)
      const [s] = await q`select pay_shift, transfer_shift, billing_shift from settings where user_id = ${u.id}`
      ok(s.pay_shift === u.rule && s.transfer_shift === u.rule && s.billing_shift === u.rule, `after the drop: rule ${u.rule} is still on the three dates`)
    }
    throw new Rollback()
  })
} catch (e) {
  if (!(e instanceof Rollback)) threw(e)
}
const left = await sql`select count(*)::int as n from "user" where email like 'mig-%@example.com'`
ok(left[0].n === 0, `rolled back: ${left[0].n} check account(s) left`)
await sql.end()
console.log(failures() ? `${failures()} check(s) failed` : 'all checks passed')
process.exit(failures() ? 1 : 0)
