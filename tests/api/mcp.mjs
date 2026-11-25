// API check for spec 008 V-4 (authentication), V-5 (isolation) and V-6 (tools) of the MCP endpoint.
//   docker compose -f docker/compose.dev.yaml restart api      (the failure limit is in memory: start clean)
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://127.0.0.1:3000 api node tests/api/mcp.mjs auth
// Run it inside the api container of the dev stack (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD). A is
// ADMIN_EMAIL; the other users are created here and deleted at the end. Keys for these checks are
// written straight into the `apikey` table in the form the plugin stores them (the way a key made
// on the screen looks in the database: SHA-256 base64url of the key); making keys through the
// screen's API is tests/api/api-keys.mjs. No raw key is printed or written anywhere.
//   isolation  V-5: users A and B each put marked data in; A's key calls all twelve read tools and nothing of B shows, and back.
//   tools      V-6: tools/list (twelve, read-only; get_income: spec 014 S-10), get_overview for this month and three months on against calc.ts,
//              get_budget and list_accounts against calc.ts (spec 013 S-10), an unknown tool and bad arguments, list_changes paging;
//              spec 013 rev 1: search against src/lib/search.ts, list_notifications against calc.ts, list_changes since/until,
//              the month adjustments and maturity schedule in get_budget (S-14, S-15, S-18..S-20).
//   write      spec 009 V-3…V-9 through the tools: scope, proposals, previews, apply, confirmation methods,
//              stale / expired / revoked, revert, isolation (a fresh user W; keys are made through the API);
//              spec 013 S-10: living items, accounts, cards, a balance record and a buffer use proposed, confirmed, read back and reverted;
//              spec 013 S-14: a month adjustment proposed, applied, read back in get_overview and get_budget (this month only), deleted.
//   auth       V-4: every refusal is the same 401, the per-address limit (21st failure → 429), the per-key
//              limit, a session or a key on the wrong path, GET, a big body, a foreign Origin.
//              Ends by exhausting the address limit: restart the api before the next mode.
// Exit 0 only if every check passed. The login rate limit (5/min) is respected: one sign-in per user.
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { arm, cleanupStep, disarm, failures, ok, settle, threw } from './lib/check.mjs'

const mode = process.argv[2]
if (!['auth', 'isolation', 'tools', 'write'].includes(mode)) throw new Error('usage: mcp.mjs auth|isolation|tools|write')
const cleanups = [] // run in the final `finally` (rows made by id, deleted by id even if a check threw)
// The first failed check stops the run (tests/api/lib/check.mjs; audit 0.1.7 rc.3 F-3): inside the main try it
// throws once, no further write happens, and the finally block below still cleans up. Later failures are only reported.
/** One cleanup DELETE that never throws: a throw is counted and logged, a status other than 204 is logged (A-47). */
const drop = (api, path) => cleanupStep(`DELETE ${path.replace(/\/[^/]+$/, '/<id>')}`, async () => {
  const r = await api('DELETE', path)
  return r.status === 204 ? undefined : r.status
})
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
  await sql`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, metadata, expires_at, created_at, updated_at)
    values (${randomBytes(12).toString('hex')}, 'default', ${over.name ?? 'v4'}, ${key.slice(0, 6)}, ${userId}, 'allot_', ${sha(key)}, ${over.enabled ?? true}, true, 60000, 120, 0,
      ${over.permissions ?? '{"mcp":["read"]}'}, ${over.metadata ?? null}, ${over.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)}, now(), now())`
  return key
}

const A = client()
const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
ok(sa.status === 200, `A sign-in ${sa.status}`)
if (failures()) process.exit(1)
const aId = sa.json.user.id
const made = []
const skip = (msg) => console.log(`SKIP ${msg}`)
const createUser = async (tag) => {
  const email = `v4-${tag}-${Date.now()}@example.com`
  const r = await A('POST', '/api/auth/admin/create-user', { email, password: 'v4-pass-12345', name: `V4 ${tag}`, role: 'user' })
  if (r.status !== 200) throw new Error(`create-user ${tag} → ${r.status}`)
  made.push({ id: r.json.user.id, email })
  return r.json.user.id
}

const TOOLS = ['get_overview', 'list_subscriptions', 'list_plan_changes', 'get_allocation', 'get_schedule', 'list_changes', 'list_spendings', 'get_budget', 'list_accounts', 'search', 'list_notifications', 'get_income']
let rpcId = 100
/** tools/call → { status, result (the tool's result), error (JSON-RPC error), data (structuredContent) } */
async function tool(key, name, args = {}) {
  const r = await mcp(A, key, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })
  return { status: r.status, result: r.json?.result, error: r.json?.error, data: r.json?.result?.structuredContent, text: r.text }
}
const failedCall = (t) => !!t.error || t.result?.isError === true || t.status >= 400

async function authMode() {
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

  // ── an account that may not use the app gets the plain 401 even over the key's limit (review finding 3) ──
  const limitedBannedId = await createUser('limited-banned')
  const limitedPendingId = await createUser('limited-pending')
  let overLimit = 0
  for (const [what, uid, block] of [
    ['banned', limitedBannedId, () => A('POST', `/api/admin/users/${limitedBannedId}/ban`, { reason: 'v4' })],
    ['pending', limitedPendingId, () => sql`update "user" set status = 'pending' where id = ${limitedPendingId}`],
  ]) {
    const k = await insertKey(uid)
    let n = 0
    for (; n < 125; n++) if ((await mcp(A, k)).status === 429) break
    ok(n === 120, `${what}-to-be account: its active key reaches the limit after 120 requests (${n})`)
    await block()
    const r = await mcp(A, k)
    ok(r.status === 401 && r.text === seen[0].text && r.headers.get('www-authenticate') === seen[0].www, `a ${what} account's key over its limit: the common 401, not 429 (${r.status})`)
    overLimit++
  }

  // ── the limit per address: 20 failures in 10 minutes, the 21st is 429 ──
  // This process has made `cases.length` failures above, and the cookie-only call has none of the
  // Authorization header, which counts as one more. Calls refused before the check (405, 413, 403)
  // and the key on other paths do not count.
  let counted = cases.length + 1 + overLimit
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
}

async function isolationMode() {
  const calc0 = await import('../../src/lib/calc.ts')
  const stamp = Date.now()
  const users = {}
  const mk = async (tag, existing) => {
    const marker = `ISO${tag}${stamp}`
    let api, id
    if (existing) { api = existing.api; id = existing.id } else {
      id = await createUser(`iso${tag.toLowerCase()}`)
      api = client()
      const email = made[made.length - 1].email
      const si = await api.signIn(email, 'v4-pass-12345')
      ok(si.status === 200, `${tag} sign-in ${si.status}`)
      if (si.status !== 200) throw new Error('sign-in failed')
    }
    const key = await insertKey(id)
    const made_ = []
    // registered before the first post, so a post that fails half-way still removes the rows made before it (A-47)
    cleanups.push(async () => { for (const [path, rid] of [...made_].reverse()) await drop(api, `${path}/${rid}`) })
    const post = async (path, body) => {
      const r = await api('POST', path, body)
      if (r.status !== 201) throw new Error(`POST ${path} → ${r.status} ${r.text}`)
      made_.push([path, r.json.id])
      return r.json
    }
    const thisMonth = new Date().toISOString().slice(0, 7)
    const sub = await post('/api/subscriptions', { name: `${marker}-sub`, category: 'tool', plan: `${marker}-plan`, amount: 5000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: `${thisMonth}-20`, path: 'direct', verified: false })
    await post('/api/plan-changes', { subId: sub.id, effective: `${thisMonth}-28`, to: { amount: 7000 }, note: `${marker}-change` })
    await post('/api/targets', { name: `${marker}-target`, kind: 'fixed', note: `${marker}-tnote` })
    await post('/api/events', { when: thisMonth, kind: '저축', title: `${marker}-event`, state: 'todo' })
    await post('/api/checks', { text: `${marker}-check`, done: false })
    const account = await post('/api/accounts', { name: `${marker}-account`, role: 'r', inflow: 'i', outflow: 'o' })
    await post('/api/balances', { accountId: account.id, date: `${thisMonth}-01`, amount: 1000, note: `${marker}-balance` })
    await post('/api/cards', { name: `${marker}-card`, last4: '', accountId: account.id, billingDay: null })
    await post('/api/living-items', { name: `${marker}-living`, kind: '', payMethod: '', amount: 1000, from: null, amounts: {} })
    await post('/api/spendings', { name: `${marker}-spend`, note: '', category: 'etc', bought: `${thisMonth}-02`, amount: 33_000, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'installment', payBy: 'salary', count: 2, fee: 0, interval: null, cancelled: false,
      rounds: [{ no: 1, date: `${thisMonth}-15`, amount: 16_500, state: 'left', edited: false }, { no: 2, date: `${calc0.addYm(thisMonth, 1)}-15`, amount: 16_500, state: 'left', edited: false }] })
    await post('/api/debts', { name: `${marker}-debt`, principal: 1000, rate: '1%', method: 'm', plan: 'p' })
    users[tag] = { id, api, key, marker, made: made_ }
  }
  const aExisting = { api: A, id: aId }
  await mk('A', aExisting)
  await mk('B')
  // B also has a phase (B has none yet; A's phases are A's own data and may not overlap)
  const bPhase = await users.B.api('POST', '/api/phases', { label: 'PB', name: `${users.B.marker}-phase`, from: '2020-01', to: null, amounts: {} })
  ok(bPhase.status === 201, `B phase → ${bPhase.status}`)
  users.B.made.push(['/api/phases', bPhase.json?.id])

  const uuidIds = (state) => JSON.stringify(state).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
  const ownStrings = (state) => [...state.subscriptions.map((x) => x.name), ...state.targets.map((x) => x.name), ...state.accounts.map((x) => x.name), ...state.debts.map((x) => x.name), ...(state.spendings ?? []).map((x) => x.name),
    ...(state.cards ?? []).map((x) => x.name), ...(state.livingItems ?? []).map((x) => x.name)].filter((x) => x.length >= 4)
  const states = {}
  for (const tag of ['A', 'B']) states[tag] = (await users[tag].api('GET', '/api/state')).json
  const calls = [['get_overview', {}], ['list_subscriptions', {}], ['list_plan_changes', {}], ['get_allocation', {}], ['get_schedule', { months: 12 }], ['list_changes', { limit: 50 }], ['list_spendings', {}], ['get_budget', {}], ['list_accounts', {}], ['search', { query: 'ISO' }], ['list_notifications', {}], ['get_income', {}]]
  for (const [me, other] of [['A', 'B'], ['B', 'A']]) {
    const out = {}
    const outD = {}
    for (const [name, args] of calls) {
      const t = await tool(users[me].key, name, args)
      ok(!failedCall(t) && !!t.data, `${me}'s key: ${name} → ${t.status}${t.error ? ' ' + JSON.stringify(t.error) : ''}`)
      out[name] = t.text
      outD[name] = t.data
    }
    const all = Object.values(out).join('\n')
    ok(!all.includes(users[other].marker), `${me}'s key: nothing marked ${users[other].marker} in any of the twelve answers`)
    const foreignIds = uuidIds(states[other]).filter((x) => !uuidIds(states[me]).includes(x))
    ok(foreignIds.length > 0 && !foreignIds.some((x) => all.includes(x)), `${me}'s key: none of ${other}'s ${foreignIds.length} ids appear`)
    const foreignNames = ownStrings(states[other]).filter((n) => !ownStrings(states[me]).includes(n))
    ok(foreignNames.length > 0 && !foreignNames.some((n) => all.includes(n)), `${me}'s key: none of ${other}'s ${foreignNames.length} names appear`)
    // and the user's own marked data is there
    const m = users[me].marker
    ok(out.list_subscriptions.includes(`${m}-sub`) && out.list_plan_changes.includes(`${m}-change`) && out.get_allocation.includes(`${m}-target`)
      && out.get_allocation.includes(`${m}-account`) && out.get_allocation.includes(`${m}-debt`) && out.get_schedule.includes(`${m}-event`) && out.get_schedule.includes(`${m}-check`),
      `${me}'s key: ${me}'s own marked data is in the answers`)
    const mine = outD.list_spendings.spendings.filter((x) => x.name.startsWith('ISO'))
    ok(mine.length === 1 && mine[0].name === `${m}-spend` && mine[0].rounds.length === 2 && outD.get_overview.spendingRounds.some((r) => r.name === `${m}-spend`) && out.get_schedule.includes(`${m}-spend`),
      `${me}'s key: list_spendings, get_overview and get_schedule show ${me}'s own spending and its rounds, and no other ISO one`)
    ok(!out.list_spendings.includes(users[other].marker) && !out.get_overview.includes(users[other].marker) && !out.get_schedule.includes(users[other].marker), `${me}'s key: ${other}'s spending is in none of the three`)
    ok(out.list_changes.includes('subscription') || out.list_changes.includes(`${m}-sub`), `${me}'s key: list_changes shows ${me}'s own changes`)
    ok(out.list_accounts.includes(`${m}-account`) && out.list_accounts.includes(`${m}-balance`) && out.list_accounts.includes(`${m}-card`) && out.get_budget.includes(`${m}-living`),
      `${me}'s key: list_accounts shows ${me}'s own account, balance record and card, get_budget ${me}'s own living item`)
    const found = outD.search.results.map((x) => x.name)
    ok([`${m}-sub`, `${m}-spend`, `${m}-living`, `${m}-account`, `${m}-card`, `${m}-target`, `${m}-event`, `${m}-check`].every((n) => found.includes(n)) && !found.some((n) => n.includes(users[other].marker)),
      `${me}'s key: search finds ${me}'s own marked rows of every kind and none of ${other}'s`)
  }
  // A's key cannot ask for B's data by id or by any argument: the tools take none, and an extra argument is ignored or refused
  const sneaky = await tool(users.A.key, 'list_changes', { limit: 50, userId: users.B.id })
  ok(!JSON.stringify(sneaky.text).includes(users.B.marker), "an extra userId argument does not reach B's data")
  // clean up both users' marked rows by id (the users go at the end), then the spendings must be gone
  for (const tag of ['A', 'B']) for (const [path, id] of [...users[tag].made].reverse()) await users[tag].api('DELETE', `${path}/${id}`)
  for (const tag of ['A', 'B']) ok(!(await users[tag].api('GET', '/api/state')).json.spendings.some((x) => x.name.includes(users[tag].marker)), `${tag}'s marked spending is gone`)
}

