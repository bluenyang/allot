// API check for spec 008 V-2 and V-3 (a): the life of an API key, and the expiry policy.
//   run inside the api container of the dev stack (it needs DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD):
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://web:15173 api node tests/api/api-keys.mjs [--keep-key-file]
// A is ADMIN_EMAIL (an admin); U is created here and deleted at the end (which also checks that the
// admin "delete user" removes the user's keys). The "no expiry" policy is switched on and off through
// the admin API; when ALLOT_API_KEY_NO_EXPIRY locks it, the checks that need the switch are skipped
// and said so. With --keep-key-file one raw key is written to /tmp/v2-key.txt in the container
// (outside the repository) so a pg_dump can be searched for it; otherwise no raw key leaves this process.
// Exit 0 only if every check passed. The login rate limit (5/min) is respected: two sign-ins.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import postgres from 'postgres'

let failed = 0
let skipped = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const skip = (msg) => { console.log(`SKIP ${msg}`); skipped++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const sha = (k) => createHash('sha256').update(k).digest('base64url')
const DAY = 86_400_000

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
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
  api.signIn = (email, password) => api('POST', '/api/auth/sign-in/email', { email, password })
  api.noCookie = (method, path, body, headers) => {
    const saved = cookie
    cookie = ''
    return api(method, path, body, headers).finally(() => { cookie = saved })
  }
  return api
}

