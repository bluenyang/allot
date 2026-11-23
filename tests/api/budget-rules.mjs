// API check for the budget-core write rules fixed after reviews 1 and 2 (spec 013 S-9, S-11, S-13):
//   BASE=http://127.0.0.1:15174 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/budget-rules.mjs
// (on the throwaway test server: bash scripts/test-server/run.sh <log> node tests/api/budget-rules.mjs)
// One sign-in. Every row it makes carries the E2E mark and is deleted by id at the end. Exit 0 only when every check passed.
const BASE = process.env.BASE ?? 'http://127.0.0.1:15174'
const MARK = `E2E-${Date.now().toString(36)}-rules`
const headers = { 'content-type': 'application/json', origin: BASE }
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }

const login = await fetch(BASE + '/api/auth/sign-in/email', { method: 'POST', headers, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) })
if (login.status !== 200) throw new Error(`sign-in → ${login.status}`)
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...headers, cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const made = [] // [path, id], deleted in reverse

try {
  // review 2 F-1: an account saved twice in a row with what the API answered (an empty memo)
  const a = await api('POST', '/api/accounts', { name: `${MARK}-acc`, role: '', inflow: '', outflow: '', buffer: 500_000, note: '' })
  ok(a.status === 201, `account created → ${a.status}`)
  made.push(['/api/accounts', a.json.id])
  const { id: aid, ...answer } = a.json
  const again = await api('PUT', `/api/accounts/${aid}`, answer)
  ok(again.status === 200, `the answer sent back as it is saves again → ${again.status}`)
  ok(!('note' in again.json) || again.json.note === undefined, 'an empty memo is answered as absent')
  ok((await api('PUT', `/api/accounts/${aid}`, { ...answer, note: null })).status === 200, 'a memo of null is taken as none')

  // review 1 F-7: a body in the 0.1.6 shape keeps the memo and the new fields
  await api('PUT', `/api/accounts/${aid}`, { ...answer, note: 'kept' })
  const old = await api('PUT', `/api/accounts/${aid}`, { name: `${MARK}-acc`, role: 'r', inflow: 'i', outflow: 'o' })
  ok(old.status === 200 && old.json.note === 'kept' && old.json.buffer === 500_000, `an 0.1.6-shape update keeps note and buffer (${old.json?.note}, ${old.json?.buffer})`)

  // review 1 F-8: a monthly amount on an account without a group is refused also when the body leaves the group out
  ok((await api('PUT', `/api/accounts/${aid}`, { name: `${MARK}-acc`, role: '', inflow: '', outflow: '', amount: 10_000 })).status === 400, 'an amount without a stored group is refused')

  // review 1 F-12: a balance record keeps the money put in at once
  const b = await api('POST', '/api/balances', { accountId: aid, date: '2026-11-23', amount: 1_000_000, deposit: 1_000_000 })
  ok(b.status === 201 && b.json.deposit === 1_000_000, `a balance record with its deposit → ${b.status} ${b.json?.deposit}`)
  if (b.status === 201) made.push(['/api/balances', b.json.id])
  ok((await api('POST', '/api/balances', { accountId: aid, date: '2026-11-24', amount: 1, deposit: -1 })).status === 400, 'a negative deposit is refused')

  // review 1 F-1: a card that a buffer use goes through keeps a paying account; it may move to another one
  const a2 = await api('POST', '/api/accounts', { name: `${MARK}-acc2`, role: '', inflow: '', outflow: '' })
  made.push(['/api/accounts', a2.json.id])
  const c = await api('POST', '/api/cards', { name: `${MARK}-card`, last4: '', accountId: aid, billingDay: 16 })
  ok(c.status === 201, `card → ${c.status}`)
  made.push(['/api/cards', c.json.id])
  const round = (no, amount) => ({ no, date: `2090-0${no + 1}-25`, amount, state: 'left', edited: false })
  const buf = {
    name: `${MARK}-buf`, category: 'home', bought: '2090-01-10', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: c.json.id, refillFrom: '2090-02-25',
    rounds: [round(1, 100_000), round(2, 100_000), round(3, 100_000)],
  }
  const s = await api('POST', '/api/spendings', buf)
  ok(s.status === 201, `buffer use → ${s.status}`)
  made.push(['/api/spendings', s.json.id])
  ok((await api('PUT', `/api/cards/${c.json.id}`, { name: `${MARK}-card`, last4: '', accountId: null, billingDay: 16 })).status === 400, "clearing the card's account is refused while a buffer use goes through it")
  ok((await api('PUT', `/api/cards/${c.json.id}`, { name: `${MARK}-card`, last4: '', accountId: a2.json.id, billingDay: 16 })).status === 200, 'moving it to another account is taken')

  // review 1 F-5: a spending that is no longer a buffer use or paid by card loses its refill start and card
  const lump = { ...buf, how: 'lump', count: 1, payBy: 'salary', rounds: [round(1, 300_000)] }
  delete lump.cardId
  delete lump.refillFrom
  const l = await api('PUT', `/api/spendings/${s.json.id}`, lump)
  ok(l.status === 200 && l.json.cardId === null && l.json.refillFrom === null, `a salary lump sum keeps no card and no refill start (${l.status} ${l.json?.cardId} ${l.json?.refillFrom})`)
} finally {
  for (const [path, id] of made.reverse()) {
    const r = await api('DELETE', `${path}/${id}`)
    ok(r.status === 204, `cleanup ${path}/${id} → ${r.status}`)
  }
}
console.log(failed ? `FAIL: ${failed}` : 'PASS: all')
process.exit(failed ? 1 : 0)
