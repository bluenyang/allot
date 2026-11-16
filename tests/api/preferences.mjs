// API check for spec 007 V-5 (a)–(c) and V-3 (c), (d): display settings and holiday sets.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… B_EMAIL=… B_PASSWORD=… node tests/api/preferences.mjs
// A is the seeded account; B a second account (tests/api/make-user.ts). Every value A and B had is
// put back at the end (in finally) and checked. Exit code 0 only when every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'

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

const before = (await A('GET', '/api/state')).json
const prefs0 = before.preferences
const settings0 = before.settings
const bBefore = (await B('GET', '/api/state')).json
ok(!!prefs0 && Array.isArray(before.holidaySets) && 'dayShift' in settings0, '/api/state has preferences, holidaySets, settings.dayShift')
const made = []
try {
  // (a) PUT → state, and the rules refuse bad input without touching the row
  const want = { themeMode: 'dark', primary: '#1f5f8b', accent: '#7A5AB8', radius: 'sharp', density: 'compact', dateFormat: 'dot', amountUnit: 'man', negative: 'paren', language: 'en' }
  const put = await A('PUT', '/api/preferences', want)
  ok(put.status === 200 && put.json.primary === '#1F5F8B', `PUT /api/preferences → ${put.status}, colour stored upper-case (${put.json?.primary})`)
  const read = (await A('GET', '/api/state')).json.preferences
  ok(JSON.stringify(read) === JSON.stringify({ ...want, primary: '#1F5F8B' }), '/api/state answers what was saved')
  for (const [why, bad] of [
    ['colour #12345', { ...want, primary: '#12345' }],
    ['unknown theme', { ...want, themeMode: 'sepia' }],
    ['unknown unit', { ...want, amountUnit: 'billion' }],
    ['extra key', { ...want, font: 'x' }],
    ['missing key', { ...want, negative: undefined }],
    ['unknown language', { ...want, language: 'fr' }],
  ]) {
    const r = await A('PUT', '/api/preferences', bad)
    ok(r.status === 400, `${why} → ${r.status} (want 400)`)
  }
  const still = (await A('GET', '/api/state')).json.preferences
  ok(still.primary === '#1F5F8B' && still.themeMode === 'dark', 'refused writes left the row as it was')

  // settings.dayShift: set, kept when a client leaves it out, refused when unknown
  const { dayShift: _d, ...plain } = settings0
  const s1 = await A('PUT', '/api/settings', { ...plain, dayShift: 'before' })
  const s2 = await A('PUT', '/api/settings', plain)
  const s3 = await A('PUT', '/api/settings', { ...plain, dayShift: 'sideways' })
  ok(s1.json?.dayShift === 'before' && s2.json?.dayShift === 'before' && s3.status === 400,
    `dayShift: set ${s1.json?.dayShift}, kept when omitted ${s2.json?.dayShift}, unknown → ${s3.status}`)

  // V-3 (c): rules the API refuses
  const set = (rules, extra = {}) => ({ name: 'V5-set', enabled: true, builtin: null, rules, ...extra })
  for (const [why, body] of [
    ['RSCALE=CHINESE', set([{ name: 'x', rrule: 'RSCALE=CHINESE;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1' }])],
    ['RSCALE=HEBREW', set([{ name: 'x', rrule: 'RSCALE=HEBREW;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1' }])],
    ['FREQ=MONTHLY', set([{ name: 'x', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1' }])],
    ['broken RRULE', set([{ name: 'x', rrule: 'FREQ=YEARLY;BYMONTH=13;BYMONTHDAY=1' }])],
    ['DANGI leap month', set([{ name: 'x', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=5L;BYMONTHDAY=1' }])],
    ['DANGI with BYDAY', set([{ name: 'x', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYDAY=MO' }])],
    ['no rule and no date', set([{ name: 'x' }])],
    ['0 rules', set([])],
    ['101 rules', set(Array.from({ length: 101 }, (_, i) => ({ name: `r${i}`, rdate: ['2031-01-02'] })))],
    ['bad date', set([{ name: 'x', rdate: ['2031-02-30'] }])],
    ['built-in with rules', set([{ name: 'x', rdate: ['2031-01-02'] }], { builtin: 'kr' })],
    ['unknown built-in', set([], { builtin: 'us' })],
  ]) {
    const r = await A('POST', '/api/holiday-sets', body)
    ok(r.status === 400, `${why} → ${r.status} (want 400)${r.status === 400 ? '' : ' ' + JSON.stringify(r.json)}`)
    if (r.status === 201) made.push(r.json.id)
  }
  const good = await A('POST', '/api/holiday-sets', set([
    { name: '양력', rrule: 'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17' },
    { name: '음력', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=-1', substitute: { on: ['SU'], since: 2014 } },
    { name: '하루', rdate: ['2031-01-02'] },
  ]))
  ok(good.status === 201, `a valid set (Gregorian, DANGI, RDATE) → ${good.status}`)
  if (good.status === 201) made.push(good.json.id)
  const builtinOff = await A('POST', '/api/holiday-sets', set([], { name: '대한민국 공휴일', builtin: 'kr', enabled: false }))
  const builtinTwice = await A('POST', '/api/holiday-sets', set([], { name: '대한민국 공휴일', builtin: 'kr', enabled: true }))
  ok((builtinOff.status === 201 || before.holidaySets.some((h) => h.builtin === 'kr')) && builtinTwice.status === 400,
    `built-in set row once (${builtinOff.status}), a second row for it → ${builtinTwice.status} (want 400)`)
  if (builtinOff.status === 201) made.push(builtinOff.json.id)

  // (b) B cannot see or change A's rows
  const bState = (await B('GET', '/api/state')).json
  ok(!JSON.stringify(bState.holidaySets).includes('V5-set') && bState.preferences.primary !== '#1F5F8B', 'B sees neither A\'s sets nor A\'s colours')
  if (good.status === 201) {
    const bPut = await B('PUT', `/api/holiday-sets/${good.json.id}`, set([{ name: 'x', rdate: ['2031-01-03'] }], { name: 'B-took-it' }))
    const bDel = await B('DELETE', `/api/holiday-sets/${good.json.id}`)
    const aStill = (await A('GET', '/api/state')).json.holidaySets.find((h) => h.id === good.json.id)
    ok(bPut.status === 404 && bDel.status === 404 && aStill?.name === 'V5-set', `B PUT ${bPut.status}, DELETE ${bDel.status} on A's set (want 404); A's set unchanged`)
  }
  const bPref = await B('PUT', '/api/preferences', { ...want, primary: '#3A4540' })
  const aAfterB = (await A('GET', '/api/state')).json.preferences
  ok(bPref.status === 200 && aAfterB.primary === '#1F5F8B', `B's own PUT (${bPref.status}) leaves A's colour as it was`)

  // (c) each write is one change set; reverting the preference write brings the old value back
  const sets = (await A('GET', '/api/changes?limit=20')).json
  const prefSet = sets.find((x) => x.changes.some((c) => c.tableName === 'preference'))
  const holSet = sets.find((x) => x.changes.some((c) => c.tableName === 'holiday_set'))
  ok(!!prefSet && !!holSet, 'preference and holiday_set writes are in the change history')
  const p2 = await A('PUT', '/api/preferences', { ...want, primary: '#2E3F6E' })
  const last = (await A('GET', '/api/changes?limit=1')).json[0]
  ok(p2.status === 200 && last.changes.length === 1 && last.changes[0].tableName === 'preference', 'one PUT = one set with one row change')
  const rv = await A('POST', `/api/changes/${last.id}/revert`)
  const afterRevert = (await A('GET', '/api/state')).json.preferences
  ok(rv.status === 200 && afterRevert.primary === '#1F5F8B', `revert → ${rv.status}, colour back to ${afterRevert.primary}`)
} finally {
  for (const id of made) await A('DELETE', `/api/holiday-sets/${id}`)
  await A('PUT', '/api/preferences', prefs0)
  await A('PUT', '/api/settings', settings0)
  const end = (await A('GET', '/api/state')).json
  ok(JSON.stringify(end.preferences) === JSON.stringify(prefs0) && end.settings.dayShift === settings0.dayShift
    && end.holidaySets.length === before.holidaySets.length, 'A is back to what it had')
  await B('PUT', '/api/preferences', bBefore.preferences)
  const bEnd = (await B('GET', '/api/state')).json
  ok(JSON.stringify(bEnd.preferences) === JSON.stringify(bBefore.preferences) && bEnd.holidaySets.length === bBefore.holidaySets.length, 'B is back to what it had')
}
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
