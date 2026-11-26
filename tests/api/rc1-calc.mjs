// API check for spec 018 (0.1.10-rc.1, V-5). W-1: the weekend and holiday rule of each date. W-2: a card's usage period.
// W-3: what a month is (the settings' monthBasis, monthBasisCardId, monthNaming). W-4: the basis applied to the MCP answers.
//   bash scripts/test-server/disposable.sh rc1-api node tests/api/rc1-calc.mjs   (it writes to the database directly)
// A is ADMIN_EMAIL. U is made here and deleted at the end; every row below is U's.
//   shifts    a settings body with the old dayShift alone sets the three rules; a rule the body names wins, each on its
//             own; a body without any keeps the saved ones; no answer has dayShift and the column is gone; an unknown
//             value is refused (400) and leaves the row; a schedule item's shift is saved, kept when left out, 'none' for
//             a new one, and the settings' dayShift does not touch it
//   mcp       get_schedule and get_overview give each date its rule; propose_changes takes the old dayShift, the three
//             keys and a schedule item's shift, and refuses an unknown value
//   revert    a settings change logged in the 0.1.9 shape (dayShift in the logged rows) is still reverted, and still
//             refused when a rule changed after it (A-2)
//   usage     a card's usageFrom (spec 018 S-2): a card in the 0.1.9 shape has none; it is saved and read back (1 and 31
//             as they are), kept by a body that leaves it out, cleared by null; 0, 32, 1.5, a string → 400 and the row
//             stays; list_accounts carries it; propose_changes sets it, keeps it when left out and refuses 32; a change
//             of it is reverted, and a card change logged before the column existed still reverts and leaves it
//   basis     the settings' three month keys (spec 018 S-3, S-12): calendar / no card / auto until a body names them;
//             saved and read back; kept by a body that leaves them out, each on its own; an unknown value, a card id that
//             does not exist and another user's card id are refused (400) and leave the row; deleting the basis card
//             puts the basis back to calendar in the same change set, and reverting the delete brings both back; a card
//             kept under another basis is only let go; a card's insert is not reverted while it is the basis card;
//             a proposal deletes the basis card the same way; an account whose basis is a card can be deleted
//   month     the basis applied (spec 018 S-3, S-10, W-4), with the pay basis: the MCP tools' default month is the name of
//             the period that holds today, each monthly answer carries period { from, to }, the pay date of the month is
//             the period's first day, a one-off income dated on the period's first day counts in that month and one dated
//             the day before in the month before; a proposal's preview starts with that month; the server instructions
//             say what a month is inside their first 512 characters; back on the calendar basis the answers are the
//             calendar month's
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

  // ── usage: the first day of a card's usage period (W-2) ──
  const [ucol] = await sql`select data_type, is_nullable from information_schema.columns where table_name = 'card' and column_name = 'usage_from'`
  const [uchk] = await sql`select count(*)::int as n from pg_constraint where conname = 'card_usage_from'`
  ok(ucol?.data_type === 'smallint' && ucol.is_nullable === 'YES' && uchk.n === 1, `card.usage_from is ${ucol?.data_type}, nullable ${ucol?.is_nullable}, with its check (${uchk.n})`)
  const CARD = { name: 'RC1 card', last4: '', accountId: null, billingDay: 25, note: 'memo' }
  const cardNow = async (id) => (await state()).cards.find((c) => c.id === id)
  const c1 = await U('POST', '/api/cards', CARD)
  ok(c1.status === 201 && c1.json.usageFrom === null, `a new card in the 0.1.9 shape (no usageFrom) → ${c1.status}, usageFrom ${c1.json?.usageFrom}`)
  const cid = c1.json.id
  ok((await cardNow(cid))?.usageFrom === null, '/api/state gives the card usageFrom null')
  const c2 = await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: 12 })
  ok(c2.status === 200 && c2.json.usageFrom === 12 && (await cardNow(cid))?.usageFrom === 12, `usageFrom 12 is saved and read back (${c2.status}, ${c2.json?.usageFrom})`)
  const c3 = await U('PUT', `/api/cards/${cid}`, { ...CARD, name: 'RC1 card b', billingDay: 14 })
  const kept3 = await cardNow(cid)
  ok(c3.status === 200 && c3.json.usageFrom === 12 && kept3.usageFrom === 12 && kept3.name === 'RC1 card b' && kept3.billingDay === 14 && kept3.note === 'memo',
    `an update without usageFrom keeps the saved one (${c3.json?.usageFrom}) and writes the rest (${kept3?.name}, ${kept3?.billingDay})`)
  for (const v of [1, 31]) {
    const r = await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: v })
    ok(r.status === 200 && r.json.usageFrom === v && (await cardNow(cid))?.usageFrom === v, `usageFrom ${v} is stored as ${r.json?.usageFrom}`)
  }
  for (const v of [0, 32, 1.5, -1, '12']) {
    const up = await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: v })
    const mk2 = await U('POST', '/api/cards', { ...CARD, name: 'RC1 bad card', usageFrom: v })
    ok(up.status === 400 && typeof up.json?.error === 'string' && mk2.status === 400, `usageFrom ${JSON.stringify(v)}: update → ${up.status} with a message, create → ${mk2.status}`)
  }
  const afterBad = await state()
  ok((afterBad.cards.find((c) => c.id === cid))?.usageFrom === 31 && afterBad.cards.length === 1, 'the refused bodies left the card as it was and made no card')
  const c4 = await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: null })
  ok(c4.status === 200 && c4.json.usageFrom === null && (await cardNow(cid))?.usageFrom === null, `usageFrom null clears it (${c4.status}, ${c4.json?.usageFrom})`)
  const c5 = await U('POST', '/api/cards', { ...CARD, name: 'RC1 card 2', billingDay: 1, usageFrom: 18 })
  ok(c5.status === 201 && c5.json.usageFrom === 18, `a new card with usageFrom 18 → ${c5.status}, ${c5.json?.usageFrom}`)
  // mcp
  ok((await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: 12 })).status === 200, 'usage: the first card back to 12 for the tools')
  const la = await tool(kRead, 'list_accounts', { months: 1 })
  const laCards = la.data?.cards ?? []
  ok(!la.failed && laCards.find((c) => c.id === cid)?.usageFrom === 12 && laCards.find((c) => c.id === c5.json.id)?.usageFrom === 18 && laCards.find((c) => c.id === cid)?.billingDay === 25,
    `list_accounts: every card carries usageFrom (${laCards.map((c) => c.usageFrom)})`)
  const pSet = await apply([{ resource: 'cards', action: 'update', id: cid, data: { ...CARD, usageFrom: 20 } }])
  ok(!pSet.failed && (await cardNow(cid))?.usageFrom === 20, `propose_changes with usageFrom 20, applied: ${(await cardNow(cid))?.usageFrom}`)
  const pKeep = await apply([{ resource: 'cards', action: 'update', id: cid, data: { ...CARD, name: 'RC1 card c' } }])
  const kept4 = await cardNow(cid)
  ok(!pKeep.failed && kept4?.usageFrom === 20 && kept4.name === 'RC1 card c', `propose_changes without usageFrom keeps it (${kept4?.usageFrom}) and writes the rest (${kept4?.name})`)
  const pBadU = await tool(kChat, 'propose_changes', { changes: [{ resource: 'cards', action: 'update', id: cid, data: { ...CARD, usageFrom: 32 } }] })
  const pBadU2 = await tool(kChat, 'propose_changes', { changes: [{ resource: 'cards', action: 'create', data: { ...CARD, name: 'RC1 bad card', usageFrom: 0 } }] })
  ok(pBadU.failed && pBadU2.failed && (await cardNow(cid))?.usageFrom === 20 && (await state()).cards.length === 2, 'propose_changes refuses usageFrom 32 and 0')
  const pNull = await apply([{ resource: 'cards', action: 'update', id: cid, data: { ...CARD, usageFrom: null } }])
  ok(!pNull.failed && (await cardNow(cid))?.usageFrom === null, `propose_changes with usageFrom null clears it (${(await cardNow(cid))?.usageFrom})`)
  // revert: a change of usageFrom goes back
  ok((await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: 12 })).status === 200 && (await U('PUT', `/api/cards/${cid}`, { ...CARD, usageFrom: 25 })).status === 200, 'usage revert: 12, then a change to 25')
  const uSet = await lastSet()
  const urv = await U('POST', `/api/changes/${uSet.id}/revert`)
  ok(urv.status === 200 && (await cardNow(cid))?.usageFrom === 12, `usage revert: the change is reverted → ${urv.status}, usageFrom back to ${(await cardNow(cid))?.usageFrom}`)
  // a card change logged before the column existed (no usageFrom in the logged rows) still reverts, and leaves usageFrom
  ok((await U('PUT', `/api/cards/${cid}`, { ...CARD, name: 'RC1 card old log' })).status === 200, 'usage revert: a name change')
  const oSet = await lastSet()
  const stripped = await sql.begin(async (q) => {
    await q`select set_config('app.user_id', ${uid}, true)`
    const r = await q`update change_log set before = before - 'usageFrom', after = after - 'usageFrom'
      where user_id = ${uid} and set_id = ${oSet.id} and table_name = 'card' and op = 'update'`
    return r.count
  })
  ok(stripped === 1, `usage revert: the logged rows of set ${oSet.id.slice(0, 8)} hold no usageFrom, as 0.1.9 logged a card`)
  ok((await U('PUT', `/api/cards/${cid}`, { ...CARD, name: 'RC1 card old log', usageFrom: 15 })).status === 200, 'usage revert: then usageFrom alone changes to 15')
  const orv = await U('POST', `/api/changes/${oSet.id}/revert`)
  const back = await cardNow(cid)
  ok(orv.status === 200 && back?.name === 'RC1 card' && back.usageFrom === 15, `usage revert: the old set is reverted → ${orv.status}, the name is back (${back?.name}) and usageFrom stays ${back?.usageFrom}`)

  // ── basis: what a month is (W-3) ──
  const month = (x) => [x?.monthBasis, x?.monthBasisCardId, x?.monthNaming].join('/')
  const monthNow = async () => month((await state()).settings)
  const mcols = await sql`select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'settings' and column_name in ('month_basis', 'month_basis_card_id', 'month_naming') order by 1`
  const mcons = await sql`select conname from pg_constraint where conname in ('settings_month_basis', 'settings_month_naming', 'settings_month_basis_card_fk') order by 1`
  ok(mcols.map((c) => `${c.column_name} ${c.data_type} ${c.is_nullable} ${c.column_default}`).join('; ')
    === "month_basis text NO 'calendar'::text; month_basis_card_id text YES null; month_naming text NO 'auto'::text" && mcons.length === 3,
    `settings has the three month columns with their defaults, the two checks and the card foreign key (${mcons.map((c) => c.conname)})`)
  ok(await monthNow() === 'calendar//auto', `a settings row saved only by bodies without the three keys reads calendar, no card, auto (${await monthNow()})`)
  // an account that never saved its settings gets the same from the defaults
  const emailV = `rc1-v-${Date.now()}@example.com`
  const cv = await A('POST', '/api/auth/admin/create-user', { email: emailV, password: PASS, name: 'RC1 V', role: 'user' })
  ok(cv.status === 200, `create V → ${cv.status}`)
  const vid = cv.json.user.id
  made.push({ id: vid, email: emailV })
  const V = client()
  ok((await V.signIn(emailV, PASS)).status === 200, 'V signs in')
  ok(month((await V('GET', '/api/state')).json.settings) === 'calendar//auto', 'an account without a settings row reads calendar, no card, auto')

  const MCARD = { name: 'RC1 basis card', last4: '', accountId: null, billingDay: 25, usageFrom: 12 }
  const b1 = (await U('POST', '/api/cards', MCARD)).json.id
  const b2 = (await U('POST', '/api/cards', { ...MCARD, name: 'RC1 basis card 2', usageFrom: null })).json.id
  ok(!!b1 && !!b2, 'basis: two cards of U')
  const m1 = await put({ ...BODY, monthBasis: 'card', monthBasisCardId: b1, monthNaming: 'end' })
  ok(m1.status === 200 && month(m1.json) === `card/${b1}/end` && await monthNow() === `card/${b1}/end`, `the three keys are saved and read back (${m1.status}, ${month(m1.json).replace(b1, 'b1')})`)
  const m2 = await put(BODY)
  ok(m2.status === 200 && month(m2.json) === `card/${b1}/end` && m2.json.netPay === BODY.netPay, 'a body in the 0.1.9 shape keeps the three and writes the rest')
  const m3 = await put({ ...BODY, monthNaming: 'start' })
  ok(m3.status === 200 && month(m3.json) === `card/${b1}/start`, 'monthNaming alone changes that key only')
  const m4 = await put({ ...BODY, monthBasis: 'pay' })
  ok(m4.status === 200 && month(m4.json) === `pay/${b1}/start`, 'monthBasis alone changes that key only: the card stays under another basis')
  const m5 = await put({ ...BODY, monthBasisCardId: b2 })
  ok(m5.status === 200 && month(m5.json) === `pay/${b2}/start`, 'monthBasisCardId alone changes that key only (a card without a first day is taken)')
  const m6 = await put({ ...(await state()).settings })
  ok(m6.status === 200 && month(m6.json) === `pay/${b2}/start`, 'the whole row sent back, as the screen does, keeps them')
  for (const monthBasis of ['calendar', 'card', 'pay']) {
    for (const monthNaming of ['auto', 'start', 'end']) {
      const r = await put({ ...BODY, monthBasis, monthNaming })
      ok(r.status === 200 && month(r.json) === `${monthBasis}/${b2}/${monthNaming}`, `${monthBasis} + ${monthNaming} → ${r.status}`)
    }
  }
  const m7 = await put({ ...BODY, monthBasis: 'card', monthBasisCardId: null, monthNaming: 'auto' })
  ok(m7.status === 200 && month(m7.json) === 'card//auto', `null clears the card, also under the card basis (${m7.status}, ${month(m7.json)})`)
  ok((await put({ ...BODY, monthBasis: 'card', monthBasisCardId: b1, monthNaming: 'end' })).status === 200, 'basis: back to card / b1 / end')
  // refused values
  for (const [k, bads] of [['monthBasis', ['salary', '', null, 1]], ['monthNaming', ['middle', '', null, 15]], ['monthBasisCardId', ['', 12, true]]]) {
    const got = []
    for (const bad of bads) {
      const r = await put({ ...BODY, [k]: bad })
      got.push(r.status === 400 && typeof r.json?.error === 'string' ? 400 : `${r.status}!`)
    }
    ok(got.every((x) => x === 400), `${k}: ${bads.map((b) => JSON.stringify(b)).join(', ')} → ${got.join(', ')} with a message`)
  }
  const EN = { 'accept-language': 'en' }
  const LINK = 'A linked item could not be found.'
  const gone = await U('PUT', '/api/settings', { ...BODY, monthBasisCardId: 'no-such-card' }, EN)
  ok(gone.status === 400 && gone.json?.error === LINK, `a card id that does not exist → ${gone.status} "${gone.json?.error}"`)
  const vCard = await V('POST', '/api/cards', { ...MCARD, name: 'RC1 V card' })
  ok(vCard.status === 201, `V makes a card → ${vCard.status}`)
  const others = await U('PUT', '/api/settings', { ...BODY, monthBasisCardId: vCard.json.id }, EN)
  ok(others.status === 400 && others.json?.error === LINK, `another user's card id → ${others.status} "${others.json?.error}"`)
  const pBadM = await tool(kChat, 'propose_changes', { changes: [{ resource: 'settings', action: 'update', data: { ...BODY, monthBasis: 'salary' } }] })
  const pBadM2 = await apply([{ resource: 'settings', action: 'update', data: { ...BODY, monthBasisCardId: vCard.json.id } }])
  ok(pBadM.failed && pBadM2.failed, 'propose_changes refuses an unknown basis, and another user\'s card is not applied')
  ok(await monthNow() === `card/${b1}/end`, 'the refused bodies left the row as it was')

  // a card that is not the basis card goes without touching the settings
  const del2 = await U('DELETE', `/api/cards/${b2}`)
  const set2d = await lastSet()
  const logs2 = (await U('GET', `/api/changes/${set2d.id}`)).json.changes
  ok(del2.status === 204 && await monthNow() === `card/${b1}/end` && logs2.length === 1 && logs2[0].tableName === 'card', `deleting another card → ${del2.status}, the settings stay and the set holds the card alone`)
  // a card's insert is not reverted while it is the basis card
  const b3 = (await U('POST', '/api/cards', { ...MCARD, name: 'RC1 basis card 3', usageFrom: 18 })).json.id
  const insSet = await lastSet()
  ok((await put({ ...BODY, monthBasisCardId: b3 })).status === 200, 'basis: the new card b3 is the basis card')
  const rvIns = await U('POST', `/api/changes/${insSet.id}/revert`)
  ok(rvIns.status === 409 && (await state()).cards.some((c) => c.id === b3) && await monthNow() === `card/${b3}/end`, `reverting the insert of the basis card → ${rvIns.status}, the card and the basis stay`)
  // deleting the basis card: not refused, the basis goes back to calendar in the same change set
  const delB = await U('DELETE', `/api/cards/${b3}`)
  ok(delB.status === 204 && await monthNow() === 'calendar//end' && !(await state()).cards.some((c) => c.id === b3), `deleting the basis card → ${delB.status}, the settings are ${await monthNow()}`)
  const delSet = await lastSet()
  const delLogs = (await U('GET', `/api/changes/${delSet.id}`)).json.changes
  const sLog = delLogs.find((c) => c.tableName === 'settings')
  ok(delLogs.length === 2 && delLogs.some((c) => c.tableName === 'card' && c.op === 'delete') && sLog?.op === 'update'
    && sLog.before.monthBasis === 'card' && sLog.before.monthBasisCardId === b3 && sLog.after.monthBasis === 'calendar' && sLog.after.monthBasisCardId === null,
    'the change set of the delete holds the card and the settings row, before and after')
  const rvDel = await U('POST', `/api/changes/${delSet.id}/revert`)
  ok(rvDel.status === 200 && (await state()).cards.some((c) => c.id === b3) && await monthNow() === `card/${b3}/end`, `reverting the delete → ${rvDel.status}: the card is back and the basis is card / b3 again`)
  // a card kept under another basis is only let go: the basis stays
  ok((await put({ ...BODY, monthBasis: 'pay' })).status === 200 && await monthNow() === `pay/${b3}/end`, 'basis: pay, the card b3 kept')
  const delP = await U('DELETE', `/api/cards/${b3}`)
  ok(delP.status === 204 && await monthNow() === 'pay//end', `deleting a card kept under the pay basis → ${delP.status}, the settings are ${await monthNow()}`)
  // a proposal that deletes the basis card does the same (and one that sets the keys)
  const pSetM = await apply([{ resource: 'settings', action: 'update', data: { ...BODY, monthBasis: 'card', monthBasisCardId: b1, monthNaming: 'auto' } }])
  ok(!pSetM.failed && await monthNow() === `card/${b1}/auto`, `propose_changes sets the three keys, applied: ${(await monthNow()).replace(b1, 'b1')}`)
  const pDelM = await apply([{ resource: 'cards', action: 'delete', id: b1 }])
  ok(!pDelM.failed && await monthNow() === 'calendar//auto' && !(await state()).cards.some((c) => c.id === b1), `propose_changes deletes the basis card, applied: the settings are ${await monthNow()}`)
  // ── month: the basis applied (W-4) ──
  {
    const p2 = (n) => String(n).padStart(2, '0')
    const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    const ymOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
    // today in the user's zone (the default, Asia/Seoul), as a local date
    const now = new Date(new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'))
    const [y, m, day] = [now.getFullYear(), now.getMonth(), now.getDate()]
    // a pay day with today inside its period: the period runs from the pay day on or before today to the day before the next
    const pay = day === 1 ? 2 : Math.min(day, 28)
    const start = day >= pay ? new Date(y, m, pay) : new Date(y, m - 1, pay)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, pay - 1)
    // named after the month it starts in when the pay day is the 15th or earlier, else after the month it ends in
    const name = ymOf(pay <= 15 ? start : new Date(start.getFullYear(), start.getMonth() + 1, 1))
    const prevName = ymOf(new Date(Number(name.slice(0, 4)), Number(name.slice(5, 7)) - 2, 1))
    const nextName = ymOf(new Date(Number(name.slice(0, 4)), Number(name.slice(5, 7)), 1))
    const from = iso(start)
    const to = iso(end)
    const dayBefore = iso(new Date(start.getFullYear(), start.getMonth(), pay - 1))
    const span = (x) => `${x?.from}~${x?.to}`

    // the rules the earlier sections left are put aside for this one: no date moves, so the period is known here
    const was = (await state()).settings
    const NONE = { payShift: 'none', transferShift: 'none', billingShift: 'none' }
    const setPay = await put({ ...BODY, ...NONE, payDay: pay, monthBasis: 'pay', monthBasisCardId: null, monthNaming: 'auto' })
    ok(setPay.status === 200 && setPay.json.monthBasis === 'pay', `month: the pay basis, pay day ${pay} → ${setPay.status}`)
    const x1 = await U('POST', '/api/income-extras', { date: from, name: 'RC1 first day', amount: 7_000, note: '' })
    const x2 = await U('POST', '/api/income-extras', { date: dayBefore, name: 'RC1 day before', amount: 900, note: '' })
    ok(x1.status === 201 && x2.status === 201, `month: money that came in once on ${from} and on ${dayBefore} → ${x1.status}, ${x2.status}`)

    const ovM = await tool(kRead, 'get_overview', {})
    ok(!ovM.failed && ovM.data?.month === name, `get_overview: the default month is the name of the period that holds today (${ovM.data?.month}, want ${name})`)
    ok(span(ovM.data?.period) === `${from}~${to}`, `get_overview: period is ${span(ovM.data?.period)} (want ${from}~${to})`)
    ok(ovM.data?.dates?.pay?.date === from && ovM.data?.dates?.pay?.nominal === from, `get_overview: the pay date of the month is the period's first day (${ovM.data?.dates?.pay?.date})`)
    const inP = (d) => d >= from && d <= to
    ok(inP(ovM.data?.dates?.transfer?.date) && inP(ovM.data?.dates?.billing?.date), `get_overview: the transfer and billing dates lie in the period (${ovM.data?.dates?.transfer?.date}, ${ovM.data?.dates?.billing?.date})`)
    ok(ovM.data?.income?.totalKrw === BODY.netPay + 7_000, `get_overview: the one-off income of the period's first day counts in the month (${ovM.data?.income?.totalKrw})`)
    ok(ovM.data?.settings?.monthBasis === 'pay' && ovM.data?.settings?.monthNaming === 'auto', 'get_overview: the settings carry the month keys')

    const inc = await tool(kRead, 'get_income', {})
    const names = (d) => (d?.extras ?? []).map((e) => e.name).join(',')
    ok(!inc.failed && inc.data?.month === name && span(inc.data?.period) === `${from}~${to}` && names(inc.data) === 'RC1 first day' && inc.data?.totalKrw === BODY.netPay + 7_000,
      `get_income: month ${inc.data?.month}, period ${span(inc.data?.period)}, extras [${names(inc.data)}], total ${inc.data?.totalKrw}`)
    const incPrev = await tool(kRead, 'get_income', { month: prevName })
    ok(!incPrev.failed && incPrev.data?.period?.to === dayBefore && names(incPrev.data) === 'RC1 day before' && incPrev.data?.totalKrw === BODY.netPay + 900,
      `get_income ${prevName}: its period ends on ${incPrev.data?.period?.to}, the income of the day before counts there (extras [${names(incPrev.data)}], total ${incPrev.data?.totalKrw})`)

    const schM = await tool(kRead, 'get_schedule', { months: 2 })
    const [m0, m1] = schM.data?.months ?? []
    ok(!schM.failed && schM.data?.from === name && m0?.month === name && span(m0?.period) === `${from}~${to}` && m0?.dates?.pay?.date === from,
      `get_schedule: starts with ${schM.data?.from}, period ${span(m0?.period)}, pay date ${m0?.dates?.pay?.date}`)
    const dayAfter = iso(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1))
    ok(m1?.month === nextName && m1?.period?.from === dayAfter && m1?.dates?.pay?.date === dayAfter, `get_schedule: the next month ${m1?.month} starts the day after (${m1?.period?.from}), on its pay date`)

    const bud = await tool(kRead, 'get_budget', {})
    const subsM = await tool(kRead, 'list_subscriptions', {})
    const accM = await tool(kRead, 'list_accounts', { months: 2 })
    const spM = await tool(kRead, 'list_spendings', { month: name })
    ok(bud.data?.month === name && span(bud.data?.period) === `${from}~${to}`, `get_budget: month ${bud.data?.month}, period ${span(bud.data?.period)}`)
    ok(subsM.data?.month === name && span(subsM.data?.period) === `${from}~${to}`, `list_subscriptions: month ${subsM.data?.month}, period ${span(subsM.data?.period)}`)
    const pm = accM.data?.projectionMonths ?? []
    ok(accM.data?.month === name && span(accM.data?.period) === `${from}~${to}` && pm.length === 2 && pm[0].month === name && span(pm[0]) === `${from}~${to}` && pm[1].month === nextName && pm[1].from === dayAfter,
      `list_accounts: month ${accM.data?.month}, period ${span(accM.data?.period)}, projectionMonths ${pm.map((x) => `${x.month} ${span(x)}`).join(' | ')}`)
    ok(spM.data?.month === name && span(spM.data?.period) === `${from}~${to}`, `list_spendings month ${name}: period ${span(spM.data?.period)}`)

    // a proposal's preview starts with this month of the basis, and names the month a one-off income counts in
    const prop = await tool(kChat, 'propose_changes', { note: 'rc1 month', changes: [{ resource: 'income-extras', action: 'create', data: { date: from, name: 'RC1 proposed', amount: 100, note: '' } }] })
    const line = prop.data?.preview?.rows?.[0]?.line ?? ''
    ok(!prop.failed && prop.data?.preview?.months?.[0]?.month === name && prop.data?.preview?.months?.[1]?.month === nextName && line.includes(`left over of ${name}:`),
      `propose_changes: the preview's months are ${(prop.data?.preview?.months ?? []).map((x) => x.month).join(', ')} and the income line says "${line.slice(line.indexOf('left over'))}"`)

    // the server instructions: what a month is, inside the first 512 characters
    const init = await fetch(BASE + '/api/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: ACCEPT, authorization: `Bearer ${kRead}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rc1', version: '1' } } }),
    })
    const instr = (await init.json().catch(() => null))?.result?.instructions ?? ''
    ok(instr.slice(0, 512).includes('A month is the period of the user\'s chosen basis'), `initialize: the instructions say what a month is in their first 512 characters (${instr.length} in all)`)

    // the calendar basis again: the calendar month, and the same income by its date's calendar month
    ok((await put({ ...BODY, ...NONE, payDay: pay, monthBasis: 'calendar' })).status === 200, 'month: back to the calendar basis')
    const cal = ymOf(now)
    const last = new Date(y, m + 1, 0).getDate()
    const ovC = await tool(kRead, 'get_overview', {})
    ok(ovC.data?.month === cal && span(ovC.data?.period) === `${cal}-01~${cal}-${p2(last)}`, `get_overview, calendar basis: month ${ovC.data?.month}, period ${span(ovC.data?.period)}`)
    const incC = await tool(kRead, 'get_income', { month: from.slice(0, 7) })
    ok(names(incC.data).split(',').includes('RC1 first day'), `get_income ${from.slice(0, 7)}, calendar basis: the income of ${from} counts in its calendar month (extras [${names(incC.data)}])`)
    ok(ovC.data?.dates?.pay?.date === `${cal}-${p2(pay)}`, `get_overview, calendar basis: the pay date is day ${pay} of the calendar month (${ovC.data?.dates?.pay?.date})`)
    for (const x of [x1, x2]) await U('DELETE', `/api/income-extras/${x.json.id}`)
    const back = await put({ ...BODY, payShift: was.payShift, transferShift: was.transferShift, billingShift: was.billingShift })
    ok(back.status === 200 && three(back.json) === three(was) && back.json.payDay === BODY.payDay && (await state()).incomeExtras.length === 0, `month: the settings (rules ${three(back.json)}) and the income rows are put back`)
  }

  // an account whose basis is a card can be deleted (the settings row goes before the card)
  ok((await V('PUT', '/api/settings', { ...BODY, monthBasis: 'card', monthBasisCardId: vCard.json.id })).status === 200, 'V counts its month by its card')
  const delV = await A('DELETE', `/api/admin/users/${vid}`, { confirmEmail: emailV })
  ok(delV.status === 204, `the admin deletes V, whose basis is a card → ${delV.status}`)
  made.splice(made.findIndex((u) => u.id === vid), 1)
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
