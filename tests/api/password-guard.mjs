// API check for spec 006 V-9 (b) and review 1 R4: password login can go off only while an active
// admin can sign in another way, and an OIDC link counts only at the issuer that will be in use.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/password-guard.mjs
// Preconditions: OIDC is on and usable, and some active admin has an OIDC login linked at its
// current issuer (e.g. the ADMIN_OIDC_SUBJECT bootstrap admin). Run where nobody else signs in:
// password login is off for a moment. It serves a fake discovery document (another issuer) on
// 127.0.0.1:3299 of the machine it runs on, so run it where the api can reach that (the api container).
import { createServer } from 'node:http'

let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const BASE = process.env.BASE ?? 'http://localhost:15173'
let cookie = ''
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}

const other = 'http://127.0.0.1:3299/other-issuer'
const server = createServer((_q, r) => {
  r.setHeader('content-type', 'application/json')
  r.end(JSON.stringify({ issuer: other, authorization_endpoint: `${other}/auth`, token_endpoint: `${other}/token`, jwks_uri: `${other}/keys`, id_token_signing_alg_values_supported: ['RS256'] }))
}).listen(3299, '127.0.0.1')

const s = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
ok(s.status === 200, `admin sign-in ${s.status}`)
const before = (await api('GET', '/api/admin/providers')).json.providers
const oidc = before.find((p) => p.id === 'oidc')
ok(oidc?.usable === true, `precondition: OIDC usable (${oidc?.usable})`)

try {
  const off = await api('PUT', '/api/admin/providers/password', { enabled: false })
  ok(off.status === 200, `password off while an admin has OIDC at the current issuer → ${off.status} (want 200)`)
  const methods = await fetch(BASE + '/api/auth-methods').then((r) => r.json())
  ok(!methods.methods.some((m) => m.id === 'password'), 'password is no longer listed')
  const signIn = await fetch(BASE + '/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) })
  ok(signIn.status === 403, `password sign-in while off → ${signIn.status} (want 403)`)
  // R4: moving OIDC to another issuer would leave no admin a way in
  const move = await api('PUT', '/api/admin/providers/oidc', { options: { discoveryUrl: `${other}/.well-known/openid-configuration` } })
  ok(move.status === 409, `switch OIDC to another issuer while password is off → ${move.status} (want 409)`)
  const still = (await api('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'oidc')
  ok(still.values.discoveryUrl === oidc.values.discoveryUrl, 'OIDC discovery URL unchanged')
  const disableOidc = await api('PUT', '/api/admin/providers/oidc', { enabled: false })
  ok(disableOidc.status === 409, `switch OIDC off while password is off → ${disableOidc.status} (want 409)`)
} finally {
  const on = await api('PUT', '/api/admin/providers/password', { enabled: true })
  ok(on.status === 200, `password back on → ${on.status}`)
  server.close()
}
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
