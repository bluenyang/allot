// API check for spec 008 V-4 (authentication), V-5 (isolation) and V-6 (tools) of the MCP endpoint.
//   docker compose -f docker/compose.dev.yaml restart api      (the failure limit is in memory: start clean)
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://127.0.0.1:3000 api node tests/api/mcp.mjs auth
// Run it inside the api container of the dev stack (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD). A is
// ADMIN_EMAIL; the other users are created here and deleted at the end. Keys for these checks are
// written straight into the `apikey` table in the form the plugin stores them (the way a key made
// on the screen looks in the database: SHA-256 base64url of the key); making keys through the
// screen's API is tests/api/api-keys.mjs. No raw key is printed or written anywhere.
//   isolation  V-5: users A and B each put marked data in; A's key calls all six tools and nothing of B shows, and back.
//   tools      V-6: tools/list (six, read-only), get_overview for this month and three months on against calc.ts,
//              an unknown tool and bad arguments, list_changes paging.
//   auth       V-4: every refusal is the same 401, the per-address limit (21st failure → 429), the per-key
//              limit, a session or a key on the wrong path, GET, a big body, a foreign Origin.
//              Ends by exhausting the address limit: restart the api before the next mode.
// Exit 0 only if every check passed. The login rate limit (5/min) is respected: one sign-in per user.
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

const mode = process.argv[2]
if (!['auth', 'isolation', 'tools'].includes(mode)) throw new Error('usage: mcp.mjs auth|isolation|tools')
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
const skip = (msg) => console.log(`SKIP ${msg}`)
const createUser = async (tag) => {
  const email = `v4-${tag}-${Date.now()}@example.com`
  const r = await A('POST', '/api/auth/admin/create-user', { email, password: 'v4-pass-12345', name: `V4 ${tag}`, role: 'user' })
  if (r.status !== 200) throw new Error(`create-user ${tag} → ${r.status}`)
  made.push({ id: r.json.user.id, email })
  return r.json.user.id
}

const TOOLS = ['get_overview', 'list_subscriptions', 'list_plan_changes', 'get_allocation', 'get_schedule', 'list_changes']
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
    await post('/api/accounts', { name: `${marker}-account`, role: 'r', inflow: 'i', outflow: 'o' })
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
  const ownStrings = (state) => [...state.subscriptions.map((x) => x.name), ...state.targets.map((x) => x.name), ...state.accounts.map((x) => x.name), ...state.debts.map((x) => x.name)].filter((x) => x.length >= 4)
  const states = {}
  for (const tag of ['A', 'B']) states[tag] = (await users[tag].api('GET', '/api/state')).json
  const calls = [['get_overview', {}], ['list_subscriptions', {}], ['list_plan_changes', {}], ['get_allocation', {}], ['get_schedule', { months: 12 }], ['list_changes', { limit: 50 }]]
  for (const [me, other] of [['A', 'B'], ['B', 'A']]) {
    const out = {}
    for (const [name, args] of calls) {
      const t = await tool(users[me].key, name, args)
      ok(!failedCall(t) && !!t.data, `${me}'s key: ${name} → ${t.status}${t.error ? ' ' + JSON.stringify(t.error) : ''}`)
      out[name] = t.text
    }
    const all = Object.values(out).join('\n')
    ok(!all.includes(users[other].marker), `${me}'s key: nothing marked ${users[other].marker} in any of the six answers`)
    const foreignIds = uuidIds(states[other]).filter((x) => !uuidIds(states[me]).includes(x))
    ok(foreignIds.length > 0 && !foreignIds.some((x) => all.includes(x)), `${me}'s key: none of ${other}'s ${foreignIds.length} ids appear`)
    const foreignNames = ownStrings(states[other]).filter((n) => !ownStrings(states[me]).includes(n))
    ok(foreignNames.length > 0 && !foreignNames.some((n) => all.includes(n)), `${me}'s key: none of ${other}'s ${foreignNames.length} names appear`)
    // and the user's own marked data is there
    const m = users[me].marker
    ok(out.list_subscriptions.includes(`${m}-sub`) && out.list_plan_changes.includes(`${m}-change`) && out.get_allocation.includes(`${m}-target`)
      && out.get_allocation.includes(`${m}-account`) && out.get_allocation.includes(`${m}-debt`) && out.get_schedule.includes(`${m}-event`) && out.get_schedule.includes(`${m}-check`),
      `${me}'s key: ${me}'s own marked data is in the answers`)
    ok(out.list_changes.includes('subscription') || out.list_changes.includes(`${m}-sub`), `${me}'s key: list_changes shows ${me}'s own changes`)
  }
  // A's key cannot ask for B's data by id or by any argument: the tools take none, and an extra argument is ignored or refused
  const sneaky = await tool(users.A.key, 'list_changes', { limit: 50, userId: users.B.id })
  ok(!JSON.stringify(sneaky.text).includes(users.B.marker), "an extra userId argument does not reach B's data")
  // clean up A's marked rows (B goes with the user)
  for (const [path, id] of [...users.A.made].reverse()) await A('DELETE', `${path}/${id}`)
}

async function toolsMode() {
  const calc = await import('../../src/lib/calc.ts')
  const key = await insertKey(aId)
  const list = await mcp(A, key)
  const tools = list.json?.result?.tools ?? []
  ok(tools.length === 6 && TOOLS.every((n) => tools.some((t) => t.name === n)), `tools/list: exactly the six tools (${tools.map((t) => t.name).join(', ')})`)
  ok(tools.every((t) => t.annotations?.readOnlyHint === true), 'every tool says readOnlyHint: true')
  ok(tools.every((t) => !/create|update|delete|write|set_|add_|remove/.test(t.name)), 'no tool name is a write')
  ok(tools.every((t) => typeof t.description === 'string' && /^[\x20-\x7e]+$/.test(t.description)), 'descriptions are English text')

  const unknown = await tool(key, 'delete_everything', {})
  ok(failedCall(unknown), `an unknown tool is an MCP error (${unknown.status} ${JSON.stringify(unknown.error ?? unknown.result?.content?.[0]?.text)?.slice(0, 80)})`)
  for (const [name, args] of [['get_overview', { month: '2026-13' }], ['get_overview', { month: 'now' }], ['get_schedule', { months: 13 }], ['get_schedule', { months: 0 }], ['list_changes', { limit: 51 }], ['list_changes', { before: '2026-01-01 00:00:00+00' }], ['list_subscriptions', { status: 'gone' }]]) {
    const t = await tool(key, name, args)
    ok(failedCall(t), `${name} ${JSON.stringify(args)} is refused`)
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
    const x = calc.transferAt(state.subscriptions, state.planChanges, state.settings, ym)
    const dist = calc.distributionAt(ym, state.settings.netPay, state.phases, state.targets, state.living, state.subscriptions, state.planChanges, state.settings)
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
}

try {
  if (mode === 'auth') await authMode()
  else if (mode === 'isolation') await isolationMode()
  else await toolsMode()
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
