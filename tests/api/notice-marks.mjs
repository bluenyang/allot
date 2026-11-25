// API check for spec 016 V-3, V-4 and V-5: the bell's marks per account and adding a password.
//   bash scripts/test-server/disposable.sh notice-marks node tests/api/notice-marks.mjs   (it writes to the database directly)
// A is ADMIN_EMAIL. U, X and the second session are made here and deleted at the end.
//   marks     two sessions of U see the same marks; A sees none of U's; the limits (201 characters, 501 marks → 400;
//             past 2000 the oldest go); MCP list_notifications gives read from A's marks
//   password  X loses its password sign-in (a fake GitHub login keeps it in), adds a password (too short 400, a session
//             signed in two days ago 403, then 200 and the password signs in), a second add is 409, removing it again
//             (unlink) makes the password fail, and the last way in cannot be unlinked
// Exit 0 only if every check passed.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const ACCEPT = 'application/json, text/event-stream'
const sha = (k) => createHash('sha256').update(k).digest('base64url')
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const newKey = () => 'allot_' + Array.from(randomBytes(64), (b) => LETTERS[b % 52]).join('')

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  api.signIn = async (email, password) => {
    // the sign-in limit is 5 a minute per address (knowledge: login-rate-limit-in-tests): wait before the sixth
    if (++signIns % 5 === 0) await new Promise((r) => setTimeout(r, 61_000))
    return api('POST', '/api/auth/sign-in/email', { email, password })
  }
  return api
}
let signIns = 0

const made = []
const createUser = async (A, tag, password) => {
  const email = `nm-${tag}-${Date.now()}@example.com`
  const r = await A('POST', '/api/auth/admin/create-user', { email, password, name: `NM ${tag}`, role: 'user' })
  if (r.status !== 200) throw new Error(`create-user ${tag} → ${r.status} ${r.text.slice(0, 120)}`)
  made.push({ id: r.json.user.id, email })
  return { id: r.json.user.id, email }
}

