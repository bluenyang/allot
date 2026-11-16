// API check for spec 008 V-4 (authentication), V-5 (isolation) and V-6 (tools) of the MCP endpoint.
//   docker compose -f docker/compose.dev.yaml restart api      (the failure limit is in memory: start clean)
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://127.0.0.1:3000 api node tests/api/mcp.mjs auth
// Run it inside the api container of the dev stack (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD). A is
// ADMIN_EMAIL; the other users are created here and deleted at the end. Keys for these checks are
// written straight into the `apikey` table in the form the plugin stores them (the way a key made
// on the screen looks in the database: SHA-256 base64url of the key); making keys through the
// screen's API is tests/api/api-keys.mjs. No raw key is printed or written anywhere.
//   auth       V-4: every refusal is the same 401, the per-address limit (21st failure → 429), the per-key
//              limit, a session or a key on the wrong path, GET, a big body, a foreign Origin.
//              Ends by exhausting the address limit: restart the api before the next mode.
// Exit 0 only if every check passed. The login rate limit (5/min) is respected: one sign-in per user.
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

const mode = process.argv[2]
if (!['auth'].includes(mode)) throw new Error('usage: mcp.mjs auth')
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const sha = (k) => createHash('sha256').update(k).digest('base64url')
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const newKey = () => 'allot_' + Array.from(randomBytes(64), (b) => LETTERS[b % 52]).join('')

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}, useCookie = true) => {
    const all = { 'content-type': 'application/json', origin: BASE, ...(cookie && useCookie ? { cookie } : {}), ...headers }
    for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k]
    const res = await fetch(BASE + path, {
      method,
      headers: all,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text, headers: res.headers }
  }
  api.signIn = (email, password) => api('POST', '/api/auth/sign-in/email', { email, password })
  return api
}

const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
const ACCEPT = 'application/json, text/event-stream'
const bearer = (k) => `Bearer ${k}`
/** One MCP request: `auth` is the whole Authorization value (null: none), no cookie, no Origin unless given. */
const mcpAuth = (A, auth, body = RPC, extra = {}) =>
  A('POST', '/api/mcp', body, { accept: ACCEPT, ...(auth === null ? {} : { authorization: auth }), origin: undefined, ...extra }, false)
const mcp = (A, key, body = RPC, extra = {}) => mcpAuth(A, bearer(key), body, extra)

/** Insert a key the way the plugin stores it. */
async function insertKey(userId, over = {}) {
  const key = newKey()
  await sql`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, expires_at, created_at, updated_at)
    values (${randomBytes(12).toString('hex')}, 'default', ${over.name ?? 'v4'}, ${key.slice(0, 6)}, ${userId}, 'allot_', ${sha(key)}, ${over.enabled ?? true}, true, 60000, 120, 0,
      ${over.permissions ?? '{"mcp":["read"]}'}, ${over.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)}, now(), now())`
  return key
}

const A = client()
const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
ok(sa.status === 200, `A sign-in ${sa.status}`)
if (failed) process.exit(1)
const aId = sa.json.user.id
const made = []
const createUser = async (tag) => {
  const email = `v4-${tag}-${Date.now()}@example.com`
  const r = await A('POST', '/api/auth/admin/create-user', { email, password: 'v4-pass-12345', name: `V4 ${tag}`, role: 'user' })
  if (r.status !== 200) throw new Error(`create-user ${tag} → ${r.status}`)
  made.push({ id: r.json.user.id, email })
  return r.json.user.id
}

