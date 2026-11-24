// API check for spec 005 V-5 and V-8 (h): one user cannot see or change another user's data; spec 013 V-4: also the
// living items, the new account fields, balance records and cards; spec 013 rev 1 (rc.2): month adjustments.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… B_EMAIL=… B_PASSWORD=… node tests/api/isolation.mjs
// A is the seeded account (has data); B is a second account with no data (tests/api/make-user.ts).
// B's rows are removed at the end (in finally); its change history and the account stay, so run it on a
// disposable test database. Exit code 0 only when every check passed.
// The first failed check stops the run: it throws once (once armed), the `finally` below removes what was
// made, and later failures there are only reported (tests/api/lib/check.mjs; knowledge: stop-at-first-failure).
import { arm, cleanupStep, disarm, failures, ok, settle, threw } from './lib/check.mjs'
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
const created = [] // [path, id]: everything B creates, removed in `finally`
const track = (path, r) => { if (r.status === 201 && r.json?.id) created.push([path, r.json.id]); return r }
let aRestore = null
let aOrig = null // A's three rows as they were, put back in `finally` when a check found them changed
const LISTS = ['subscriptions', 'planChanges', 'phases', 'events', 'checks', 'accounts', 'debts', 'targets', 'remainderSplit']
const isState = (j) => !!j && LISTS.every((k) => Array.isArray(j[k]))
const A = client()
const B = client()
const sa = await A('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
const sb = await B('POST', '/api/auth/sign-in/email', { email: process.env.B_EMAIL, password: process.env.B_PASSWORD })
ok(sa.status === 200 && sb.status === 200, `sign-in A ${sa.status}, B ${sb.status}`)
if (failures()) process.exit(1)

// From here every write sits behind the first failed check: it stops the run, `finally` puts back what it can.
arm()
try {
const aState = (await A('GET', '/api/state')).json
const aSub = aState.subscriptions[0]
const aCheck = aState.checks[0]
const aTarget = aState.targets.find((t) => t.kind === 'fixed')
const aPhase = aState.phases[0]
ok(!!aSub && !!aCheck && !!aTarget && !!aPhase, 'A has a subscription, a check, a fixed target and a phase (needed below)')
aOrig = [['subscriptions', aSub], ['checks', aCheck], ['targets', aTarget]]

// B sees nothing of A
const bState = await B('GET', '/api/state')
const aIds = [aSub.id, aCheck.id, aTarget.id, aPhase.id]
// spec 006 S-7: a new account gets the defaults (200) instead of 0.1.1's 409; never any of A's rows.
ok(bState.status === 200 && isState(bState.json) && !aIds.some((id) => JSON.stringify(bState.json).includes(id)),
  `B GET /api/state → ${bState.status} (want 200 without any of A's rows)`)

// B cannot change or delete A's rows by id
for (const [path, body] of [
  [`/api/subscriptions/${aSub.id}`, { ...aSub, id: undefined, name: MARK }],
  [`/api/checks/${aCheck.id}`, { text: MARK, done: !aCheck.done }],
  [`/api/targets/${aTarget.id}`, { name: MARK, kind: 'fixed' }],
]) {
  const put = await B('PUT', path, body)
  ok(put.status === 404, `B PUT ${path.split('/').slice(0, 3).join('/')}/<A's id> → ${put.status} (want 404)`) // no DELETE after a PUT that got through
  const del = await B('DELETE', path)
  ok(del.status === 404, `B DELETE ${path.split('/').slice(0, 3).join('/')}/<A's id> → ${del.status} (want 404)`)
}
const aAfter = (await A('GET', '/api/state')).json
ok(JSON.stringify(aAfter) === JSON.stringify(aState), "A's data is unchanged")

// B gets settings and living of its own, so its /api/state answers 200 and the final cleanup check can see its rows.
const bSettings = await B('PUT', '/api/settings', { netPay: 1, fxRate: 1, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10000 })
const bLiving = await B('PUT', '/api/living', { food: 0, transit: 0, allowance: 0 })
ok(bSettings.status === 200 && bLiving.status === 200, `B saves its own settings and living → ${bSettings.status}, ${bLiving.status}`)

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
  // spec 011 S-9: A's spending (with rounds) is invisible to B and out of its reach.
  const aSpend = await A('POST', '/api/spendings', { name: MARK, category: 'x', bought: '2090-01-10', amount: 1000, currency: 'KRW', fxRate: null, how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false,
    rounds: [{ no: 1, date: '2090-01-10', amount: 1000, state: 'left', edited: false }] })
  try {
    const bSees = (await B('GET', '/api/state')).json
    ok(aSpend.status === 201 && !JSON.stringify(bSees.spendings).includes(aSpend.json.id), `A creates a spending; B's state has none of it (${aSpend.status})`)
    const sPut = await B('PUT', `/api/spendings/${aSpend.json.id}`, { name: MARK, category: 'x', bought: '2090-01-10', amount: 1, currency: 'KRW', fxRate: null, how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false,
      rounds: [{ no: 1, date: '2090-01-10', amount: 1, state: 'paid', edited: true }] })
    const sDel = await B('DELETE', `/api/spendings/${aSpend.json.id}`)
    ok(sPut.status === 404 && sDel.status === 404, `B PUT/DELETE A's spending → ${sPut.status}/${sDel.status} (want 404/404)`)
    const aSp = (await A('GET', '/api/state')).json.spendings.find((x) => x.id === aSpend.json.id)
    ok(aSp?.amount === 1000 && aSp.rounds.length === 1 && aSp.rounds[0].state === 'left', "A's spending and its round are unchanged")
  } finally {
    if (aSpend.status === 201) await cleanupStep("A's test spending", async () => ok((await A('DELETE', `/api/spendings/${aSpend.json.id}`)).status === 204, "A's test spending removed"))
  }
  settle()
  // spec 013 V-4: A's living item, account with the new fields, balance record and card are invisible to B and out of
  // its reach; B cannot point a balance record or a card at A's account, or a spending at A's card. B's PUT /api/living
  // (above) wrote B's own coded items, not A's.
  ok(JSON.stringify((await A('GET', '/api/state')).json.livingItems) === JSON.stringify(aState.livingItems), "B's PUT /api/living left A's living items as they were")
  const aMade = [] // [path, id], removed by A in the finally below
  const aMake = async (path, body) => {
    const r = await A('POST', path, body)
    if (r.status === 201 && r.json?.id) aMade.push([path, r.json.id])
    return r
  }
  try {
    const aLi = await aMake('/api/living-items', { name: MARK, kind: '', payMethod: '', amount: 1000, from: null, note: '', amounts: {} })
    const aAcc = await aMake('/api/accounts', { name: MARK, role: '', inflow: '', outflow: '', bank: 'b', last4: '1234', buffer: 50_000, goal: 1_000_000, annualLimit: null, group: 'saving', amount: 10_000, note: MARK })
    const aBal = await aMake('/api/balances', { accountId: aAcc.json?.id, date: '2090-01-01', amount: 1000, note: MARK })
    const aCard = await aMake('/api/cards', { name: MARK, last4: '', accountId: aAcc.json?.id, billingDay: 10, note: '' })
    ok([aLi, aAcc, aBal, aCard].every((r) => r.status === 201), `A creates a living item, an account, a balance record and a card (${[aLi, aAcc, aBal, aCard].map((r) => r.status).join(',')})`)
    const bSees = JSON.stringify((await B('GET', '/api/state')).json)
    ok([aLi, aAcc, aBal, aCard].every((r) => !bSees.includes(r.json.id)), "B's state has none of them")
    for (const [path, r, body] of [
      ['/api/living-items', aLi, { name: MARK, kind: '', payMethod: '', amount: 1, from: null, amounts: {} }],
      ['/api/accounts', aAcc, { name: MARK, role: '', inflow: '', outflow: '', buffer: 1, goal: 1 }],
      ['/api/balances', aBal, { accountId: aAcc.json.id, date: '2090-01-01', amount: 1 }],
      ['/api/cards', aCard, { name: MARK, last4: '', accountId: null, billingDay: null }],
    ]) {
      const put = await B('PUT', `${path}/${r.json.id}`, body)
      const del = await B('DELETE', `${path}/${r.json.id}`)
      ok(put.status === 404 && del.status === 404, `B PUT/DELETE ${path}/<A's id> → ${put.status}/${del.status} (want 404/404)`)
    }
    const bBal = track('/api/balances', await B('POST', '/api/balances', { accountId: aAcc.json.id, date: '2090-01-01', amount: 1, note: MARK }))
    ok(bBal.status === 400, `B balance record on A's account → ${bBal.status} (want 400)`)
    const bCard = track('/api/cards', await B('POST', '/api/cards', { name: MARK, last4: '', accountId: aAcc.json.id, billingDay: null }))
    ok(bCard.status === 400, `B card paid from A's account → ${bCard.status} (want 400)`)
    const bSpend = track('/api/spendings', await B('POST', '/api/spendings', { name: MARK, category: 'x', bought: '2090-01-10', amount: 1000, currency: 'KRW', fxRate: null, how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false,
      cardId: aCard.json.id, rounds: [{ no: 1, date: '2090-02-10', amount: 1000, state: 'left', edited: false }] }))
    ok(bSpend.status === 400, `B spending on A's card → ${bSpend.status} (want 400)`)
    const bTgt = track('/api/targets', await B('POST', '/api/targets', { name: MARK, kind: 'fixed', accountId: aAcc.json.id }))
    ok(bTgt.status === 400, `B target linked to A's account → ${bTgt.status} (want 400)`)
    const aNow = (await A('GET', '/api/state')).json
    const row = (list, r) => aNow[list].find((x) => x.id === r.json.id)
    ok(row('livingItems', aLi)?.amount === 1000 && row('balances', aBal)?.amount === 1000 && row('cards', aCard)?.accountId === aAcc.json.id && row('cards', aCard)?.billingDay === 10
      && row('accounts', aAcc)?.buffer === 50_000 && row('accounts', aAcc)?.goal === 1_000_000,
      "A's living item, account, balance record and card are unchanged")
  } finally {
    for (const [path, id] of aMade.reverse()) {
      await cleanupStep(`A's ${path} row`, async () => {
        const d = await A('DELETE', `${path}/${id}`)
        ok(d.status === 204, `A's ${path} row removed → ${d.status}`)
      })
    }
  }
  settle()
  // spec 013 rev 1 (rc.2) S-14: A's month adjustment is invisible to B and out of its reach; B cannot adjust A's target.
  const aMade2 = []
  try {
    const aTgt = await A('POST', '/api/targets', { name: MARK, kind: 'fixed' })
    if (aTgt.status === 201) aMade2.push(['/api/targets', aTgt.json.id])
    const aAdj = await A('POST', '/api/month-adjusts', { ym: '2090-05', targetId: aTgt.json?.id, amount: 1000, reason: MARK })
    if (aAdj.status === 201) aMade2.push(['/api/month-adjusts', aAdj.json.id])
    ok(aTgt.status === 201 && aAdj.status === 201, `A creates a fixed target and a month adjustment (${aTgt.status},${aAdj.status})`)
    const bSees = (await B('GET', '/api/state')).json
    ok(Array.isArray(bSees.monthAdjusts) && !JSON.stringify(bSees).includes(aAdj.json.id), "B's state has none of A's month adjustments")
    const put = await B('PUT', `/api/month-adjusts/${aAdj.json.id}`, { ym: '2090-05', targetId: aTgt.json.id, amount: 1 })
    const del = await B('DELETE', `/api/month-adjusts/${aAdj.json.id}`)
    ok(put.status === 404 && del.status === 404, `B PUT/DELETE A's month adjustment → ${put.status}/${del.status} (want 404/404)`)
    const bAdj = track('/api/month-adjusts', await B('POST', '/api/month-adjusts', { ym: '2090-06', targetId: aTgt.json.id, amount: 1, reason: MARK }))
    ok(bAdj.status === 400, `B month adjustment of A's target → ${bAdj.status} (want 400)`)
    const mine = (await A('GET', '/api/state')).json.monthAdjusts.filter((x) => x.targetId === aTgt.json.id)
    ok(mine.length === 1 && mine[0].amount === 1000 && mine[0].ym === '2090-05', "A's month adjustment is unchanged, and the only one on its target")
  } finally {
    for (const [path, id] of aMade2.reverse()) {
      await cleanupStep(`A's ${path} row`, async () => {
        const d = await A('DELETE', `${path}/${id}`)
        ok(d.status === 204, `A's ${path} row removed → ${d.status}`)
      })
    }
  }
  settle()
  const aSets = (await A('GET', '/api/changes?limit=200')).json
  const bSets = (await B('GET', '/api/changes?limit=200')).json
  ok(Array.isArray(bSets) && bSets.length >= 2 && bSets.every((x) => !aSets.some((y) => y.id === x.id)), `B lists only its own change sets (${bSets.length})`)
  if (aSet) {
    const one = await B('GET', `/api/changes/${aSet.id}`)
    ok(one.status === 404, `B GET A's change set by id → ${one.status} (want 404)`)
    const rv = await B('POST', `/api/changes/${aSet.id}/revert`)
    ok(rv.status === 404, `B revert of A's change set → ${rv.status} (want 404)`)
  } else ok(false, 'A has a change set to try')
} catch (e) {
  threw(e)
} finally {
  // cleanup: try every step even when one throws; report each, then look at B's rows for the marker
  disarm()
  const step = cleanupStep
  for (const [path, id] of created.reverse()) {
    await step(`DELETE ${path}`, async () => {
      const d = await B('DELETE', `${path}/${id}`)
      ok(d.status === 204, `cleanup DELETE ${path}/<id> → ${d.status}`)
    })
  }
  if (aOrig) {
    await step("restore A's rows when a check changed them", async () => {
      const now = (await A('GET', '/api/state')).json
      for (const [list, row] of aOrig) {
        const cur = now?.[list]?.find((x) => x.id === row.id)
        if (JSON.stringify(cur) === JSON.stringify(row)) continue
        const { id, ...body } = row
        const r = cur ? await A('PUT', `/api/${list === 'checks' ? 'checks' : list}/${id}`, body) : { status: 'row is gone' }
        ok(r.status === 200, `cleanup: A's ${list} row put back → ${r.status}`)
      }
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

console.log(failures() ? `${failures()} FAILED` : 'ALL PASS')
process.exit(failures() ? 1 : 0)
