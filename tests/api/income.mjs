// API check for spec 014 V-4: the incomes, their receipts and extra income — create, update, delete, the stated rules
// (S-2–S-4: the same rules as the existing fields, and a yearly income names its month), the delete of an income taking
// its receipts and its revert bringing both back, the month's money in /api/state, and isolation from a second user.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/income.mjs
// A is the test account (an admin); B is a second account A creates through the admin API (e2e-… @example.com) and
// deletes at the end. Every row made is removed in `finally`; the
// change history stays, so run it on the throwaway test server only. Exit code 0 only when every check passed.
import { arm, cleanupStep, disarm, failures, ok, settle, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://localhost:15174'
const MARK = 'E2E-income'
const YM = '2090-01'

function client() {
  let cookie = ''
  return async function api(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
}
const A = client()
const B = client()
const made = [] // [client, path, id]
const track = (c, path, r) => { if (r.status === 201 && r.json?.id) made.push([c, path, r.json.id]); return r }
const sa = await A('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
const bEmail = `e2e-income-${Date.now()}@example.com`
const bPw = `e2e-income-${Math.random().toString(36).slice(2)}-Pw1`
const bMade = await A('POST', '/api/auth/admin/create-user', { email: bEmail, password: bPw, name: 'E2E income B', role: 'user' })
const bId = bMade.json?.user?.id
const sb = await B('POST', '/api/auth/sign-in/email', { email: bEmail, password: bPw })
ok(sa.status === 200 && bMade.status === 200 && sb.status === 200, `sign-in A ${sa.status}, create B ${bMade.status}, sign-in B ${sb.status}`)
if (failures()) process.exit(1)

arm()
try {
  const income = (over) => ({ name: MARK, cycle: 'monthly', day: 10, amount: 150000, note: '', ...over })
  const post = (c, path, body) => c('POST', path, body).then((r) => track(c, path, r))

  // create and the stated rules
  const mon = await post(A, '/api/incomes', income({}))
  ok(mon.status === 201 && mon.json.cycle === 'monthly' && mon.json.month === null, `monthly income → ${mon.status} ${JSON.stringify(mon.json)}`)
  const yr = await post(A, '/api/incomes', income({ name: `${MARK}-y`, cycle: 'yearly', month: 1, day: 31, amount: 1000000 }))
  ok(yr.status === 201 && yr.json.month === 1, `yearly income with its month → ${yr.status}`)
  for (const [label, body] of [
    ['yearly without a month', income({ cycle: 'yearly' })],
    ['monthly with a month', income({ month: 3 })],
    ['day 0', income({ day: 0 })],
    ['day 32', income({ day: 32 })],
    ['month 13', income({ cycle: 'yearly', month: 13 })],
    ['negative amount', income({ amount: -1 })],
    ['empty name', income({ name: '  ' })],
    ['an account that does not exist', income({ accountId: 'no-such-account' })],
  ]) {
    const r = await post(A, '/api/incomes', body)
    ok(r.status === 400, `income: ${label} → ${r.status} (want 400)`)
  }
  const upd = await A('PUT', `/api/incomes/${mon.json.id}`, income({ amount: 160000, day: 31 }))
  ok(upd.status === 200 && upd.json.amount === 160000 && upd.json.day === 31, `update income → ${upd.status}`)

  // receipts: several per month add up; null = the salary
  const s1 = await post(A, '/api/income-receipts', { itemId: null, ym: YM, amount: 3000000, date: '2090-01-25', note: MARK })
  const s2 = await post(A, '/api/income-receipts', { itemId: null, ym: YM, amount: 260000, note: MARK })
  const r1 = await post(A, '/api/income-receipts', { itemId: mon.json.id, ym: YM, amount: 120000, note: MARK })
  ok(s1.status === 201 && s2.status === 201 && r1.status === 201 && s2.json.date === null, `three receipts → ${s1.status} ${s2.status} ${r1.status}`)
  for (const [label, body] of [
    ['an income that does not exist', { itemId: 'no-such-income', ym: YM, amount: 1 }],
    ['a bad month', { itemId: null, ym: '2090-13', amount: 1 }],
    ['a bad date', { itemId: null, ym: YM, amount: 1, date: '2090-02-30' }],
    ['a negative amount', { itemId: null, ym: YM, amount: -5 }],
  ]) {
    const r = await post(A, '/api/income-receipts', body)
    ok(r.status === 400, `receipt: ${label} → ${r.status} (want 400)`)
  }
  const ex = await post(A, '/api/income-extras', { date: '2090-01-12', name: MARK, amount: 45000, note: '' })
  ok(ex.status === 201 && ex.json.amount === 45000, `extra income → ${ex.status}`)
  const exBad = await post(A, '/api/income-extras', { date: '2090-01-12', name: '', amount: 1 })
  ok(exBad.status === 400, `extra income without a name → ${exBad.status} (want 400)`)

  // they are in the state
  const st = (await A('GET', '/api/state')).json
  ok(st.incomes.some((x) => x.id === mon.json.id) && st.incomeReceipts.filter((x) => x.note === MARK).length === 3 && st.incomeExtras.some((x) => x.id === ex.json.id),
    'the incomes, receipts and extra are in /api/state')

  // delete an income: its receipts go; the revert brings both back
  const del = await A('DELETE', `/api/incomes/${mon.json.id}`)
  ok(del.status === 204, `delete the monthly income → ${del.status}`)
  const after = (await A('GET', '/api/state')).json
  ok(!after.incomes.some((x) => x.id === mon.json.id) && !after.incomeReceipts.some((x) => x.id === r1.json.id) && after.incomeReceipts.some((x) => x.id === s1.json.id),
    "the income's receipt went with it, the salary's stayed")
  const set = (await A('GET', '/api/changes?limit=1')).json[0]
  const rv = await A('POST', `/api/changes/${set.id}/revert`)
  ok(rv.status === 200 || rv.status === 201, `revert the delete → ${rv.status} ${JSON.stringify(rv.json)}`)
  const back = (await A('GET', '/api/state')).json
  ok(back.incomes.some((x) => x.id === mon.json.id) && back.incomeReceipts.some((x) => x.id === r1.json.id), 'the revert brought the income and its receipt back')

  // isolation: B sees, changes and points at none of it
  const bState = (await B('GET', '/api/state')).json
  ok(![mon.json.id, yr.json.id, s1.json.id, ex.json.id].some((id) => JSON.stringify(bState).includes(id)), "B's state has none of A's income rows")
  for (const [path, body] of [
    [`/api/incomes/${yr.json.id}`, income({ name: 'B' })],
    [`/api/income-receipts/${s1.json.id}`, { itemId: null, ym: YM, amount: 1 }],
    [`/api/income-extras/${ex.json.id}`, { date: '2090-01-12', name: 'B', amount: 1 }],
  ]) {
    const put = await B('PUT', path, body)
    ok(put.status === 404, `B PUT ${path.split('/').slice(0, 3).join('/')}/<A's id> → ${put.status} (want 404)`)
    const d = await B('DELETE', path)
    ok(d.status === 404, `B DELETE ${path.split('/').slice(0, 3).join('/')}/<A's id> → ${d.status} (want 404)`)
  }
  const bPoint = await post(B, '/api/income-receipts', { itemId: yr.json.id, ym: YM, amount: 1 })
  ok(bPoint.status === 400, `B's receipt pointing at A's income → ${bPoint.status} (want 400)`)
  const aStill = (await A('GET', '/api/state')).json
  ok(aStill.incomes.find((x) => x.id === yr.json.id)?.name === `${MARK}-y`, "A's yearly income is unchanged")
} catch (e) {
  threw(e)
} finally {
  disarm()
  // receipts before incomes (a deleted income takes its receipts; a 404 for those is fine)
  const order = (p) => (p.includes('receipts') ? 0 : p.includes('extras') ? 1 : 2)
  for (const [c, path, id] of [...made].sort((x, y) => order(x[1]) - order(y[1]))) {
    await cleanupStep(`delete ${path}/${id}`, async () => {
      const r = await c('DELETE', `${path}/${id}`)
      ok(r.status === 204 || r.status === 404, `cleanup ${path} → ${r.status}`)
    })
  }
  settle()
  if (bId) await cleanupStep('delete B', async () => {
    const r = await A('DELETE', `/api/admin/users/${bId}`, { confirmEmail: bEmail })
    ok(r.status === 200 || r.status === 204, `delete B → ${r.status}`)
  })
  const left = (await A('GET', '/api/state')).json
  ok(!JSON.stringify([left.incomes, left.incomeReceipts, left.incomeExtras]).includes(MARK), 'no E2E-income rows left for A')
}
console.log(failures() ? `FAILED: ${failures()} check(s)` : 'ALL PASS')
process.exit(failures() ? 1 : 0)
