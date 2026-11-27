// API check for spec 018 V-2 (the migration and the data of 0.1.9): made-up data is put in through the API of 0.1.9,
// the state and the MCP answers are written to a file before and after the image is upgraded in place, and the two
// files are compared. Four modes: prepare, dump, compare, cleanup (below).
// The PM runs it in the test step against the throwaway test server (:15174, through scripts/test-server/run.sh):
// prepare and dump on the released 0.1.9 image, the upgrade to the image under test, dump again, compare, cleanup.
// It refuses any BASE but :15174 and the disposable API (:15184); it never runs against :15173.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/rc1-upgrade.mjs prepare
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/rc1-upgrade.mjs dump <file.json>
//   node tests/api/rc1-upgrade.mjs compare <before.json> <after.json>
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/rc1-upgrade.mjs cleanup
// prepare  adds rows whose names start with "RC1-up " on top of the seed (scripts/test-server/seed.mjs), with the
//          bodies 0.1.9 takes (server/validation.ts of 0.1.9): the one holiday rule set to 'before', an own date on
//          day 31, an account with a buffer and a card paid from it (billing day 14), the subscriptions target linked
//          to that account, card spendings (lump sum, 3-month installment, buffer use), one spending from the salary
//          account and one from the subscription account, three subscriptions (monthly on the 27th with a price
//          change on the 30th; one cancelled after this month's charge; one yearly) and a balance record dated today.
//          What it changed in rows it did not make (the rule, the target's link) is kept in the note of the account
//          it made, so cleanup can put it back after an upgrade too. It refuses to run twice.
// dump     /api/state without the fields that change by themselves, and the answers of the read tools of the MCP
//          server (a read key named E2E-rc1-upgrade, removed at the end), keys sorted.
// compare  every difference between two dumps: (a) keys only after, (b) keys gone, (c) values changed. Exit 0 always.
// cleanup  removes the "RC1-up " rows and puts back what prepare changed.
// The output holds made-up data only. A dump is written under .loctx/, never committed.
import { readFileSync, writeFileSync } from 'node:fs'
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const MARK = 'RC1-up '
const KEY_NAME = 'E2E-rc1-upgrade' // a prefix scripts/test-server/cleanup.mjs removes, should a run stop half way
const ALLOWED = ['http://127.0.0.1:15174', 'http://127.0.0.1:15184']
const [mode, ...args] = process.argv.slice(2)
const USAGE = 'usage: rc1-upgrade.mjs prepare | dump <file.json> | compare <before.json> <after.json> | cleanup'

// ── compare needs no server ──
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const show = (v) => (v === undefined ? '(none)' : JSON.stringify(v))
/**
 * What a list's items are matched by, so a row that moved or a new row does not shift the ones after it: the first of
 * these that every item of both lists has, with no two items of a list alike. Without one, the position.
 */
