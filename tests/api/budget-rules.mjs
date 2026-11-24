// API check for the budget-core write rules fixed after reviews 1 and 2 (spec 013 S-9, S-11, S-13), the revert re-check
// for buffer-use cards (review 2 F-6) and the history period of GET /api/changes (spec 013 rev 1 S-18):
//   BASE=http://127.0.0.1:15174 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/budget-rules.mjs
// (on the throwaway test server: bash scripts/test-server/run.sh <log> node tests/api/budget-rules.mjs)
// One sign-in. Every row it makes carries the E2E mark and is deleted by id at the end. Exit 0 only when every check passed.
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:15174'
const MARK = `E2E-${Date.now().toString(36)}-rules`
const headers = { 'content-type': 'application/json', origin: BASE }
// The first failed check stops the run (tests/api/lib/check.mjs; audit 0.1.7 rc.3 F-3): inside the main try it
// throws once, no further write happens, and the finally block below still cleans up. Later failures are only reported.

const login = await fetch(BASE + '/api/auth/sign-in/email', { method: 'POST', headers, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) })
if (login.status !== 200) throw new Error(`sign-in → ${login.status}`)
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...headers, cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const made = [] // [path, id], deleted in reverse

arm()
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

  // review 2 F-6 (spec 013 rev 1 W-15): a revert that would leave a buffer use's card without a paying account is refused
  const c2 = await api('POST', '/api/cards', { name: `${MARK}-card2`, last4: '', accountId: null, billingDay: null })
  ok(c2.status === 201, `a card without an account → ${c2.status}`)
  made.push(['/api/cards', c2.json.id])
  const link = await api('PUT', `/api/cards/${c2.json.id}`, { name: `${MARK}-card2`, last4: '', accountId: aid, billingDay: null })
  ok(link.status === 200 && link.json.accountId === aid, `the card gets a paying account → ${link.status}`)
  const linkSet = (await api('GET', '/api/changes?limit=1')).json?.[0]
  ok(JSON.stringify(linkSet?.changes ?? []).includes(c2.json.id), 'the latest change set is that card update')
  const s2 = await api('POST', '/api/spendings', { ...buf, name: `${MARK}-buf2`, cardId: c2.json.id })
  ok(s2.status === 201, `a buffer use through that card → ${s2.status}`)
  made.push(['/api/spendings', s2.json.id])
  const rv = await api('POST', `/api/changes/${linkSet.id}/revert`)
  ok(rv.status === 400 && typeof rv.json?.error === 'string' && rv.json.error.includes(`${MARK}-buf2`) && /결제 통장이 없어져요|no paying account/.test(rv.json.error), `reverting the card's account is refused with the revertBuffer message → ${rv.status} ${rv.json?.error}`)
  ok((await api('GET', '/api/state')).json.cards.find((x) => x.id === c2.json.id)?.accountId === aid, 'the card keeps its account')
  // once the buffer use is gone the same revert goes through
  ok((await api('DELETE', `/api/spendings/${s2.json.id}`)).status === 204, 'the buffer use deleted')
  made.splice(made.findIndex(([, id]) => id === s2.json.id), 1)
  const rv2 = await api('POST', `/api/changes/${linkSet.id}/revert`)
  ok(rv2.status === 200, `then the revert is taken → ${rv2.status}`)
  ok((await api('GET', '/api/state')).json.cards.find((x) => x.id === c2.json.id)?.accountId === null, 'and the card has no account again')

  // spec 013 rev 1 S-26 lists no limit on a month adjustment's reason (review rc2-1 F-4): a long one is taken
  const fx = await api('POST', '/api/targets', { name: `${MARK}-fx`, kind: 'fixed' })
  ok(fx.status === 201, `a fixed target → ${fx.status}`)
  made.push(['/api/targets', fx.json.id])
  const long = 'r'.repeat(1000)
  const adj = await api('POST', '/api/month-adjusts', { ym: '2090-07', targetId: fx.json.id, amount: 1_000, reason: long })
  ok(adj.status === 201 && adj.json.reason === long, `a reason of 1,000 characters is taken → ${adj.status}`)
  if (adj.status === 201) made.push(['/api/month-adjusts', adj.json.id])
  // one adjustment per month and target (S-26; user: "하나만 둠 (Recommended)"): a second is refused, the first can be changed
  ok((await api('POST', '/api/month-adjusts', { ym: '2090-07', targetId: fx.json.id, amount: 2_000 })).status === 400, 'a second adjustment for the same month and target is refused')
  if (adj.status === 201) {
    const put = await api('PUT', `/api/month-adjusts/${adj.json.id}`, { ym: '2090-07', targetId: fx.json.id, amount: 3_000 })
    ok(put.status === 200 && put.json.amount === 3_000, `the existing one is changed → ${put.status}`)
  }

  // spec 013 rev 1 S-18: GET /api/changes takes a period, since (inclusive) and until (exclusive), as ISO times
  const t0 = new Date(Date.now() - 10 * 60_000).toISOString()
  const recent = await api('GET', `/api/changes?since=${encodeURIComponent(t0)}&limit=100`)
  ok(recent.status === 200 && recent.json.length > 0 && recent.json.every((x) => Date.parse(x.at) >= Date.parse(t0)) && recent.json.some((x) => x.id === linkSet.id), `since: only sets from then on, the card update among them → ${recent.status} ${recent.json?.length}`)
  const early = await api('GET', '/api/changes?until=2000-01-01T00:00:00.000Z')
  ok(early.status === 200 && Array.isArray(early.json) && early.json.length === 0, `until 2000-01-01: none → ${early.status} ${early.json?.length}`)
  const none = await api('GET', `/api/changes?since=${encodeURIComponent(t0)}&until=${encodeURIComponent(t0)}`)
  ok(none.status === 200 && none.json.length === 0, `since = until: none → ${none.status} ${none.json?.length}`)
  const inside = await api('GET', `/api/changes?since=${encodeURIComponent(t0)}&until=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&limit=100`)
  ok(inside.status === 200 && inside.json.some((x) => x.id === linkSet.id), `since … until now: the card update is in it → ${inside.status}`)
  ok((await api('GET', '/api/changes?since=yesterday-ish')).status === 400, 'a since that is not a time is refused (400)')
  ok((await api('GET', '/api/changes?until=nope')).status === 400, 'an until that is not a time is refused (400)')
} catch (e) {
  threw(e)
} finally {
  disarm() // the cleanup's own checks only report; each delete runs even when one before it threw
  for (const [path, id] of made.reverse()) {
    await cleanupStep(`${path}/${id}`, async () => {
      const r = await api('DELETE', `${path}/${id}`)
      ok(r.status === 204, `cleanup ${path}/${id} → ${r.status}`)
    })
  }
}
console.log(failures() ? `FAIL: ${failures()}` : 'PASS: all')
process.exit(failures() ? 1 : 0)
