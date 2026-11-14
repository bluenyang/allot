// API check for spec 006 V-12 (a)(b, server part)(c): bearer tokens and the one-time token for an app.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… APP_RETURN=allot://auth node tests/api/mobile.mjs
// The api must run with ALLOT_APP_RETURN_URLS containing APP_RETURN. Two sign-ins. Exit 0 only if every check passed.
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
const APP = process.env.APP_RETURN ?? 'allot://auth'

async function req(method, path, { body, headers = {}, origin = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin: BASE } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}
const creds = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }

// V-12 (c), audit 0.1.2 A-2: with ALLOT_APP_RETURN_URLS empty the app-return path is off.
//   EXPECT_OFF=1 BASE=… node tests/api/mobile.mjs   (the api runs without ALLOT_APP_RETURN_URLS)
if (process.env.EXPECT_OFF === '1') {
  const si = await req('POST', '/api/auth/sign-in/email', { body: creds })
  const cookie = (si.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  ok(si.status === 200, `sign-in → ${si.status}`)
  for (const to of [APP, 'allot://auth', 'com.example.app://cb']) {
    const t = await req('POST', '/api/app-login/ticket', { body: { returnTo: to }, headers: { cookie } })
    ok(t.status === 400, `ticket for "${to}" with the list empty → ${t.status} (want 400)`)
  }
  const v = await req('POST', '/api/auth/one-time-token/verify', { body: { token: 'anything' }, origin: false })
  ok(v.status === 404, `one-time-token/verify with the list empty → ${v.status} (want 404)`)
  const g = await req('GET', '/api/auth/one-time-token/generate', { headers: { cookie } })
  ok(g.status === 404, `one-time-token/generate with the list empty → ${g.status} (want 404)`)
  const cb = await req('POST', '/api/auth/sign-in/social', { body: { provider: 'oidc', callbackURL: `${APP}/x` }, headers: {} })
  ok(cb.status === 403 && cb.json?.code === 'INVALID_CALLBACK_URL', `an app URL as callbackURL is not trusted → ${cb.status} ${cb.json?.code ?? ''} (want 403 INVALID_CALLBACK_URL)`)
  console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
  process.exit(failed ? 1 : 0)
}

// (a) a bearer token from a password sign-in, as an app would do it (no cookies kept)
const s = await req('POST', '/api/auth/sign-in/email', { body: creds, origin: false })
const token = s.headers.get('set-auth-token')
ok(s.status === 200 && !!token, `sign-in → ${s.status}, set-auth-token ${token ? 'present' : 'missing'}`)
const withToken = await req('GET', '/api/state', { headers: { authorization: `Bearer ${token}` }, origin: false })
ok(withToken.status === 200, `GET /api/state with Bearer → ${withToken.status}`)
const without = await req('GET', '/api/state', { origin: false })
ok(without.status === 401, `GET /api/state without anything → ${without.status} (want 401)`)
const forged = await req('GET', '/api/state', { headers: { authorization: 'Bearer not-a-token' }, origin: false })
ok(forged.status === 401, `GET /api/state with a made-up token → ${forged.status} (want 401)`)

// the browser side, with the session's cookie
const cookie = (s.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const asBrowser = { cookie }

// (c) only a listed app URL gets a ticket
for (const bad of ['evil://x', 'https://evil.example', `${APP}/more`, `${APP}?x=1`, '']) {
  const r = await req('POST', '/api/app-login/ticket', { body: { returnTo: bad }, headers: asBrowser })
  ok(r.status === 400, `ticket for "${bad}" → ${r.status} (want 400)`)
}
// the generate endpoint itself is not for clients
const direct = await req('GET', '/api/auth/one-time-token/generate', { headers: asBrowser })
ok(direct.status >= 400, `client GET one-time-token/generate → ${direct.status} (want a refusal)`)
const anon = await req('POST', '/api/app-login/ticket', { body: { returnTo: APP } })
ok(anon.status === 401, `ticket without a session → ${anon.status} (want 401)`)

// (b) server part: ticket → app URL with ?ott → bearer session, once
const t = await req('POST', '/api/app-login/ticket', { body: { returnTo: APP }, headers: asBrowser })
const url = t.json?.url ? new URL(t.json.url) : null
const ott = url?.searchParams.get('ott')
ok(t.status === 200 && !!url && `${url.protocol}//${url.host}${url.pathname}` === APP && !!ott, `ticket → ${t.status}, ${url ? url.protocol + '//…?ott=' : 'no url'}`)
const v1 = await req('POST', '/api/auth/one-time-token/verify', { body: { token: ott }, origin: false })
const appToken = v1.headers.get('set-auth-token')
ok(v1.status === 200 && !!appToken, `verify → ${v1.status}, set-auth-token ${appToken ? 'present' : 'missing'}`)
const appState = await req('GET', '/api/state', { headers: { authorization: `Bearer ${appToken}` }, origin: false })
ok(appState.status === 200, `the app's bearer session reads /api/state → ${appState.status}`)
const v2 = await req('POST', '/api/auth/one-time-token/verify', { body: { token: ott }, origin: false })
ok(v2.status >= 400, `the same token again → ${v2.status} (want a refusal)`)

console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
