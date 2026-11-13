// API check for spec 006 V-4 (e)(f), V-7, V-8, V-9 (a), V-11 (a): admin rights, admin actions, guards.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/admin.mjs
// Run on a disposable test database: it creates, bans and deletes accounts, demotes every other
// admin, and stores a fake GitHub client. A is ADMIN_EMAIL (an admin); U is created here.
// The login rate limit (5/min per client) is respected with one pause. Exit 0 only if every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client() {
  let cookie = ''
  const api = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  api.signIn = (email, password) => api('POST', '/api/auth/sign-in/email', { email, password })
  api.forget = () => { cookie = '' }
  return api
}

const A = client()
const U = client()
const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
ok(sa.status === 200, `A sign-in ${sa.status}`)
if (failed) process.exit(1)
const aId = sa.json.user.id

// ── setup: U, a normal user with a password; A becomes the only active admin ──
const uEmail = `v8-${Date.now()}@example.com`
const uPw1 = 'v8-first-pass-1'
const uPw2 = 'v8-second-pass-2'
const created = await A('POST', '/api/auth/admin/create-user', { email: uEmail, password: uPw1, name: 'V8 user', role: 'user' })
ok(created.status === 200, `create-user → ${created.status}`)
const uId = created.json?.user?.id
const listed = await A('GET', '/api/auth/admin/list-users?limit=500')
const uRow = listed.json?.users?.find((x) => x.id === uId)
ok(uRow?.status === 'active' && uRow?.admission === 'admin' && uRow?.role === 'user' && uRow?.emailVerified === true,
  `new account: status ${uRow?.status}, admission ${uRow?.admission}, role ${uRow?.role}, emailVerified ${uRow?.emailVerified}`)
for (const other of (listed.json?.users ?? []).filter((x) => x.role === 'admin' && x.id !== aId)) {
  const r = await A('POST', `/api/admin/users/${other.id}/role`, { role: 'user' })
  ok(r.status === 200, `setup: demote other admin ${other.id} → ${r.status}`)
}
const extra = await A('POST', '/api/auth/admin/create-user', { email: `v8x-${Date.now()}@example.com`, name: 'x', data: { status: 'active' } })
ok(extra.status === 400, `create-user with extra data → ${extra.status} (want 400)`)

// ── V-7 (a): a normal user is refused everywhere admin ──
const su = await U.signIn(uEmail, uPw1)
ok(su.status === 200, `U sign-in ${su.status}`)
for (const [m, p, b] of [
  ['GET', '/api/admin/providers'], ['PUT', '/api/admin/providers/github', { enabled: false }],
  ['DELETE', `/api/admin/users/${aId}`, { confirmEmail: process.env.ADMIN_EMAIL }],
  ['GET', '/api/auth/admin/list-users'], ['POST', `/api/admin/users/${uId}/role`, { role: 'admin' }],
  ['POST', '/api/auth/admin/create-user', { email: 'nope@example.com', name: 'n' }],
  ['POST', `/api/admin/users/${aId}/ban`, {}], ['POST', '/api/auth/admin/set-user-password', { userId: aId, newPassword: 'nope-nope-1' }],
]) {
  const r = await U(m, p, b)
  ok(r.status === 403 || r.status === 401, `U ${m} ${p} → ${r.status} (want 403)`)
}
const uMe = await U('GET', '/api/me')
ok(uMe.json?.user?.role === 'user', 'U is still a user')

// ── review 1 R3: two admins demoting each other at the same moment leave one admin ──
const X = client()
const xEmail = `v8-admin-${Date.now()}@example.com`
const xMade = await A('POST', '/api/auth/admin/create-user', { email: xEmail, password: 'v8-admin-pass-1', name: 'V8 admin', role: 'admin' })
const xId = xMade.json?.user?.id
const sx = await X.signIn(xEmail, 'v8-admin-pass-1')
ok(xMade.status === 200 && sx.status === 200, `second admin X: create ${xMade.status}, sign-in ${sx.status}`)
const [ax, xa] = await Promise.all([
  A('POST', `/api/admin/users/${xId}/role`, { role: 'user' }),
  X('POST', `/api/admin/users/${aId}/role`, { role: 'user' }),
])
// The loser gets 409 (last admin, checked under the lock) or 403 (it was demoted first and is no
// longer an admin by the time its request is checked). Never two 200s.
const winners = [ax.status, xa.status].filter((s) => s === 200).length
const loser = ax.status === 200 ? xa.status : ax.status
ok(winners === 1 && (loser === 409 || loser === 403), `A demotes X while X demotes A → ${ax.status}, ${xa.status} (want one 200, the other 409 or 403)`)
// Ask as whoever is still the admin (review 2, R2-2).
const aIsAdmin = (await A('GET', '/api/me')).json?.user?.role === 'admin'
const survivor = aIsAdmin ? A : X
const left = await survivor('GET', '/api/auth/admin/list-users?limit=500')
const adminsLeft = left.json?.users?.filter((x) => x.role === 'admin' && !x.banned && x.status === 'active').length
ok(left.status === 200 && adminsLeft === 1, `active admins left: ${adminsLeft} (list → ${left.status}; want 200 and 1, asked as ${aIsAdmin ? 'A' : 'X'})`)
if (!aIsAdmin) {
  // X won the race: give A the admin role back through X, so the rest of the run is the same
  const back = await X('POST', `/api/admin/users/${aId}/role`, { role: 'admin' })
  const xDown = await A('POST', `/api/admin/users/${xId}/role`, { role: 'user' })
  ok(back.status === 200 && xDown.status === 200, `restore A as the only admin: ${back.status}, ${xDown.status}`)
}
const xDel = await A('DELETE', `/api/admin/users/${xId}`, { confirmEmail: xEmail })
ok(xDel.status === 204, `X removed → ${xDel.status}`)

