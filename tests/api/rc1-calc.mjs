// API check for spec 018 (0.1.10-rc.1, V-5). W-1: the weekend and holiday rule of each date.
//   bash scripts/test-server/disposable.sh rc1-w1-api node tests/api/rc1-calc.mjs   (it writes to the database directly)
// A is ADMIN_EMAIL. U is made here and deleted at the end; every row below is U's.
//   shifts    a settings body with the old dayShift alone sets the three rules; a rule the body names wins, each on its
//             own; a body without any keeps the saved ones; no answer has dayShift and the column is gone; an unknown
//             value is refused (400) and leaves the row; a schedule item's shift is saved, kept when left out, 'none' for
//             a new one, and the settings' dayShift does not touch it
//   mcp       get_schedule and get_overview give each date its rule; propose_changes takes the old dayShift, the three
//             keys and a schedule item's shift, and refuses an unknown value
//   revert    a settings change logged in the 0.1.9 shape (dayShift in the logged rows) is still reverted, and still
//             refused when a rule changed after it (A-2)
// Exit 0 only if every check passed.
import postgres from 'postgres'
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const ACCEPT = 'application/json, text/event-stream'

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  api.signIn = (email, password) => api('POST', '/api/auth/sign-in/email', { email, password })
  return api
}
let rpcId = 0
async function tool(key, name, args = {}) {
  const r = await fetch(BASE + '/api/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: ACCEPT, authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, failed: r.status >= 400 || !!json?.error || json?.result?.isError === true, data: json?.result?.structuredContent, text }
}

const PASS = 'rc1-pass-12345'
const BODY = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const three = (s) => [s?.payShift, s?.transferShift, s?.billingShift].join('/')
const made = []

const A = client()
const U = client()
let mainErr = null
try {
  const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
  ok(sa.status === 200, `admin sign-in ${sa.status}`)
  if (failures()) process.exit(1)
  arm()
  const email = `rc1-u-${Date.now()}@example.com`
  const cu = await A('POST', '/api/auth/admin/create-user', { email, password: PASS, name: 'RC1 U', role: 'user' })
  ok(cu.status === 200, `create U → ${cu.status}`)
  const uid = cu.json.user.id
  made.push({ id: uid, email })
  ok((await U.signIn(email, PASS)).status === 200, 'U signs in')
  const state = async () => (await U('GET', '/api/state')).json
  const put = (body) => U('PUT', '/api/settings', body)

  // ── shifts: the settings ──
  const s0 = (await state()).settings
  ok(three(s0) === 'none/none/none' && !('dayShift' in s0), `a new account: every rule is none, and /api/state has no dayShift (${three(s0)})`)
  const [col] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'settings' and column_name = 'day_shift'`
  const cols = await sql`select column_name from information_schema.columns where table_name = 'settings' and column_name in ('pay_shift', 'transfer_shift', 'billing_shift') order by 1`
  ok(col.n === 0 && cols.length === 3, `the table has the three rule columns and no day_shift (${cols.map((c) => c.column_name)})`)

  const old = await put({ ...BODY, dayShift: 'before' })
  ok(old.status === 200 && three(old.json) === 'before/before/before' && !('dayShift' in old.json), `a body with dayShift alone → ${old.status}, the three rules ${three(old.json)}, no dayShift in the answer`)
  ok(three((await state()).settings) === 'before/before/before', '/api/state reads the three back')
  const kept = await put(BODY)
  ok(kept.status === 200 && three(kept.json) === 'before/before/before', `a body without any of them keeps the saved rules (${three(kept.json)})`)
  const one = await put({ ...BODY, transferShift: 'after' })
  ok(one.status === 200 && three(one.json) === 'before/after/before', `one rule alone changes that rule only (${three(one.json)})`)
  const wins = await put({ ...BODY, dayShift: 'none', payShift: 'after' })
  ok(wins.status === 200 && three(wins.json) === 'after/none/none', `a named rule wins over dayShift, which fills the others (${three(wins.json)})`)
  const all = await put({ ...BODY, payShift: 'before', transferShift: 'none', billingShift: 'after' })
  ok(all.status === 200 && three(all.json) === 'before/none/after' && three((await state()).settings) === 'before/none/after', `the three rules are saved and read back (${three(all.json)})`)
  // the screen sends the whole row it read: the three rules it holds win over a dayShift sent with them
  const whole = await put({ ...(await state()).settings, dayShift: 'after' })
  ok(whole.status === 200 && three(whole.json) === 'before/none/after', `a body with the three rules and dayShift keeps the three (${three(whole.json)})`)
  ok(whole.json.payDay === 25 && whole.json.transferDay === 26 && whole.json.billingDay === 14 && whole.json.netPay === 3_000_000, 'the other settings are saved as before')
  for (const k of ['payShift', 'transferShift', 'billingShift', 'dayShift']) {
    const bad = await put({ ...BODY, [k]: 'sideways' })
    const nul = await put({ ...BODY, [k]: null })
    ok(bad.status === 400 && typeof bad.json?.error === 'string' && nul.status === 400, `${k}: an unknown value → ${bad.status} with a message, null → ${nul.status}`)
  }
  ok(three((await state()).settings) === 'before/none/after', 'the refused bodies left the row as it was')

  // ── shifts: the user's own dates ──
  const ITEM = { name: 'RC1 date', day: 10, accountId: null, direction: 'out' }
  const i1 = await U('POST', '/api/schedules', ITEM)
  ok(i1.status === 201 && i1.json.shift === 'none', `a new date in the 0.1.9 shape (no shift) → ${i1.status}, shift ${i1.json?.shift}`)
  const i2 = await U('POST', '/api/schedules', { ...ITEM, name: 'RC1 date 2', shift: 'before' })
  ok(i2.status === 201 && i2.json.shift === 'before', `a new date with its rule → ${i2.status}, shift ${i2.json?.shift}`)
  const u1 = await U('PUT', `/api/schedules/${i2.json.id}`, { ...ITEM, name: 'RC1 date 2b', day: 11 })
  ok(u1.status === 200 && u1.json.shift === 'before' && u1.json.name === 'RC1 date 2b' && u1.json.day === 11, `an update without shift keeps the saved rule (${u1.json?.shift})`)
  const u2 = await U('PUT', `/api/schedules/${i1.json.id}`, { ...ITEM, shift: 'after' })
  ok(u2.status === 200 && u2.json.shift === 'after', `an update with shift changes it (${u2.json?.shift})`)
  const badNew = await U('POST', '/api/schedules', { ...ITEM, name: 'RC1 bad', shift: 'sideways' })
  const badUp = await U('PUT', `/api/schedules/${i1.json.id}`, { ...ITEM, shift: 'sideways' })
  const nulUp = await U('PUT', `/api/schedules/${i1.json.id}`, { ...ITEM, shift: null })
  ok(badNew.status === 400 && typeof badNew.json?.error === 'string' && badUp.status === 400 && nulUp.status === 400, `an unknown shift → ${badNew.status} / ${badUp.status}, null → ${nulUp.status}`)
  const untouched = await put({ ...BODY, dayShift: 'none' })
  const list = (await state()).schedules
  ok(untouched.status === 200 && three(untouched.json) === 'none/none/none'
    && list.length === 2 && list.find((x) => x.id === i1.json.id)?.shift === 'after' && list.find((x) => x.id === i2.json.id)?.shift === 'before',
    `the settings' dayShift sets the three dates and leaves the own dates' rules (${list.map((x) => x.shift)})`)

  // ── mcp ──
  const mk = async (body) => {
    const r = await U('POST', '/api/keys', { expiresInDays: 30, ...body })
    if (r.status !== 201) throw new Error(`create key ${JSON.stringify(body)} → ${r.status} ${r.text}`)
    return r.json.key
  }
  const kRead = await mk({ name: 'rc1-read' })
  const kChat = await mk({ name: 'rc1-chat', write: true, confirm: 'chat' })
  ok((await put({ ...BODY, payShift: 'before', transferShift: 'after', billingShift: 'none' })).status === 200, 'the rules for the tools: before / after / none')
  const sch = await tool(kRead, 'get_schedule', { months: 1 })
  const m0 = sch.data?.months?.[0]
  ok(!sch.failed && m0?.dates?.pay?.shift === 'before' && m0.dates.transfer.shift === 'after' && m0.dates.billing.shift === 'none'
    && ['date', 'nominal', 'shifted'].every((k) => k in m0.dates.pay),
    `get_schedule: each date has its rule (${m0?.dates?.pay?.shift}/${m0?.dates?.transfer?.shift}/${m0?.dates?.billing?.shift}) next to date, nominal and shifted`)
  const own = m0?.ownDates ?? []
  ok(own.length === 2 && own.find((x) => x.id === i1.json.id)?.shift === 'after' && own.find((x) => x.id === i2.json.id)?.shift === 'before', `get_schedule: every own date has its rule (${own.map((x) => x.shift)})`)
  const ov = await tool(kRead, 'get_overview', {})
  ok(!ov.failed && three(ov.data?.settings) === 'before/after/none' && !('dayShift' in ov.data.settings) && ov.data.dates.pay.shift === 'before' && ov.data.dates.transfer.shift === 'after' && ov.data.dates.billing.shift === 'none',
    `get_overview: the settings have the three rules and no dayShift; the dates carry them (${three(ov.data?.settings)})`)
  const apply = async (changes) => {
    const p = await tool(kChat, 'propose_changes', { note: 'rc1', changes })
    if (p.failed) return p
    return tool(kChat, 'apply_proposal', { proposalId: p.data.proposalId })
  }
  const pOld = await apply([{ resource: 'settings', action: 'update', data: { ...BODY, dayShift: 'after' } }])
  ok(!pOld.failed && three((await state()).settings) === 'after/after/after', `propose_changes with the old dayShift, applied: ${three((await state()).settings)}`)
  const pNew = await apply([
    { resource: 'settings', action: 'update', data: { ...BODY, billingShift: 'before' } },
    { resource: 'schedules', action: 'update', id: i2.json.id, data: { ...ITEM, name: 'RC1 date 2b', day: 11, shift: 'none' } },
  ])
  const after = await state()
  ok(!pNew.failed && three(after.settings) === 'after/after/before' && after.schedules.find((x) => x.id === i2.json.id)?.shift === 'none', `propose_changes with one rule and a date's shift, applied: ${three(after.settings)}, the date ${after.schedules.find((x) => x.id === i2.json.id)?.shift}`)
  const pBad = await tool(kChat, 'propose_changes', { changes: [{ resource: 'settings', action: 'update', data: { ...BODY, payShift: 'sideways' } }] })
  const pBad2 = await tool(kChat, 'propose_changes', { changes: [{ resource: 'schedules', action: 'update', id: i2.json.id, data: { ...ITEM, shift: 'sideways' } }] })
  ok(pBad.failed && pBad2.failed && three((await state()).settings) === 'after/after/before', 'propose_changes refuses an unknown rule, for the settings and for a date')

  // ── revert of a change logged in the 0.1.9 shape (A-2) ──
  // A real change, then its logged rows rewritten the way 0.1.9 wrote them: dayShift in place of the three rules.
  const asOld = async (setId, before, after) => sql.begin(async (q) => {
    await q`select set_config('app.user_id', ${uid}, true)`
    const r = await q`update change_log
      set before = (before - 'payShift' - 'transferShift' - 'billingShift') || ${sql.json({ dayShift: before })},
          after = (after - 'payShift' - 'transferShift' - 'billingShift') || ${sql.json({ dayShift: after })}
      where user_id = ${uid} and set_id = ${setId} and table_name = 'settings' and op = 'update'`
    return r.count
  })
  const lastSet = async () => (await U('GET', '/api/changes?limit=1')).json[0]
  ok((await put({ ...BODY, dayShift: 'before' })).status === 200, 'revert: start from before / before / before')
  ok((await put({ ...BODY, dayShift: 'after' })).status === 200, 'revert: a change to after / after / after')
  const set1 = await lastSet()
  ok(await asOld(set1.id, 'before', 'after') === 1, `revert: the logged rows of set ${set1.id.slice(0, 8)} now hold dayShift only, as 0.1.9 logged them`)
  const shown = (await U('GET', `/api/changes/${set1.id}`)).json.changes.find((c) => c.tableName === 'settings')
  ok(shown.before.dayShift === 'before' && shown.after.dayShift === 'after' && !('payShift' in shown.after), 'revert: the history shows the old row as it was logged')
  const rv = await U('POST', `/api/changes/${set1.id}/revert`)
  ok(rv.status === 200 && three((await state()).settings) === 'before/before/before', `revert: the old set is reverted → ${rv.status}, the rules are back to ${three((await state()).settings)}`)
  // an old set after which one rule changed is still refused
  ok((await put({ ...BODY, dayShift: 'after' })).status === 200, 'revert: another change to after / after / after')
  const set2 = await lastSet()
  ok(await asOld(set2.id, 'before', 'after') === 1, 'revert: its logged rows in the 0.1.9 shape too')
  ok((await put({ ...BODY, transferShift: 'none' })).status === 200, 'revert: then the transfer rule alone changes')
  const rv2 = await U('POST', `/api/changes/${set2.id}/revert`)
  ok(rv2.status === 409 && three((await state()).settings) === 'after/none/after', `revert: a rule changed later → ${rv2.status}, nothing changes (${three((await state()).settings)})`)
} catch (e) {
  mainErr = e
  threw(e)
} finally {
  disarm()
  for (const u of made) {
    await cleanupStep(`delete ${u.email.split('@')[0]}`, async () => {
      const r = await A('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: u.email })
      return r.status === 200 || r.status === 204 ? undefined : r.status
    })
  }
  await sql.end()
}
console.log(failures() ? `FAILED ${failures()} check(s)` : 'ALL PASSED')
process.exit(failures() || mainErr ? 1 : 0)
