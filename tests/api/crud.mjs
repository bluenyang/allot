// API check for spec 001 V-4, V-5, V-8 and spec 003 V-4: auth, CRUD on every resource, phase overlap, allocation targets;
// spec 013 V-5: living items, the new account fields, balance records, cards, card and buffer-use spendings, one refused
// and one accepted value per S-9 limit, the delete rules, and PUT /api/living writing the three coded items;
// spec 013 rev 1 (rc.2) V-14, V-15: a month adjustment and an account's `afterMaturity`, with the S-26 limits.
//   BASE=http://<host>:15173 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/crud.mjs [create|verify|cleanup]
// Phases (each its own process, so a restart of the api can sit between them):
//   create  — sign in, create/update a marker row in every resource, write the ids to tests/api/.state.json
//   verify  — read /api/state and check every marker is still there (run after `restart api`)
//   cleanup — delete the markers (checks DELETE), restore settings/living
// Exit code 0 only when every check passed.
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:15173'
const STATE = new URL('./.state.json', import.meta.url)
const phase = process.argv[2] ?? 'create'
let failed = 0
// The first failed check stops the run (knowledge: stop-at-first-failure): it throws once (when `armed`), no
// further write happens, and what this run made is removed by `rollback` below. Later failures are only reported.
class Stop extends Error {}
let armed = false
let stopped = false
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
  if (cond) return
  failed++
  if (armed && !stopped) { stopped = true; throw new Stop(msg) }
}
// Every row this run created (POST → 201, by path/id) and every change to existing data that must be put back.
const made = []
const restores = []

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
  if (method === 'POST' && res.status === 201 && json?.id) made.push(`${path}/${json.id}`)
  if (method === 'DELETE' && res.status === 204) { const i = made.indexOf(path); if (i >= 0) made.splice(i, 1) }
  return { status: res.status, json }
}

async function signIn() {
  const r = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  ok(r.status === 200, `sign-in → ${r.status}`)
  if (r.status !== 200) process.exit(1)
}

// After a failed create phase: delete what was made (newest first), then put back what was changed. Reports each
// step, never throws, never hides the first failure.
async function rollback() {
  console.log(`ROLLBACK: removing ${made.length} row(s) this run made, then ${restores.length} restore(s)`)
  for (const path of [...made].reverse()) {
    try {
      const d = await api('DELETE', path)
      console.log(`${d.status === 204 ? 'CLEANUP' : 'CLEANUP-FAIL'} DELETE ${path.split('/').slice(0, 3).join('/')}/<id> → ${d.status}`)
    } catch (e) { console.log(`CLEANUP-FAIL DELETE ${path}: ${e?.message ?? e}`) }
  }
  for (const [name, fn] of [...restores].reverse()) {
    try {
      const r = await fn()
      console.log(`${r.status === 200 ? 'CLEANUP' : 'CLEANUP-FAIL'} restore ${name} → ${r.status}`)
    } catch (e) { console.log(`CLEANUP-FAIL restore ${name}: ${e?.message ?? e}`) }
  }
}

const MARK = 'V8-marker'
// A card installment over 3 months with a fee; rounds as the screen would write them (spec 011 S-2).
const spend = {
  name: MARK, note: 'n', category: '가전', bought: '2090-01-10', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'installment', payBy: 'card', count: 3, fee: 3_000, interval: null, cancelled: false,
  rounds: [
    { no: 1, date: '2090-02-16', amount: 101_000, state: 'left', edited: false },
    { no: 2, date: '2090-03-16', amount: 101_000, state: 'left', edited: false },
    { no: 3, date: '2090-04-16', amount: 101_000, state: 'left', edited: false },
  ],
}
const sub = { name: MARK, category: 'tool', plan: 'p', amount: 1.5, currency: 'USD', vat: 10, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false, note: 'n' }