async function toolsMode() {
  const calc = await import('../../src/lib/calc.ts')
  const key = await insertKey(aId)
  const list = await mcp(A, key)
  const tools = list.json?.result?.tools ?? []
  ok(tools.length === TOOLS.length && TOOLS.every((n) => tools.some((t) => t.name === n)), `tools/list: exactly the twelve tools (${tools.map((t) => t.name).join(', ')})`)
  ok(tools.every((t) => t.annotations?.readOnlyHint === true), 'every tool says readOnlyHint: true')
  ok(tools.every((t) => !/create|update|delete|write|set_|add_|remove/.test(t.name)), 'no tool name is a write')
  ok(tools.every((t) => typeof t.description === 'string' && /^[\x20-\x7e]+$/.test(t.description)), 'descriptions are English text')

  const unknown = await tool(key, 'delete_everything', {})
  ok(failedCall(unknown), `an unknown tool is an MCP error (${unknown.status} ${JSON.stringify(unknown.error ?? unknown.result?.content?.[0]?.text)?.slice(0, 80)})`)
  for (const [name, args] of [['get_overview', { month: '2026-13' }], ['get_overview', { month: 'now' }], ['get_schedule', { months: 13 }], ['get_schedule', { months: 0 }], ['list_changes', { limit: 51 }], ['list_changes', { before: '2026-01-01 00:00:00+00' }], ['list_subscriptions', { status: 'gone' }], ['get_budget', { month: '2026-00' }],
    ['search', {}], ['list_changes', { since: 'not a time' }], ['list_changes', { until: '2026-13-45' }]]) {
    const t = await tool(key, name, args)
    ok(failedCall(t), `${name} ${JSON.stringify(args)} is refused`)
  }
  // list_accounts takes any number of months, clamped to 1..120 (review 1 F-13: no limit the spec did not state)
  for (const [months, want] of [[0, 1], [25, 25], [500, 120]]) {
    const t = await tool(key, 'list_accounts', { months })
    const p = t.data?.accounts?.find((x) => Array.isArray(x.projection))?.projection
    ok(!failedCall(t) && (p === undefined || p.length === want), `list_accounts {"months":${months}} answers with ${want} months of projection`)
  }

  // A timestamp that does not exist is an input error, and no tool failure shows SQL (review finding 1).
  for (const before of ['2026-99-99 00:00:00Z', '2026-02-30 00:00:00Z']) {
    const t = await tool(key, 'list_changes', { before, beforeId: 'x' })
    const text = JSON.stringify(t)
    ok(failedCall(t) && !/select|insert|\$1|params|"change/i.test(text), `list_changes before ${before} is refused without SQL in the answer`)
  }

  const state = (await A('GET', '/api/state')).json
  const now = new Date()
  const ym0 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const ym3 = calc.addYm(ym0, 3)
  for (const ym of [ym0, ym3]) {
    const t = await tool(key, 'get_overview', { month: ym })
    ok(!failedCall(t) && t.data?.month === ym, `get_overview ${ym} → ${t.status}`)
    const o = t.data
    // monthMoney: the same call every screen makes, so one-off spendings are in both halves (spec 011 S-5)
    const { transfer: x, dist } = calc.monthMoney(state, ym)
    ok(o.subscriptionTransfer.transferKrw === x.transfer && o.subscriptionTransfer.neededKrw === x.needed, `${ym}: the subscription transfer is calc.ts's (${x.transfer})`)
    ok(JSON.stringify(o.distribution.rows.map((r) => [r.targetId, r.amountKrw])) === JSON.stringify(dist.rows.map((r) => [r.key, Math.round(r.amount)])) && o.distribution.remainderKrw === Math.round(dist.remainder),
      `${ym}: the distribution rows and the remainder are calc.ts's (${dist.rows.length} rows)`)
    const d = calc.monthDates(ym, state.settings, new Set())
    ok(o.dates.pay.nominal === d.pay.nominal && o.dates.transfer.nominal === d.transfer.nominal && o.dates.billing.nominal === d.billing.nominal, `${ym}: the nominal pay, transfer and billing dates are calc.ts's`)
    const ups = calc.upcomingPayments(state.subscriptions, state.planChanges, state.settings, calc.parseDate(`${ym}-01`), new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate() - 1).filter((p) => calc.ymd(p.date).startsWith(ym))
    ok(JSON.stringify(o.payments.map((p) => [p.date, p.subscriptionId, p.amountKrw])) === JSON.stringify(ups.map((p) => [calc.ymd(p.date), p.sub.id, Math.round(p.krw)])), `${ym}: the ${ups.length} payments are calc.ts's`)
    ok(JSON.stringify(o.planChanges.map((c) => c.id)) === JSON.stringify(calc.changesIn(state.planChanges, ym).map((c) => c.id)), `${ym}: the plan changes are calc.ts's`)
    ok(o.settings.netPay === state.settings.netPay && o.settings.fxRate === state.settings.fxRate, `${ym}: settings carried`)
    ok(t.result?.content?.[0]?.text === JSON.stringify(t.data), 'the text content is the same JSON as structuredContent')
  }
  const subs = await tool(key, 'list_subscriptions', {})
  ok(!failedCall(subs) && subs.data.subscriptions.length === state.subscriptions.length, `list_subscriptions: all ${state.subscriptions.length} subscriptions`)
  const act = await tool(key, 'list_subscriptions', { status: 'active' })
  ok(act.data.subscriptions.every((s) => s.status === 'active'), 'list_subscriptions status filter')
  const pc = await tool(key, 'list_plan_changes', {})
  ok(pc.data.planChanges.length === state.planChanges.length, `list_plan_changes: ${state.planChanges.length}`)
  const al = await tool(key, 'get_allocation', {})
  ok(al.data.targets.length === state.targets.length && al.data.phases.length === state.phases.length && al.data.debts.length === state.debts.length, 'get_allocation: targets, phases, debts as stored')
  const ls = await tool(key, 'list_spendings', {})
  const stSp = state.spendings ?? []
  ok(!failedCall(ls) && ls.data.spendings.length === stSp.length && stSp.every((x) => ls.data.spendings.some((y) => y.id === x.id && y.rounds.length === x.rounds.length)), `list_spendings: all ${stSp.length} spendings with their rounds`)
  for (const st of ['active', 'done', 'cancelled']) {
    const f = await tool(key, 'list_spendings', { status: st })
    ok(!failedCall(f) && f.data.spendings.every((x) => (st === 'cancelled' ? x.cancelled : st === 'done' ? x.state === 'paid' : !x.cancelled && x.state !== 'paid')), `list_spendings status ${st}`)
  }
  for (const bad of [{ status: 'gone' }, { month: '2026-13' }]) ok(failedCall(await tool(key, 'list_spendings', bad)), `list_spendings ${JSON.stringify(bad)} is refused`)
  // spec 013 S-10: the budget menus and the accounts, with the functions the screens use
  for (const ym of [ym0, ym3]) {
    const b = await tool(key, 'get_budget', { month: ym })
    const items = state.livingItems ?? []
    const { dist } = calc.monthMoney(state, ym)
    ok(!failedCall(b) && b.data?.month === ym && b.data.living.items.length === items.length && b.data.living.sumKrw === calc.livingAt(items, state.phases, ym).sum, `get_budget ${ym}: the ${items.length} living items and their sum are calc.ts's`)
    for (const g of ['saving', 'invest']) {
      const x = calc.groupAt(g, state.accounts, state.phases, state.targets, state.settings, ym, state.monthAdjusts ?? [])
      ok(b.data?.[g]?.mode === x.mode && b.data[g].sumKrw === x.sum && b.data[g].totalKrw === x.total && JSON.stringify(b.data[g].items.map((i) => [i.accountId, i.monthKrw])) === JSON.stringify(x.rows.map((r) => [r.account.id, r.amount])),
        `get_budget ${ym}: ${g} (${x.mode}, ${x.rows.length} items) is calc.ts's`)
    }
    ok(b.data?.targets?.length === state.targets.length && b.data.targets.every((t) => t.amountKrw === (t.kind === 'remainder' ? dist.remainder : (dist.rows.find((r) => r.key === t.targetId)?.amount ?? 0))) && b.data.remainderKrw === dist.remainder,
      `get_budget ${ym}: what every target gets is monthMoney's`)
    const adj = (state.monthAdjusts ?? []).filter((a) => a.ym === ym)
    ok(JSON.stringify((b.data?.monthAdjusts ?? []).map((a) => [a.id, a.targetId, a.amountKrw])) === JSON.stringify(adj.map((a) => [a.id, a.targetId, a.amount])), `get_budget ${ym}: the ${adj.length} month adjustments of the month`)
    ok(Array.isArray(b.data?.maturity) && b.data.maturity.every((m) => state.accounts.some((a) => a.id === m.accountId && a.group === 'saving' && a.from) && /^\d{4}-\d{2}$/.test(m.maturityMonth)), `get_budget ${ym}: the maturity schedule lists savings items with a from month (${b.data?.maturity?.length})`)
  }
  const la = await tool(key, 'list_accounts', {})
  const bal = state.balances ?? []
  ok(!failedCall(la) && la.data?.accounts?.length === state.accounts.length && la.data.cards.length === (state.cards ?? []).length, `list_accounts: all ${state.accounts.length} accounts and ${(state.cards ?? []).length} cards`)
  ok((la.data?.accounts ?? []).every((a) => a.balances.length === bal.filter((x) => x.accountId === a.id).length && (a.projection === null) === !bal.some((x) => x.accountId === a.id) && (a.projection === null || a.projection.length === 12)),
    'list_accounts: every balance record, and twelve months of projection exactly for the accounts that have one')
  ok((la.data?.accounts ?? []).every((a) => { const g = calc.bufferGauge(state.accounts.find((x) => x.id === a.id), state, calc.ymd(calc.today())); return a.buffer.bufferKrw === g.buffer && a.buffer.usedKrw === g.used && a.buffer.leftKrw === g.left }), 'list_accounts: the buffer gauges are calc.ts\'s')
  const la3 = await tool(key, 'list_accounts', { months: 3 })
  ok(!failedCall(la3) && la3.data.accounts.every((a) => a.projection === null || (a.projection.length === 3 && a.projection[0].month === ym0)), 'list_accounts months 3: three months from this month')
  ok(al.data.targets.every((t) => 'accountId' in t) && al.data.accounts.every((a) => 'group' in a && 'role' in a && 'inflow' in a && 'outflow' in a), 'get_allocation: targets with accountId, accounts with group and the old fields')

  const sc = await tool(key, 'get_schedule', { from: ym0, months: 3 })
  ok(sc.data.months.length === 3 && sc.data.months[0].month === ym0 && sc.data.months[2].month === calc.addYm(ym0, 2), 'get_schedule: three months from the first')
  const sc12 = await tool(key, 'get_schedule', { months: 12 })
  ok(sc12.data.months.length === 12, 'get_schedule: months 12')

  const p1 = await tool(key, 'list_changes', { limit: 1 })
  ok(!failedCall(p1) && p1.data.sets.length === 1, 'list_changes limit 1 → one set')
  if (p1.data.next) {
    const p2 = await tool(key, 'list_changes', { limit: 1, before: p1.data.next.before, beforeId: p1.data.next.beforeId })
    ok(!failedCall(p2) && p2.data.sets.length <= 1 && p2.data.sets[0]?.id !== p1.data.sets[0].id, `list_changes: the next page is another set (${p2.data.sets[0]?.id ?? 'none'})`)
  } else skip('list_changes paging (only one set in the history)')

  // ── spec 013 S-18: list_changes takes the period of the change history (since inclusive, until exclusive) ──
  const allSets = (await A('GET', '/api/changes?limit=50')).json
  const pAll = await tool(key, 'list_changes', { limit: 50, since: '2000-01-01T00:00:00Z' })
  ok(!failedCall(pAll) && JSON.stringify(pAll.data.sets.map((x) => x.id)) === JSON.stringify(allSets.map((x) => x.id)), 'list_changes since 2000: the same sets as without a period')
  const pNone = await tool(key, 'list_changes', { since: '2999-01-01' })
  ok(!failedCall(pNone) && pNone.data.sets.length === 0, 'list_changes since 2999: nothing')
  const pOld = await tool(key, 'list_changes', { until: '2000-01-01' })
  ok(!failedCall(pOld) && pOld.data.sets.length === 0, 'list_changes until 2000: nothing')
  if (allSets.length >= 2) {
    const cut = allSets[1].at // the second newest: since takes it and the newer one
    const api = (await A('GET', `/api/changes?limit=50&since=${encodeURIComponent(cut)}`)).json
    const viaTool = await tool(key, 'list_changes', { limit: 50, since: cut })
    ok(!failedCall(viaTool) && JSON.stringify(viaTool.data.sets.map((x) => x.id)) === JSON.stringify(api.map((x) => x.id)) && viaTool.data.sets.length >= 2, `list_changes since ${cut}: the sets GET /api/changes gives (${api.length})`)
  } else skip('list_changes period against the API (fewer than two sets)')

  // ── spec 013 S-19: search is the header search's matching (src/lib/search.ts) on the same state ──
  const srch = await import('../../src/lib/search.ts')
  const named = [...state.subscriptions, ...state.accounts, ...(state.spendings ?? [])].find((x) => x.name.length >= 2)
  for (const query of [named ? named.name.slice(0, 2) : 'a', 'a', '  ']) {
    const t = await tool(key, 'search', { query })
    const want = srch.search(state, query)
    ok(!failedCall(t) && t.data.count === want.length && JSON.stringify(t.data.results.map((x) => [x.kind, x.id, x.matched, x.page])) === JSON.stringify(want.map((h) => [h.kind, h.id, h.field, h.path])),
      `search ${JSON.stringify(query)}: the ${want.length} results of src/lib/search.ts, in its order`)
  }
  const onlyAcc = await tool(key, 'search', { query: 'a', kinds: ['account'] })
  ok(!failedCall(onlyAcc) && onlyAcc.data.results.every((x) => x.kind === 'account') && onlyAcc.data.count === srch.search(state, 'a', ['account']).length, 'search kinds [account]: accounts only')
  // an unknown kind is taken and matches nothing (193f231: not refused); next to a known kind it is left out
  const gone = await tool(key, 'search', { query: 'a', kinds: ['gone'] })
  ok(!failedCall(gone) && gone.data.count === 0 && gone.data.results.length === 0, `search kinds [gone]: taken, no results (${gone.data?.count})`)
  const mixed = await tool(key, 'search', { query: 'a', kinds: ['gone', 'account'] })
  ok(!failedCall(mixed) && mixed.data.count === srch.search(state, 'a', ['account']).length, 'search kinds [gone, account]: the accounts only')

  // ── spec 013 S-20: list_notifications against calc.ts (charges and rounds of the next three days, this month's remainder) ──
  const ln = await tool(key, 'list_notifications', {})
  const todayStr = calc.ymd(calc.today())
  const in3 = calc.ymd(new Date(calc.today().getFullYear(), calc.today().getMonth(), calc.today().getDate() + 3))
  const charges = calc.upcomingPayments(state.subscriptions, state.planChanges, state.settings, calc.today(), 3).map((p) => `charge:${p.sub.id}:${calc.ymd(p.date)}`)
  const rounds = (state.spendings ?? []).filter((x) => !x.cancelled).flatMap((x) => x.rounds.filter((r) => r.state === 'left' && r.date >= todayStr && r.date <= in3).map((r) => `round:${x.id}:${r.no}:${r.date}`))
  const got = ln.data?.notifications ?? []
  ok(!failedCall(ln) && ln.data.date === todayStr && got.every((n) => typeof n.message === 'string' && n.message.length > 0 && typeof n.path === 'string'), `list_notifications: ${got.length} notifications, each with a sentence and a page`)
  ok(JSON.stringify(got.filter((n) => n.group === 'pay').map((n) => n.id).sort()) === JSON.stringify([...charges, ...rounds].sort()), `list_notifications: the ${charges.length} charges and ${rounds.length} rounds of the next three days are calc.ts's`)
  const rem = calc.monthMoney(state, todayStr.slice(0, 7)).dist.remainder
  ok(got.some((n) => n.kind === 'remainderShort') === rem < 0, `list_notifications: a remainder short notice exactly when this month's remainder (${rem}) is below 0`)
  ok(got.filter((n) => n.kind === 'proposals').every((n) => n.count === state.pendingProposals) && got.some((n) => n.kind === 'proposals') === state.pendingProposals > 0, `list_notifications: the proposals waiting (${state.pendingProposals})`)
}


async function writeMode() {
  const PASS = 'v4-pass-12345'
  const wId = await createUser('w')
  // W's rows are under row-level security: this connection acts as W (a non-superuser role, as on the test server, sees nothing otherwise)
  const sqlW = postgres(process.env.DATABASE_URL, { max: 1, connection: { 'app.user_id': wId } })
  const xId = await createUser('x')
  const W = client()
  const X = client()
  const wEmail = made.find((u) => u.id === wId).email
  const xEmail = made.find((u) => u.id === xId).email
  ok((await W.signIn(wEmail, PASS)).status === 200 && (await X.signIn(xEmail, PASS)).status === 200, 'W and X sign in')
  const mk = async (U, body) => {
    const r = await U('POST', '/api/keys', { expiresInDays: 30, ...body })
    if (r.status !== 201) throw new Error(`create key ${JSON.stringify(body)} → ${r.status} ${r.text}`)
    return { key: r.json.key, id: r.json.item.id }
  }
  const kRead = await mk(W, { name: 'w-read' })
  const kUi = await mk(W, { name: 'w-ui', write: true })
  const kChat = await mk(W, { name: 'w-chat', write: true, confirm: 'chat' })
  const kX = await mk(X, { name: 'x-chat', write: true, confirm: 'chat' })
  const WRITE_TOOLS = ['propose_changes', 'propose_revert', 'get_proposal', 'apply_proposal']
  const names = async (k) => ((await mcp(A, k)).json?.result?.tools ?? []).map((t) => t.name)

  // ── V-3: scope ──
  const rn = await names(kRead.key)
  ok(rn.length === TOOLS.length && ['list_spendings', 'get_budget', 'list_accounts', 'search', 'list_notifications', 'get_income'].every((n) => rn.includes(n)) && WRITE_TOOLS.every((n) => !rn.includes(n)), 'a read key: tools/list has the twelve read tools (list_spendings, get_budget, list_accounts, search, list_notifications and get_income among them) and no write tool')
  for (const [name, args] of [['propose_changes', { changes: [] }], ['apply_proposal', { proposalId: 'x' }], ['get_proposal', { proposalId: 'x' }], ['propose_revert', { changeSetId: 'x' }]]) {
    ok(failedCall(await tool(kRead.key, name, args)), `a read key calling ${name} is an MCP error`)
  }
  const un = await mcp(A, kUi.key)
  const utools = un.json?.result?.tools ?? []
  ok(utools.length === 16 && WRITE_TOOLS.every((n) => utools.some((t) => t.name === n)), `a write key: sixteen tools (twelve read with get_income, spec 014 S-10, and four write) (${utools.length})`)
  ok(utools.find((t) => t.name === 'apply_proposal')?.annotations?.destructiveHint === true && utools.find((t) => t.name === 'get_proposal')?.annotations?.readOnlyHint === true && utools.find((t) => t.name === 'propose_changes')?.annotations?.readOnlyHint === false, 'annotations: apply is destructive, get is read-only, propose is not read-only')
  ok(utools.every((t) => typeof t.description === 'string' && /^[\x20-\x7e]+$/.test(t.description)), 'write tool descriptions are English text')
  const pc = utools.find((t) => t.name === 'propose_changes')
  ok(JSON.stringify(pc?.inputSchema ?? {}).includes('subscriptions') && JSON.stringify(pc?.inputSchema ?? {}).includes('remainder-split') && JSON.stringify(pc?.inputSchema ?? {}).includes('spendings') && /spendings/.test(pc?.description ?? ''), 'propose_changes advertises the resource shapes (spendings too)')
  ok(['living-items', 'accounts', 'balances', 'cards'].every((r) => JSON.stringify(pc?.inputSchema ?? {}).includes(`"${r}"`)) && /buffer/.test(pc?.description ?? '') && /maturity/.test(pc?.description ?? '') && /mini PC/.test(pc?.description ?? ''),
    'propose_changes advertises living items, accounts, balances and cards, the buffer use and the two examples (spec 013 S-10)')
  ok(JSON.stringify(pc?.inputSchema ?? {}).includes('"month-adjusts"') && /month adjustments/.test(pc?.description ?? '') && /afterMaturity/.test(pc?.description ?? ''), 'propose_changes advertises the month adjustments and afterMaturity (spec 013 S-14, S-15)')
  console.log(`INFO propose_changes input schema: ${JSON.stringify(pc?.inputSchema ?? {}).length} bytes`)

  // without the badge's number, which a proposal changes by existing
  const wState = async () => { const { pendingProposals: _p, ...rest } = (await W('GET', '/api/state')).json; return rest }
  const wSets = async () => (await W('GET', '/api/changes?limit=200')).json
  const proposalCount = async (uid) => Number((await sqlW`select count(*)::int as n from mcp_proposal where user_id = ${uid}`)[0].n)
  const SUB = (name, over = {}) => ({ name, category: 'tool', plan: 'p', amount: 12000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false, ...over })
  const LIV = (food) => ({ food, transit: 20000, allowance: 30000 })

  // ── V-4: propose changes nothing ──
  const s0 = JSON.stringify(await wState())
  const n0 = (await wSets()).length
  const pr1 = await tool(kChat.key, 'propose_changes', { note: 'v4', changes: [
    { resource: 'subscriptions', action: 'create', data: SUB('mcp-sub') },
    { resource: 'living', action: 'update', data: LIV(111000) },
  ] })
  ok(!failedCall(pr1) && typeof pr1.data?.proposalId === 'string' && pr1.data.confirm === 'chat' && pr1.data.status === 'pending', `propose_changes → proposal ${pr1.data?.status} (${pr1.data?.confirm})`)
  // a fresh user has no living items yet: the old living resource makes the three coded ones (spec 013 S-2)
  const pr1Rows = pr1.data?.preview?.rows ?? []
  ok(pr1Rows.length === 4 && pr1Rows.filter((r) => r.table === 'living_item' && r.op === 'insert').length === 3 && pr1Rows.some((r) => r.table === 'subscription') && pr1.data.preview.months?.length === 2 && pr1.data.preview.months[0].transferKrw.after !== undefined,
    `the preview has rows (${pr1Rows.map((r) => r.table)}) and two months of transfer and distribution`)
  ok(/user agrees/.test(pr1.data?.next ?? ''), 'a chat proposal tells the AI to show the preview and wait for the user')
  ok(JSON.stringify(await wState()) === s0 && (await wSets()).length === n0, 'the data and the history are unchanged after proposing')
  const cnt1 = await proposalCount(wId)
  const overlap = await tool(kChat.key, 'propose_changes', { changes: [
    { resource: 'phases', action: 'create', data: { label: 'P', name: 'a', from: '2031-01', to: '2031-06', amounts: {} } },
    { resource: 'phases', action: 'create', data: { label: 'P', name: 'b', from: '2031-03', to: null, amounts: {} } },
  ] })
  ok(failedCall(overlap) && /Change 2/.test(overlap.text) && /verlap/.test(overlap.text), `an overlapping phase: no proposal, the reason is returned (${overlap.text.slice(0, 120)})`)
  ok(await proposalCount(wId) === cnt1, 'a refused proposal is not stored')
  const many = await tool(kChat.key, 'propose_changes', { changes: Array.from({ length: 21 }, (_, i) => ({ resource: 'checks', action: 'create', data: { text: `c${i}`, done: false } })) })
  ok(failedCall(many) && await proposalCount(wId) === cnt1, '21 changes are refused')
  const badDate = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'subscriptions', action: 'create', data: SUB('x', { nextDate: '2031-02-30' }) }] })
  ok(failedCall(badDate) && /[Nn]o such date|dateInvalid|date/.test(badDate.text) && !/dateInvalid|serviceNameReq/.test(badDate.text), `a rule message reaches the AI in English (${(badDate.error?.message ?? badDate.text).slice(0, 140)})`)
  // envelopes are strict (review 6): nothing unknown is dropped silently
  const cnt6 = await proposalCount(wId)
  const withExtra = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'checks', action: 'create', data: { text: 'x', done: false }, extra: 1 }] })
  ok(failedCall(withExtra) && /nrecognized/.test(withExtra.error?.message ?? withExtra.text), `an extra field on a change is refused (${(withExtra.error?.message ?? withExtra.text).slice(0, 100)})`)
  const idOnSingle = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', id: 'x', data: LIV(1) }] })
  ok(failedCall(idOnSingle), 'an id on a single-row resource (living) is refused, not dropped')
  ok(failedCall(await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'checks', action: 'create', data: { text: 'x', done: false } }], force: true })), 'an extra top-level field is refused')
  ok(failedCall(await tool(kChat.key, 'get_proposal', { proposalId: 'x', extra: 1 })) && failedCall(await tool(kChat.key, 'apply_proposal', { proposalId: 'x', extra: 1 })) && failedCall(await tool(kChat.key, 'propose_revert', { changeSetId: 'x', extra: 1 })), 'extra fields are refused by the other three tools')
  ok(await proposalCount(wId) === cnt6, 'and no proposal was stored')
  // accounts are an AI resource since spec 013 S-10; debts are not
  const debt = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'debts', action: 'create', data: { name: 'x', principal: 1, rate: '', method: '', plan: '' } }] })
  ok(failedCall(debt) && await proposalCount(wId) === cnt6, 'debts cannot be proposed')

  // ── V-5: apply gives the preview's after ──
  const ap = await tool(kChat.key, 'apply_proposal', { proposalId: pr1.data.proposalId })
  ok(!failedCall(ap) && ap.data?.status === 'applied' && typeof ap.data?.changeSetId === 'string', 'apply_proposal (chat key) applies')
  const s1 = await wState()
  ok(s1.subscriptions.some((x) => x.name === 'mcp-sub') && s1.living.food === 111000, 'the data now holds both changes')
  const ov = await tool(kChat.key, 'get_overview', {})
  ok(ov.data?.subscriptionTransfer?.transferKrw === pr1.data.preview.months[0].transferKrw.after, `this month's transfer = the preview's after (${ov.data?.subscriptionTransfer?.transferKrw})`)
  const sets = await wSets()
  ok(sets.length === n0 + 1 && sets[0].id === ap.data.changeSetId && sets[0].actorKind === 'api_key' && sets[0].actorId === kChat.id && sets[0].actorLabel === 'w-chat' && sets[0].proposalId === pr1.data.proposalId, 'one new change set: api_key, key id, key name, proposal id')
  const again = await tool(kChat.key, 'apply_proposal', { proposalId: pr1.data.proposalId })
  ok(failedCall(again) && /not_pending/.test(again.text), 'applying again is refused (not_pending)')
  ok((await wSets()).length === n0 + 1, 'and wrote nothing')

  // ── V-6 (tools): a screen-confirm key cannot apply ──
  const pr2 = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', data: LIV(222000) }] })
  ok(!failedCall(pr2) && pr2.data.confirm === 'ui' && /Pending changes/.test(pr2.data.next), 'a screen-confirm proposal says the user confirms it in Allot')
  const refuse = await tool(kUi.key, 'apply_proposal', { proposalId: pr2.data.proposalId })
  ok(failedCall(refuse) && /wrong_confirm/.test(refuse.text), 'apply_proposal is refused for a screen-confirm key')
  const gp = await tool(kUi.key, 'get_proposal', { proposalId: pr2.data.proposalId })
  ok(!failedCall(gp) && gp.data.status === 'pending' && gp.data.preview?.rows?.length === 1, 'get_proposal returns the state and preview')
  ok((await wState()).living.food === 111000, 'nothing was applied')
  const cross = await tool(kChat.key, 'get_proposal', { proposalId: pr2.data.proposalId })
  ok(failedCall(cross) && /not_found/.test(cross.text), "a key cannot read another key's proposal")
  const crossApply = await tool(kChat.key, 'apply_proposal', { proposalId: pr2.data.proposalId })
  ok(failedCall(crossApply), "a key cannot apply another key's proposal")

  // ── V-6 (screen API): the user confirms or rejects ──
  const listed = await W('GET', '/api/proposals?status=pending')
  const mine = (listed.json ?? []).find((x) => x.id === pr2.data.proposalId)
  ok(listed.status === 200 && !!mine && mine.keyName === 'w-ui' && mine.confirm === 'ui' && mine.keyUsable === true && mine.preview?.rows?.length === 1 && mine.baseHash === undefined && mine.userId === undefined, 'GET /api/proposals lists it with its key, method and preview (no fingerprint, no owner)')
  ok((await W('GET', '/api/state')).json.pendingProposals === (listed.json ?? []).length, 'the state carries the pending count for the badge')
  ok((await W('GET', '/api/proposals?status=nope')).status === 400, 'an unknown status filter is 400')
  const h1 = await W('GET', '/api/proposals?status=handled&limit=1')
  ok(h1.status === 200 && h1.json.length === 1 && h1.json[0].status !== 'pending', 'status=handled lists handled proposals, a page at a time')
  const h2 = await W('GET', `/api/proposals?status=handled&limit=1&before=${encodeURIComponent(h1.json[0]?.createdAt)}&beforeId=${encodeURIComponent(h1.json[0]?.id)}`)
  ok(h2.status === 200 && (h2.json.length === 0 || h2.json[0].id !== h1.json[0].id), 'the next page starts after the last one shown')
  ok((await W('GET', '/api/proposals?status=handled&before=2026-01-01')).status === 400, 'before without beforeId is 400')
  ok((await W('GET', `/api/proposals/${pr2.data.proposalId}`)).json?.id === pr2.data.proposalId, 'GET /api/proposals/:id')
  for (const [m, path] of [['GET', ''], ['POST', '/apply'], ['POST', '/reject']]) {
    const r = await X(m, `/api/proposals/${pr2.data.proposalId}${path}`)
    ok(r.status === 404, `X: ${m} W's proposal${path} → ${r.status} (want 404)`)
  }
  ok((await X('GET', '/api/proposals')).json.length === 0, "X's list holds none of W's")
  const anon = await mcp(A, kUi.key, { jsonrpc: '2.0', id: 9, method: 'tools/list' })
  ok(anon.status === 200, 'the key still works at the MCP endpoint')
  const viaKey = await W('GET', '/api/proposals', undefined, { authorization: `Bearer ${kUi.key}`, cookie: '' })
  ok(viaKey.status === 401, `a key is no session: GET /api/proposals with a key → ${viaKey.status} (want 401)`)
  const en = await W('POST', `/api/proposals/${pr1.data.proposalId}/apply`, undefined, { 'accept-language': 'en' })
  const ko = await W('POST', `/api/proposals/${pr1.data.proposalId}/apply`, undefined, { 'accept-language': 'ko' })
  ok(en.status === 409 && /already been handled/.test(en.json?.error) && ko.status === 409 && /이미 처리/.test(ko.json?.error) && en.json?.code === 'not_pending', 'a handled proposal: 409 in the request language, with a code')
  const okApply = await W('POST', `/api/proposals/${pr2.data.proposalId}/apply`)
  ok(okApply.status === 200 && typeof okApply.json?.changeSet === 'string', `POST /api/proposals/:id/apply → ${okApply.status}`)
  ok((await wState()).living.food === 222000, 'the screen confirmation applied it')
  const afterSets = await wSets()
  ok(afterSets[0].id === okApply.json.changeSet && afterSets[0].actorKind === 'api_key' && afterSets[0].actorId === kUi.id && afterSets[0].actorLabel === 'w-ui' && afterSets[0].proposalId === pr2.data.proposalId, "confirming on the screen: the actor is still the proposing key and the set names the proposal")
  const dec = await sqlW`select decided_by, status, change_set_id from mcp_proposal where id = ${pr2.data.proposalId}`
  ok(dec[0].decided_by === 'user' && dec[0].status === 'applied' && dec[0].change_set_id === okApply.json.changeSet, 'the proposal records that the user decided')
  const prRej = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', data: LIV(555000) }] })
  const rj = await W('POST', `/api/proposals/${prRej.data.proposalId}/reject`)
  ok(rj.status === 204 && (await tool(kUi.key, 'get_proposal', { proposalId: prRej.data.proposalId })).data?.status === 'rejected', 'reject → 204 and get_proposal says rejected')
  ok((await W('POST', `/api/proposals/${prRej.data.proposalId}/apply`)).status === 409, 'a rejected proposal cannot be applied (409)')
  ok((await W('POST', `/api/proposals/${prRej.data.proposalId}/reject`)).status === 409, 'nor rejected again (409)')
  ok((await wState()).living.food === 222000, 'and nothing changed')
  ok((await W('POST', '/api/proposals/nope/apply')).status === 404, 'an unknown id is 404')
  // a revoked key: its pending proposal can no longer be confirmed, on the screen either
  const kGone = await mk(W, { name: 'w-gone', write: true })
  const prGone = await tool(kGone.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', data: LIV(666000) }] })
  ok((await W('DELETE', `/api/keys/${kGone.id}`)).status === 204, 'the key is revoked')
  const ga = await W('POST', `/api/proposals/${prGone.data.proposalId}/apply`)
  ok(ga.status === 409 && ga.json?.code === 'key_unusable' && (await wState()).living.food === 222000, `the revoked key's proposal cannot be applied on the screen → ${ga.status} ${ga.json?.code}`)
  const gl = (await W('GET', '/api/proposals?status=pending')).json.find((x) => x.id === prGone.data.proposalId)
  ok(gl?.keyUsable === false, 'the list says its key is no longer usable')
  ok((await W('POST', `/api/proposals/${prGone.data.proposalId}/reject`)).status === 204, 'the user can still reject it')

  // ── V-7: stale, expired, the pending cap ──
  const pr3 = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', data: LIV(333000) }] })
  ok((await W('PUT', '/api/living', LIV(120000))).status === 200, 'the data is changed on the screen after proposing')
  const st = await tool(kChat.key, 'apply_proposal', { proposalId: pr3.data.proposalId })
  ok(failedCall(st) && /stale/.test(st.text), 'apply → stale (propose again)')
  ok((await tool(kChat.key, 'get_proposal', { proposalId: pr3.data.proposalId })).data?.status === 'stale' && (await wState()).living.food === 120000, 'the proposal is stale and the screen change stays')
  const pr4 = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'living', action: 'update', data: LIV(444000) }] })
  await sqlW`update mcp_proposal set expires_at = now() - interval '1 second' where id = ${pr4.data.proposalId}`
  const ex = await tool(kChat.key, 'apply_proposal', { proposalId: pr4.data.proposalId })
  ok(failedCall(ex) && /expired/.test(ex.text) && (await tool(kChat.key, 'get_proposal', { proposalId: pr4.data.proposalId })).data?.status === 'expired', 'an expired proposal is refused and marked expired')
  const ttl = await sqlW`select extract(epoch from (expires_at - created_at))::int as s, confirm from mcp_proposal where id = ${pr2.data.proposalId}`
  ok(ttl[0].s === 24 * 3600 && ttl[0].confirm === 'ui', 'a screen proposal expires after 24 hours')
  const ttl2 = await sqlW`select extract(epoch from (expires_at - created_at))::int as s from mcp_proposal where id = ${pr3.data.proposalId}`
  ok(ttl2[0].s === 15 * 60, 'a chat proposal expires after 15 minutes')
  await sqlW`update mcp_proposal set status = 'rejected' where user_id = ${wId} and status = 'pending'`
  let last
  for (let i = 0; i <= 20; i++) {
    last = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'checks', action: 'create', data: { text: `cap${i}`, done: false } }] })
    if (i < 20 && failedCall(last)) { ok(false, `pending proposal ${i + 1} refused early: ${last.text.slice(0, 100)}`); break }
  }
  ok(failedCall(last) && /too_many/.test(last.text), 'the 21st pending proposal is refused')
  await sqlW`update mcp_proposal set status = 'rejected' where user_id = ${wId} and status = 'pending'`

  // ── V-8: the AI reverts what it applied ──
  const before8 = JSON.stringify(await wState())
  const pr5 = await tool(kChat.key, 'propose_changes', { changes: [
    { resource: 'subscriptions', action: 'create', data: SUB('mcp-sub-2') },
    { resource: 'events', action: 'create', data: { when: '2031-01', kind: 'k', title: 'mcp-event', state: 'todo' } },
  ] })
  const ap5 = await tool(kChat.key, 'apply_proposal', { proposalId: pr5.data.proposalId })
  ok(!failedCall(ap5) && JSON.stringify(await wState()) !== before8, 'a second change is applied')
  const rv = await tool(kChat.key, 'propose_revert', { changeSetId: ap5.data.changeSetId, note: 'undo' })
  ok(!failedCall(rv) && rv.data.revertOf === ap5.data.changeSetId && rv.data.preview.rows.length === 2, 'propose_revert has the rows it would undo')
  ok(JSON.stringify(await wState()) !== before8, 'proposing the revert changes nothing yet')
  const rap = await tool(kChat.key, 'apply_proposal', { proposalId: rv.data.proposalId })
  ok(!failedCall(rap) && JSON.stringify(await wState()) === before8, 'after applying the revert the data is as before')
  const sets8 = await wSets()
  ok(sets8[0].id === rap.data.changeSetId && sets8[0].revertOf === ap5.data.changeSetId && sets8[0].actorKind === 'api_key', 'the new set has revert_of and the key as actor')
  ok(sets8.find((x) => x.id === ap5.data.changeSetId)?.revertedBy === rap.data.changeSetId, 'the original set is marked as reverted')
  ok(failedCall(await tool(kChat.key, 'propose_revert', { changeSetId: ap5.data.changeSetId })), 'reverting it a second time is refused')
  // the screen's own revert button works on an AI set (spec 009 V-8)
  const pr6 = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'events', action: 'create', data: { when: '2031-02', kind: 'k', title: 'mcp-event-2', state: 'todo' } }] })
  const ap6 = await tool(kChat.key, 'apply_proposal', { proposalId: pr6.data.proposalId })
  const before6 = JSON.stringify((await wState()).events.filter((e) => e.title === 'mcp-event-2'))
  const ui = await W('POST', `/api/changes/${ap6.data.changeSetId}/revert`)
  ok(ui.status === 200 && before6 !== '[]' && (await wState()).events.every((e) => e.title !== 'mcp-event-2'), `the screen's revert works on an AI change set → ${ui.status}`)

  // ── spec 011 V-9: one-off spendings through the tools ──
  const ymNow = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}` })()
  const SP = (name, payBy, amount, over = {}) => ({
    name, note: '', category: 'etc', bought: `${ymNow}-02`, amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy, count: 1, fee: 0, interval: null, cancelled: false,
    rounds: [{ no: 1, date: `${ymNow}-15`, amount, state: 'left', edited: false }], ...over,
  })
  const spendIds = []
  const mjs = await import('../../src/lib/calc.ts')
  const sp0 = JSON.stringify(await wState())
  const spCount = async () => Number((await sqlW`select count(*)::int as n from spending where user_id = ${wId}`)[0].n)
  const roundCount = async () => Number((await sqlW`select count(*)::int as n from spending_round where user_id = ${wId}`)[0].n)
  const overviewNow = async (k) => (await tool(k, 'get_overview', { month: ymNow })).data
  const o0 = await overviewNow(kUi.key)
  ok((await tool(kRead.key, 'list_spendings', {})).data?.spendings?.length === 0, 'list_spendings (a read key): none yet')

  // a salary-paid spending: the preview shows the month's remainder before and after, nothing is written
  const ps = await tool(kUi.key, 'propose_changes', { note: 'v9', changes: [{ resource: 'spendings', action: 'create', data: SP('mcp-spend', 'salary', 120_000) }] })
  ok(!failedCall(ps) && ps.data?.confirm === 'ui' && ps.data.preview?.rows?.some((r) => r.table === 'spending' && r.op === 'insert') && ps.data.preview.rows.some((r) => r.table === 'spending_round'), `propose_changes (spending): the preview has the spending and its round (${ps.data?.preview?.rows?.map((r) => r.table)})`)
  const m0 = ps.data?.preview?.months?.[0]
  ok(m0?.month === ymNow && m0.remainderKrw.before - m0.remainderKrw.after === 120_000 && m0.transferKrw.before === m0.transferKrw.after, `the preview's remainder is 120,000 lower and the transfer the same (${m0?.remainderKrw?.before} → ${m0?.remainderKrw?.after})`)
  ok(m0?.remainderKrw?.before === o0.distribution.remainderKrw, "the preview's before is this month's remainder")
  ok(JSON.stringify(await wState()) === sp0 && await spCount() === 0 && await roundCount() === 0, 'proposing wrote no spending and no round')
  // a spending from the subscription account: the preview shows the transfer
  const pt = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('mcp-spend-subs', 'subs', 40_000) }] })
  const t0 = pt.data?.preview?.months?.[0]
  ok(!failedCall(pt) && t0.neededKrw.after - t0.neededKrw.before >= 40_000 && t0.neededKrw.after - t0.neededKrw.before < 41_000 && t0.transferKrw.after >= t0.transferKrw.before && t0.remainderKrw.after <= t0.remainderKrw.before, `the preview's needed amount is 40,000 higher (rounded up to 1,000) (${t0?.neededKrw?.before} → ${t0?.neededKrw?.after}), the transfer ${t0?.transferKrw?.before} → ${t0?.transferKrw?.after}`)
  ok((await W('POST', `/api/proposals/${pt.data.proposalId}/reject`)).status === 204, 'rejected: the subscription-account proposal')
  // rules of the screen apply: a round count that does not fit, a USD amount with a rate past 6 decimals (A-43)
  const bad1 = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('x', 'salary', 1000, { count: 2 }) }] })
  const bad2 = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('x', 'salary', 10, { currency: 'USD', fxRate: 1300.1234567, fxBuffer: 2 }) }] })
  ok(failedCall(bad1) && failedCall(bad2) && !/spendFx|spendHow|spendRounds/.test(bad1.text + bad2.text), `spending rules reach the AI in English (${(bad1.error?.message ?? bad1.text).slice(0, 80)} | ${(bad2.error?.message ?? bad2.text).slice(0, 80)})`)
  // the user confirms on the screen
  const apS = await W('POST', `/api/proposals/${ps.data.proposalId}/apply`)
  ok(apS.status === 200 && await spCount() === 1 && await roundCount() === 1, `the screen's confirmation applied it → ${apS.status}`)
  const st9 = await wState()
  const made9 = st9.spendings.find((x) => x.name === 'mcp-spend')
  ok(!!made9 && made9.rounds.length === 1 && made9.rounds[0].amount === 120_000, 'the spending and its round are in the data')
  if (made9) spendIds.push(made9.id)
  const lsw = await tool(kRead.key, 'list_spendings', {})
  const lm = lsw.data?.spendings?.[0]
  ok(lsw.data?.spendings?.length === 1 && lm.id === made9?.id && lm.rounds.length === 1 && lm.progress.left === 1 && lm.progress.next?.amountKrw === 120_000 && ['planned', 'billing'].includes(lm.state), `list_spendings (read key): the spending with its round (${lm?.state})`)
  const lmonth = await tool(kRead.key, 'list_spendings', { month: ymNow, status: 'active' })
  ok(lmonth.data?.spendings?.length === 1 && lmonth.data.monthTotals.remainderKrw === 120_000 && lmonth.data.monthTotals.subscriptionAccountKrw === 0, 'list_spendings month and status filters')
  const o1 = await overviewNow(kRead.key)
  ok(o1.distribution.remainderKrw === m0.remainderKrw.after && o1.distribution.spendingKrw === 120_000, "get_overview: the remainder is the preview's after, and the spending is named")
  ok(o1.spendingRounds?.length === 1 && o1.spendingRounds[0].name === 'mcp-spend' && o1.spendingRounds[0].amountKrw === 120_000 && JSON.stringify(o1.payments) === JSON.stringify(o0.payments), 'get_overview: the round is its own item, the subscription charges are unchanged')
  const sc9 = (await tool(kRead.key, 'get_schedule', { from: ymNow, months: 1 })).data
  ok(sc9?.months?.[0]?.spendingRounds?.some((r) => r.name === 'mcp-spend' && r.round === 1 && r.of === 1), 'get_schedule: the round is in its month')
  const stNow = await wState()
  const mm = mjs.monthMoney(stNow, ymNow)
  ok(mm.dist.remainder === o1.distribution.remainderKrw, "the tool's remainder is monthMoney's")
  // reverting the creation in the change history: no spending, no round, the data as before
  ok(apS.json?.changeSet && (await W('POST', `/api/changes/${apS.json.changeSet}/revert`)).status === 200 && await spCount() === 0 && await roundCount() === 0 && JSON.stringify(await wState()) === sp0, 'reverting the creation in the change history: no spending, no round, the data as before')
  ok((await tool(kRead.key, 'list_spendings', {})).data?.spendings?.length === 0 && (await overviewNow(kRead.key)).distribution.remainderKrw === o0.distribution.remainderKrw, 'list_spendings is empty again and the remainder is back')
  // a chat key: create, update (cancelled), delete, revert the delete; each is one change set
  const crt = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('mcp-spend-2', 'salary', 90_000) }] })
  const apC = await tool(kChat.key, 'apply_proposal', { proposalId: crt.data?.proposalId })
  const made2 = (await wState()).spendings.find((x) => x.name === 'mcp-spend-2')
  ok(!failedCall(apC) && !!made2, 'a chat key creates a spending')
  if (made2) spendIds.push(made2.id)
  const upd = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'update', id: made2?.id, data: { ...SP('mcp-spend-2', 'salary', 90_000), cancelled: true } }] })
  ok(!failedCall(upd) && upd.data.preview.months[0].remainderKrw.after - upd.data.preview.months[0].remainderKrw.before === 90_000, 'an update to cancelled: the preview gives the 90,000 back')
  const apU = await tool(kChat.key, 'apply_proposal', { proposalId: upd.data.proposalId })
  ok(!failedCall(apU) && (await tool(kRead.key, 'list_spendings', { status: 'cancelled' })).data.spendings.length === 1 && (await overviewNow(kRead.key)).distribution.remainderKrw === o0.distribution.remainderKrw, 'applied: cancelled in list_spendings and the remainder is back')
  const del = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'delete', id: made2?.id }] })
  ok(!failedCall(del) && del.data.preview.rows.some((r) => r.table === 'spending_round' && r.op === 'delete'), 'deleting: the preview shows the round going too')
  const apD = await tool(kChat.key, 'apply_proposal', { proposalId: del.data?.proposalId })
  ok(!failedCall(apD) && await spCount() === 0 && await roundCount() === 0, 'deleted with its rounds')
  const rvD = await tool(kChat.key, 'propose_revert', { changeSetId: apD.data?.changeSetId })
  const apRv = failedCall(rvD) ? rvD : await tool(kChat.key, 'apply_proposal', { proposalId: rvD.data.proposalId })
  ok(!failedCall(apRv) && await spCount() === 1 && await roundCount() === 1, `propose_revert of the delete brings the spending and its round back (${rvD.text?.slice(0, 80)})`)
  // clean up by id (W is deleted at the end too)
  for (const id of spendIds) await W('DELETE', `/api/spendings/${id}`)
  cleanups.push(async () => { for (const id of spendIds) await drop(W, `/api/spendings/${id}`) })

  // ── spending isolation: both W and X own a spending with rounds while the cross-user checks run ──
  const iso = async (U, name) => {
    const r = await U('POST', '/api/spendings', SP(name, 'salary', 80_000, { how: 'installment', count: 2, rounds: [{ no: 1, date: `${ymNow}-15`, amount: 40_000, state: 'left', edited: false }, { no: 2, date: `${mjs.addYm(ymNow, 1)}-15`, amount: 40_000, state: 'left', edited: false }] }))
    if (r.status !== 201) throw new Error(`seed spending ${name} → ${r.status} ${r.text}`)
    return r.json.id
  }
  const wSpend = await iso(W, 'iso-w-spend')
  const xSpend = await iso(X, 'iso-x-spend')
  cleanups.push(async () => { await drop(W, `/api/spendings/${wSpend}`); await drop(X, `/api/spendings/${xSpend}`) })
  const wSpendSet = (await wSets())[0]
  ok(await spCount() === 1 && await roundCount() === 2 && !!wSpendSet?.id, "W's spending has two rounds and a change set")
  const text9 = async (k, name, args) => (await tool(k, name, args)).text
  for (const [who, key, own, foreign] of [['W', kChat.key, 'iso-w-spend', 'iso-x-spend'], ['X', kX.key, 'iso-x-spend', 'iso-w-spend']]) {
    const lT = await tool(key, 'list_spendings', {})
    const [l, o, sc] = [lT.text, await text9(key, 'get_overview', { month: ymNow }), await text9(key, 'get_schedule', { from: ymNow, months: 2 })]
    ok(l.includes(own) && o.includes(own) && sc.includes(own), `${who}'s key sees its own spending in list_spendings, get_overview and get_schedule`)
    ok(!l.includes(foreign) && !o.includes(foreign) && !sc.includes(foreign), `${who}'s key sees none of ${foreign === 'iso-x-spend' ? "X's" : "W's"} spending or rounds`)
    ok(lT.data?.spendings?.length === 1 && lT.data.spendings[0].rounds.length === 2, `${who}'s key: exactly one spending with its two rounds`)
  }
  const xProp0 = (await X('GET', '/api/proposals')).json.length
  const wProp0 = await proposalCount(wId)
  const xUpd = await tool(kX.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'update', id: wSpend, data: SP('hijacked', 'salary', 1000) }] })
  const xDel = await tool(kX.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'delete', id: wSpend }] })
  ok(failedCall(xUpd) && failedCall(xDel) && /not found|itemNotFound|Item not found/i.test(xUpd.text + xDel.text), `X cannot update or delete W's spending by id (${(xUpd.text ?? '').slice(0, 70)})`)
  const wUpd = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'delete', id: xSpend }] })
  ok(failedCall(wUpd), "W cannot delete X's spending by id")
  const xRev = await tool(kX.key, 'propose_revert', { changeSetId: wSpendSet.id })
  ok(failedCall(xRev) && /not_found/.test(xRev.text), "X cannot propose reverting W's spending change set (not_found)")
  ok((await X('GET', '/api/proposals')).json.length === xProp0 && await proposalCount(wId) === wProp0, 'none of these made a proposal')
  ok(await spCount() === 1 && await roundCount() === 2 && (await X('GET', '/api/state')).json.spendings.length === 1, "both spendings are unchanged")
  // ── V-9: another user ──
  const wSet = ap.data.changeSetId
  const xs0 = JSON.stringify((await X('GET', '/api/state')).json)
  const wDataNow = JSON.stringify(await wState())
  ok(failedCall(await tool(kX.key, 'get_proposal', { proposalId: pr2.data.proposalId })), "X cannot read W's proposal")
  ok(failedCall(await tool(kX.key, 'apply_proposal', { proposalId: pr2.data.proposalId })), "X cannot apply W's proposal")
  const xr = await tool(kX.key, 'propose_revert', { changeSetId: wSet })
  ok(failedCall(xr) && /not_found/.test(xr.text), "X cannot propose reverting W's change set")
  const xu = await tool(kX.key, 'propose_changes', { changes: [{ resource: 'subscriptions', action: 'update', id: s1.subscriptions.find((x) => x.name === 'mcp-sub').id, data: SUB('hijacked') }] })
  ok(failedCall(xu) && /not found|itemNotFound|Item not found/i.test(xu.text), "X cannot update W's row by id")
  ok(JSON.stringify(await wState()) === wDataNow && JSON.stringify((await X('GET', '/api/state')).json) === xs0, "neither user's data changed")
  // row-level security of W's rows, read and written as another user: the same assertions run as the connected role
  // when it is not a superuser (a superuser bypasses RLS, so it first switches to a plain role, which needs privileges)
  const probe = async (tx) => {
    await tx`select set_config('app.user_id', ${xId}, true)`
    const seen = {}
    for (const t of ['mcp_proposal', 'spending', 'spending_round']) {
      seen[t] = (await tx.unsafe(`select count(*)::int as n from ${t} where user_id = $1`, [wId]))[0].n
      seen[`${t}.notX`] = (await tx.unsafe(`select count(*)::int as n from ${t} where user_id <> $1`, [xId]))[0].n // every row X can see is X's own
    }
    const upd = { mcp_proposal: (await tx`update mcp_proposal set status = status where user_id = ${wId}`).count, spending: (await tx`update spending set name = name where user_id = ${wId}`).count, spending_round: (await tx`update spending_round set amount = amount where user_id = ${wId}`).count }
    const del = { mcp_proposal: (await tx`delete from mcp_proposal where user_id = ${wId}`).count, spending: (await tx`delete from spending where user_id = ${wId}`).count, spending_round: (await tx`delete from spending_round where user_id = ${wId}`).count }
    await tx`select set_config('app.user_id', ${wId}, true)`
    const mine = {}
    for (const t of ['mcp_proposal', 'spending', 'spending_round']) mine[t] = (await tx.unsafe(`select count(*)::int as n from ${t}`))[0].n
    return { seen, upd, del, mine }
  }
  const judge = (r, who) => {
    ok(Object.values(r.seen).every((n) => n === 0), `RLS (${who}): X sees none of W's mcp_proposal, spending and spending_round rows (${JSON.stringify(r.seen)})`)
    ok(Object.values(r.upd).every((n) => n === 0) && Object.values(r.del).every((n) => n === 0), `RLS (${who}): X can neither update nor delete them (${JSON.stringify([r.upd, r.del])})`)
    ok(r.mine.mcp_proposal > 0 && r.mine.spending >= 1 && r.mine.spending_round >= 2, `RLS (${who}): W sees them (${JSON.stringify(r.mine)})`)
  }
  const isSuper = (await sqlW`select rolsuper from pg_roles where rolname = current_user`)[0].rolsuper
  if (!isSuper) judge(await sqlW.begin(probe), 'the connected non-superuser role')
  else {
    await sqlW`do $$ begin if not exists (select 1 from pg_roles where rolname = 'allot_rls_probe') then create role allot_rls_probe nosuperuser nobypassrls; end if; end $$`
    await sqlW`grant select, update, delete on mcp_proposal, spending, spending_round to allot_rls_probe`
    judge(await sqlW.begin(async (tx) => { await tx`set local role allot_rls_probe`; return probe(tx) }), 'a plain role made for the probe')
  }
  // clean up by id, and the rows must be gone
  await W('DELETE', `/api/spendings/${wSpend}`)
  await X('DELETE', `/api/spendings/${xSpend}`)
  ok(await spCount() === 0 && await roundCount() === 0 && (await X('GET', '/api/state')).json.spendings.length === 0, 'both seeded spendings and their rounds are gone')

  // ── spec 013 S-10: living items, accounts, cards, a balance record and a buffer use through the tools ──
  {
    const ym1 = mjs.addYm(ymNow, 1)
    const ym2 = mjs.addYm(ymNow, 2)
    const todayStr = mjs.ymd(mjs.today())
    const made13 = { spendings: [], cards: [], targets: [], 'living-items': [], accounts: [] }
    const drop13 = async () => { for (const r of ['spendings', 'cards', 'targets', 'living-items', 'accounts']) for (const id of made13[r].splice(0)) await drop(W, `/api/${r}/${id}`) }
    cleanups.push(drop13)
    const ACC_CMA = { name: 'E2E-mcp-cma', role: 'saving', inflow: '', outflow: '', bank: 'E2E Bank', last4: '1234', kind: 'CMA', group: 'saving', amount: 300_000, goal: 6_000_000, annualLimit: 20_000_000 }
    const ACC_PAY = { name: 'E2E-mcp-pay', role: 'card', inflow: '', outflow: '', buffer: 1_000_000 }
    const ITEM = { name: 'E2E-mcp-item', kind: 'food', payMethod: 'card', amount: 70_000, from: null, note: '', amounts: {} }
    // the accounts, the item and a living total target first (ids are server-assigned), then the card and the savings target that refer to them
    const st0 = await wState()
    const livingBefore = mjs.livingAt(st0.livingItems ?? [], st0.phases, ymNow).sum
    const q1 = await tool(kChat.key, 'propose_changes', { note: 's10 accounts', changes: [
      { resource: 'accounts', action: 'create', data: ACC_CMA },
      { resource: 'accounts', action: 'create', data: ACC_PAY },
      { resource: 'living-items', action: 'create', data: ITEM },
      { resource: 'targets', action: 'create', data: { name: 'E2E-mcp-living', kind: 'living', note: '' } },
    ] })
    ok(!failedCall(q1) && q1.data.preview.rows.filter((r) => r.table === 'bank_account').length === 2 && q1.data.preview.rows.some((r) => r.table === 'living_item'), `propose_changes: two accounts, a living item and a target (${(q1.text ?? '').slice(0, 100)})`)
    const q1m = q1.data?.preview?.months?.[0]
    const q1l = q1m?.distribution?.find((r) => r.kind === 'living')
    ok(q1l?.amountKrw?.before === null && q1l.amountKrw.after === livingBefore + 70_000 && q1m.remainderKrw.before - q1m.remainderKrw.after === livingBefore + 70_000,
      `the preview: the living total (the items with the new one, ${q1l?.amountKrw?.after}) comes off this month's remainder (${q1m?.remainderKrw?.before} → ${q1m?.remainderKrw?.after})`)
    const a1 = await tool(kChat.key, 'apply_proposal', { proposalId: q1.data?.proposalId })
    ok(!failedCall(a1), 'applied: the accounts and the living item')
    const st1 = await wState()
    const cma = st1.accounts.find((x) => x.name === 'E2E-mcp-cma')
    const pay = st1.accounts.find((x) => x.name === 'E2E-mcp-pay')
    const it = (st1.livingItems ?? []).find((x) => x.name === 'E2E-mcp-item')
    const lt = st1.targets.find((x) => x.name === 'E2E-mcp-living')
    for (const [r, x] of [['accounts', cma], ['accounts', pay], ['living-items', it], ['targets', lt]]) if (x) made13[r].push(x.id)
    ok(!!cma && !!pay && !!it && cma.group === 'saving' && cma.amount === 300_000 && cma.last4 === '1234' && pay.buffer === 1_000_000, 'the accounts and the item are in the data as proposed')
    const q2 = await tool(kChat.key, 'propose_changes', { changes: [
      { resource: 'cards', action: 'create', data: { name: 'E2E-mcp-card', last4: '9876', accountId: pay?.id ?? 'x', billingDay: 12 } },
      { resource: 'targets', action: 'create', data: { name: 'E2E-mcp-saving', kind: 'saving', accountId: null } },
    ] })
    const a2 = failedCall(q2) ? q2 : await tool(kChat.key, 'apply_proposal', { proposalId: q2.data.proposalId })
    ok(!failedCall(a2), `applied: the card paid from the pay account and the savings target (${(q2.text ?? '').slice(0, 100)})`)
    const st2 = await wState()
    const card = (st2.cards ?? []).find((x) => x.name === 'E2E-mcp-card')
    const tgt = st2.targets.find((x) => x.name === 'E2E-mcp-saving')
    if (card) made13.cards.push(card.id)
    if (tgt) made13.targets.push(tgt.id)
    ok(card?.accountId === pay?.id && card?.billingDay === 12 && tgt?.kind === 'saving', 'the card and the target are in the data')

    // the two examples of the description: a CMA balance after a maturity payout, a mini PC bought by card from the buffer
    const round = (no, date) => ({ no, date, amount: 150_000, state: 'left', edited: false })
    const BUF = { name: 'E2E-mcp-minipc', note: '', category: 'etc', bought: `${ymNow}-02`, amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'buffer', payBy: 'card',
      count: 2, fee: 0, interval: null, cancelled: false, cardId: card?.id ?? 'x', refillFrom: `${ym1}-25`, rounds: [round(1, `${ym1}-25`), round(2, `${ym2}-25`)] }
    const noCard = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: { ...BUF, cardId: null } }] })
    ok(failedCall(noCard) && !/bufferNeedsCard/.test(noCard.text), `a buffer use without a card is refused, in English (${(noCard.error?.message ?? noCard.text).slice(0, 100)})`)
    const s13 = JSON.stringify(await wState())
    const q3 = await tool(kUi.key, 'propose_changes', { note: 'maturity payout and a mini PC', changes: [
      { resource: 'balances', action: 'create', data: { accountId: cma?.id ?? 'x', date: `${ymNow}-01`, amount: 4_800_000, note: 'after the maturity payout' } },
      { resource: 'spendings', action: 'create', data: BUF },
    ] })
    const rows3 = q3.data?.preview?.rows ?? []
    ok(!failedCall(q3) && rows3.some((r) => r.table === 'account_balance' && r.op === 'insert') && rows3.some((r) => r.table === 'spending' && r.op === 'insert') && rows3.filter((r) => r.table === 'spending_round').length === 2,
      `propose_changes: the balance record and the buffer use with its two refills (${rows3.map((r) => r.table)})`)
    const [m3a, m3b] = q3.data?.preview?.months ?? []
    ok(m3a?.remainderKrw?.before === m3a?.remainderKrw?.after && m3b?.month === ym1 && m3b.remainderKrw.before - m3b.remainderKrw.after === 150_000,
      `the preview: nothing this month (the bill is paid from the buffer), next month's refill comes off the remainder (${m3b?.remainderKrw?.before} → ${m3b?.remainderKrw?.after})`)
    ok(JSON.stringify(await wState()) === s13, 'proposing wrote nothing')
    const apply3 = await W('POST', `/api/proposals/${q3.data?.proposalId}/apply`)
    ok(apply3.status === 200 && typeof apply3.json?.changeSet === 'string', `the user confirms it on the screen → ${apply3.status}`)
    const st3 = await wState()
    const sp13 = (st3.spendings ?? []).find((x) => x.name === 'E2E-mcp-minipc')
    if (sp13) made13.spendings.push(sp13.id)
    ok(sp13?.how === 'buffer' && sp13.cardId === card?.id && sp13.refillFrom === `${ym1}-25` && sp13.rounds.length === 2 && (st3.balances ?? []).some((b) => b.accountId === cma?.id && b.amount === 4_800_000),
      'the buffer use and the balance record are in the data')

    // read back: get_budget and list_accounts with the functions the screens use
    const gb = (await tool(kRead.key, 'get_budget', {})).data
    const x = mjs.groupAt('saving', st3.accounts, st3.phases, st3.targets, st3.settings, ymNow)
    ok(gb?.saving?.mode === 'amount' && gb.saving.target?.id === tgt?.id && gb.saving.sumKrw === x.sum && gb.saving.items.some((i) => i.accountId === cma?.id && i.monthKrw === 300_000 && i.last4 === '1234' && i.goalKrw === 6_000_000),
      `get_budget: the savings menu with the CMA account sending 300,000 (sum ${gb?.saving?.sumKrw})`)
    ok(gb?.living?.items?.some((i) => i.id === it?.id && i.monthKrw === 70_000) && gb.living.sumKrw === mjs.livingAt(st3.livingItems, st3.phases, ymNow).sum && gb.targets.find((t) => t.targetId === tgt?.id)?.amountKrw === x.sum,
      'get_budget: the living item, the living sum and the savings target value')
    const la = (await tool(kRead.key, 'list_accounts', {})).data
    const lc = la?.accounts?.find((a) => a.id === cma?.id)
    const lp = la?.accounts?.find((a) => a.id === pay?.id)
    const none = new Set() // W's settings shift no date (dayShift none), so no holiday moves one
    const proj = mjs.projectAccount(st3.accounts.find((a) => a.id === cma?.id), st3, none, ymNow, 12)
    ok(!!lc && lc.lastBalance?.amountKrw === 4_800_000 && JSON.stringify(lc.projection) === JSON.stringify(proj.map((r) => ({ month: r.ym, inflowKrw: r.inflow, outflowKrw: r.outflow, endKrw: r.end }))),
      `list_accounts: the CMA account's last balance and its projection are calc.ts's (${lc?.projection?.[0]?.endKrw})`)
    ok(lc?.goalMonth === mjs.addYm(ymNow, 3) && lc.goalMonth === mjs.goalMonth(st3.accounts.find((a) => a.id === cma?.id), st3, none), `list_accounts: the goal month is three transfers on (${lc?.goalMonth})`)
    ok(lc?.year?.contributionKrw === mjs.yearContribution(st3.accounts.find((a) => a.id === cma?.id), st3, none, new Date().getFullYear()) && lc.year.limitKrw === 20_000_000, `list_accounts: this year's contribution (${lc?.year?.contributionKrw}) against the limit`)
    const g = mjs.bufferGauge(st3.accounts.find((a) => a.id === pay?.id), st3, todayStr)
    ok(lp?.buffer?.bufferKrw === 1_000_000 && lp.buffer.usedKrw === 300_000 && lp.buffer.usedKrw === g.used && lp.buffer.leftKrw === 700_000 && lp.projection === null && lp.cards.some((c) => c.id === card?.id && c.effectiveBillingDay === 12),
      `list_accounts: the pay account's buffer gauge (${JSON.stringify(lp?.buffer)}), no projection without a record, its card`)
    ok(la?.cards?.some((c) => c.id === card?.id && c.accountId === pay?.id && c.account === 'E2E-mcp-pay' && c.billingDay === 12), 'list_accounts: the card with its paying account and billing day')
    const ov1 = (await tool(kRead.key, 'get_overview', { month: ym1 })).data
    ok(ov1?.distribution?.remainderKrw === m3b?.remainderKrw?.after, "get_overview next month: the remainder is the preview's after")

    // ── spec 013 S-14: a month adjustment of the savings target, this month only ──
    const sMa = JSON.stringify(await wState())
    const qa = await tool(kChat.key, 'propose_changes', { note: 'this month only', changes: [
      { resource: 'month-adjusts', action: 'create', data: { ym: ymNow, targetId: tgt?.id ?? 'x', amount: 100_000, reason: 'E2E once' } },
    ] })
    const [qaNow, qaNext] = qa.data?.preview?.months ?? []
    const qaRow = qaNow?.distribution?.find((r) => r.targetId === tgt?.id)
    ok(!failedCall(qa) && (qa.data?.preview?.rows ?? []).some((r) => r.table === 'month_adjust' && r.op === 'insert') && qaRow?.amountKrw?.before === 300_000 && qaRow.amountKrw.after === 100_000
      && qaNow.remainderKrw.after - qaNow.remainderKrw.before === 200_000 && qaNext?.remainderKrw?.before === qaNext?.remainderKrw?.after,
      `propose_changes month-adjusts: this month the savings target 300,000 → 100,000 and the remainder 200,000 more, next month as before (${(qa.text ?? '').slice(0, 100)})`)
    ok(JSON.stringify(await wState()) === sMa, 'proposing the adjustment wrote nothing')
    const aa = await tool(kChat.key, 'apply_proposal', { proposalId: qa.data?.proposalId })
    ok(!failedCall(aa), 'applied: the month adjustment')
    const stA = await wState()
    const ma = (stA.monthAdjusts ?? []).find((x) => x.targetId === tgt?.id && x.ym === ymNow)
    ok(ma?.amount === 100_000 && ma.reason === 'E2E once', 'the month adjustment is in the data')
    const ovA = (await tool(kRead.key, 'get_overview', {})).data
    ok(ovA?.monthAdjusts?.some((x) => x.id === ma?.id && x.amountKrw === 100_000 && x.plannedKrw === 300_000 && x.reason === 'E2E once') && ovA.distribution.rows.find((r) => r.targetId === tgt?.id)?.amountKrw === 100_000
      && ovA.distribution.remainderKrw === mjs.monthMoney(stA, ymNow).dist.remainder, 'get_overview: the adjustment with the amount it replaces, the target at 100,000 and the remainder monthMoney\'s')
    const gbA = (await tool(kRead.key, 'get_budget', {})).data
    const gbN = (await tool(kRead.key, 'get_budget', { month: ym1 })).data
    ok(gbA?.saving?.targetKrw === 100_000 && gbA.saving.sumKrw === 100_000 && gbA.saving.adjustment?.amountKrw === 100_000 && gbA.targets.find((t) => t.targetId === tgt?.id)?.amountKrw === 100_000
      && gbN?.saving?.targetKrw === 300_000 && gbN.saving.adjustment === null && (gbN.monthAdjusts ?? []).length === 0,
      'get_budget: this month the target gets the adjustment, spread over its items (review rc2-1 F-2), next month 300,000 again')
    const delA = await W('DELETE', `/api/month-adjusts/${ma?.id}`)
    ok(delA.status === 204 && JSON.stringify(await wState()) === sMa, `deleting the adjustment → ${delA.status}, the data as before it`)

    // the user reverts it in the change history: no balance record, no spending, the data as before
    const rv13 = await W('POST', `/api/changes/${apply3.json?.changeSet}/revert`)
    ok(rv13.status === 200 && JSON.stringify(await wState()) === s13, `reverting the confirmed proposal → ${rv13.status}, the data as before`)
    made13.spendings.splice(0)
    const la2 = (await tool(kRead.key, 'list_accounts', {})).data
    ok(la2?.accounts?.find((a) => a.id === cma?.id)?.projection === null && la2.accounts.find((a) => a.id === pay?.id)?.buffer?.usedKrw === 0, 'list_accounts after the revert: no record, no buffer used')
    await drop13()
    settle() // a delete that threw in drop13 stops the run here, after every delete was tried
    const st4 = await wState()
    ok(!st4.accounts.some((a) => a.name.startsWith('E2E-mcp-')) && !(st4.cards ?? []).some((c) => c.name.startsWith('E2E-mcp-')) && !(st4.livingItems ?? []).some((i) => i.name.startsWith('E2E-mcp-')) && !st4.targets.some((t) => t.name.startsWith('E2E-mcp-')),
      'the accounts, card, living item and target made here are gone')
  }

  // ── revoked key ──
  const dead = await W('DELETE', `/api/keys/${kChat.id}`)
  ok(dead.status === 204 && (await mcp(A, kChat.key)).status === 401, 'a revoked key is 401 at the endpoint')
  console.log(`INFO ${JSON.stringify({ wId, keyUi: kUi.id, proposalUi: pr2.data.proposalId })}`)
  await sqlW.end()
}

arm()
try {
  if (mode === 'write') await writeMode()
  else if (mode === 'auth') await authMode()
  else if (mode === 'isolation') await isolationMode()
  else await toolsMode()
} catch (e) {
  threw(e)
} finally {
  disarm() // the cleanup's own checks only report; each step runs even when one before it threw
  for (const f of cleanups) await cleanupStep('a registered cleanup', f)
  await cleanupStep("delete the 'v4' keys", async () => { await sql`delete from apikey where name = 'v4'` })
  for (const u of made) {
    await cleanupStep(`delete ${u.email}`, async () => {
      const r = await A('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: u.email })
      return r.status === 204 ? undefined : r.status
    })
  }
  await cleanupStep('close the database connection', async () => { await sql.end() })
}
console.log(failures() ? `${failures()} FAILED` : 'all checks passed')
process.exit(failures() ? 1 : 0)