// ── V-7 (b): closed admin paths, also for the admin ──
// set-role and ban-user moved to /api/admin (one locked transaction with the last-admin check, review 1 R3)
for (const p of ['/api/auth/admin/impersonate-user', '/api/auth/admin/stop-impersonating', '/api/auth/admin/remove-user', '/api/auth/admin/set-role', '/api/auth/admin/ban-user']) {
  const r = await A('POST', p, { userId: uId })
  ok(r.status === 404 || r.status === 403, `A POST ${p} → ${r.status} (want 404)`)
}

// ── V-7 (c): admin answers carry no data-table columns ──
const providers = await A('GET', '/api/admin/providers')
ok(providers.status === 200, `GET /api/admin/providers → ${providers.status}`)
const adminText = listed.text + providers.text
const leaked = ['net_pay', 'netPay', 'fxRate', 'amount', 'allowance', 'inflow', 'outflow'].filter((k) => adminText.includes(k))
ok(leaked.length === 0, `admin answers without data columns (found: ${leaked.join(', ') || 'none'})`)

// ── V-8 (a): field rules, password reset ends sessions ──
const badRole = await A('POST', '/api/auth/admin/update-user', { userId: uId, data: { role: 'admin' } })
ok(badRole.status === 400, `update-user role → ${badRole.status} (want 400)`)
const badStatus = await A('POST', '/api/auth/admin/update-user', { userId: uId, data: { status: 'pending' } })
ok(badStatus.status === 400, `update-user status pending → ${badStatus.status} (want 400)`)
const rename = await A('POST', '/api/auth/admin/update-user', { userId: uId, data: { name: 'V8 renamed' } })
ok(rename.status === 200 && rename.json?.name === 'V8 renamed', `update-user name → ${rename.status}`)
const toAdmin = await A('POST', `/api/admin/users/${uId}/role`, { role: 'admin' })
const toUser = await A('POST', `/api/admin/users/${uId}/role`, { role: 'user' })
ok(toAdmin.status === 200 && toUser.status === 200, `set-role admin → user: ${toAdmin.status}, ${toUser.status}`)
const badRoleName = await A('POST', `/api/admin/users/${uId}/role`, { role: 'owner' })
ok(badRoleName.status === 400, `set-role owner → ${badRoleName.status} (want 400)`)
// U gets some data, so the delete below has rows to remove
const uSettings = await U('PUT', '/api/settings', { netPay: 1000000, fxRate: 1400, fxBuffer: 3, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10000 })
const uSub = await U('POST', '/api/subscriptions', { name: 'V8-sub', category: 'tool', plan: 'p', amount: 1, currency: 'USD', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false })
ok(uSettings.status === 200 && (uSub.status === 200 || uSub.status === 201), `U writes data: settings ${uSettings.status}, subscription ${uSub.status}`)
// V-7 (d): the admin's own /api/state never holds U's rows
const aState = await A('GET', '/api/state')
ok(aState.status === 200 && !aState.text.includes('V8-sub') && !aState.text.includes(uSub.json?.id ?? 'no-id') && aState.json?.settings?.netPay !== 1000000,
  `(V-7 d) admin /api/state → ${aState.status}, without U's subscription or settings`)
const reset = await A('POST', '/api/auth/admin/set-user-password', { userId: uId, newPassword: uPw2 })
ok(reset.status === 200, `set-user-password → ${reset.status}`)
const afterReset = await U('GET', '/api/me')
ok(afterReset.status === 401, `U's old session after reset → ${afterReset.status} (want 401)`)
const oldPw = await U.signIn(uEmail, uPw1)
ok(oldPw.status === 401, `U old password → ${oldPw.status} (want 401)`)

console.log('… waiting 61s for the login rate limit')
await sleep(61_000)
const newPw = await U.signIn(uEmail, uPw2)
ok(newPw.status === 200, `U new password → ${newPw.status}`)