const LIST_KEYS = [['id'], ['spendingId', 'round'], ['subscriptionId', 'date'], ['subscriptionId'], ['targetId'], ['incomeId', 'name'], ['month'], ['ym'], ['code'], ['no'], ['round'], ['date', 'name']]
const plain = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
function listKey(...lists) {
  if (!lists.some((l) => l.length)) return null
  for (const keys of LIST_KEYS) {
    const id = (x) => keys.map((k) => String(x[k])).join(' ')
    if (lists.every((list) => list.every((x) => isObj(x) && keys.every((k) => k in x && plain(x[k]))) && new Set(list.map(id)).size === list.length)) return { name: keys.join('+'), of: id }
  }
  return null
}
function diff(a, b, path, out) {
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const p = path ? `${path}.${k}` : k
      if (!(k in a)) out.added.push([p, b[k]])
      else if (!(k in b)) out.gone.push([p, a[k]])
      else diff(a[k], b[k], p, out)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = listKey(a, b)
    if (key) {
      const [ma, mb] = [a, b].map((list) => new Map(list.map((x) => [key.of(x), x])))
      for (const id of [...new Set([...ma.keys(), ...mb.keys()])]) {
        const p = `${path}[${key.name}=${id}]`
        if (!ma.has(id)) out.added.push([p, mb.get(id)])
        else if (!mb.has(id)) out.gone.push([p, ma.get(id)])
        else diff(ma.get(id), mb.get(id), p, out)
      }
      const [oa, ob] = [a, b].map((list) => list.map(key.of).filter((id) => ma.has(id) && mb.has(id)).join(', '))
      if (oa !== ob) out.changed.push([`${path} (the order of the items both have)`, oa, ob])
      return
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = `${path}[${i}]`
      if (i >= a.length) out.added.push([p, b[i]])
      else if (i >= b.length) out.gone.push([p, a[i]])
      else diff(a[i], b[i], p, out)
    }
    return
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.changed.push([path, a, b])
}
if (mode === 'compare') {
  const [fa, fb] = args
  if (!fa || !fb) { console.log(USAGE); process.exit(0) }
  const [A, B] = [fa, fb].map((f) => JSON.parse(readFileSync(f, 'utf8')))
  console.log(`before: ${fa} (${JSON.stringify(A.meta)})`)
  console.log(`after:  ${fb} (${JSON.stringify(B.meta)})`)
  const out = { added: [], gone: [], changed: [] }
  for (const part of ['state', 'mcp']) diff(A[part] ?? {}, B[part] ?? {}, part, out)
  console.log(`\n(a) keys that only exist after: ${out.added.length}`)
  for (const [p, v] of out.added) console.log(`  + ${p}\n      after:  ${show(v)}`)
  console.log(`\n(b) keys gone: ${out.gone.length}`)
  for (const [p, v] of out.gone) console.log(`  - ${p}\n      before: ${show(v)}`)
  console.log(`\n(c) values changed: ${out.changed.length}`)
  for (const [p, x, y] of out.changed) console.log(`  ~ ${p}\n      before: ${show(x)}\n      after:  ${show(y)}`)
  console.log(`\n${out.added.length} new, ${out.gone.length} gone, ${out.changed.length} changed`)
  process.exit(0)
}
if (!['prepare', 'dump', 'cleanup'].includes(mode) || (mode === 'dump' && !args[0])) { console.log(USAGE); process.exit(2) }