try {
  // ── the good key works ──
  const good = await insertKey(aId)
  const g = await mcp(A, good)
  ok(g.status === 200 && g.json?.jsonrpc === '2.0' && g.json?.id === 1, `a valid key: tools/list → ${g.status}`)
  ok(!g.headers.get('mcp-session-id'), 'stateless: no session id is handed out')
  const init = await mcp(A, good, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v4', version: '1' } } })
  ok(init.status === 200 && init.json?.result?.serverInfo?.name === 'allot', `initialize → ${init.status}, server ${init.json?.result?.serverInfo?.name}`)

  // ── every refusal looks the same ──
  const revoked = await insertKey(aId)
  await sql`delete from apikey where key = ${sha(revoked)}`
  const expired = await insertKey(aId, { expiresAt: new Date(Date.now() - 60_000) })
  const disabled = await insertKey(aId, { enabled: false })
  const noScope = await insertKey(aId, { permissions: '{"other":["read"]}' })
  const bannedId = await createUser('banned')
  const bannedKey = await insertKey(bannedId)
  const banned = await A('POST', `/api/admin/users/${bannedId}/ban`, { reason: 'v4' })
  ok(banned.status === 200, `ban the user of a key → ${banned.status}`)
  const pendingId = await createUser('pending')
  const pendingKey = await insertKey(pendingId)
  await sql`update "user" set status = 'pending' where id = ${pendingId}`
  const goodStill = await mcp(A, good)
  ok(goodStill.status === 200, `the good key still works → ${goodStill.status}`)

  const cases = [
    ['no Authorization header', null],
    ['an unknown key', bearer(newKey())],
    ['a revoked key', bearer(revoked)],
    ['an expired key', bearer(expired)],
    ['a disabled key', bearer(disabled)],
    ['a key without the mcp scope', bearer(noScope)],
    ["a banned account's key", bearer(bannedKey)],
    ["a pending account's key", bearer(pendingKey)],
    ['the Basic scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['an empty token', 'Bearer '],
    ['a short token', 'Bearer x'],
    ['the right key with a different scheme', `Token ${good}`],
  ]
  const seen = []
  for (const [what, auth] of cases) {
    const r = await mcpAuth(A, auth)
    seen.push({ what, status: r.status, text: r.text, www: r.headers.get('www-authenticate') })
  }
  const same = seen.every((s) => s.status === 401 && s.text === '{"error":"unauthorized"}' && s.www === 'Bearer')
  for (const s of seen) ok(s.status === 401 && s.text === '{"error":"unauthorized"}' && s.www === 'Bearer', `${s.what} → ${s.status} ${s.text} (WWW-Authenticate ${s.www})`)
  ok(same && new Set(seen.map((s) => `${s.status}|${s.text}|${s.www}`)).size === 1, 'all refusals are byte-identical')

  // ── other ways in and out ──
  const cookieOnly = await A('POST', '/api/mcp', RPC, { accept: ACCEPT })
  ok(cookieOnly.status === 401, `a session cookie alone on /api/mcp → ${cookieOnly.status} (want 401)`)
  for (const [m, p] of [['GET', '/api/state'], ['GET', '/api/me'], ['GET', '/api/keys']]) {
    const r = await A(m, p, undefined, { authorization: `Bearer ${good}` }, false)
    ok(r.status === 401, `the key on ${m} ${p} → ${r.status} (want 401)`)
  }
  for (const m of ['GET', 'DELETE', 'PUT']) {
    const r = await A(m, '/api/mcp', undefined, { accept: ACCEPT, authorization: `Bearer ${good}` }, false)
    ok(r.status === 405 && r.headers.get('allow') === 'POST', `${m} /api/mcp → ${r.status} (want 405, Allow POST)`)
  }
  const big = await mcp(A, good, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { pad: 'x'.repeat(65 * 1024) } }))
  ok(big.status === 413, `a 65 KB body → ${big.status} (want 413)`)
  const small = await mcp(A, good, JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { pad: 'x'.repeat(60 * 1024) } }))
  ok(small.status === 200, `a 60 KB body → ${small.status} (want 200)`)
  const foreign = await mcp(A, good, RPC, { origin: 'https://evil.example' })
  ok(foreign.status === 403, `an untrusted Origin → ${foreign.status} (want 403)`)
  const own = await mcp(A, good, RPC, { origin: BASE })
  ok(own.status === 200, `the server's own Origin → ${own.status} (want 200)`)
  const notJson = await mcp(A, good, '{not json')
  ok(notJson.status === 400 && notJson.json?.error?.code === -32700, `invalid JSON → ${notJson.status} ${notJson.json?.error?.code} (want 400, -32700)`)

  // ── the limit per key: 120 a minute ──
  const busy = await insertKey(aId)
  let firstLimited = 0
  for (let i = 1; i <= 125; i++) {
    const r = await mcp(A, busy)
    if (r.status === 429) { firstLimited = i; break }
    if (r.status !== 200) { firstLimited = -i; break }
  }
  ok(firstLimited === 121, `per-key limit: the 121st request in a minute is the first 429 (got ${firstLimited})`)
  const [{ n: rows }] = await sql`select count(*)::int as n from apikey where key = ${sha(busy)}`
  ok(rows === 1, 'a limited key is not deleted')

  // ── the limit per address: 20 failures in 10 minutes, the 21st is 429 ──
  // This process has made `cases.length` failures above, and the cookie-only call has none of the
  // Authorization header, which counts as one more. Calls refused before the check (405, 413, 403)
  // and the key on other paths do not count.
  let counted = cases.length + 1
  let last
  for (let i = 0; i < 40; i++) {
    last = await mcp(A, newKey())
    if (last.status === 429) break
    counted++
  }
  ok(counted === 20, `the 20th failure is the last that gets a 401 (counted ${counted})`)
  ok(last?.status === 429 && !!last.headers.get('retry-after') && last.json?.error === 'too_many_requests',
    `the 21st failure → ${last?.status}, Retry-After ${last?.headers.get('retry-after')} (want 429)`)
  const blockedGood = await mcp(A, good)
  ok(blockedGood.status === 429, `from a blocked address even a valid key waits → ${blockedGood.status} (want 429)`)
} finally {
  await sql`delete from apikey where name = 'v4'`.catch(() => {})
  for (const u of made) {
    const r = await A('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: u.email })
    if (r.status !== 204) console.log(`cleanup: delete ${u.email} → ${r.status}`)
  }
  await sql.end()
}
console.log(failed ? `${failed} FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
