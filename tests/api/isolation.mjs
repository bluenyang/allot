// API check for spec 005 V-5 and V-8 (h): one user cannot see or change another user's data.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… B_EMAIL=… B_PASSWORD=… node tests/api/isolation.mjs
// A is the seeded account (has data); B is a second account with no data (tests/api/make-user.ts).
// B's own rows are removed at the end. Exit code 0 only when every check passed.
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
ok(bState.status === 409, `B GET /api/state → ${bState.status} (want 409: no settings of its own)`)

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

// B cannot point at A's rows
const pc = await B('POST', '/api/plan-changes', { subId: aSub.id, effective: null, to: { amount: 1 }, note: MARK })
ok(pc.status === 400, `B plan change on A's subscription → ${pc.status} (want 400)`)
const bPhase = await B('POST', '/api/phases', { label: 'B', name: MARK, from: '2030-01', to: '2030-12', amounts: { [aTarget.id]: 1000 } })
ok(bPhase.status === 400, `B phase with an amount for A's target → ${bPhase.status} (want 400)`)
const bPhase2 = await B('POST', '/api/phases', { label: 'B', name: MARK, from: aPhase.from, to: aPhase.to, amounts: {} })
ok(bPhase2.status === 201, `B phase over the same months as A's phase → ${bPhase2.status} (want 201: overlap is per user)`)

// B's rows are invisible to A
const bCheck = await B('POST', '/api/checks', { text: MARK, done: false })
const aSees = (await A('GET', '/api/state')).json
ok(bCheck.status === 201 && !JSON.stringify(aSees).includes(MARK), "B's new rows do not show up for A")

// (h) change sets are per user. A needs a set of its own first: toggle a check and back.
await A('PUT', `/api/checks/${aCheck.id}`, { text: aCheck.text, done: !aCheck.done })
await A('PUT', `/api/checks/${aCheck.id}`, { text: aCheck.text, done: aCheck.done })
const aSets = (await A('GET', '/api/changes?limit=200')).json
const bSets = (await B('GET', '/api/changes?limit=200')).json
ok(Array.isArray(bSets) && bSets.length >= 2 && bSets.every((s) => !aSets.some((x) => x.id === s.id)), `B lists only its own change sets (${bSets.length})`)
const aSet = aSets[0]
if (aSet) {
  const rv = await B('POST', `/api/changes/${aSet.id}/revert`)
  ok(rv.status === 404, `B revert of A's change set → ${rv.status} (want 404)`)
} else ok(false, 'A has a change set to try')

// cleanup B
await B('DELETE', `/api/checks/${bCheck.json.id}`)
if (bPhase2.json?.id) await B('DELETE', `/api/phases/${bPhase2.json.id}`)
const bLeft = (await B('GET', '/api/changes?limit=1')).json
ok(Array.isArray(bLeft), 'cleanup done')

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