// ── the API client ──
const BASE = process.env.BASE
if (!ALLOWED.includes(BASE)) { console.log(`refuse: BASE is not a throwaway server (${ALLOWED.join(' or ')})`); process.exit(1) }
let cookie = ''
async function api(method, path, body, headers = {}, withCookie = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, ...(withCookie && cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (withCookie && set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
const state = async () => (await api('GET', '/api/state')).json
const named = (row) => String(row.name ?? row.text ?? row.title ?? row.note ?? '')
const mine = (row) => named(row).startsWith(MARK)

// ── dates: "today" in the account's time zone; a date on a weekend moves to the Friday before (the rule 'before';
// holidays are not looked up here — the dates are only what a spending's rounds are saved with) ──
const pad = (n) => String(n).padStart(2, '0')
const todayIn = (tz) => new Date().toLocaleString('sv', { timeZone: tz || 'Asia/Seoul' }).slice(0, 10)
const ymAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
/** Day `day` of the month (its last day when the month is shorter). */
const dayOf = (ym, day) => `${ym}-${pad(Math.min(day, lastDay(ym)))}`
const offWeekend = (date) => {
  const d = new Date(`${date}T00:00:00Z`)
  const back = d.getUTCDay() === 6 ? 1 : d.getUTCDay() === 0 ? 2 : 0
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

const si = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
ok(si.status === 200, `sign-in → ${si.status}`)
if (failures()) process.exit(1)

/** Runs `fn(tool)` with a read key of the MCP server made for it; the key is removed at the end, also on a failure. */
async function withKey(fn) {
  let keyId = null
  try {
    const k = await api('POST', '/api/keys', { name: KEY_NAME, expiresInDays: 1 })
    ok(k.status === 201 && typeof k.json?.key === 'string', `read key → ${k.status}`)
    keyId = k.json.item.id
    return await fn(async (name, toolArgs = {}) => {
      const r = await api('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: toolArgs } },
        { authorization: `Bearer ${k.json.key}`, accept: 'application/json, text/event-stream' }, false)
      const res = r.json?.result
      ok(r.status === 200 && res && res.isError !== true, `${name} ${JSON.stringify(toolArgs)} → ${r.status}${res?.isError ? ` ${JSON.stringify(res.content)}` : ''}`)
      return res?.structuredContent ?? JSON.parse(res?.content?.[0]?.text ?? 'null')
    })
  } finally {
    if (keyId) await cleanupStep('remove the read key', async () => (await api('DELETE', `/api/keys/${keyId}`)).status)
  }
}

// ───────────────────────────── prepare ─────────────────────────────
async function prepare() {
  const st = await state()
  const left = Object.entries(st).flatMap(([k, v]) => (Array.isArray(v) ? v.filter((r) => isObj(r) && mine(r)).map((r) => `${k}: ${named(r)}`) : []))
  ok(left.length === 0, `no "${MARK}" row yet${left.length ? ` (run cleanup first: ${left.join('; ')})` : ''}`)
  const subsTarget = (st.targets ?? []).find((t) => t.kind === 'subscriptions')
  ok(!!subsTarget, `the seed's subscriptions target is there (${subsTarget?.name})`)
  if (failures()) return
  arm()
  const today = todayIn(st.preferences?.timezone)
  const ym = today.slice(0, 7)
  const create = async (what, path, body) => {
    const r = await api('POST', path, body)
    ok(r.status === 201, `create ${what} → ${r.status}${r.status === 201 ? ` id ${r.json.id}` : ` ${JSON.stringify(r.json)}`}`)
    return r.json
  }

  // the account first: its note keeps what cleanup has to put back
  const restore = { dayShift: st.settings.dayShift ?? null, subsTargetId: subsTarget.id, subsAccountId: subsTarget.accountId ?? null }
  const acc = await create('account "RC1-up pay" (buffer 300,000)', '/api/accounts',
    { name: `${MARK}pay`, role: 'card payments', inflow: 'salary', outflow: 'card', buffer: 300_000, note: `restore ${JSON.stringify(restore)}` })
  console.log(`  kept for cleanup: ${JSON.stringify(restore)}`)

  // settings: only the holiday rule changes; every other value stays as the seed or an earlier run left it
  const s0 = st.settings
  const put = await api('PUT', '/api/settings', { ...s0, dayShift: 'before' })
  ok(put.status === 200 && put.json?.dayShift === 'before', `settings: dayShift ${s0.dayShift} → ${put.json?.dayShift} (${put.status}); kept: payDay ${put.json?.payDay}, transferDay ${put.json?.transferDay}, billingDay ${put.json?.billingDay}, netPay ${put.json?.netPay}, subRound ${put.json?.subRound}, fxRate ${put.json?.fxRate}, fxBuffer ${put.json?.fxBuffer}`)

  await create('own date "RC1-up own 31" (day 31, out)', '/api/schedules', { name: `${MARK}own 31`, day: 31, accountId: null, direction: 'out', note: '' })
  const card = await create('card "RC1-up card" (billing day 14, paid from RC1-up pay)', '/api/cards', { name: `${MARK}card`, last4: '', accountId: acc.id, billingDay: 14, note: '' })

  const { id: _id, ...target } = subsTarget
  const link = await api('PUT', `/api/targets/${subsTarget.id}`, { ...target, accountId: acc.id })
  ok(link.status === 200 && link.json?.accountId === acc.id, `subscriptions target "${subsTarget.name}": accountId ${subsTarget.accountId ?? null} → ${link.json?.accountId} (${link.status})`)

  // spendings
  const base = { note: '', category: '생활', currency: 'KRW', fxRate: null, fxBuffer: null, fee: 0, interval: null, cancelled: false }
  const round = (no, date, amount) => ({ no, date, amount, state: 'left', edited: false })
  // The dates a round is saved with are the ones the app works out under the rule just set (weekends and the account's
  // holidays): the billing and pay dates of get_schedule. The card bills on the settings' billing day only when both
  // are 14; otherwise day 14 moved off a weekend.
  const sched = await withKey((tool) => tool('get_schedule', { from: ym, months: 4 }))
  const dates = (n) => sched.months.find((m) => m.month === ymAdd(ym, n))?.dates
  const bill = (n) => (put.json?.billingDay === 14 && dates(n)?.billing?.date) || offWeekend(dayOf(ymAdd(ym, n), 14))
  const spend = async (what, body) => {
    const r = await create(`spending ${what}`, '/api/spendings', body)
    console.log(`  bought ${body.bought}; rounds ${body.rounds.map((x) => `${x.date} ${x.amount}`).join(', ')}`)
    return r
  }
  await spend('"RC1-up card lump" (card, lump sum 120,000)', { ...base, name: `${MARK}card lump`, bought: dayOf(ym, 20), amount: 120_000, how: 'lump', payBy: 'card', cardId: card.id, count: 1,
    rounds: [round(1, bill(1), 120_000)] })
  await spend('"RC1-up card 3m" (card, 3-month installment 300,000 + fee 6,000)', { ...base, name: `${MARK}card 3m`, bought: dayOf(ym, 10), amount: 300_000, fee: 6_000, how: 'installment', payBy: 'card', cardId: card.id, count: 3,
    rounds: [round(1, bill(1), 102_000), round(2, bill(2), 102_000), round(3, bill(3), 102_000)] })
  const refill = (n) => dates(n)?.pay?.date || offWeekend(dayOf(ymAdd(ym, n), st.settings.payDay))
  console.log(`  dates from get_schedule: billing ${[1, 2, 3].map(bill).join(', ')}; pay ${[1, 2].map(refill).join(', ')}`)
  await spend('"RC1-up buffer use" (card, from the buffer 200,000, 2 refills)', { ...base, name: `${MARK}buffer use`, bought: dayOf(ym, 12), amount: 200_000, how: 'buffer', payBy: 'card', cardId: card.id, count: 2, refillFrom: refill(1),
    rounds: [round(1, refill(1), 100_000), round(2, refill(2), 100_000)] })
  await spend('"RC1-up salary lump" (salary account, 77,000)', { ...base, name: `${MARK}salary lump`, bought: today, amount: 77_000, how: 'lump', payBy: 'salary', count: 1, rounds: [round(1, today, 77_000)] })
  await spend('"RC1-up subs lump" (subscription account, 33,000)', { ...base, name: `${MARK}subs lump`, bought: today, amount: 33_000, how: 'lump', payBy: 'subs', count: 1, rounds: [round(1, today, 33_000)] })

  // subscriptions and their plan changes
  const sub = (name, over) => ({ name: `${MARK}${name}`, category: 'tool', plan: 'basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', path: 'direct', verified: false, ...over })
  const m27 = await create(`subscription "RC1-up monthly 27" (10,000 a month, next charge ${dayOf(ym, 27)})`, '/api/subscriptions', sub('monthly 27', { nextDate: dayOf(ym, 27) }))
  await create(`plan change "RC1-up price 30" (amount 10,000 → 15,000, effective ${dayOf(ym, 30)})`, '/api/plan-changes', { subId: m27.id, effective: dayOf(ym, 30), to: { amount: 15_000 }, note: `${MARK}price 30` })
  const m28 = await create(`subscription "RC1-up cancel after charge" (8,000 a month, next charge ${dayOf(ym, 28)})`, '/api/subscriptions', sub('cancel after charge', { amount: 8_000, nextDate: dayOf(ym, 28) }))
  await create(`plan change "RC1-up cancel 29" (status → cancelled, effective ${dayOf(ym, 29)})`, '/api/plan-changes', { subId: m28.id, effective: dayOf(ym, 29), to: { status: 'cancelled' }, note: `${MARK}cancel 29` })
  await create(`subscription "RC1-up yearly" (120,000 a year, next charge ${dayOf(ymAdd(ym, 1), 15)})`, '/api/subscriptions', sub('yearly', { amount: 120_000, cycle: 'yearly', plan: 'yearly', nextDate: dayOf(ymAdd(ym, 1), 15) }))

  await create(`balance record of RC1-up pay (1,500,000 on ${today})`, '/api/balances', { accountId: acc.id, date: today, amount: 1_500_000, note: `${MARK}balance` })
  console.log(`prepared for ${today} (month ${ym})`)
}

// ───────────────────────────── dump ─────────────────────────────
/** Fields that change without anyone saving: the time of the last automatic rate refresh (the USD one and a listed currency's). */
const VOLATILE = new Set(['fxAutoAt', 'autoAt'])
const dropped = new Set()
function tidy(v, path = '') {
  if (Array.isArray(v)) return v.map((x, i) => tidy(x, `${path}[${i}]`))
  if (!isObj(v)) return v
  const out = {}
  for (const k of Object.keys(v).sort()) {
    if (VOLATILE.has(k)) { dropped.add(`${path.replace(/\[\d+\]/g, '[]')}.${k}`); continue }
    out[k] = tidy(v[k], path ? `${path}.${k}` : k)
  }
  return out
}
async function dump(file) {
  arm()
  try {
    const st = await api('GET', '/api/state')
    ok(st.status === 200, `GET /api/state → ${st.status}`)
    const today = todayIn(st.json.preferences?.timezone)
    const ym = today.slice(0, 7)
    const months = [0, 1, 2].map((n) => ymAdd(ym, n))
    const mcp = await withKey(async (tool) => {
      const out = {}
      for (const m of months) out[`get_overview ${m}`] = await tool('get_overview', { month: m })
      out[`get_schedule from ${ym}, 3 months`] = await tool('get_schedule', { from: ym, months: 3 })
      out.get_allocation = await tool('get_allocation')
      out['list_accounts, 3 months'] = await tool('list_accounts', { months: 3 })
      out.list_subscriptions = await tool('list_subscriptions')
      out.list_spendings = await tool('list_spendings')
      for (const m of months) out[`list_spendings ${m}`] = await tool('list_spendings', { month: m })
      for (const m of months) out[`get_income ${m}`] = await tool('get_income', { month: m })
      out.list_notifications = await tool('list_notifications')
      return out
    })
    const out = { meta: { base: BASE, at: new Date().toISOString(), today, months }, state: tidy(st.json, 'state'), mcp: tidy(mcp, 'mcp') }
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n')
    console.log(`dump written to ${file}: state (${Object.keys(out.state).length} keys), ${Object.keys(out.mcp).length} MCP answers, today ${today}`)
    console.log(`fields left out (they change by themselves): ${[...dropped].map((p) => p.replace(/ \d{4}-\d{2}(?=\.)/, '')).filter((p, i, all) => all.indexOf(p) === i).sort().join(', ') || 'none'}`)
  } finally {
    disarm()
  }
}

// ───────────────────────────── cleanup ─────────────────────────────
async function cleanup() {
  const st = await state()
  const acc = (st.accounts ?? []).find((a) => a.name === `${MARK}pay`)
  let restore = null
  try { restore = acc?.note?.startsWith('restore ') ? JSON.parse(acc.note.slice(8)) : null } catch { restore = null }
  console.log(restore ? `to put back: ${JSON.stringify(restore)}` : 'nothing to put back was kept (no "RC1-up pay" account with its note)')
  if (restore) {
    // the target's link first: an account a target sends to cannot be removed
    const t = (st.targets ?? []).find((x) => x.id === restore.subsTargetId)
    if (t) {
      const { id: _id, ...body } = t
      const r = await api('PUT', `/api/targets/${t.id}`, { ...body, accountId: restore.subsAccountId })
      ok(r.status === 200 && (r.json?.accountId ?? null) === restore.subsAccountId, `subscriptions target "${t.name}": accountId back to ${restore.subsAccountId} (${r.status})`)
    }
    if (restore.dayShift) {
      // `dayShift` is the one rule of 0.1.9; a later server takes it as the rule of each date
      const r = await api('PUT', '/api/settings', { ...st.settings, dayShift: restore.dayShift })
      ok(r.status === 200, `settings: the holiday rule back to ${restore.dayShift} (${r.status}; now ${JSON.stringify(Object.fromEntries(Object.entries(r.json ?? {}).filter(([k]) => /shift/i.test(k))))})`)
    }
  }
  // a spending before its card, a balance record and a card before their account, a plan change before its subscription
  for (const [key, path] of [['planChanges', 'plan-changes'], ['subscriptions', 'subscriptions'], ['spendings', 'spendings'], ['cards', 'cards'], ['balances', 'balances'], ['schedules', 'schedules'], ['accounts', 'accounts']]) {
    for (const row of (st[key] ?? []).filter(mine)) {
      const r = await api('DELETE', `/api/${path}/${row.id}`)
      ok(r.status === 204 || r.status === 404, `delete ${key} "${named(row)}" → ${r.status}`)
    }
  }
  const end = await state()
  const left = Object.entries(end).flatMap(([k, v]) => (Array.isArray(v) ? v.filter((r) => isObj(r) && mine(r)).map((r) => `${k}: ${named(r)}`) : []))
  ok(left.length === 0, `no "${MARK}" row is left${left.length ? ` (${left.join('; ')})` : ''}`)
}

try {
  if (mode === 'prepare') await prepare()
  else if (mode === 'dump') await dump(args[0])
  else await cleanup()
} catch (e) {
  threw(e)
}
console.log(failures() ? `\n${failures()} FAILED` : '\nall passed')
process.exit(failures() ? 1 : 0)