// ── V-8 (b): ban, unban ──
const ban = await A('POST', `/api/admin/users/${uId}/ban`, { reason: 'test' })
ok(ban.status === 200, `ban-user → ${ban.status}`)
const bannedSession = await U('GET', '/api/me')
ok(bannedSession.status === 401, `U session after ban → ${bannedSession.status} (want 401)`)
U.forget()
const bannedSignIn = await U.signIn(uEmail, uPw2)
ok(bannedSignIn.status === 403 && bannedSignIn.json?.code === 'BANNED_USER', `U sign-in while banned → ${bannedSignIn.status} ${bannedSignIn.json?.code ?? ''}`)
const unban = await A('POST', '/api/auth/admin/unban-user', { userId: uId })
const back = await U.signIn(uEmail, uPw2)
ok(unban.status === 200 && back.status === 200, `unban → ${unban.status}, sign-in → ${back.status}`)

// ── V-8 (c): the last admin and oneself ──
const demoteLast = await A('POST', `/api/admin/users/${aId}/role`, { role: 'user' })
ok(demoteLast.status === 409, `demote the last admin → ${demoteLast.status} (want 409)`)
const banSelf = await A('POST', `/api/admin/users/${aId}/ban`, {})
ok(banSelf.status === 409, `ban oneself → ${banSelf.status} (want 409)`)
const delSelf = await A('DELETE', `/api/admin/users/${aId}`, { confirmEmail: process.env.ADMIN_EMAIL })
ok(delSelf.status === 409, `delete oneself → ${delSelf.status} (want 409)`)
const aStill = await A('GET', '/api/me')
ok(aStill.json?.user?.role === 'admin', 'A is still admin')

// ── V-9 (a): password cannot go off while no admin has another login ──
const pwOff = await A('PUT', '/api/admin/providers/password', { enabled: false })
ok(pwOff.status === 409, `password off with no admin external login → ${pwOff.status} (want 409)`)

// ── V-4 (e): a bad discovery URL is refused and nothing changes ──
const before = (await A('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'oidc')
// complete otherwise, so the discovery fetch is what fails
const badDisc = await A('PUT', '/api/admin/providers/oidc', { enabled: true, options: { clientId: 'v4e', discoveryUrl: 'http://127.0.0.1:9/nothing' }, clientSecret: 'v4e-secret' })
// 409 would mean an env lock stopped it before the discovery check ran: that proves nothing (review 1 R7)
ok(badDisc.status === 400 && badDisc.json?.path === 'options.discoveryUrl', `bad discovery URL → ${badDisc.status} ${badDisc.json?.path ?? ''} (want 400 on options.discoveryUrl)`)
const afterDisc = (await A('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'oidc')
ok(JSON.stringify(before) === JSON.stringify(afterDisc), 'OIDC settings unchanged')

// ── V-11 (a): a client secret is stored, never shown ──
const SECRET = `v11-secret-${Date.now()}`
const gh = await A('PUT', '/api/admin/providers/github', { options: { clientId: 'v11-client' }, clientSecret: SECRET })
ok(gh.status === 200 && gh.json?.secretSet === true, `github secret stored → ${gh.status}, secretSet ${gh.json?.secretSet}`)
const all = await A('GET', '/api/admin/providers')
ok(!all.text.includes(SECRET) && !gh.text.includes(SECRET), 'the secret is in no admin answer')
const unknownField = await A('PUT', '/api/admin/providers/github', { options: { discoveryUrl: 'https://x.example' } })
ok(unknownField.status === 400, `OIDC-only option on github → ${unknownField.status} (want 400)`)
const wipe = await A('PUT', '/api/admin/providers/github', { clientSecret: null })
ok(wipe.status === 200 && wipe.json?.secretSet === false, `secret removed → ${wipe.status}, secretSet ${wipe.json?.secretSet}`)

// ── V-4 (f): the public list holds ids and names only ──
const methods = await fetch(BASE + '/api/auth-methods').then((r) => r.text())
ok(!/clientId|client_id|discovery|secret|rules|groups/i.test(methods), `public methods without settings: ${methods}`)

// ── V-8 (d): full delete ──
const wrong = await A('DELETE', `/api/admin/users/${uId}`, { confirmEmail: 'someone@example.com' })
ok(wrong.status === 400, `delete with the wrong email → ${wrong.status} (want 400)`)
const del = await A('DELETE', `/api/admin/users/${uId}`, { confirmEmail: uEmail.toUpperCase() })
ok(del.status === 204, `delete → ${del.status}`)
const gone = (await A('GET', '/api/auth/admin/list-users?limit=500')).json?.users?.some((x) => x.id === uId)
ok(gone === false, 'U is no longer listed')
const uAfter = await U('GET', '/api/me')
ok(uAfter.status === 401, `U's session after delete → ${uAfter.status} (want 401)`)
console.log(`deleted user id: ${uId}`)

console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
