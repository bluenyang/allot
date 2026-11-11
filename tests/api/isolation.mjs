// API check for spec 005 V-5 and V-8 (h): one user cannot see or change another user's data.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… B_EMAIL=… B_PASSWORD=… node tests/api/isolation.mjs
// A is the seeded account (has data); B is a second account with no data (tests/api/make-user.ts).
// B's rows are removed at the end (in finally); its change history and the account stay, so run it on a
// disposable test database. Exit code 0 only when every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
const MARK = 'V5-marker'

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
const sa = await A('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
const sb = await B('POST', '/api/auth/sign-in/email', { email: process.env.B_EMAIL, password: process.env.B_PASSWORD })
ok(sa.status === 200 && sb.status === 200, `sign-in A ${sa.status}, B ${sb.status}`)
if (failed) process.exit(1)

const aState = (await A('GET', '/api/state')).json
const aSub = aState.subscriptions[0]
const aCheck = aState.checks[0]
const aTarget = aState.targets.find((t) => t.kind === 'fixed')
const aPhase = aState.phases[0]
ok(!!aSub && !!aCheck && !!aTarget && !!aPhase, 'A has a subscription, a check, a fixed target and a phase (needed below)')

// B sees nothing of A
const bState = await B('GET', '/api/state')
const aIds = [aSub.id, aCheck.id, aTarget.id, aPhase.id]
const LISTS = ['subscriptions', 'planChanges', 'phases', 'events', 'checks', 'accounts', 'debts', 'targets', 'remainderSplit']
const isState = (j) => !!j && LISTS.every((k) => Array.isArray(j[k]))
ok(bState.status === 409 || (bState.status === 200 && isState(bState.json) && !aIds.some((id) => JSON.stringify(bState.json).includes(id))),
  `B GET /api/state → ${bState.status} (want 409 for a new account, or 200 without any of A's rows)`)

// B cannot change or delete A's rows by id
for (const [path, body] of [
  [`/api/subscriptions/${aSub.id}`, { ...aSub, id: undefined, name: MARK }],
  [`/api/checks/${aCheck.id}`, { text: MARK, done: !aCheck.done }],
  [`/api/targets/${aTarget.id}`, { name: MARK, kind: 'fixed' }],
]) {
  const put = await B('PUT', path, body)
  const del = await B('DELETE', path)
  ok(put.status === 404 && del.status === 404, `B PUT/DELETE ${path.split('/').slice(0, 3).join('/')}/<A's id> → ${put.status}/${del.status} (want 404/404)`)
}
const aAfter = (await A('GET', '/api/state')).json
ok(JSON.stringify(aAfter) === JSON.stringify(aState), "A's data is unchanged")

// B gets settings and living of its own, so its /api/state answers 200 and the final cleanup check can see its rows.
const bSettings = await B('PUT', '/api/settings', { netPay: 1, fxRate: 1, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10000 })
const bLiving = await B('PUT', '/api/living', { food: 0, transit: 0, allowance: 0 })
ok(bSettings.status === 200 && bLiving.status === 200, `B saves its own settings and living → ${bSettings.status}, ${bLiving.status}`)

// Everything B creates is tracked and removed in `finally`, also when a check throws.
const created = [] // [path, id]
const track = (path, r) => { if (r.status === 201 && r.json?.id) created.push([path, r.json.id]); return r }
let aRestore = null
try {
  // B cannot point at A's rows
  const pc = track('/api/plan-changes', await B('POST', '/api/plan-changes', { subId: aSub.id, effective: null, to: { amount: 1 }, note: MARK }))
  ok(pc.status === 400, `B plan change on A's subscription → ${pc.status} (want 400)`)
  const bPhase = track('/api/phases', await B('POST', '/api/phases', { label: 'B', name: MARK, from: '2030-01', to: '2030-12', amounts: { [aTarget.id]: 1000 } }))
  ok(bPhase.status === 400, `B phase with an amount for A's target → ${bPhase.status} (want 400)`)
  const bPhase2 = track('/api/phases', await B('POST', '/api/phases', { label: 'B', name: MARK, from: aPhase.from, to: aPhase.to, amounts: {} }))
  ok(bPhase2.status === 201, `B phase over the same months as A's phase → ${bPhase2.status} (want 201: overlap is per user)`)

  // B's rows are invisible to A
  const bCheck = track('/api/checks', await B('POST', '/api/checks', { text: MARK, done: false }))
  const aSees = (await A('GET', '/api/state')).json
  ok(bCheck.status === 201 && !JSON.stringify(aSees).includes(MARK), "B's new rows do not show up for A")

  // (h) change sets are per user. A needs a set of its own: toggle a check and back (both checked).
  aRestore = { id: aCheck.id, body: { text: aCheck.text, done: aCheck.done } }
  const t1 = await A('PUT', `/api/checks/${aCheck.id}`, { text: aCheck.text, done: !aCheck.done })
  const aSet = (await A('GET', '/api/changes?limit=1')).json?.[0]
  const t2 = await A('PUT', `/api/checks/${aCheck.id}`, aRestore.body)
  const back = (await A('GET', '/api/state')).json.checks.find((x) => x.id === aCheck.id)
  ok(t1.status === 200 && t2.status === 200 && back?.done === aCheck.done && aSet?.changes?.[0]?.rowKey?.id === aCheck.id,
    `A toggles its check and back (${t1.status}, ${t2.status}); restored; the first toggle is A's set`)
  if (t2.status === 200 && back?.done === aCheck.done) aRestore = null // only when the value really is back
  const aSets = (await A('GET', '/api/changes?limit=200')).json
  const bSets = (await B('GET', '/api/changes?limit=200')).json
  ok(Array.isArray(bSets) && bSets.length >= 2 && bSets.every((x) => !aSets.some((y) => y.id === x.id)), `B lists only its own change sets (${bSets.length})`)
  if (aSet) {
    const one = await B('GET', `/api/changes/${aSet.id}`)
    ok(one.status === 404, `B GET A's change set by id → ${one.status} (want 404)`)
    const rv = await B('POST', `/api/changes/${aSet.id}/revert`)
    ok(rv.status === 404, `B revert of A's change set → ${rv.status} (want 404)`)
  } else ok(false, 'A has a change set to try')
} finally {
  // cleanup: try every step even when one throws; report each, then look at B's rows for the marker
  const step = async (name, run) => {
    try { await run() } catch (e) { ok(false, `cleanup ${name} threw: ${e?.message ?? e}`) }
  }
  for (const [path, id] of created.reverse()) {
    await step(`DELETE ${path}`, async () => {
      const d = await B('DELETE', `${path}/${id}`)
      ok(d.status === 204, `cleanup DELETE ${path}/<id> → ${d.status}`)
    })
  }
  if (aRestore) {
    await step("restore A's check", async () => {
      const r = await A('PUT', `/api/checks/${aRestore.id}`, aRestore.body)
      const now = (await A('GET', '/api/state')).json.checks.find((x) => x.id === aRestore.id)
      ok(r.status === 200 && now?.done === aRestore.body.done, `cleanup: A's check restored → ${r.status}, value ${now?.done === aRestore.body.done ? 'back' : 'NOT back'}`)
    })
  }
  await step('final look', async () => {
    const bRows = await B('GET', '/api/state')
    ok(bRows.status === 200 && isState(bRows.json) && !JSON.stringify(bRows.json).includes(MARK),
      `cleanup: B's state readable (${bRows.status}) and no marker row left (B's settings, change history and the account stay; use a disposable database)`)
  })
}

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