/** One MCP request with a key as Bearer (no cookie); the endpoint is spec 008 W-3. */
const mcp = (A, key, body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) =>
  A.noCookie('POST', '/api/mcp', body, { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' })

const within = (iso, ms, tol = 60_000) => !!iso && Math.abs(new Date(iso).getTime() - (Date.now() + ms)) <= tol

const A = client()
const U = client()
const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
ok(sa.status === 200, `A sign-in ${sa.status}`)
if (failed) process.exit(1)

const uEmail = `v2-${Date.now()}@example.com`
const uPw = 'v2-first-pass-1'
const created = await A('POST', '/api/auth/admin/create-user', { email: uEmail, password: uPw, name: 'V2 user', role: 'user' })
ok(created.status === 200, `create-user → ${created.status}`)
const uId = created.json?.user?.id
const su = await U.signIn(uEmail, uPw)
ok(su.status === 200, `U sign-in ${su.status}`)
if (failed) process.exit(1)

let policyChanged = false
try {
  // ── the policy and who may change it ──
  const p0 = await A('GET', '/api/admin/api-keys')
  ok(p0.status === 200 && typeof p0.json?.noExpiry === 'boolean' && ['default', 'db', 'env'].includes(p0.json?.source), `admin GET policy → ${p0.status} ${JSON.stringify(p0.json)}`)
  const locked = p0.json?.locked === true
  const uGet = await U('GET', '/api/admin/api-keys')
  const uPut = await U('PUT', '/api/admin/api-keys', { noExpiry: true })
  ok(uGet.status === 403 && uPut.status === 403, `a normal user: GET/PUT admin policy → ${uGet.status}/${uPut.status} (want 403/403)`)
  if (locked) {
    const put = await A('PUT', '/api/admin/api-keys', { noExpiry: !p0.json.noExpiry })
    ok(put.status === 409, `policy set by env: PUT → ${put.status} (want 409)`)
  } else {
    policyChanged = true
    const off = await A('PUT', '/api/admin/api-keys', { noExpiry: false })
    ok(off.status === 200 && off.json?.noExpiry === false && off.json?.source === 'db', `start from OFF → ${off.status} ${JSON.stringify(off.json)}`)
    const bad = await A('PUT', '/api/admin/api-keys', { noExpiry: 'yes' })
    ok(bad.status === 400, `PUT with a non-boolean → ${bad.status} (want 400)`)
  }
  const noExpiryOn = locked ? p0.json.noExpiry : false

  // ── create: the key is in the response only ──
  const c1 = await U('POST', '/api/keys', { name: 'first' })
  const raw = c1.json?.key
  ok(c1.status === 201 && typeof raw === 'string' && /^allot_[A-Za-z]{64}$/.test(raw), `create → ${c1.status}, key shape allot_ + 64 letters`)
  ok(!!c1.json?.item?.id && c1.json.item.start === raw?.slice(0, 6) && c1.json.item.name === 'first', `item: id, name, start = first 6 chars (${c1.json?.item?.start})`)
  ok(JSON.stringify(c1.json?.item).includes(raw) === false, 'the item does not hold the key')
  ok(c1.json?.item?.permissions?.mcp?.[0] === 'read' && c1.json.item.permissions.mcp.length === 1, `scope is mcp: read (${JSON.stringify(c1.json?.item?.permissions)})`)
  if (!noExpiryOn || !locked) ok(within(c1.json?.item?.expiresAt, 90 * DAY), `no expiresInDays → 90 days (${c1.json?.item?.expiresAt})`)
  if (process.argv.includes('--keep-key-file')) writeFileSync('/tmp/v2-key.txt', raw)
  const list = await U('GET', '/api/keys')
  const listed = list.json?.keys?.find((k) => k.id === c1.json?.item?.id)
  ok(list.status === 200 && !!listed && listed.start === raw.slice(0, 6), `GET /api/keys lists it → ${list.status}`)
  ok(!list.text.includes(raw) && !list.text.includes(sha(raw)), 'the list holds neither the key nor its hash')
  ok(list.json?.max === 10 && typeof list.json?.policy?.noExpiry === 'boolean', `the list carries the policy and the limit (${JSON.stringify(list.json?.policy)}, max ${list.json?.max})`)
  ok(listed?.lastUsedAt === null, 'lastUsedAt is empty before any use')
  const [row] = await sql`select key, start, reference_id, permissions, enabled from apikey where id = ${c1.json.item.id}`
  ok(row?.key === sha(raw), 'DB apikey.key is the SHA-256 (base64url) of the key')
  ok(row?.key !== raw && !JSON.stringify(row).includes(raw), 'DB row does not hold the raw key')
  ok(row?.reference_id === uId && row?.start === raw.slice(0, 6), 'DB row belongs to U, start is the first 6 characters')

  // ── create: input rules ──
  const bad = async (body, why) => {
    const r = await U('POST', '/api/keys', body)
    ok(r.status === 400 && typeof r.json?.error === 'string', `${why} → ${r.status} (want 400)`)
  }
  await bad({ name: 'x', expiresInDays: 366 }, 'expiresInDays 366')
  await bad({ name: 'x', expiresInDays: 0 }, 'expiresInDays 0')
  await bad({ name: 'x', expiresInDays: 1.5 }, 'expiresInDays 1.5')
  await bad({ name: '' }, 'empty name')
  await bad({ name: 'n'.repeat(33) }, 'name of 33 characters')
  await bad({ name: 'x', extra: 1 }, 'an unknown field')
  await bad({ name: 'x', permissions: { mcp: ['write'] } }, 'permissions in the body')
  if (!noExpiryOn) await bad({ name: 'x', expiresInDays: null }, 'expiresInDays null while no-expiry keys are off')
  else skip('null while off (the policy is on, set by env)')
  const d365 = await U('POST', '/api/keys', { name: 'y365', expiresInDays: 365 })
  ok(d365.status === 201 && within(d365.json?.item?.expiresAt, 365 * DAY), `365 days is allowed → ${d365.status}`)
  const d1 = await U('POST', '/api/keys', { name: 'd1', expiresInDays: 1 })
  ok(d1.status === 201 && within(d1.json?.item?.expiresAt, DAY), `1 day is allowed → ${d1.status}`)

  // ── at most 10 live keys ──
  const have = (await U('GET', '/api/keys')).json.keys.length
  const made = []
  for (let i = have; i < 10; i++) {
    const r = await U('POST', '/api/keys', { name: `k${i}`, expiresInDays: 30 })
    if (r.status !== 201) ok(false, `fill to 10: ${r.status}`)
    made.push(r.json?.item?.id)
  }
  const eleventh = await U('POST', '/api/keys', { name: 'eleventh', expiresInDays: 30 })
  ok(eleventh.status === 400, `11th key → ${eleventh.status} (want 400)`)
  const del1 = await U('DELETE', `/api/keys/${made[0]}`)
  const twelfth = await U('POST', '/api/keys', { name: 'after-delete', expiresInDays: 30 })
  ok(del1.status === 204 && twelfth.status === 201, `after a delete there is room again → ${del1.status}/${twelfth.status}`)
  for (const id of [...made.slice(1), twelfth.json?.item?.id]) await U('DELETE', `/api/keys/${id}`)

  // ── someone else's key; a key is no session ──
  const aKey = await A('POST', '/api/keys', { name: 'admin-key', expiresInDays: 30 })
  ok(aKey.status === 201, `A creates a key → ${aKey.status}`)
  const stolen = await U('DELETE', `/api/keys/${aKey.json?.item?.id}`)
  ok(stolen.status === 404, `U deletes A's key id → ${stolen.status} (want 404)`)
  ok(!(await U('GET', '/api/keys')).text.includes(aKey.json?.item?.id), "U's list has none of A's keys")
  const aStill = await A('GET', '/api/keys')
  ok(aStill.json?.keys?.some((k) => k.id === aKey.json?.item?.id), "A's key is still there")
  for (const [path, method] of [['/api/keys', 'GET'], ['/api/keys', 'POST'], ['/api/state', 'GET'], ['/api/me', 'GET'], ['/api/admin/api-keys', 'GET']]) {
    const r = await A.noCookie(method, path, method === 'POST' ? { name: 'x' } : undefined, { authorization: `Bearer ${aKey.json?.key}` })
    ok(r.status === 401, `a key as Bearer: ${method} ${path} → ${r.status} (want 401)`)
    const r2 = await A.noCookie(method, path, method === 'POST' ? { name: 'x' } : undefined, { 'x-api-key': aKey.json?.key })
    ok(r2.status === 401, `a key as x-api-key: ${method} ${path} → ${r2.status} (want 401)`)
  }
  ok((await A('GET', '/api/keys')).json.keys.length === 1, 'those requests created nothing')
  await A('DELETE', `/api/keys/${aKey.json?.item?.id}`)

  // ── the plugin's own paths are closed ──
  for (const [method, path, body] of [
    ['POST', '/api/auth/api-key/create', { name: 'x' }],
    ['GET', '/api/auth/api-key/list'],
    ['POST', '/api/auth/api-key/delete', { keyId: 'x' }],
    ['POST', '/api/auth/api-key/update', { keyId: 'x', name: 'y' }],
    ['GET', '/api/auth/api-key/get?id=x'],
    ['POST', '/api/auth/api-key/verify', { key: 'x' }],
    ['POST', '/api/auth/api-key/delete-all-expired-api-keys', {}],
  ]) {
    const r = await U(method, path, body)
    ok(r.status === 404, `${method} ${path.replace('/api/auth', '')} → ${r.status} (want 404)`)
  }

  // ── the policy: on, a key without an expiry, off again ──
  let noExpiryKey
  if (!locked) {
    const on = await A('PUT', '/api/admin/api-keys', { noExpiry: true })
    ok(on.status === 200 && on.json?.noExpiry === true, `policy ON → ${on.status}`)
    const forever = await U('POST', '/api/keys', { name: 'forever', expiresInDays: null })
    noExpiryKey = forever.json
    ok(forever.status === 201 && forever.json?.item?.expiresAt === null, `ON: null → no expiry (${forever.status}, expiresAt ${forever.json?.item?.expiresAt})`)
    const [fr] = await sql`select expires_at from apikey where id = ${forever.json?.item?.id}`
    ok(fr?.expires_at === null, 'DB expires_at is null')
    const t0 = Date.now()
    const offAgain = await A('PUT', '/api/admin/api-keys', { noExpiry: false })
    ok(offAgain.status === 200 && offAgain.json?.noExpiry === false && offAgain.json?.capped >= 1, `policy OFF → ${offAgain.status}, capped ${offAgain.json?.capped}`)
    const [fr2] = await sql`select expires_at from apikey where id = ${forever.json?.item?.id}`
    ok(fr2?.expires_at && Math.abs(new Date(fr2.expires_at).getTime() - (t0 + 365 * DAY)) <= 60_000 + (Date.now() - t0), `DB expires_at is the save time + 365 days (${fr2?.expires_at?.toISOString?.()})`)
    const stillNull = await sql`select count(*)::int as n from apikey where expires_at is null`
    ok(stillNull[0].n === 0, `no key without an expiry is left (${stillNull[0].n})`)
    const refused = await U('POST', '/api/keys', { name: 'x', expiresInDays: null })
    ok(refused.status === 400, `OFF again: null → ${refused.status} (want 400)`)
  } else skip('policy ON/OFF checks (ALLOT_API_KEY_NO_EXPIRY locks the switch)')

  // ── use, revoke, expire: through MCP (spec 008 W-3) ──
  const live = await U('POST', '/api/keys', { name: 'use', expiresInDays: 7 })
  const lk = live.json?.key
  const before = (await U('GET', '/api/keys')).json.keys.find((k) => k.id === live.json?.item?.id)
  ok(before?.lastUsedAt === null, 'a new key has not been used')
  const call = await mcp(A, lk)
  ok(call.status === 200, `MCP tools/list with the key → ${call.status}`)
  const after = (await U('GET', '/api/keys')).json.keys.find((k) => k.id === live.json?.item?.id)
  ok(!!after?.lastUsedAt && Math.abs(new Date(after.lastUsedAt).getTime() - Date.now()) < 60_000, `lastUsedAt is filled after a call (${after?.lastUsedAt})`)
  const del = await U('DELETE', `/api/keys/${live.json?.item?.id}`)
  const revoked = await mcp(A, lk)
  ok(del.status === 204 && revoked.status === 401, `revoked key → MCP ${revoked.status} (want 401)`)
  const old = await U('POST', '/api/keys', { name: 'old', expiresInDays: 7 })
  ok((await mcp(A, old.json?.key)).status === 200, 'a second key works')
  await sql`update apikey set expires_at = now() - interval '1 minute' where id = ${old.json?.item?.id}`
  const expired = await mcp(A, old.json?.key)
  ok(expired.status === 401, `key with expires_at in the past → MCP ${expired.status} (want 401)`)
  if (noExpiryKey) ok((await mcp(A, noExpiryKey.key)).status === 200, 'a capped (formerly no-expiry) key still works')

  // ── deleting the user removes the user's keys ──
  const left = await U('POST', '/api/keys', { name: 'left', expiresInDays: 7 })
  ok(left.status === 201, `a key to leave behind → ${left.status}`)
  const [{ n: nBefore }] = await sql`select count(*)::int as n from apikey where reference_id = ${uId}`
  ok(nBefore >= 1, `U has ${nBefore} key(s) before the account is deleted`)
  const gone = await A('DELETE', `/api/admin/users/${uId}`, { confirmEmail: uEmail })
  ok(gone.status === 204, `admin deletes U → ${gone.status}`)
  const [{ n: nAfter }] = await sql`select count(*)::int as n from apikey where reference_id = ${uId}`
  ok(nAfter === 0, `U's keys are gone with the account (${nAfter})`)
  ok((await mcp(A, left.json?.key)).status === 401, 'a deleted user\'s key → MCP 401')
} finally {
  if (policyChanged) {
    const r = await A('PUT', '/api/admin/api-keys', { noExpiry: false })
    console.log(`restore policy OFF → ${r.status}`)
  }
  await sql`delete from apikey where name in ('first','y365','d1','admin-key','forever','use','old','left') and reference_id = ${uId ?? ''}`.catch(() => {})
  await sql.end()
}
console.log(failed ? `${failed} FAILED` : `all checks passed${skipped ? ` (${skipped} skipped)` : ''}`)
process.exit(failed ? 1 : 0)