const A = client()
let mainErr = null
try {
  const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
  ok(sa.status === 200, `admin sign-in ${sa.status}`)
  if (failures()) process.exit(1)
  arm()

  // ── marks: two sessions of the same account ──
  const U = await createUser(A, 'u', 'nm-pass-12345')
  const U1 = client()
  const U2 = client()
  ok((await U1.signIn(U.email, 'nm-pass-12345')).status === 200, 'U signs in (session 1)')
  ok((await U2.signIn(U.email, 'nm-pass-12345')).status === 200, 'U signs in (session 2)')
  const empty = await U2('GET', '/api/notices/marks')
  ok(empty.status === 200 && empty.json.read.length === 0 && empty.json.maturityKept.length === 0, `a new account has no marks (${empty.status})`)
  const p1 = await U1('POST', '/api/notices/marks', { read: { add: ['charge:s1:2026-11-30', 'round:p1:1:2026-12-01'] }, maturityKept: { add: ['acc1@2026-11'] } })
  ok(p1.status === 200 && p1.json.read.length === 2 && p1.json.maturityKept[0] === 'acc1@2026-11', `session 1 adds two read marks and a kept maturity (${p1.status})`)
  const g2 = await U2('GET', '/api/notices/marks')
  ok(JSON.stringify(g2.json) === JSON.stringify(p1.json), 'session 2 sees the same marks')
  const p2 = await U2('POST', '/api/notices/marks', { read: { add: ['remainder:2026-11'], drop: ['charge:s1:2026-11-30'] } })
  ok(p2.status === 200 && JSON.stringify(p2.json.read) === JSON.stringify(['round:p1:1:2026-12-01', 'remainder:2026-11']), `session 2 adds one and drops one (${JSON.stringify(p2.json?.read)})`)
  ok(JSON.stringify((await U1('GET', '/api/notices/marks')).json) === JSON.stringify(p2.json), 'session 1 sees session 2\'s change')
  const again = await U1('POST', '/api/notices/marks', { read: { add: ['remainder:2026-11'] } })
  ok(again.status === 200 && again.json.read.length === 2, 'adding a mark that is there changes nothing')

  // ── isolation ──
  const am = await A('GET', '/api/notices/marks')
  ok(am.status === 200 && !am.json.read.includes('remainder:2026-11') && !am.json.maturityKept.includes('acc1@2026-11'), "A sees none of U's marks")
  const [{ n: unscoped }] = await sql`select count(*)::int as n from notice_mark where user_id = ${U.id}`
  ok(unscoped === 0, `row-level security: with no user set the app role sees none of the rows (${unscoped})`)
  const n = await sql.begin(async (t) => {
    await t`select set_config('app.user_id', ${U.id}, true)`
    const [{ n }] = await t`select count(*)::int as n from notice_mark where user_id = ${U.id}`
    return n
  })
  ok(n === 3, `as U, the three rows are there (${n})`)

  // ── limits (S-8) ──
  const long = await U1('POST', '/api/notices/marks', { read: { add: ['x'.repeat(201)] } })
  ok(long.status === 400, `a 201-character mark → ${long.status}`)
  ok((await U1('POST', '/api/notices/marks', { read: { add: ['x'.repeat(200)] } })).status === 200, 'a 200-character mark is taken')
  const many = await U1('POST', '/api/notices/marks', { read: { add: Array.from({ length: 300 }, (_, i) => `m${i}`) }, maturityKept: { add: Array.from({ length: 201 }, (_, i) => `k${i}@2026-01`) } })
  ok(many.status === 400, `501 marks in one request → ${many.status}`)
  ok((await U1('POST', '/api/notices/marks', { read: { add: [''] } })).status === 400, 'an empty mark → 400')
  ok((await U1('POST', '/api/notices/marks', { other: [] })).status === 400, 'an unknown field → 400')
  ok((await client()('GET', '/api/notices/marks')).status === 401, 'no session → 401')
  for (let c = 0; c < 4; c++) {
    const r = await U1('POST', '/api/notices/marks', { read: { add: Array.from({ length: 500 }, (_, i) => `cap${c}-${String(i).padStart(3, '0')}`) } })
    if (r.status !== 200) ok(false, `cap round ${c} → ${r.status}`)
  }
  const capped = await U1('POST', '/api/notices/marks', { read: { add: ['cap-last'] } })
  ok(capped.status === 200 && capped.json.read.length === 2000 && capped.json.read.includes('cap-last') && !capped.json.read.includes('round:p1:1:2026-12-01'),
    `past 2000 the oldest go (${capped.json?.read?.length}, newest kept, an early one gone)`)

  // ── MCP list_notifications (V-4): read from A's marks ──
  const key = newKey()
  await sql`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, metadata, expires_at, created_at, updated_at)
    values (${randomBytes(12).toString('hex')}, 'default', 'nm-mcp', ${key.slice(0, 6)}, ${sa.json.user.id}, 'allot_', ${sha(key)}, true, true, 60000, 120, 0, '{"mcp":["read"]}', null, ${new Date(Date.now() + 86_400_000)}, now(), now())`
  const call = async () => {
    const r = await fetch(BASE + '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: ACCEPT, authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_notifications', arguments: {} } }) })
    return (await r.json())?.result?.structuredContent?.notifications ?? []
  }
  const before = await call()
  ok(before.every((x) => typeof x.read === 'boolean'), `list_notifications: every notice has read (${before.length})`)
  if (before.length) {
    const first = before[0].id
    const m = await A('POST', '/api/notices/marks', { read: { add: [first] } })
    ok(m.status === 200, 'A marks the first notice read')
    const after = await call()
    ok(after.find((x) => x.id === first)?.read === true && after.filter((x) => x.id !== first).every((x) => before.find((b) => b.id === x.id)?.read === x.read), 'list_notifications: that one is read now, the others as before')
    await A('POST', '/api/notices/marks', { read: { drop: [first] } })
  } else {
    console.log('NOTE A has no notices today: the read flip is covered by tests/unit/mcp-views.test.ts')
  }
  await sql`delete from apikey where key = ${sha(key)}`

  // ── password (V-5) ──
  const X = await createUser(A, 'x', 'nm-first-12345')
  const XS = client()
  ok((await XS.signIn(X.email, 'nm-first-12345')).status === 200, 'X signs in with the password it was made with')
  const now = new Date()
  await sql`insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values (${randomUUID()}, ${'gh-' + X.id}, 'github', ${X.id}, ${now}, ${now})`
  const acc0 = await XS('GET', '/api/auth/list-accounts')
  const cred0 = acc0.json.find((a) => a.providerId === 'credential')
  ok(acc0.json.length === 2 && cred0, `X has a password and a (fake) GitHub login (${acc0.json.map((a) => a.providerId)})`)
  const un0 = await XS('POST', '/api/auth/unlink-account', { accountId: cred0.id })
  ok(un0.status === 200, `X removes its password (unlink) → ${un0.status}`)
  const gone0 = await client().signIn(X.email, 'nm-first-12345')
  ok(gone0.status === 401, `the removed password no longer signs in (${gone0.status} ${gone0.text.slice(0, 120)})`)
  const short = await XS('POST', '/api/account/password', { newPassword: 'short' })
  ok(short.status === 400 && short.json?.code === 'PASSWORD_TOO_SHORT', `too short → ${short.status} ${short.json?.code}`)
  await sql`update session set created_at = now() - interval '2 days' where user_id = ${X.id}`
  const stale = await XS('POST', '/api/account/password', { newPassword: 'nm-second-12345' })
  ok(stale.status === 403 && stale.json?.code === 'REAUTH', `a session signed in two days ago → ${stale.status} ${stale.json?.code}`)
  await sql`update session set created_at = now() where user_id = ${X.id}`
  const added = await XS('POST', '/api/account/password', { newPassword: 'nm-second-12345' })
  ok(added.status === 200, `add a password → ${added.status} ${added.text.slice(0, 120)}`)
  const acc1 = await XS('GET', '/api/auth/list-accounts')
  const cred1 = acc1.json.find((a) => a.providerId === 'credential')
  ok(!!cred1, 'the password sign-in is listed')
  ok((await client().signIn(X.email, 'nm-second-12345')).status === 200, 'the new password signs in')
  const twice = await XS('POST', '/api/account/password', { newPassword: 'nm-third-123456' })
  ok(twice.status === 409 && twice.json?.code === 'PASSWORD_ALREADY_SET', `a second add → ${twice.status} ${twice.json?.code}`)
  ok((await client()('POST', '/api/account/password', { newPassword: 'nm-third-123456' })).status === 401, 'no session → 401')
  const un1 = await XS('POST', '/api/auth/unlink-account', { accountId: cred1.id })
  ok(un1.status === 200, `remove it again → ${un1.status}`)
  const gone1 = await client().signIn(X.email, 'nm-second-12345')
  ok(gone1.status === 401, `the removed password no longer signs in (${gone1.status} ${gone1.text.slice(0, 120)})`)
  const gh = (await XS('GET', '/api/auth/list-accounts')).json.find((a) => a.providerId === 'github')
  const last = await XS('POST', '/api/auth/unlink-account', { accountId: gh.id })
  ok(last.status === 400, `the last way in cannot be unlinked → ${last.status} ${last.json?.code ?? ''}`)
} catch (e) {
  mainErr = e
  threw(e)
} finally {
  disarm()
  for (const u of made) {
    await cleanupStep(`delete ${u.email.split('@')[0]}`, async () => {
      const r = await A('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: u.email })
      return r.status === 200 || r.status === 204 ? undefined : r.status
    })
  }
  await sql.end()
}
console.log(failures() ? `FAILED ${failures()} check(s)` : 'ALL PASSED')
process.exit(failures() || mainErr ? 1 : 0)
