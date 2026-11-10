// API check for spec 001 V-4, V-5, V-8 and spec 003 V-4: auth, CRUD on every resource, phase overlap, allocation targets.
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
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }

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

async function signIn() {
  const r = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  ok(r.status === 200, `sign-in → ${r.status}`)
  if (r.status !== 200) process.exit(1)
}

const MARK = 'V8-marker'
const sub = { name: MARK, category: 'tool', plan: 'p', amount: 1.5, currency: 'USD', vat: 10, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false, note: 'n' }

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
  ids.split = await created('/api/remainder-split', { name: MARK, code: 'X', ratio: 0 }, { ratio: 0.5 })

  // Target rules (spec 003 S-1). The seeded data must have one of each non-fixed kind;
  // if it does not, the rule checks below cannot run, and that is a failure, not a skip.
  const byKind = (k) => before.json.targets.find((t) => t.kind === k)
  const living = byKind('living'), subsT = byKind('subscriptions'), rem = byKind('remainder')
  ok(!!living && !!subsT && !!rem, 'seed has one living, one subscriptions and one remainder target (needed for the rule checks)')
  for (const k of ['living', 'subscriptions', 'remainder']) {
    const dup = await api('POST', '/api/targets', { name: `${MARK}-dup`, kind: k })
    ok(dup.status === 400, `second '${k}' target → ${dup.status} (want 400) ${dup.json?.error ?? ''}`)
  }
  const delRem = await api('DELETE', `/api/targets/${rem?.id}`)
  ok(delRem.status === 400, `delete the remainder target → ${delRem.status} (want 400)`)
  const { id: _rid, ...remBody } = rem ?? {}
  const kindChange = await api('PUT', `/api/targets/${rem?.id}`, { ...remBody, kind: 'fixed' })
  ok(kindChange.status === 400, `change the remainder target's kind → ${kindChange.status} (want 400)`)
  const amtOnLiving = await api('PUT', `/api/phases/${ids.phase}`, { label: 'V', name: `${MARK}-2`, from: '2090-01', to: '2090-12', amounts: { [living?.id]: 1 } })
  ok(amtOnLiving.status === 400, `phase amount on a non-fixed target → ${amtOnLiving.status} (want 400)`)

  // Race (review #2): a phase write giving target X an amount, against X changing kind away
  // from 'fixed'. Free the 'subscriptions' kind for the test by making that target fixed
  // for a moment, race 15 times, then check no amount sits on a non-fixed target.
  if (subsT) {
    const { id: subsId, ...subsBody } = subsT
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
  } else {
    for (const [path, id] of [['/api/plan-changes', ids.chg], ['/api/subscriptions', ids.sub], ['/api/phases', ids.phase], ['/api/events', ids.event], ['/api/checks', ids.check], ['/api/accounts', ids.account], ['/api/debts', ids.debt], ['/api/remainder-split', ids.split], ['/api/targets', ids.target], ['/api/phases', ids.racePhase]]) {
      if (!id) continue
      const d = await api('DELETE', `${path}/${id}`)
      ok(d.status === 204, `DELETE ${path}/:id → ${d.status}`)
    }
    // after the marker phase is gone, so the restored open phase does not overlap it
    for (const p of ids.openPhases ?? []) {
      const { id, ...rest } = p
      const r = await api('PUT', `/api/phases/${id}`, rest)
      ok(r.status === 200 && r.json.to === null, `restore open phase ${p.label} → ${r.status}`)
    }
    const again = await api('GET', '/api/state')
    const left = Object.values(again.json).flatMap((v) => (Array.isArray(v) ? v : [])).filter((x) => JSON.stringify(x).includes(MARK))
    ok(left.length === 0, `no marker rows left (${left.length})`)
    const s = await api('PUT', '/api/settings', ids.settings)
    const l = await api('PUT', '/api/living', ids.living)
    ok(s.status === 200 && l.status === 200, 'settings/living restored')
  }
}

console.log(failed === 0 ? `\nALL PASS (${phase})` : `\n${failed} FAILED (${phase})`)
process.exit(failed === 0 ? 0 : 1)
