// API check for spec 010 V-4: the "remainder" target rules were lifted. The remainder target may be
// deleted and may change kind; "one per kind" stays; without a remainder target the state, the
// change history and the MCP get_overview still work and give the leftover; the remainder split rows
// stay; reverting the delete from the history brings the target back.
//   docker compose -f docker/compose.dev.yaml exec -T -e BASE=http://127.0.0.1:3000 api node tests/api/remainder.mjs
// Run it inside the api container of the dev stack (DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD). It works
// on a fresh user it creates and deletes (the admin's own data is not touched). A key for the MCP call
// is written into the `apikey` table the way tests/api/mcp.mjs does; no raw key is printed.
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}) => {
    const all = { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...headers }
    for (const k of Object.keys(all)) if (all[k] === undefined || all[k] === '') delete all[k]
    const res = await fetch(BASE + path, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json }
  }
  return api
}

const A = client()
const sa = await A('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
ok(sa.status === 200, `admin sign-in → ${sa.status}`)
if (failed) process.exit(1)

const email = `v4rem-${Date.now()}@example.com`
const password = 'v4rem-pass-12345'
const cu = await A('POST', '/api/auth/admin/create-user', { email, password, name: 'V4 remainder', role: 'user' })
if (cu.status !== 200) throw new Error(`create-user → ${cu.status}`)
const uid = cu.json.user.id
const U = client()
let keyHash = null

try {
  const si = await U('POST', '/api/auth/sign-in/email', { email, password })
  ok(si.status === 200, `test user sign-in → ${si.status}`)

  // A fresh account: living, remainder, a fixed target, two remainder-split rows.
  const living = await U('POST', '/api/targets', { name: 'Living', kind: 'living' })
  const rem = await U('POST', '/api/targets', { name: 'Leftover', kind: 'remainder' })
  const fixed = await U('POST', '/api/targets', { name: 'Fixed', kind: 'fixed' })
  ok([living, rem, fixed].every((r) => r.status === 201), `three targets created → ${living.status}/${rem.status}/${fixed.status}`)
  const sp1 = await U('POST', '/api/remainder-split', { name: 'Split A', code: 'A', ratio: 0.6 })
  const sp2 = await U('POST', '/api/remainder-split', { name: 'Split B', code: 'B', ratio: 0.4 })
  ok(sp1.status === 201 && sp2.status === 201, 'two remainder-split rows created')
  const settings = (await U('GET', '/api/state')).json.settings
  const sPut = await U('PUT', '/api/settings', { ...settings, netPay: 3_000_000 })
  ok(sPut.status === 200, `net pay set → ${sPut.status}`)
  const lv = await U('PUT', '/api/living', { food: 400_000, transit: 100_000, allowance: 200_000 })
  ok(lv.status === 200, `living set → ${lv.status}`)

  // "One per kind" stays.
  const dup = await U('POST', '/api/targets', { name: 'Second', kind: 'remainder' })
  ok(dup.status === 400, `a second remainder target → ${dup.status} (want 400)`)
  const dupL = await U('POST', '/api/targets', { name: 'Second', kind: 'living' })
  ok(dupL.status === 400, `a second living target → ${dupL.status} (want 400)`)

  // Delete the remainder target.
  const del = await U('DELETE', `/api/targets/${rem.json.id}`)
  ok(del.status === 204 || del.status === 200, `delete the remainder target → ${del.status} (want 200/204)`)
  const delSet = (await U('GET', '/api/changes?limit=1')).json[0]
  ok(delSet?.changes?.some((c) => c.op === 'delete' && c.tableName === 'allocation_target'), 'the delete is in the change history')
  let st = await U('GET', '/api/state')
  ok(st.status === 200 && !st.json.targets.some((x) => x.kind === 'remainder'), '/api/state works and has no remainder target')
  ok(st.json.remainderSplit.length === 2, `the remainder-split rows are kept (${st.json.remainderSplit.length})`)

  // MCP get_overview without a remainder target: the leftover is shown.
  const key = 'allot_' + Array.from(randomBytes(64), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[b % 52]).join('')
  keyHash = createHash('sha256').update(key).digest('base64url')
  await sql`insert into apikey (id, config_id, name, start, reference_id, prefix, key, enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count, permissions, metadata, expires_at, created_at, updated_at)
    values (${randomBytes(12).toString('hex')}, 'default', 'v4rem', ${key.slice(0, 6)}, ${uid}, 'allot_', ${keyHash}, true, true, 60000, 120, 0, '{"mcp":["read"]}', null, ${new Date(Date.now() + 86_400_000)}, now(), now())`
  const overview = async () => {
    const r = await U('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_overview', arguments: {} } },
      { accept: 'application/json, text/event-stream', authorization: `Bearer ${key}`, origin: undefined, cookie: '' })
    return r.json?.result?.structuredContent
  }
  let ov = await overview()
  ok(!!ov?.distribution, 'get_overview works without a remainder target')
  // The month has no phase: fixed = 0, so the leftover is 3,000,000 - 700,000.
  ok(ov?.distribution?.remainderKrw === 2_300_000 && ov?.distribution?.unallocatedKrw === 2_300_000, `get_overview shows the leftover (${ov?.distribution?.remainderKrw} / unallocated ${ov?.distribution?.unallocatedKrw}; want 2300000)`)
  ok(Array.isArray(ov?.remainderSplit) && ov.remainderSplit.length === 0, 'get_overview splits nothing without a remainder target')

  // Revert the delete from the history: the target comes back.
  const rv = await U('POST', `/api/changes/${delSet.id}/revert`)
  ok(rv.status === 200, `revert the delete → ${rv.status}`)
  st = await U('GET', '/api/state')
  ok(st.json.targets.some((x) => x.id === rem.json.id && x.kind === 'remainder' && x.name === 'Leftover'), 'the remainder target is back after the revert')
  ov = await overview()
  ok(ov?.distribution?.unallocatedKrw === 0 && ov?.remainderSplit?.length === 2, 'get_overview: unallocated is 0 and the split is back')

  // Remainder → fixed.
  const { id: _i, ...body } = st.json.targets.find((x) => x.id === rem.json.id)
  const toFixed = await U('PUT', `/api/targets/${rem.json.id}`, { ...body, kind: 'fixed' })
  ok(toFixed.status === 200, `remainder → fixed → ${toFixed.status} (want 200)`)
  st = await U('GET', '/api/state')
  ok(st.json.targets.find((x) => x.id === rem.json.id)?.kind === 'fixed' && !st.json.targets.some((x) => x.kind === 'remainder'), 'the target is fixed now and no remainder target is left')
  // Two remainder targets still 400: make the other fixed one a remainder, then try to turn the first back.
  const other = st.json.targets.find((x) => x.id === fixed.json.id)
  const { id: _o, ...otherBody } = other
  const asRem = await U('PUT', `/api/targets/${fixed.json.id}`, { ...otherBody, kind: 'remainder' })
  ok(asRem.status === 200, `another target becomes the remainder → ${asRem.status}`)
  const { id: _r, ...firstBody } = st.json.targets.find((x) => x.id === rem.json.id)
  const two = await U('PUT', `/api/targets/${rem.json.id}`, { ...firstBody, kind: 'remainder' })
  ok(two.status === 400, `two remainder targets → ${two.status} (want 400)`)

  // A revert that removes the last remainder target is no longer refused: revert the "become remainder" set.
  const sets = (await U('GET', '/api/changes?limit=5')).json
  const becameRem = sets.find((s) => s.changes.some((c) => c.op === 'update' && c.after?.kind === 'remainder' && c.before?.kind === 'fixed'))
  if (becameRem) {
    const rv2 = await U('POST', `/api/changes/${becameRem.id}/revert`)
    ok(rv2.status === 200, `reverting the change that made the only remainder target → ${rv2.status} (want 200)`)
  } else ok(false, 'found the set that made a remainder target')
} finally {
  if (keyHash) await sql`delete from apikey where key = ${keyHash}`.catch(() => {})
  const r = await A('DELETE', `/api/admin/users/${uid}`, { confirmEmail: email })
  if (r.status !== 204) console.log(`cleanup: delete ${email} → ${r.status}`)
  await sql.end()
}
console.log(failed ? `${failed} FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
