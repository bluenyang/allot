// API check for spec 006 V-4: login-method settings (defaults, change without restart, off, env lock,
// bad discovery, the public list).
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… DISCOVERY=<Dex discovery URL> DEX_CLIENT_SECRET=… \
//     [LOCKED=github] node tests/api/login-methods.mjs
// Start the api on a database with no auth_provider rows and no AUTH_* env, except, with LOCKED=github,
// AUTH_GITHUB_CLIENT_ID set (for the env-lock check). Exit 0 only if every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE
let cookie = ''
async function api(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  // anonymous calls (extra.cookie === '') must not replace the admin's session cookie
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length && extra.cookie === undefined) cookie = set.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text, headers: res.headers }
}
const methods = async () => (await (await fetch(BASE + '/api/auth-methods')).json()).methods.map((m) => m.id)

if (process.env.LOCKED === 'github') {
  // (d) env wins and locks: run with AUTH_GITHUB_CLIENT_ID set
  ok((await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status === 200, 'admin sign-in')
  const before = (await api('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'github')
  ok(before.source.clientId === 'env', `github clientId source: ${before.source.clientId} (want env)`)
  const r = await api('PUT', '/api/admin/providers/github', { options: { clientId: 'from-the-screen' } })
  ok(r.status === 409 && JSON.stringify(r.json?.fields) === '["clientId"]', `(d) change an env field → ${r.status} ${JSON.stringify(r.json?.fields ?? null)} (want 409 ["clientId"])`)
  const after = (await api('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'github')
  ok(after.values.clientId === before.values.clientId && after.values.clientId !== 'from-the-screen', '(d) the value is unchanged')
  const free = await api('PUT', '/api/admin/providers/github', { signup: 'approval' })
  ok(free.status === 200, `(d) a field env does not set can still change → ${free.status}`)
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
  process.exit(failed ? 1 : 0)
}

// (a) nothing configured: password only
ok(JSON.stringify(await methods()) === '["password"]', `(a) /api/auth-methods with no settings → ${JSON.stringify(await methods())} (want ["password"])`)
ok((await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status === 200, 'admin sign-in')

// (b) OIDC on through the database (admin API) → listed without a restart, sign-in starts
const on = await api('PUT', '/api/admin/providers/oidc', { enabled: true, signup: 'closed', options: { name: 'Dex', clientId: 'allot-dev', discoveryUrl: process.env.DISCOVERY, scopes: ['openid', 'email', 'profile', 'groups'] }, clientSecret: process.env.DEX_CLIENT_SECRET })
ok(on.status === 200 && on.json?.usable === true, `(b) turn OIDC on → ${on.status}, usable ${on.json?.usable}`)
ok((await methods()).includes('oidc'), '(b) OIDC listed without a restart')
const start = await api('POST', '/api/auth/sign-in/social', { provider: 'oidc', callbackURL: BASE + '/' }, { cookie: '' })
const authUrl = start.json?.url ? new URL(start.json.url) : null
console.log(`OBSERVED (b) sign-in start: HTTP ${start.status}, redirect=${start.json?.redirect}, url → ${authUrl ? authUrl.origin + authUrl.pathname : 'none'}`)
const follow = authUrl ? await fetch(authUrl, { redirect: 'manual' }) : null
console.log(`OBSERVED (b) following that url: HTTP ${follow?.status}`)

// (f) the public list: ids and names only
const pub = await (await fetch(BASE + '/api/auth-methods')).text()
ok(!/allot-dev|discovery|well-known|secret|clientId|client_id|rules|groups|signup/i.test(pub), `(f) public list holds no settings: ${pub}`)

// (e) a bad discovery URL is refused and the working OIDC stays
const bad = await api('PUT', '/api/admin/providers/oidc', { options: { discoveryUrl: 'http://127.0.0.1:9/.well-known/openid-configuration' } })
ok(bad.status === 400 && bad.json?.path === 'options.discoveryUrl', `(e) bad discovery URL → ${bad.status} ${bad.json?.path ?? ''} (want 400 on options.discoveryUrl)`)
const stillOn = (await api('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'oidc')
ok(stillOn.values.discoveryUrl === process.env.DISCOVERY && stillOn.usable, '(e) the previous OIDC settings are kept and usable')
const stillStarts = await api('POST', '/api/auth/sign-in/social', { provider: 'oidc', callbackURL: BASE + '/' }, { cookie: '' })
ok(stillStarts.status === 200 && !!stillStarts.json?.url, `(e) OIDC sign-in still starts → ${stillStarts.status}`)

// (c) OIDC off → not listed, its paths refused
const off = await api('PUT', '/api/admin/providers/oidc', { enabled: false })
ok(off.status === 200, `(c) turn OIDC off → ${off.status}`)
ok(!(await methods()).includes('oidc'), '(c) OIDC no longer listed')
const s2 = await api('POST', '/api/auth/sign-in/social', { provider: 'oidc', callbackURL: BASE + '/' }, { cookie: '' })
ok(s2.status === 403, `(c) POST /sign-in/social oidc → ${s2.status} (want 403)`)
const cb = await api('GET', '/api/auth/callback/oidc?code=x&state=y', undefined, { cookie: '' })
ok(cb.status === 403, `(c) GET /callback/oidc → ${cb.status} (want 403)`)

console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