// create and verify stop at the first failed check; cleanup tries every step (a leftover is the worse outcome)
// and still exits non-zero when any step failed.
armed = phase !== 'cleanup'
try {
if (phase === 'create') {
  const anon = await api('GET', '/api/state')
  ok(anon.status === 401, `GET /api/state without session → ${anon.status} (want 401)`)
  for (const path of ['/api/me', '/api/health', '/api/subscriptions/x']) {
    const r = await api(path.endsWith('/x') ? 'DELETE' : 'GET', path)
    ok(r.status === 401, `${path} without session → ${r.status} (want 401)`)
  }
  // Private files must not be served by the LAN-facing dev server: each answer must be a refusal
  // or Vite's SPA fallback (the same body as '/'). Bodies are compared, never printed.
  const fallback = await (await fetch(BASE + '/')).text()
  for (const path of ['/.loctx/scripts/seed-data.ts', '/.loctx/scripts/seed-data.ts?raw', '/@fs/app/.loctx/scripts/seed-data.ts',
    '/tests/e2e/.auth.json', '/tests/api/.state.json', '/server/auth.ts', '/docker/.env.dev', '/AGENTS.md', '/drizzle/0000_init.sql']) {
    const res = await fetch(BASE + path)
    const text = await res.text()
    const refused = res.status === 403 || res.status === 404 || (res.status === 200 && text === fallback)
    ok(refused, `${path} not served → ${res.status}${res.status === 200 ? (text === fallback ? ' (SPA fallback)' : ' (FILE CONTENT)') : ''}`)
  }
  const signup = await api('POST', '/api/auth/sign-up/email', { email: `v5-${Date.now()}@example.com`, password: 'abcdefgh12', name: 'x' })
  ok(signup.status >= 400 && signup.status < 500 && signup.json?.code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED', `sign-up → ${signup.status} ${signup.json?.code ?? ''}`)
  await signIn()
  const before = await api('GET', '/api/state')
  ok(before.status === 200, `GET /api/state with session → ${before.status}`)
  const ids = { settings: before.json.settings, living: before.json.living }

  restores.push(['settings', () => api('PUT', '/api/settings', ids.settings)])
  restores.push(['living', () => api('PUT', '/api/living', ids.living)])
  const s1 = await api('PUT', '/api/settings', { ...before.json.settings, netPay: 2_600_001 })
  ok(s1.status === 200 && s1.json.netPay === 2_600_001, `PUT /api/settings → ${s1.status}`)
  const l1 = await api('PUT', '/api/living', { ...before.json.living, food: 300_001 })
  ok(l1.status === 200 && l1.json.food === 300_001, `PUT /api/living → ${l1.status}`)

  const created = async (path, body, patch) => {
    const c = await api('POST', path, body)
    ok(c.status === 201 && typeof c.json?.id === 'string', `POST ${path} → ${c.status}`)
    if (c.status !== 201) { console.log('   ', JSON.stringify(c.json)); return null }
    const u = await api('PUT', `${path}/${c.json.id}`, { ...body, ...patch })
    const key = Object.keys(patch)[0]
    ok(u.status === 200 && JSON.stringify(u.json[key]) === JSON.stringify(patch[key]), `PUT ${path}/:id → ${u.status}`)
    return c.json.id
  }
  ids.sub = await created('/api/subscriptions', sub, { plan: 'p2' })
  ids.chg = await created('/api/plan-changes', { subId: ids.sub, effective: null, to: { amount: 2 }, note: MARK }, { note: `${MARK}-2` })
  // Real data has an open-ended last phase; close it before 2090 for the test, restore it in cleanup.
  ids.openPhases = before.json.phases.filter((p) => p.to === null)
  for (const p of ids.openPhases) {
    const { id, ...rest } = p
    restores.push([`open phase ${p.label}`, () => api('PUT', `/api/phases/${id}`, rest)])
    const r = await api('PUT', `/api/phases/${id}`, { ...rest, to: '2089-12' })
    ok(r.status === 200, `close open phase ${p.label} for the test → ${r.status}`)
  }
  // A fixed target, and a phase that gives it an amount.
  ids.target = await created('/api/targets', { name: MARK, kind: 'fixed', note: '' }, { name: `${MARK}-t2` })
  ids.phase = await created('/api/phases', { label: 'V', name: MARK, from: '2090-01', to: '2090-12', amounts: { [ids.target]: 12_345 } }, { name: `${MARK}-2` })
  const ph = (await api('GET', '/api/state')).json.phases.find((p) => p.id === ids.phase)
  ok(ph?.amounts?.[ids.target] === 12_345, `phase amount for the new target kept across PUT (${ph?.amounts?.[ids.target]})`)
  ids.event = await created('/api/events', { when: '2090-01', kind: '저축', title: MARK, state: 'todo' }, { state: 'doing' })
  ids.check = await created('/api/checks', { text: MARK, done: false }, { done: true })
  ids.account = await created('/api/accounts', { name: MARK, role: '', inflow: '', outflow: '' }, { role: 'r' })
  ids.debt = await created('/api/debts', { name: MARK, principal: 1, rate: '', method: '', plan: '' }, { principal: 2 })
  // Spendings with rounds: the rounds come back with the spending, are replaced as a whole, and a revert restores them.
  ids.spend = await created('/api/spendings', spend, { rounds: spend.rounds.map((r) => (r.no === 2 ? { ...r, amount: 100_500, edited: true } : r)) })
  const sp = (await api('GET', '/api/state')).json.spendings.find((x) => x.id === ids.spend)
  ok(sp?.rounds?.length === 3 && sp.rounds[1].amount === 100_500 && sp.rounds[1].edited === true && sp.rounds.every((r, i) => r.no === i + 1), 'spending rounds replaced by PUT, sorted by no')
  const putSet = (await api('GET', '/api/changes?limit=1')).json?.[0]
  const rvSp = await api('POST', `/api/changes/${putSet?.id}/revert`)
  const spBack = (await api('GET', '/api/state')).json.spendings.find((x) => x.id === ids.spend)
  ok(rvSp.status === 200 && spBack?.rounds?.[1]?.amount === 101_000 && spBack.rounds[1].edited === false, `revert of a spending PUT restores its rounds → ${rvSp.status}`)
  const spAgain = await api('PUT', `/api/spendings/${ids.spend}`, { ...spend, rounds: spend.rounds.map((r) => (r.no === 2 ? { ...r, amount: 100_500, edited: true } : r)) })
  ok(spAgain.status === 200 && spAgain.json.rounds[1].amount === 100_500, `spending PUT again after the revert → ${spAgain.status}`)
  // Review 1 (P2): a revert that would leave rounds not matching the count is refused, and nothing changes.
  const own = await api('POST', '/api/spendings', { ...spend, fee: 0, payBy: 'salary', name: `${MARK}-rv` })
  const ownPath = `/api/spendings/${own.json?.id}`
  const paidOff = [{ ...spend.rounds[0], state: 'paid' }, { ...spend.rounds[1], state: 'merged' }, { ...spend.rounds[2], state: 'merged' }, { no: 4, date: '2090-05-16', amount: 202_000, state: 'left', edited: false }]
  const offPut = await api('PUT', ownPath, { ...spend, fee: 0, payBy: 'salary', name: `${MARK}-rv`, rounds: paidOff })
  const offSet = (await api('GET', '/api/changes?limit=1')).json?.[0]
  const countPut = await api('PUT', ownPath, { ...spend, fee: 0, payBy: 'salary', name: `${MARK}-rv`, count: 4, rounds: paidOff })
  const beforeRv = (await api('GET', '/api/state')).json.spendings.find((x) => x.id === own.json?.id)
  const rvBad = await api('POST', `/api/changes/${offSet?.id}/revert`)
  const afterRv = (await api('GET', '/api/state')).json.spendings.find((x) => x.id === own.json?.id)
  ok(own.status === 201 && offPut.status === 200 && countPut.status === 200 && rvBad.status === 400 && JSON.stringify(afterRv) === JSON.stringify(beforeRv) && afterRv?.count === 4 && afterRv.rounds.length === 4,
    `revert of a payoff after the count changed is refused, data unchanged (${own.status}, ${offPut.status}, ${countPut.status}, ${rvBad.status})`)
  ok((await api('POST', '/api/spendings', { ...spend, fee: 0, payBy: 'salary', name: `${MARK}-big`, amount: 3_000_000_000, rounds: spend.rounds.map((r) => ({ ...r, amount: 1_000_000_000 })) })).status === 400, 'POST spending whose rounds add up past 2147483647 → 400')
  if (own.status === 201) ok((await api('DELETE', ownPath)).status === 204, 'DELETE the revert test spending')
  // Rules (spec 011 S-2, S-4): each of these is refused.
  // the rate and the buffer a USD spending was saved with come back as they were (S-3)
  const usdBody = { ...spend, name: `${MARK}-usd`, currency: 'USD', amount: 100, fxRate: 1000, fxBuffer: 3.5, fee: 0, payBy: 'salary', how: 'lump', count: 1, rounds: [{ no: 1, date: '2090-02-16', amount: 103_500, state: 'left', edited: false }] }
  const usdPost = await api('POST', '/api/spendings', usdBody)
  const usdBack = (await api('GET', '/api/state')).json.spendings.find((x) => x.id === usdPost.json?.id)
  ok(usdPost.status === 201 && usdBack?.fxRate === 1000 && usdBack?.fxBuffer === 3.5, `USD spending keeps fxRate and fxBuffer → ${usdPost.status} ${usdBack?.fxRate}/${usdBack?.fxBuffer}`)
  if (usdPost.status === 201) ok((await api('DELETE', `/api/spendings/${usdPost.json.id}`)).status === 204, 'DELETE the USD test spending')
  const spendBad = {
    'USD without a rate': { ...spend, currency: 'USD', fxRate: null },
    'KRW with a rate': { ...spend, fxRate: 1380 },
    'USD without a buffer': { ...spend, currency: 'USD', fxRate: 1380, fxBuffer: null },
    'KRW with a buffer': { ...spend, fxBuffer: 3 },
    'USD with a 3-decimal buffer': { ...spend, currency: 'USD', fxRate: 1380, fxBuffer: 3.456 },
    'USD with a 3-decimal rate': { ...spend, currency: 'USD', fxRate: 1380.256, fxBuffer: 3 },
    'lump with 2 rounds': { ...spend, how: 'lump', count: 1, fee: 0, rounds: spend.rounds.slice(0, 2) },
    'fee on a salary installment': { ...spend, payBy: 'salary' },
    'interval on an installment': { ...spend, interval: 'monthly' },
    'split without an interval': { ...spend, how: 'split', payBy: 'salary', fee: 0 },
    'rounds not numbered from 1': { ...spend, rounds: spend.rounds.map((r) => ({ ...r, no: r.no + 1 })) },
    'fewer rounds than the count': { ...spend, rounds: spend.rounds.slice(0, 2) },
    'a negative round': { ...spend, rounds: spend.rounds.map((r) => (r.no === 1 ? { ...r, amount: -1 } : r)) },
    'a date that does not exist': { ...spend, rounds: spend.rounds.map((r) => (r.no === 1 ? { ...r, date: '2090-02-30' } : r)) },
    'how buffer': { ...spend, how: 'buffer' },
    'no rounds': { ...spend, rounds: [] },
  }
  for (const [why, body] of Object.entries(spendBad)) {
    const r = await api('POST', '/api/spendings', body)
    ok(r.status === 400, `POST spending with ${why} → ${r.status} (want 400)`)
  }
  ids.split = await created('/api/remainder-split', { name: MARK, code: 'X', ratio: 0 }, { ratio: 0.5 })

  // ── spec 013 V-5: living items, the new account fields, balance records, cards, a card / buffer-use spending ──
  // Marker rows that stay for verify (the phase above gives them per-phase amounts).
  ids.livingItem = await created('/api/living-items', { name: `${MARK}-li`, kind: 'k', payMethod: 'm', amount: 1_000, from: '2090-01', note: MARK, amounts: { [ids.phase]: 5_000 } }, { amount: 2_000 })
  const acc2 = {
    name: `${MARK}-acc`, role: '', inflow: '', outflow: '', bank: 'b', last4: '0123', kind: 'k', rate: '3.1%', term: '12m', buffer: 100_000, goal: 5_000_000,
    annualLimit: 20_000_000, group: 'saving', amount: 50_000, ratio: 0.25, from: '2090-01', stopFrom: '2090-06', goalAck: 4_000_000, note: MARK, amounts: { [ids.phase]: 60_000 },
    afterMaturity: `${MARK}-after`,
  }
  ids.acc2 = await created('/api/accounts', acc2, { buffer: 150_000 })
  ids.balance = await created('/api/balances', { accountId: ids.acc2, date: '2090-01-05', amount: 1_000_000, note: MARK }, { amount: 1_100_000 })
  ids.card = await created('/api/cards', { name: `${MARK}-card`, last4: '0123', accountId: ids.acc2, billingDay: 5, note: MARK }, { billingDay: 20 })
  const lumpCard = { ...spend, name: `${MARK}-cl`, how: 'lump', count: 1, fee: 0, cardId: ids.card, rounds: [{ no: 1, date: '2090-02-20', amount: 300_000, state: 'left', edited: false }] }
  ids.cardSpend = await created('/api/spendings', lumpCard, { note: 'n2' })
  const buf = (name, cardId, over = {}) => ({
    ...spend, name, how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cardId, refillFrom: '2090-02-25',
    rounds: [1, 2, 3].map((no) => ({ no, date: `2090-0${no + 1}-25`, amount: 100_000, state: 'left', edited: false })), ...over,
  })
  ids.bufSpend = await created('/api/spendings', buf(`${MARK}-buf`, ids.card), { refillFrom: '2090-02-26' })
  // rc.2 (S-14): one month's amount of the fixed target
  ids.adjust = await created('/api/month-adjusts', { ym: '2090-03', targetId: ids.target, amount: 7_000, reason: MARK }, { amount: 8_000 })
  const lv = (await api('GET', '/api/state')).json.livingItems.find((x) => x.code === 'food')
  ok(lv?.amount === 300_001, `PUT /api/living (above) changed the coded food item → ${lv?.amount}`)

  // One refused value and one accepted boundary value per S-9 limit. An accepted row is deleted at once.
  const refused = async (path, body, why) => {
    const r = await api('POST', path, body)
    ok(r.status === 400, `POST ${path} with ${why} → ${r.status} (want 400)`)
  }
  const accepted = async (path, body, why, check) => {
    const r = await api('POST', path, body)
    ok(r.status === 201 && (!check || check(r.json)), `POST ${path} with ${why} → ${r.status} (want 201)`)
    if (r.status === 201) ok((await api('DELETE', `${path}/${r.json.id}`)).status === 204, `DELETE that ${path.split('/')[2]} row`)
  }
  const li = { name: `${MARK}-lb`, kind: '', payMethod: '', amount: 0, from: null, note: '', amounts: {} }
  const s41 = 'x'.repeat(41), s40 = 'x'.repeat(40), m201 = 'x'.repeat(201), m200 = 'x'.repeat(200)
  await refused('/api/living-items', { ...li, name: ' ' }, 'an empty name')
  await refused('/api/living-items', { ...li, amount: -1 }, 'amount -1')
  await accepted('/api/living-items', { ...li, amount: 0 }, 'amount 0', (j) => j.amount === 0)
  await refused('/api/living-items', { ...li, amount: 2_147_483_648 }, 'amount 2^31')
  await accepted('/api/living-items', { ...li, amount: 2_147_483_647 }, 'amount 2^31-1', (j) => j.amount === 2_147_483_647)
  await refused('/api/living-items', { ...li, amount: 1.5 }, 'amount 1.5')
  await refused('/api/living-items', { ...li, from: '2090-13' }, 'from 2090-13')
  await accepted('/api/living-items', { ...li, from: '2090-12' }, 'from 2090-12', (j) => j.from === '2090-12')
  await refused('/api/living-items', { ...li, kind: s41 }, 'a kind of 41 characters')
  await accepted('/api/living-items', { ...li, kind: s40, payMethod: s40 }, 'a kind and a pay method of 40 characters', (j) => j.kind === s40 && j.payMethod === s40)
  await refused('/api/living-items', { ...li, note: m201 }, 'a note of 201 characters')
  await accepted('/api/living-items', { ...li, note: m200 }, 'a note of 200 characters', (j) => j.note === m200)
  const ac = { name: `${MARK}-ab`, role: '', inflow: '', outflow: '' }
  await accepted('/api/accounts', ac, 'only the four old fields', (j) => j.buffer === 0 && j.goal === null && j.group === null && j.last4 === '')
  await refused('/api/accounts', { ...ac, last4: '123' }, "last4 '123'")
  await refused('/api/accounts', { ...ac, last4: '12a4' }, "last4 '12a4'")
  await accepted('/api/accounts', { ...ac, last4: '0123' }, "last4 '0123'", (j) => j.last4 === '0123')
  await refused('/api/accounts', { ...ac, buffer: -1 }, 'buffer -1')
  await accepted('/api/accounts', { ...ac, buffer: 2_147_483_647, goal: 0, annualLimit: 2_147_483_647 }, 'buffer and limit 2^31-1, goal 0', (j) => j.buffer === 2_147_483_647 && j.goal === 0)
  await refused('/api/accounts', { ...ac, goal: 2_147_483_648 }, 'goal 2^31')
  await refused('/api/accounts', { ...ac, group: 'saving', ratio: 0.12345 }, 'ratio 0.12345')
  await refused('/api/accounts', { ...ac, group: 'saving', ratio: 1.0001 }, 'ratio 1.0001')
  await accepted('/api/accounts', { ...ac, group: 'invest', ratio: 0.1234 }, 'ratio 0.1234', (j) => j.ratio === 0.1234)
  await accepted('/api/accounts', { ...ac, group: 'invest', ratio: 1 }, 'ratio 1', (j) => j.ratio === 1)
  await refused('/api/accounts', { ...ac, group: null, amount: 1_000 }, 'a monthly amount without a group')
  await refused('/api/accounts', { ...ac, group: null, ratio: 0.5 }, 'a ratio without a group')
  await refused('/api/accounts', { ...ac, group: null, amounts: { [ids.phase]: 1 } }, 'phase amounts without a group')
  await refused('/api/accounts', { ...ac, from: '2090-1' }, "from '2090-1'")
  await refused('/api/accounts', { ...ac, stopFrom: '2090-00' }, "stopFrom '2090-00'")
  await refused('/api/accounts', { ...ac, bank: s41 }, 'a bank of 41 characters')
  await accepted('/api/accounts', { ...ac, bank: s40, kind: s40, rate: s40, term: s40, note: m200 }, 'bank, kind, rate, term of 40 and a note of 200', (j) => j.bank === s40 && j.term === s40 && j.note === m200)
  await refused('/api/accounts', { ...ac, note: m201 }, 'a note of 201 characters')
  const bl = { accountId: ids.acc2, date: '2090-02-28', amount: 0, note: '' }
  await accepted('/api/balances', bl, 'date 2090-02-28 and amount 0', (j) => j.date === '2090-02-28' && j.amount === 0)
  await refused('/api/balances', { ...bl, date: '2090-02-30' }, 'date 2090-02-30')
  await refused('/api/balances', { ...bl, date: '2090-02' }, "date '2090-02'")
  await refused('/api/balances', { ...bl, amount: -1 }, 'amount -1')
  await refused('/api/balances', { ...bl, accountId: 'no-such-account' }, 'an account that does not exist')
  const cd = { name: `${MARK}-cb`, last4: '', accountId: null, billingDay: null, note: '' }
  await accepted('/api/cards', cd, 'no account and no billing day', (j) => j.accountId === null && j.billingDay === null)
  await refused('/api/cards', { ...cd, name: '' }, 'an empty name')
  await refused('/api/cards', { ...cd, last4: '123' }, "last4 '123'")
  await accepted('/api/cards', { ...cd, last4: '0123' }, "last4 '0123'", (j) => j.last4 === '0123')
  await refused('/api/cards', { ...cd, billingDay: 0 }, 'billing day 0')
  await refused('/api/cards', { ...cd, billingDay: 32 }, 'billing day 32')
  await accepted('/api/cards', { ...cd, billingDay: 31 }, 'billing day 31', (j) => j.billingDay === 31)
  await refused('/api/cards', { ...cd, accountId: 'no-such-account' }, 'an account that does not exist')
  // rc.2 (S-26): an adjustment amount is a whole won of 0 or more; its target is a fixed, Savings or Investment total
  const ad = { ym: '2090-04', targetId: ids.target, amount: 0, reason: '' }
  await accepted('/api/month-adjusts', ad, 'amount 0', (j) => j.amount === 0 && j.ym === '2090-04')
  await refused('/api/month-adjusts', { ...ad, amount: -1 }, 'amount -1')
  await refused('/api/month-adjusts', { ...ad, amount: 1.5 }, 'amount 1.5')
  await refused('/api/month-adjusts', { ...ad, amount: 2_147_483_648 }, 'amount 2^31')
  await accepted('/api/month-adjusts', { ...ad, amount: 2_147_483_647 }, 'amount 2^31-1', (j) => j.amount === 2_147_483_647)
  await refused('/api/month-adjusts', { ...ad, ym: '2090-13' }, 'ym 2090-13')
  await refused('/api/month-adjusts', { ...ad, reason: m201 }, 'a reason of 201 characters')
  await accepted('/api/month-adjusts', { ...ad, reason: m200 }, 'a reason of 200 characters', (j) => j.reason === m200)
  for (const kind of ['living', 'subscriptions', 'remainder']) {
    const tg = before.json.targets.find((x) => x.kind === kind)
    if (tg) await refused('/api/month-adjusts', { ...ad, targetId: tg.id }, `a '${kind}' target`)
  }
  await refused('/api/month-adjusts', { ...ad, targetId: 'no-such-target' }, 'a target that does not exist')
  // rc.2 (S-26): afterMaturity is free text of up to 200 characters
  await accepted('/api/accounts', { ...ac, group: 'saving', afterMaturity: m200 }, 'afterMaturity of 200 characters', (j) => j.afterMaturity === m200)
  await refused('/api/accounts', { ...ac, group: 'saving', afterMaturity: m201 }, 'afterMaturity of 201 characters')
  await accepted('/api/accounts', ac, 'no afterMaturity (the 0.1.7-rc.1 body)', (j) => (j.afterMaturity ?? '') === '')
  // spendings (S-9): a buffer use needs a card that has a paying account, by card, no fee, a refill start
  const noAcc = await api('POST', '/api/cards', { ...cd, name: `${MARK}-noacc` })
  ok(noAcc.status === 201, `POST a card without an account → ${noAcc.status}`)
  await refused('/api/spendings', buf(`${MARK}-b1`, null), 'a buffer use without a card')
  await refused('/api/spendings', buf(`${MARK}-b2`, noAcc.json?.id), 'a buffer use whose card has no paying account')
  await refused('/api/spendings', buf(`${MARK}-b3`, ids.card, { payBy: 'salary' }), 'a buffer use paid from the salary account')
  await refused('/api/spendings', buf(`${MARK}-b4`, ids.card, { fee: 1_000, rounds: buf('', '').rounds.map((r) => (r.no === 3 ? { ...r, amount: 101_000 } : r)) }), 'a buffer use with a fee')
  await refused('/api/spendings', buf(`${MARK}-b5`, ids.card, { refillFrom: null }), 'a buffer use without a refill start')
  await refused('/api/spendings', buf(`${MARK}-b6`, ids.card, { count: 61 }), 'a buffer use over 61 months')
  await accepted('/api/spendings', buf(`${MARK}-b7`, ids.card, { count: 1, rounds: [{ no: 1, date: '2090-02-25', amount: 300_000, state: 'left', edited: false }] }), 'a buffer use over 1 month (A-3)')
  await refused('/api/spendings', { ...lumpCard, name: `${MARK}-r1`, refillFrom: '2090-02-25' }, 'a refill start on a lump sum')
  await refused('/api/spendings', { ...lumpCard, name: `${MARK}-r2`, payBy: 'salary' }, 'a card on a salary spending')
  await accepted('/api/spendings', { ...lumpCard, name: `${MARK}-r3`, cardId: noAcc.json?.id }, 'a card lump sum on a card without an account', (j) => j.cardId === noAcc.json?.id)
  if (noAcc.status === 201) ok((await api('DELETE', `/api/cards/${noAcc.json.id}`)).status === 204, 'DELETE the card without an account')
  // the two kinds that exist once per user (S-9)
  for (const kind of ['saving', 'invest']) {
    const had = before.json.targets.find((x) => x.kind === kind)
    let mine = null
    if (!had) {
      const c = await api('POST', '/api/targets', { name: `${MARK}-${kind}`, kind, accountId: ids.acc2 })
      ok(c.status === 201 && c.json?.accountId === ids.acc2, `first '${kind}' target with a linked account → ${c.status} ${c.json?.accountId === ids.acc2 ? '(linked)' : ''}`)
      if (c.status === 201) mine = c.json.id
    }
    const dup = await api('POST', '/api/targets', { name: `${MARK}-${kind}2`, kind })
    ok(dup.status === 400, `a second '${kind}' target → ${dup.status} (want 400)`)
    if (mine) ok((await api('DELETE', `/api/targets/${mine}`)).status === 204, `DELETE the '${kind}' target`)
  }
  // Delete rules (S-9, S-13): a card or an account a buffer use pays through cannot go; otherwise a card's
  // spendings lose the card, an account takes its balance records with it and leaves its card and target unlinked.
  {
    const tAcc = await api('POST', '/api/accounts', { ...ac, name: `${MARK}-del`, buffer: 500_000 })
    const tCard = await api('POST', '/api/cards', { ...cd, name: `${MARK}-delc`, accountId: tAcc.json?.id })
    const tBal = await api('POST', '/api/balances', { accountId: tAcc.json?.id, date: '2090-01-01', amount: 10, note: MARK })
    const tTgt = await api('POST', '/api/targets', { name: `${MARK}-delt`, kind: 'fixed', accountId: tAcc.json?.id })
    const tBuf = await api('POST', '/api/spendings', buf(`${MARK}-delb`, tCard.json?.id))
    const tLump = await api('POST', '/api/spendings', { ...lumpCard, name: `${MARK}-dell`, cardId: tCard.json?.id })
    ok([tAcc, tCard, tBal, tTgt, tBuf, tLump].every((r) => r.status === 201), `delete-rule rows made (${[tAcc, tCard, tBal, tTgt, tBuf, tLump].map((r) => r.status).join(',')})`)
    const dCard = await api('DELETE', `/api/cards/${tCard.json.id}`)
    ok(dCard.status === 400, `DELETE a card a buffer use pays through → ${dCard.status} (want 400) ${dCard.json?.error ?? ''}`)
    const dAcc = await api('DELETE', `/api/accounts/${tAcc.json.id}`)
    ok(dAcc.status === 400, `DELETE the account that buffer use pays from → ${dAcc.status} (want 400) ${dAcc.json?.error ?? ''}`)
    ok((await api('DELETE', `/api/spendings/${tBuf.json.id}`)).status === 204, 'DELETE that buffer use')
    ok((await api('DELETE', `/api/cards/${tCard.json.id}`)).status === 204, 'then the card can go')
    const s1 = (await api('GET', '/api/state')).json
    const l1 = s1.spendings.find((x) => x.id === tLump.json.id)
    ok(l1 && l1.cardId === null && l1.rounds.length === 1 && l1.rounds[0].date === '2090-02-20', `the card's lump sum keeps its round and has no card (${l1?.cardId})`)
    ok((await api('DELETE', `/api/accounts/${tAcc.json.id}`)).status === 204, 'then the account can go')
    const s2 = (await api('GET', '/api/state')).json
    ok(!s2.balances.some((b) => b.id === tBal.json.id), "the account's balance record went with it")
    ok(s2.targets.find((x) => x.id === tTgt.json.id)?.accountId === null, 'the target linked to it is unlinked')
    ok((await api('DELETE', `/api/spendings/${tLump.json.id}`)).status === 204 && (await api('DELETE', `/api/targets/${tTgt.json.id}`)).status === 204, 'delete-rule rows removed')
  }

  // Target rules (spec 003 S-1). The seeded data must have one of each non-fixed kind;
  // if it does not, the rule checks below cannot run, and that is a failure, not a skip.
  const byKind = (k) => before.json.targets.find((t) => t.kind === k)
  const living = byKind('living'), subsT = byKind('subscriptions'), rem = byKind('remainder')
  ok(!!living && !!subsT && !!rem, 'seed has one living, one subscriptions and one remainder target (needed for the rule checks)')
  for (const k of ['living', 'subscriptions', 'remainder']) {
    const dup = await api('POST', '/api/targets', { name: `${MARK}-dup`, kind: k })
    ok(dup.status === 400, `second '${k}' target → ${dup.status} (want 400) ${dup.json?.error ?? ''}`)
  }
  // The remainder target may be deleted and may change kind since spec 010 W-6: tests/api/remainder.mjs checks that.
  const amtOnLiving = await api('PUT', `/api/phases/${ids.phase}`, { label: 'V', name: `${MARK}-2`, from: '2090-01', to: '2090-12', amounts: { [living?.id]: 1 } })
  ok(amtOnLiving.status === 400, `phase amount on a non-fixed target → ${amtOnLiving.status} (want 400)`)

  // Race (review #2): a phase write giving target X an amount, against X changing kind away
  // from 'fixed'. Free the 'subscriptions' kind for the test by making that target fixed
  // for a moment, race 15 times, then check no amount sits on a non-fixed target.
  if (subsT) {
    const { id: subsId, ...subsBody } = subsT
    restores.push(['subscriptions target', () => api('PUT', `/api/targets/${subsId}`, { ...subsBody, note: subsBody.note ?? '' })])
    const freed = await api('PUT', `/api/targets/${subsId}`, { ...subsBody, kind: 'fixed' })
    ok(freed.status === 200, `free the subscriptions kind for the race test → ${freed.status}`)
    const x = await api('POST', '/api/targets', { name: `${MARK}-race`, kind: 'fixed' })
    // Deterministic first: while X is fixed, a phase write with an amount for X succeeds.
    const seq = await api('PUT', `/api/phases/${ids.phase}`, { label: 'V', name: `${MARK}-2`, from: '2090-01', to: '2090-12', amounts: { [ids.target]: 12_345, [x.json.id]: 1 } })
    ok(seq.status === 200 && seq.json?.amounts?.[x.json.id] === 1, `race: sequential phase write with an amount for fixed X → ${seq.status}`)
    const phaseCodes = [], targetCodes = []
    for (let i = 0; i < 15; i++) {
      const [p, tg] = await Promise.all([
        api('PUT', `/api/phases/${ids.phase}`, { label: 'V', name: `${MARK}-2`, from: '2090-01', to: '2090-12', amounts: { [ids.target]: 12_345, [x.json.id]: 1 + i } }),
        api('PUT', `/api/targets/${x.json.id}`, { name: `${MARK}-race`, kind: i % 2 ? 'fixed' : 'subscriptions' }),
      ])
      phaseCodes.push(p.status)
      targetCodes.push(tg.status)
    }
    // The writes must really happen: every kind change succeeds; a phase write either succeeds or is refused
    // because X is not fixed at that moment (400) — never a server error. Which one wins depends on scheduling,
    // so success is proven by the sequential write above, not required here.
    ok(targetCodes.every((c) => c === 200), `race: all target kind changes → 200 (${targetCodes.join(',')})`)
    ok(phaseCodes.every((c) => c === 200 || c === 400), `race: phase writes → 200 or 400 only (${phaseCodes.join(',')})`)
    const st = (await api('GET', '/api/state')).json
    const fixedIds = new Set(st.targets.filter((t) => t.kind === 'fixed').map((t) => t.id))
    const stray = st.phases.flatMap((p) => Object.keys(p.amounts).filter((tid) => !fixedIds.has(tid)))
    ok(stray.length === 0, `after 15 concurrent phase/target writes no amount sits on a non-fixed target (${stray.length})`)
    const delX = await api('DELETE', `/api/targets/${x.json.id}`)
    const back = await api('PUT', `/api/targets/${subsId}`, { ...subsBody, note: subsBody.note ?? '' })
    ok(delX.status === 204 && back.status === 200 && back.json.kind === 'subscriptions', `race test cleaned up → ${delX.status}, ${back.status} ${back.json?.kind}`)
    // the phase must keep only the marker target's amount for verify
    await api('PUT', `/api/phases/${ids.phase}`, { label: 'V', name: `${MARK}-2`, from: '2090-01', to: '2090-12', amounts: { [ids.target]: 12_345 } })
  }

  const overlap = await api('POST', '/api/phases', { label: 'V', name: 'overlap', from: '2090-06', to: null, amounts: {} })
  ok(overlap.status === 400, `POST overlapping phase → ${overlap.status} (want 400) ${overlap.json?.error ?? ''}`)
  const badRef = await api('POST', '/api/plan-changes', { subId: 'no-such-sub', effective: null, to: { amount: 1 }, note: '' })
  ok(badRef.status === 400, `POST plan change for missing subscription → ${badRef.status} (want 400)`)
  const bad = await api('POST', '/api/subscriptions', { ...sub, name: '' })
  ok(bad.status === 400, `POST subscription without name → ${bad.status} (want 400)`)
  const badDate = await api('POST', '/api/subscriptions', { ...sub, nextDate: '2031-02-30' })
  ok(badDate.status === 400, `POST subscription with 2031-02-30 → ${badDate.status} (want 400)`)
  const overflow = await api('POST', '/api/debts', { name: MARK, principal: 2_147_483_648, rate: '', method: '', plan: '' })
  ok(overflow.status === 400, `POST debt with principal 2^31 → ${overflow.status} (want 400)`)
  const bigLiving = await api('PUT', '/api/living', { ...before.json.living, food: 2_147_483_648 })
  ok(bigLiving.status === 400, `PUT living with food 2^31 → ${bigLiving.status} (want 400)`)
  // Two overlapping phases at the same time: exactly one may win.
  const race = await Promise.all([1, 2].map((i) => api('POST', '/api/phases', { label: 'R', name: `${MARK}-race${i}`, from: '2095-01', to: '2095-12', amounts: {} })))
  const won = race.filter((r) => r.status === 201)
  ok(won.length === 1 && race.some((r) => r.status === 400), `concurrent overlapping phases → ${race.map((r) => r.status).join(',')} (want one 201, one 400)`)
  ids.racePhase = won[0]?.json?.id ?? null

  writeFileSync(STATE, JSON.stringify({ ids, cookie }, null, 2))
}

if (phase === 'verify' || phase === 'cleanup') {
  const saved = JSON.parse(readFileSync(STATE, 'utf8'))
  await signIn()
  const { ids } = saved
  const st = (await api('GET', '/api/state')).json
  if (phase === 'verify') {
    const find = (list, id) => st[list].find((x) => x.id === id)
    ok(st.settings.netPay === 2_600_001, 'settings.netPay persisted')
    ok(st.living.food === 300_001, 'living.food persisted')
    ok(find('subscriptions', ids.sub)?.plan === 'p2', 'subscription persisted')
    ok(find('planChanges', ids.chg)?.note === `${MARK}-2`, 'plan change persisted')
    ok(find('phases', ids.phase)?.name === `${MARK}-2`, 'phase persisted')
    ok(find('phases', ids.phase)?.amounts?.[ids.target] === 12_345, 'phase amount persisted')
    ok(find('targets', ids.target)?.name === `${MARK}-t2`, 'target persisted')
    ok(find('events', ids.event)?.state === 'doing', 'event persisted')
    ok(find('checks', ids.check)?.done === true, 'check persisted')
    ok(find('accounts', ids.account)?.role === 'r', 'account persisted')
    ok(find('debts', ids.debt)?.principal === 2, 'debt persisted')
    ok(find('remainderSplit', ids.split)?.ratio === 0.5, 'remainder split persisted')
    const sp = find('spendings', ids.spend)
    ok(sp?.rounds?.length === 3 && sp.rounds[1].amount === 100_500 && sp.rounds[1].edited === true && sp.rounds[2].date === '2090-04-16' && sp.fee === 3_000 && sp.how === 'installment', 'spending with its rounds persisted')
    // spec 013 V-5
    const li = find('livingItems', ids.livingItem)
    ok(li?.amount === 2_000 && li.kind === 'k' && li.payMethod === 'm' && li.from === '2090-01' && li.code === null && li.note === MARK && li.amounts?.[ids.phase] === 5_000, 'living item with its phase amount persisted')
    ok(st.livingItems.find((x) => x.code === 'food')?.amount === 300_001, 'the coded food item persisted (PUT /api/living)')
    const a2 = find('accounts', ids.acc2)
    const want = { bank: 'b', last4: '0123', kind: 'k', rate: '3.1%', term: '12m', buffer: 150_000, goal: 5_000_000, annualLimit: 20_000_000, group: 'saving', amount: 50_000, ratio: 0.25, from: '2090-01', stopFrom: '2090-06', goalAck: 4_000_000, note: MARK }
    ok(!!a2 && Object.entries(want).every(([k, v]) => a2[k] === v) && a2.amounts?.[ids.phase] === 60_000, `account with the new fields and its phase amount persisted ${a2 ? '' : '(missing)'}`)
    const bl = find('balances', ids.balance)
    ok(bl?.accountId === ids.acc2 && bl.date === '2090-01-05' && bl.amount === 1_100_000 && bl.note === MARK, 'balance record persisted')
    const cd = find('cards', ids.card)
    ok(cd?.name === `${MARK}-card` && cd.last4 === '0123' && cd.accountId === ids.acc2 && cd.billingDay === 20 && cd.note === MARK, 'card persisted')
    ok(find('spendings', ids.cardSpend)?.cardId === ids.card && find('spendings', ids.cardSpend)?.note === 'n2', 'card lump sum with its card persisted')
    const bs = find('spendings', ids.bufSpend)
    ok(bs?.how === 'buffer' && bs.payBy === 'card' && bs.cardId === ids.card && bs.refillFrom === '2090-02-26' && bs.fee === 0 && bs.rounds.length === 3 && bs.rounds.every((r) => r.amount === 100_000), 'buffer use persisted')
    // rc.2 V-14, V-15
    const adj = find('monthAdjusts', ids.adjust)
    ok(adj?.ym === '2090-03' && adj.targetId === ids.target && adj.amount === 8_000 && adj.reason === MARK, `month adjustment persisted ${adj ? '' : '(missing)'}`)
    ok(a2?.afterMaturity === `${MARK}-after`, `afterMaturity persisted (${a2?.afterMaturity})`)
  } else {
    for (const [path, id] of [['/api/month-adjusts', ids.adjust], ['/api/spendings', ids.bufSpend], ['/api/spendings', ids.cardSpend], ['/api/cards', ids.card], ['/api/balances', ids.balance], ['/api/living-items', ids.livingItem], ['/api/accounts', ids.acc2]]) {
      if (!id) continue
      try {
        const d = await api('DELETE', `${path}/${id}`)
        ok(d.status === 204, `DELETE ${path}/:id → ${d.status}`)
      } catch (e) { ok(false, `DELETE ${path}/:id threw: ${e?.message ?? e}`) }
    }
    for (const [path, id] of [['/api/plan-changes', ids.chg], ['/api/subscriptions', ids.sub], ['/api/phases', ids.phase], ['/api/events', ids.event], ['/api/checks', ids.check], ['/api/accounts', ids.account], ['/api/debts', ids.debt], ['/api/remainder-split', ids.split], ['/api/targets', ids.target], ['/api/phases', ids.racePhase], ['/api/spendings', ids.spend]]) {
      if (!id) continue
      try {
        const d = await api('DELETE', `${path}/${id}`)
        ok(d.status === 204, `DELETE ${path}/:id → ${d.status}`)
      } catch (e) { ok(false, `DELETE ${path}/:id threw: ${e?.message ?? e}`) }
    }
    // after the marker phase is gone, so the restored open phase does not overlap it
    for (const p of ids.openPhases ?? []) {
      const { id, ...rest } = p
      try {
        const r = await api('PUT', `/api/phases/${id}`, rest)
        ok(r.status === 200 && r.json.to === null, `restore open phase ${p.label} → ${r.status}`)
      } catch (e) { ok(false, `restore open phase ${p.label} threw: ${e?.message ?? e}`) }
    }
    // Every remaining step on its own (review 21): one that throws never skips the next.
    try {
      const again = await api('GET', '/api/state')
      const left = Object.values(again.json ?? {}).flatMap((v) => (Array.isArray(v) ? v : [])).filter((x) => JSON.stringify(x).includes(MARK))
      ok(again.status === 200 && left.length === 0, `no marker rows left (${again.status}, ${left.length})`)
    } catch (e) { ok(false, `marker check threw: ${e?.message ?? e}`) }
    try {
      const s = await api('PUT', '/api/settings', ids.settings)
      ok(s.status === 200, `settings restored → ${s.status}`)
    } catch (e) { ok(false, `settings restore threw: ${e?.message ?? e}`) }
    try {
      const l = await api('PUT', '/api/living', ids.living)
      ok(l.status === 200, `living restored → ${l.status}`)
    } catch (e) { ok(false, `living restore threw: ${e?.message ?? e}`) }
  }
}
} catch (e) {
  if (!(e instanceof Stop)) { failed++; console.log(`FAIL threw: ${e?.stack ?? e}`) }
  if (phase === 'create') await rollback()
}

console.log(failed === 0 ? `\nALL PASS (${phase})` : `\n${failed} FAILED (${phase})`)
process.exit(failed === 0 ? 0 : 1)
