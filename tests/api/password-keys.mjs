// API check for spec 013 V-21 (rc.3 W-20, S-24, S-25, S-26, A-37, A-41, A-42): the password policy (its default is
// today's behaviour; a stored minimum on every path that sets a password; the email lockout) and API key management
// (rename, scope, extend, usage; someone else's or an expired key is not found).
//   run in a throwaway container on the dev network against the THROWAWAY test server (DATABASE_URL = its database,
//   ADMIN_EMAIL, ADMIN_PASSWORD, BASE = http://allot-rc:3000):
//   bash .loctx/reports/0.1.7/checks/rc3-api.sh <log> node tests/api/password-keys.mjs
// The database is used only to start and end with no stored policy (app_setting 'password' deleted: the default) and to
// make one key expired. U is a fresh account (fake example.com), deleted at the end with its keys. The sign-in limit is
// 5 a minute per address: sign-ins go in batches of 4 with a quiet minute between them. Exit 0 only if every check passed.
import postgres from 'postgres'

let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://allot-rc:3000'
if (!/^http:\/\/(allot-rc:3000|127\.0\.0\.1:15174)$/.test(BASE)) { console.log(`refuse: BASE ${BASE} is not the test server`); process.exit(1) }
if (!/\/allot_rc$/.test(process.env.DATABASE_URL ?? '')) { console.log('refuse: DATABASE_URL is not the test server database'); process.exit(1) }
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const DAY = 86_400_000
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function client(lang) {
  let cookie = ''
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(lang ? { 'accept-language': lang } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  api.noCookie = (method, path, body, headers) => {
    const saved = cookie
    cookie = ''
    return api(method, path, body, headers).finally(() => { cookie = saved })
  }
  return api
}
let lastSignIn = Date.now()
let batch = 4
/**
 * A sign-in kept under the per-address limit (5 a minute; Better Auth counts until a quiet minute has passed since the
 * last try): at most 4 tries, then more than a minute without one. `api` keeps the session when it succeeds.
 */
async function signIn(api, email, password) {
  const gap = batch >= 4 ? 62_000 - (Date.now() - lastSignIn) : 4_000 - (Date.now() - lastSignIn)
  if (batch >= 4) batch = 0
  if (gap > 0) await wait(gap)
  batch++
  lastSignIn = Date.now()
  return api('POST', '/api/auth/sign-in/email', { email, password })
}
let lastChange = 0
/** change-password: Better Auth allows 3 in 10 seconds per address, counted until 10 quiet seconds: one every 11 seconds. */
async function changePw(api, body, headers) {
  const gap = 11_000 - (Date.now() - lastChange)
  if (gap > 0) await wait(gap)
  lastChange = Date.now()
  return api('POST', '/api/auth/change-password', body, headers)
}
const tryIn = (email, password, lang) => signIn(client(lang), email, password)
const within = (iso, ms, tol = 120_000) => !!iso && Math.abs(new Date(iso).getTime() - (Date.now() + ms)) <= tol
const mcp = (A, key, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) =>
  A.noCookie('POST', '/api/mcp', body, { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' })
const isW = (k) => (k?.permissions?.mcp ?? []).includes('write')
const resetPolicy = () => sql`delete from app_setting where id = 'password'`

const A = client()
const U = client()
const stamp = Date.now()
const uEmail = `pk-u-${stamp}@example.com`
const uPw8 = 'pk8chars'          // 8 characters: today's minimum
const ghost = `pk-none-${stamp}@example.com` // no account
let uId = null
const keyIds = []

await resetPolicy()
await sql`delete from login_failure`
const sa = await signIn(A, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
ok(sa.status === 200, `admin sign-in → ${sa.status}`)
if (failed) process.exit(1)

try {
  // ── 1. nothing stored = today's behaviour ──
  const p0 = await A('GET', '/api/admin/password-policy')
  ok(p0.status === 200 && p0.json?.stored === false && JSON.stringify(p0.json?.policy) === JSON.stringify({ minLength: 8, lockout: { enabled: false, attempts: 5, minutes: 15 } }),
    `no policy stored: GET → ${p0.status} ${JSON.stringify(p0.json)}`)
  const pub0 = await A('GET', '/api/password-policy')
  ok(pub0.status === 200 && JSON.stringify(pub0.json) === JSON.stringify({ minLength: 8 }), `GET /api/password-policy → ${JSON.stringify(pub0.json)} (only the minimum)`)
  const short5 = await A('POST', '/api/auth/admin/create-user', { email: `pk-five-${stamp}@example.com`, password: 'abcde', name: 'PK five', role: 'user' })
  ok(short5.status === 200, `no policy: admin create-user with a 5-character password is still taken (as before) → ${short5.status}`)
  if (short5.json?.user?.id) await A('DELETE', `/api/admin/users/${short5.json.user.id}`, { confirmEmail: `pk-five-${stamp}@example.com` })
  const cu = await A('POST', '/api/auth/admin/create-user', { email: uEmail, password: uPw8, name: 'PK user', role: 'user' })
  ok(cu.status === 200, `create U with an 8-character password → ${cu.status}`)
  uId = cu.json?.user?.id
  const su = await signIn(U, uEmail, uPw8)
  ok(su.status === 200, `U signs in → ${su.status}`)
  const cp7 = await changePw(U, { currentPassword: uPw8, newPassword: 'seven77' })
  ok(cp7.status === 400, `no policy: change-password to 7 characters → ${cp7.status} (Better Auth's 8, as before)`)
  const cp8 = await changePw(U, { currentPassword: uPw8, newPassword: 'eight888' })
  ok(cp8.status === 200, `no policy: change-password to 8 characters → ${cp8.status}`)
  const back = await changePw(U, { currentPassword: 'eight888', newPassword: uPw8 })
  ok(back.status === 200, `and back to the first one → ${back.status}`)

  // ── 3. the policy body: S-26 ranges, whole object ──
  const good = { minLength: 12, lockout: { enabled: false, attempts: 5, minutes: 15 } }
  const bad = [
    [{ ...good, minLength: 7 }, 'minLength'], [{ ...good, minLength: 129 }, 'minLength'], [{ ...good, minLength: 8.5 }, 'minLength'],
    [{ ...good, lockout: { ...good.lockout, attempts: 2 } }, 'lockout.attempts'], [{ ...good, lockout: { ...good.lockout, attempts: 21 } }, 'lockout.attempts'],
    [{ ...good, lockout: { ...good.lockout, minutes: 0 } }, 'lockout.minutes'], [{ ...good, lockout: { ...good.lockout, minutes: 1441 } }, 'lockout.minutes'],
    [{ lockout: good.lockout }, 'minLength'], [{ ...good, extra: 1 }, ''],
  ]
  for (const [body, path] of bad) {
    const r = await A('PUT', '/api/admin/password-policy', body)
    ok(r.status === 400 && (!path || JSON.stringify(r.json).includes(path.split('.').pop())), `PUT ${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`)
  }
  for (const body of [{ ...good, minLength: 8 }, { ...good, minLength: 128 }, { ...good, lockout: { enabled: true, attempts: 3, minutes: 1 } }, { ...good, lockout: { enabled: true, attempts: 20, minutes: 1440 } }]) {
    const r = await A('PUT', '/api/admin/password-policy', body)
    ok(r.status === 200 && r.json?.stored === true, `PUT ${JSON.stringify(body)} (a boundary) → ${r.status}`)
  }

  // ── 2. a stored minimum of 12 ──
  const put = await A('PUT', '/api/admin/password-policy', good)
  ok(put.status === 200 && put.json?.stored === true && put.json?.policy?.minLength === 12, `PUT minimum 12 → ${put.status} ${JSON.stringify(put.json)}`)
  const uPol = await U('GET', '/api/admin/password-policy')
  const uPut = await U('PUT', '/api/admin/password-policy', good)
  ok(uPol.status === 403 && uPut.status === 403, `a normal user: GET/PUT the admin policy → ${uPol.status}/${uPut.status} (want 403/403)`)
  const pub = await U('GET', '/api/password-policy')
  ok(pub.status === 200 && JSON.stringify(pub.json) === JSON.stringify({ minLength: 12 }), `a normal user: GET /api/password-policy → ${JSON.stringify(pub.json)}`)
  const c11 = await changePw(U, { currentPassword: uPw8, newPassword: 'eleven11111' })
  ok(c11.status === 400 && c11.json?.code === 'PASSWORD_TOO_SHORT' && c11.json?.message === '비밀번호는 12자 이상이어야 해요.', `change-password with 11 → ${c11.status} ${JSON.stringify(c11.json)}`)
  const c11en = await changePw(U, { currentPassword: uPw8, newPassword: 'eleven11111' }, { 'accept-language': 'en' })
  ok(c11en.status === 400 && c11en.json?.message === 'The password must be at least 12 characters.', `the same in English → ${c11en.status} ${c11en.json?.message}`)
  const sp11 = await A('POST', '/api/auth/admin/set-user-password', { userId: uId, newPassword: 'eleven11111' })
  ok(sp11.status === 400 && sp11.json?.code === 'PASSWORD_TOO_SHORT', `admin set-user-password with 11 → ${sp11.status} ${sp11.json?.code}`)
  const cr11 = await A('POST', '/api/auth/admin/create-user', { email: `pk-11-${stamp}@example.com`, password: 'eleven11111', name: 'PK 11', role: 'user' })
  ok(cr11.status === 400 && cr11.json?.code === 'PASSWORD_TOO_SHORT', `admin create-user with 11 (A-42) → ${cr11.status} ${cr11.json?.code}`)
  const cr12 = await A('POST', '/api/auth/admin/create-user', { email: `pk-12-${stamp}@example.com`, password: 'twelve121212', name: 'PK 12', role: 'user' })
  ok(cr12.status === 200, `admin create-user with 12 → ${cr12.status}`)
  if (cr12.json?.user?.id) await A('DELETE', `/api/admin/users/${cr12.json.user.id}`, { confirmEmail: `pk-12-${stamp}@example.com` })
  const old8 = await tryIn(uEmail, uPw8)
  ok(old8.status === 200, `an existing 8-character password still signs in under minimum 12 → ${old8.status}`)
  const c12 = await changePw(U, { currentPassword: uPw8, newPassword: 'twelve121212' })
  ok(c12.status === 200, `change-password with 12 → ${c12.status}`)
  const sp8 = await A('POST', '/api/auth/admin/set-user-password', { userId: uId, newPassword: 'twelve-reset' })
  ok(sp8.status === 200, `admin set-user-password with 12 → ${sp8.status}`)
  const uPw = 'twelve-reset'

  // ── 4. lockout: 3 attempts, 5 minutes (the batches of sign-ins take more than a minute) ──
  const lockOn = await A('PUT', '/api/admin/password-policy', { minLength: 12, lockout: { enabled: true, attempts: 3, minutes: 5 } })
  ok(lockOn.status === 200 && lockOn.json?.policy?.lockout?.enabled === true, `lockout on (3 × / 5 min) → ${lockOn.status}`)
  const f1 = await tryIn(uEmail, 'wrong-password-1')
  const f2 = await tryIn(uEmail.toUpperCase(), 'wrong-password-2')
  const l0 = await A('GET', '/api/admin/login-locks')
  ok(f1.status === 401 && f2.status === 401, `two wrong passwords (the second with the email in upper case) → ${f1.status}/${f2.status}`)
  ok(l0.json?.locks?.every((l) => l.email !== uEmail) ?? false, `not locked after two (${JSON.stringify(l0.json)})`)
  const f3 = await tryIn(uEmail, 'wrong-password-3')
  ok(f3.status === 401, `third wrong password → ${f3.status}`)
  const locked = await tryIn(uEmail, uPw)
  ok(locked.status === 403 && locked.json?.code === 'LOGIN_LOCKED' && /^로그인 시도가 너무 많아요\. [1-5]분 뒤에 다시 시도하세요\.$/.test(locked.json?.message ?? ''),
    `fourth try with the RIGHT password → ${locked.status} ${JSON.stringify(locked.json)}`)
  const l1 = await A('GET', '/api/admin/login-locks')
  const mine = l1.json?.locks?.find((l) => l.email === uEmail)
  ok(!!mine && within(mine.until, 5 * 60_000 - (Date.now() - lastSignIn), 120_000) && mine.count >= 3, `the lock list has U's email (lower case) until about 5 min after the third failure (${JSON.stringify(mine)})`)
  // an email with no account: the same counting and the same answer
  for (const n of [1, 2, 3]) {
    const g = await tryIn(ghost, `ghost-wrong-${n}`)
    ok(g.status === 401, `no account, wrong try ${n} → ${g.status}`)
  }
  const gl = await tryIn(ghost, 'anything-at-all')
  ok(gl.status === locked.status && gl.json?.code === locked.json?.code && /^로그인 시도가 너무 많아요\. [1-5]분 뒤에 다시 시도하세요\.$/.test(gl.json?.message ?? ''), `no account, fourth try → ${gl.status} ${JSON.stringify(gl.json)} (the same as for U)`)
  const glEn = await tryIn(ghost, 'anything-at-all', 'en')
  ok(glEn.status === 403 && /^Too many sign-in attempts\. Try again in [1-5] min\.$/.test(glEn.json?.message ?? ''), `the lock answer in English → ${glEn.status} ${glEn.json?.message}`)
  // the admin unlocks U
  const un = await A('DELETE', `/api/admin/login-locks/${encodeURIComponent(uEmail)}`)
  ok(un.status === 204, `admin unlocks U → ${un.status}`)
  const un2 = await A('DELETE', `/api/admin/login-locks/${encodeURIComponent(uEmail)}`)
  ok(un2.status === 404, `unlocking again → ${un2.status} (not locked)`)
  const after = await signIn(U, uEmail, uPw) // U's session ended with the admin's set-password
  ok(after.status === 200, `U signs in after the unlock → ${after.status}`)
  const uLock = await U('DELETE', `/api/admin/login-locks/${encodeURIComponent(ghost)}`)
  ok(uLock.status === 403, `a normal user cannot unlock → ${uLock.status}`)
  const l2 = await A('GET', '/api/admin/login-locks')
  ok(!l2.json?.locks?.some((l) => l.email === uEmail) && l2.json?.locks?.some((l) => l.email === ghost), `the list: U gone, the email with no account still locked (${JSON.stringify(l2.json?.locks?.map((l) => l.email))})`)
  const [row] = await sql`select count(*)::int as n from login_failure where email = ${uEmail}`
  ok(row.n === 0, `U's failure row is gone after the success (${row.n})`)

  // ── 5. lockout off: nothing counted or refused, rows deleted ──
  const off = await A('PUT', '/api/admin/password-policy', { minLength: 12, lockout: { enabled: false, attempts: 3, minutes: 5 } })
  ok(off.status === 200, `lockout off → ${off.status}`)
  const [rows] = await sql`select count(*)::int as n from login_failure`
  ok(rows.n === 0, `turning it off deletes every failure row (${rows.n} left)`)
  const g4 = await tryIn(ghost, 'ghost-wrong-4')
  ok(g4.status === 401, `the email that was locked: a wrong password is just wrong now → ${g4.status}`)
  for (const n of [1, 2, 3]) await tryIn(uEmail, `wrong-again-${n}`)
  const in2 = await tryIn(uEmail, uPw)
  ok(in2.status === 200, `lockout off: three wrong then the right password signs in → ${in2.status}`)
  const [rows2] = await sql`select count(*)::int as n from login_failure`
  ok(rows2.n === 0, `lockout off: nothing was counted (${rows2.n} rows)`)

  // ── 7. the admin log lines (console, `admin: … target …`) are checked from the container log by the check script ──

  // ── 6. API keys: PATCH /api/keys/:id ──
  const mk = async (who, body) => { const r = await who('POST', '/api/keys', body); if (r.json?.item?.id) keyIds.push([who, r.json.item.id]); return r }
  const k1 = await mk(A, { name: 'PK-key-read', expiresInDays: 30 })
  ok(k1.status === 201, `make a read key → ${k1.status}`)
  const id1 = k1.json?.item?.id
  const rn = await A('PATCH', `/api/keys/${id1}`, { name: '  PK-key-renamed  ' })
  ok(rn.status === 200 && rn.json?.item?.name === 'PK-key-renamed', `rename (trimmed) → ${rn.status} ${rn.json?.item?.name}`)
  ok((await A('PATCH', `/api/keys/${id1}`, { name: 'x'.repeat(32) })).status === 200, 'a name of 32 characters → 200')
  ok((await A('PATCH', `/api/keys/${id1}`, { name: 'x'.repeat(33) })).status === 400, 'a name of 33 characters → 400')
  ok((await A('PATCH', `/api/keys/${id1}`, { name: '   ' })).status === 400, 'an empty name → 400')
  ok((await A('PATCH', `/api/keys/${id1}`, {})).status === 400, 'an empty body → 400')
  const cfr = await A('PATCH', `/api/keys/${id1}`, { confirm: 'chat' })
  ok(cfr.status === 400, `confirm on a read key → ${cfr.status} ${cfr.json?.error ?? ''}`)
  const toW = await A('PATCH', `/api/keys/${id1}`, { write: true })
  ok(toW.status === 200 && isW(toW.json?.item) && toW.json?.item?.confirm === 'ui', `read → write without confirm → ${toW.status} write=${isW(toW.json?.item)} confirm=${toW.json?.item?.confirm}`)
  const toChat = await A('PATCH', `/api/keys/${id1}`, { write: true, confirm: 'chat' })
  ok(toChat.status === 200 && toChat.json?.item?.confirm === 'chat', `write, confirm chat → ${toChat.status} ${toChat.json?.item?.confirm}`)
  const [kr] = await sql`select permissions, metadata from apikey where id = ${id1}`
  ok(String(kr.permissions).includes('write') && String(kr.metadata).includes('chat'), `stored: permissions ${kr.permissions}, metadata ${kr.metadata}`)
  const toR = await A('PATCH', `/api/keys/${id1}`, { write: false })
  ok(toR.status === 200 && !isW(toR.json?.item) && (toR.json?.item?.confirm ?? null) === null, `write → read → ${toR.status} write=${isW(toR.json?.item)} confirm=${toR.json?.item?.confirm}`)
  const [kr2] = await sql`select permissions from apikey where id = ${id1}`
  ok(!String(kr2.permissions).includes('write'), `stored after write → read: ${kr2.permissions}`)
  for (const d of [30, 365]) {
    const e = await A('PATCH', `/api/keys/${id1}`, { extendDays: d })
    ok(e.status === 200 && within(e.json?.item?.expiresAt, d * DAY), `extend ${d} days → ${e.status} ${e.json?.item?.expiresAt}`)
  }
  for (const d of [0, 366, 1.5]) ok((await A('PATCH', `/api/keys/${id1}`, { extendDays: d })).status === 400, `extendDays ${d} → 400`)
  const pol = await A('GET', '/api/admin/api-keys')
  if (!pol.json?.noExpiry) {
    const ne = await A('PATCH', `/api/keys/${id1}`, { extendDays: null })
    ok(ne.status === 400 && ne.json?.path === 'extendDays', `no expiry while the policy does not allow it → ${ne.status} ${JSON.stringify(ne.json)}`)
  } else console.log('NOTE the key policy allows no expiry: the refusal of extendDays null is not checked')
  // usage: a request with the key counts
  const kw = await mk(A, { name: 'PK-key-use', expiresInDays: 30 })
  const used = await mcp(A, kw.json?.key)
  ok(used.status === 200, `an MCP request with a key → ${used.status}`)
  const list = await A('GET', '/api/keys')
  const it = list.json?.keys?.find((k) => k.id === kw.json?.item?.id)
  ok(!!it && typeof it.requestCount === 'number' && it.requestCount >= 1 && !!it.lastUsedAt, `GET /api/keys: requestCount ${it?.requestCount}, lastUsedAt ${it?.lastUsedAt}`)
  ok(list.json?.keys?.every((k) => typeof k.requestCount === 'number'), 'every listed key carries requestCount')
  const bearer = await A.noCookie('GET', '/api/keys', undefined, { authorization: `Bearer ${kw.json?.key}` })
  ok(bearer.status === 401, `an API key as Bearer on /api/keys → ${bearer.status}`)
  // a key moved from write to read: write tools refused through MCP
  const kx = await mk(A, { name: 'PK-key-w', expiresInDays: 30, write: true, confirm: 'ui' })
  const listW = await mcp(A, kx.json?.key)
  ok(listW.text.includes('propose_changes'), 'a write key sees propose_changes')
  await A('PATCH', `/api/keys/${kx.json?.item?.id}`, { write: false })
  const listR = await mcp(A, kx.json?.key)
  const callR = await mcp(A, kx.json?.key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'propose_changes', arguments: { note: 'x', changes: [{ resource: 'checks', action: 'create', data: { text: 'PK-check', done: false } }] } } })
  ok(!listR.text.includes('propose_changes') && (callR.status >= 400 || /error|isError/.test(callR.text)), `after write → read: the tool list has no propose_changes and a call is refused (${callR.status})`)
  // someone else's key, an expired key
  const ku = await mk(U, { name: 'PK-key-of-U', expiresInDays: 30 })
  ok(ku.status === 201, `U makes a key → ${ku.status}`)
  const other = await A('PATCH', `/api/keys/${ku.json?.item?.id}`, { name: 'taken' })
  ok(other.status === 404, `A changes U's key → ${other.status} (not found)`)
  const [still] = await sql`select name from apikey where id = ${ku.json?.item?.id ?? ""}`
  ok(still?.name === 'PK-key-of-U', `U's key is unchanged (${still?.name})`)
  const ke = await mk(A, { name: 'PK-key-expired', expiresInDays: 30 })
  await sql`update apikey set expires_at = now() - interval '1 minute' where id = ${ke.json?.item?.id ?? ""}`
  for (const body of [{ name: 'revive' }, { extendDays: 30 }, { write: true }]) {
    const r = await A('PATCH', `/api/keys/${ke.json?.item?.id}`, body)
    ok(r.status === 404, `an expired key, PATCH ${JSON.stringify(body)} → ${r.status} (A-41)`)
  }
  ok((await A('PATCH', '/api/keys/no-such-key', { name: 'x' })).status === 404, 'an unknown key id → 404')
} finally {
  for (const [who, id] of keyIds) await who('DELETE', `/api/keys/${id}`).catch(() => null)
  await sql`delete from apikey where name like 'PK-key%'`.catch(() => null)
  if (uId) {
    const d = await A('DELETE', `/api/admin/users/${uId}`, { confirmEmail: uEmail })
    ok(d.status === 204, `delete U → ${d.status}`)
  }
  await sql`delete from login_failure`
  await resetPolicy()
  const end = await A('GET', '/api/admin/password-policy')
  ok(end.json?.stored === false && end.json?.policy?.minLength === 8 && end.json?.policy?.lockout?.enabled === false, `the policy is back to its default, not stored (${JSON.stringify(end.json)})`)
  await sql.end()
}
console.log(failed ? `FAIL: ${failed}` : 'ALL PASS (password-keys)')
process.exit(failed ? 1 : 0)
