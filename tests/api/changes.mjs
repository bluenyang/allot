// API check for spec 005 V-8 (a–g): change sets and revert.
//   BASE=http://<host>:15173 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/changes.mjs
// Works on marker rows only and removes them at the end (open-ended phases are closed for the
// overlap check and restored). Exit code 0 only when every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
const MARK = 'V8c-marker'

let cookie = ''
async function api(method, path, body) {
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

const latest = async () => (await api('GET', '/api/changes?limit=1')).json[0]
const state = async () => (await api('GET', '/api/state')).json

const signIn = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
ok(signIn.status === 200, `sign-in → ${signIn.status}`)
if (signIn.status !== 200) process.exit(1)

const sub = { name: MARK, category: 'tool', plan: 'p', amount: 3, currency: 'USD', vat: 10, cycle: 'monthly', status: 'active', nextDate: '2031-02-01', path: 'direct', verified: false }

// (a) create / update / delete each leave one set with matching logs
const c1 = await api('POST', '/api/checks', { text: MARK, done: false })
ok(c1.status === 201, `(a) create check → ${c1.status}`)
let s = await latest()
ok(s?.changes.length === 1 && s.changes[0].op === 'insert' && s.changes[0].before === null && s.changes[0].after?.text === MARK, '(a) create → one set, one insert log with after')
const u1 = await api('PUT', `/api/checks/${c1.json.id}`, { text: MARK, done: true })
s = await latest()
ok(u1.status === 200 && s.changes.length === 1 && s.changes[0].op === 'update' && s.changes[0].before.done === false && s.changes[0].after.done === true, '(a) update → one update log, before/after')
const updateSet = s.id

// (b) revert the update → value back, new set with revert_of
const rv = await api('POST', `/api/changes/${updateSet}/revert`)
ok(rv.status === 200 && typeof rv.json?.changeSet === 'string', `(b) revert update → ${rv.status}`)
let st = await state()
ok(st.checks.find((x) => x.id === c1.json.id)?.done === false, '(b) value is the before value again')
s = await latest()
ok(s.id === rv.json.changeSet && s.revertOf === updateSet, '(b) new set records revert_of')

// (e) revert the revert → applied again
const rr = await api('POST', `/api/changes/${rv.json.changeSet}/revert`)
st = await state()
ok(rr.status === 200 && st.checks.find((x) => x.id === c1.json.id)?.done === true, `(e) revert of the revert → ${rr.status}, applied again`)
const twice = await api('POST', `/api/changes/${updateSet}/revert`)
ok(twice.status === 409, `(e) a set that was already reverted → ${twice.status} (want 409)`)

// (d) a later change to the same row → conflict, nothing changes
const u2 = await api('PUT', `/api/checks/${c1.json.id}`, { text: `${MARK}-x`, done: true })
const u2set = (await latest()).id
await api('PUT', `/api/checks/${c1.json.id}`, { text: `${MARK}-y`, done: true })
const conflict = await api('POST', `/api/changes/${u2set}/revert`)
st = await state()
ok(u2.status === 200 && conflict.status === 409 && st.checks.find((x) => x.id === c1.json.id)?.text === `${MARK}-y`, `(d) later change → ${conflict.status} (want 409), data unchanged`)

// (c) delete a subscription with a plan change, revert → both back, same order
const sc = await api('POST', '/api/subscriptions', sub)
const pc = await api('POST', '/api/plan-changes', { subId: sc.json.id, effective: null, to: { amount: 4 }, note: MARK })
const order = (x) => x.subscriptions.map((y) => y.id).join(',')
const beforeDel = await state()
const del = await api('DELETE', `/api/subscriptions/${sc.json.id}`)
s = await latest()
ok(del.status === 204 && s.changes.length === 2 && s.changes.every((l) => l.op === 'delete') && s.changes.some((l) => l.tableName === 'plan_change'),
  `(c) delete subscription → ${del.status}, one set with the plan change and the subscription`)
const undel = await api('POST', `/api/changes/${s.id}/revert`)
st = await state()
ok(undel.status === 200 && JSON.stringify(st.subscriptions.find((x) => x.id === sc.json.id)) === JSON.stringify(beforeDel.subscriptions.find((x) => x.id === sc.json.id))
  && JSON.stringify(st.planChanges.find((x) => x.id === pc.json.id)) === JSON.stringify(beforeDel.planChanges.find((x) => x.id === pc.json.id))
  && order(st) === order(beforeDel), `(c) revert delete → ${undel.status}, subscription and plan change back with the same values and order`)

// (f) a revert that would make phases overlap → 400, nothing changes
const open = (await state()).phases.filter((p) => p.to === null)
for (const { id, ...rest } of open) await api('PUT', `/api/phases/${id}`, { ...rest, to: '2089-12' })
const pa = await api('POST', '/api/phases', { label: 'V', name: `${MARK}-a`, from: '2095-01', to: '2095-06', amounts: {} })
await api('DELETE', `/api/phases/${pa.json.id}`)
const delA = (await latest()).id
const pb = await api('POST', '/api/phases', { label: 'V', name: `${MARK}-b`, from: '2095-03', to: '2095-12', amounts: {} })
const overlap = await api('POST', `/api/changes/${delA}/revert`)
st = await state()
ok(pb.status === 201 && overlap.status === 400 && !st.phases.some((p) => p.id === pa.json.id), `(f) revert into an overlap → ${overlap.status} (want 400), phase not restored`)

// (g) 400 and 404 requests leave no set
const head = (await latest()).id
const bad = await api('POST', '/api/phases', { label: 'V', name: `${MARK}-c`, from: '2095-05', to: '2095-07', amounts: {} })
const missing = await api('PUT', '/api/checks/no-such-id', { text: 'x', done: false })
const missingSet = await api('POST', '/api/changes/no-such-set/revert')
ok(bad.status === 400 && missing.status === 404 && missingSet.status === 404 && (await latest()).id === head, `(g) 400/404/404 → no new set`)

// cleanup: markers out, open phases back
await api('DELETE', `/api/phases/${pb.json.id}`)
for (const p of open) await api('PUT', `/api/phases/${p.id}`, { ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'id')), to: null })
await api('DELETE', `/api/subscriptions/${sc.json.id}`)
await api('DELETE', `/api/checks/${c1.json.id}`)
st = await state()
ok(!JSON.stringify(st).includes(MARK) && st.phases.filter((p) => p.to === null).length === open.length, 'cleanup: no marker left, open phases restored')

console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
