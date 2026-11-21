// API check for spec 008 V-4 (authentication), V-5 (isolation) and V-6 (tools) of the MCP endpoint.
//   docker compose -f docker/compose.dev.yaml restart api      (the failure limit is in memory: start clean)
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://127.0.0.1:3000 api node tests/api/mcp.mjs auth
// Run it inside the api container of the dev stack (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD). A is
// ADMIN_EMAIL; the other users are created here and deleted at the end. Keys for these checks are
// written straight into the `apikey` table in the form the plugin stores them (the way a key made
// on the screen looks in the database: SHA-256 base64url of the key); making keys through the
// screen's API is tests/api/api-keys.mjs. No raw key is printed or written anywhere.
//   isolation  V-5: users A and B each put marked data in; A's key calls all seven tools and nothing of B shows, and back.
//   tools      V-6: tools/list (seven, read-only), get_overview for this month and three months on against calc.ts,
//              an unknown tool and bad arguments, list_changes paging.
//   write      spec 009 V-3…V-9 through the tools: scope, proposals, previews, apply, confirmation methods,
//              stale / expired / revoked, revert, isolation (a fresh user W; keys are made through the API).
//   auth       V-4: every refusal is the same 401, the per-address limit (21st failure → 429), the per-key
//              limit, a session or a key on the wrong path, GET, a big body, a foreign Origin.
//              Ends by exhausting the address limit: restart the api before the next mode.
// Exit 0 only if every check passed. The login rate limit (5/min) is respected: one sign-in per user.
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

const mode = process.argv[2]
if (!['auth', 'isolation', 'tools', 'write'].includes(mode)) throw new Error('usage: mcp.mjs auth|isolation|tools|write')
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
  await sql`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, metadata, expires_at, created_at, updated_at)
    values (${randomBytes(12).toString('hex')}, 'default', ${over.name ?? 'v4'}, ${key.slice(0, 6)}, ${userId}, 'allot_', ${sha(key)}, ${over.enabled ?? true}, true, 60000, 120, 0,
      ${over.permissions ?? '{"mcp":["read"]}'}, ${over.metadata ?? null}, ${over.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)}, now(), now())`
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

const TOOLS = ['get_overview', 'list_subscriptions', 'list_plan_changes', 'get_allocation', 'get_schedule', 'list_changes', 'list_spendings']
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
  const calls = [['get_overview', {}], ['list_subscriptions', {}], ['list_plan_changes', {}], ['get_allocation', {}], ['get_schedule', { months: 12 }], ['list_changes', { limit: 50 }], ['list_spendings', {}]]
  for (const [me, other] of [['A', 'B'], ['B', 'A']]) {
    const out = {}
    for (const [name, args] of calls) {
      const t = await tool(users[me].key, name, args)
      ok(!failedCall(t) && !!t.data, `${me}'s key: ${name} → ${t.status}${t.error ? ' ' + JSON.stringify(t.error) : ''}`)
      out[name] = t.text
    }
    const all = Object.values(out).join('\n')
    ok(!all.includes(users[other].marker), `${me}'s key: nothing marked ${users[other].marker} in any of the seven answers`)
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
  ok(tools.length === 7 && TOOLS.every((n) => tools.some((t) => t.name === n)), `tools/list: exactly the seven tools (${tools.map((t) => t.name).join(', ')})`)
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
  ok(rn.length === 7 && rn.includes('list_spendings') && WRITE_TOOLS.every((n) => !rn.includes(n)), 'a read key: tools/list has the seven read tools (list_spendings among them) and no write tool')
  for (const [name, args] of [['propose_changes', { changes: [] }], ['apply_proposal', { proposalId: 'x' }], ['get_proposal', { proposalId: 'x' }], ['propose_revert', { changeSetId: 'x' }]]) {
    ok(failedCall(await tool(kRead.key, name, args)), `a read key calling ${name} is an MCP error`)
  }
  const un = await mcp(A, kUi.key)
  const utools = un.json?.result?.tools ?? []
  ok(utools.length === 11 && WRITE_TOOLS.every((n) => utools.some((t) => t.name === n)), `a write key: eleven tools (${utools.length})`)
  ok(utools.find((t) => t.name === 'apply_proposal')?.annotations?.destructiveHint === true && utools.find((t) => t.name === 'get_proposal')?.annotations?.readOnlyHint === true && utools.find((t) => t.name === 'propose_changes')?.annotations?.readOnlyHint === false, 'annotations: apply is destructive, get is read-only, propose is not read-only')
  ok(utools.every((t) => typeof t.description === 'string' && /^[\x20-\x7e]+$/.test(t.description)), 'write tool descriptions are English text')
  const pc = utools.find((t) => t.name === 'propose_changes')
  ok(JSON.stringify(pc?.inputSchema ?? {}).includes('subscriptions') && JSON.stringify(pc?.inputSchema ?? {}).includes('remainder-split') && JSON.stringify(pc?.inputSchema ?? {}).includes('spendings') && /spendings/.test(pc?.description ?? ''), 'propose_changes advertises the resource shapes (spendings too)')
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
  ok(pr1.data?.preview?.rows?.length === 2 && pr1.data.preview.months?.length === 2 && pr1.data.preview.months[0].transferKrw.after !== undefined, 'the preview has rows and two months of transfer and distribution')
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
  const acc = await tool(kChat.key, 'propose_changes', { changes: [{ resource: 'accounts', action: 'create', data: { name: 'x', role: '', inflow: '', outflow: '' } }] })
  ok(failedCall(acc), 'accounts cannot be proposed')

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
  // rules of the screen apply: a round count that does not fit, a USD amount with a long rate
  const bad1 = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('x', 'salary', 1000, { count: 2 }) }] })
  const bad2 = await tool(kUi.key, 'propose_changes', { changes: [{ resource: 'spendings', action: 'create', data: SP('x', 'salary', 10, { currency: 'USD', fxRate: 1300.123, fxBuffer: 2 }) }] })
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
  const isSuper = (await sqlW`select rolsuper from pg_roles where rolname = current_user`)[0].rolsuper
  if (!isSuper) console.log('SKIP the role-probe of mcp_proposal needs a superuser to create a role (the connected role is not one); RLS of the tables is checked in the rls query of V-4')
  else {
    // the table's row-level security: as a role that is not a superuser, another user sees no row
    await sqlW`do $$ begin if not exists (select 1 from pg_roles where rolname = 'allot_rls_probe') then create role allot_rls_probe nosuperuser nobypassrls; end if; end $$`
    await sqlW`grant select on mcp_proposal to allot_rls_probe`
    const rls = await sqlW.begin(async (tx) => {
      await tx`set local role allot_rls_probe`
      await tx`select set_config('app.user_id', ${xId}, true)`
      const other = await tx`select count(*)::int as n from mcp_proposal where user_id = ${wId}`
      const all = await tx`select count(*)::int as n from mcp_proposal`
      await tx`select set_config('app.user_id', ${wId}, true)`
      const mine = await tx`select count(*)::int as n from mcp_proposal`
      return { other: other[0].n, all: all[0].n, mine: mine[0].n }
    })
    ok(rls.other === 0 && rls.all === 0 && rls.mine > 0, `RLS on mcp_proposal: X sees ${rls.all} rows of W's, W sees ${rls.mine}`)
  }

  // ── revoked key ──
  const dead = await W('DELETE', `/api/keys/${kChat.id}`)
  ok(dead.status === 204 && (await mcp(A, kChat.key)).status === 401, 'a revoked key is 401 at the endpoint')
  console.log(`INFO ${JSON.stringify({ wId, keyUi: kUi.id, proposalUi: pr2.data.proposalId })}`)
  await sqlW.end()
}

try {
  if (mode === 'write') await writeMode()
  else if (mode === 'auth') await authMode()
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
