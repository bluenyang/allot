// Browser + API check for spec 006 V-5 (a)–(e) and V-6 (a)–(c): OIDC sign-up policies and linking
// through Dex (docker/compose.dev.yaml). Runs on the host (system Chrome).
//   BASE=http://<LAN IP>:15173 ADMIN_EMAIL=… ADMIN_PASSWORD=… DEX_CLIENT_SECRET=… node tests/api/oidc-flows.mjs
// It changes the OIDC settings, and deletes and creates the Dex test users' accounts: run it on a
// test database. It pauses for the sign-in rate limit (10 external sign-in starts a minute).
// Exit 0 only if every check passed.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('@playwright/test')

const BASE = process.env.BASE
let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEX = { alice: 'dex-alice@example.org', bob: 'dex-bob@example.org', carol: 'dex-carol@example.org', mock: 'kilgore@kilgore.trout' }

function client() {
  let cookie = ''
  const api = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text }
  }
  return api
}
const admin = client()
ok((await admin('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status === 200, 'admin sign-in')
const discovery = `${BASE}/dex/.well-known/openid-configuration`
const issuer = (await (await fetch(discovery)).json()).issuer

async function setOidc(signup, groups) {
  const cur = (await admin('GET', '/api/admin/providers')).json.providers.find((p) => p.id === 'oidc')
  const body = { enabled: true, signup, rules: { groups }, options: { name: 'Dex', clientId: 'allot-dev', discoveryUrl: discovery, scopes: ['openid', 'email', 'profile', 'groups'] } }
  if (!cur.secretSet) body.clientSecret = process.env.DEX_CLIENT_SECRET
  const r = await admin('PUT', '/api/admin/providers/oidc', body)
  if (r.status !== 200) throw new Error(`setOidc ${signup}: ${r.status} ${r.text}`)
}
const users = async () => (await admin('GET', '/api/auth/admin/list-users?limit=500')).json.users
const userBy = async (email) => (await users()).find((u) => u.email === email)
async function removeUser(email) {
  const u = await userBy(email)
  if (u) {
    const r = await admin('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })
    if (r.status !== 204) throw new Error(`remove ${email}: ${r.status} ${r.text}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome' })

/** One OIDC sign-in in a fresh browser (or `page` when given); returns where it ended and /api/me. */
async function dexSignIn(who, { page, link = false } = {}) {
  const ctx = page ? null : await browser.newContext()
  const p = page ?? await ctx.newPage()
  if (!page) await p.goto(BASE + '/')
  const r = await p.evaluate(async ([b, isLink]) => {
    const res = await fetch(isLink ? '/api/auth/link-social' : '/api/auth/sign-in/social', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'oidc', callbackURL: b + '/', errorCallbackURL: b + '/' }) })
    return { status: res.status, body: await res.json() }
  }, [BASE, link])
  if (!r.body.url) return { start: r.status, error: r.body.code ?? r.body.message }
  await p.goto(r.body.url)
  if (who === DEX.mock) {
    await p.getByText('Log in with Mock (groups)').click()
  } else {
    const e = p.getByText('Log in with Email')
    await p.locator('#login').or(e).first().waitFor()
    if (await e.count()) await e.click()
    await p.locator('#login').fill(who)
    await p.locator('#password').fill('dex-password')
    await p.locator('#submit-login').click()
  }
  await p.waitForURL((u) => u.toString().startsWith(BASE) && !u.pathname.startsWith('/dex') && !u.pathname.startsWith('/api'), { timeout: 20_000 })
  const url = new URL(p.url())
  const me = await p.evaluate(async () => { const x = await fetch('/api/me'); return { status: x.status, body: x.status === 200 ? (await x.json()).user : null } })
  const accounts = me.status === 200 ? await p.evaluate(async () => (await fetch('/api/auth/list-accounts')).json()) : []
  if (ctx && !page) await ctx.close()
  return { error: url.searchParams.get('error'), me, accounts }
}

// ── V-5 ──
for (const e of Object.values(DEX)) await removeUser(e)
await setOidc('closed', ['authors'])
let r = await dexSignIn(DEX.alice)
ok(r.error === 'SIGNUP_CLOSED' && !(await userBy(DEX.alice)), `V-5 (a) closed: new Dex user → ${r.error}, user row ${(await userBy(DEX.alice)) ? 'exists' : 'none'}`)

await setOidc('approval', ['authors'])
r = await dexSignIn(DEX.alice)
const pendingRow = await userBy(DEX.alice)
ok(r.error === 'PENDING_APPROVAL' && r.me.status === 401 && pendingRow?.status === 'pending' && pendingRow?.admission === 'approval',
  `V-5 (b) approval: → ${r.error}, /api/me ${r.me.status}, row ${pendingRow?.status}/${pendingRow?.admission}`)
const approve = await admin('POST', '/api/auth/admin/update-user', { userId: pendingRow?.id, data: { status: 'active' } })
r = await dexSignIn(DEX.alice)
ok(approve.status === 200 && !r.error && r.me.status === 200 && r.me.body.status === 'active', `V-5 (b) after approval: approve ${approve.status}, sign-in → /api/me ${r.me.status} ${r.me.body?.status}`)
// (e) the account key is the issuer and the subject
const aliceKey = r.accounts.find((x) => x.providerId === 'oidc')?.accountId ?? ''
ok(aliceKey.startsWith(`${issuer} `) && aliceKey.length > issuer.length + 1, `V-5 (e) account key = issuer + " " + subject: "${aliceKey.slice(0, issuer.length + 6)}…"`)

await setOidc('rules', ['authors'])
r = await dexSignIn(DEX.mock)
ok(!r.error && r.me.status === 200 && r.me.body.status === 'active' && r.me.body.admission === 'rule', `V-5 (c) rules [authors], user in authors → /api/me ${r.me.status} ${r.me.body?.status}/${r.me.body?.admission}`)
r = await dexSignIn(DEX.bob)
ok(r.error === 'NOT_ALLOWED' && !(await userBy(DEX.bob)), `V-5 (c) rules [authors], user without the group → ${r.error}, user row ${(await userBy(DEX.bob)) ? 'exists' : 'none'}`)

console.log('… waiting 61s for the sign-in rate limit')
await sleep(61_000)
await setOidc('rules', ['other'])
r = await dexSignIn(DEX.mock)
ok(r.error === 'NOT_ALLOWED' && r.me.status === 401, `V-5 (d) group taken out of the rules → next login ${r.error}, /api/me ${r.me.status}`)
const idt = await fetch(BASE + '/api/auth/sign-in/social', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ provider: 'oidc', idToken: { token: 'x.y.z' } }) })
const idtBody = await idt.json().catch(() => ({}))
ok(idt.status === 403 && idtBody.code === 'ID_TOKEN_SIGN_IN_DISABLED', `V-5 (e) client-sent idToken → ${idt.status} ${idtBody.code}`)

// ── V-6 ──
await setOidc('closed', ['authors'])
const made = await admin('POST', '/api/auth/admin/create-user', { email: DEX.carol, name: 'Carol' })
r = await dexSignIn(DEX.carol)
ok(made.status === 200 && !r.error && r.me.body?.id === made.json?.user?.id && r.accounts.some((x) => x.providerId === 'oidc'),
  `V-6 (a) admin-made account without a password → first OIDC login joins it: ${r.me.status}, same id ${r.me.body?.id === made.json?.user?.id}`)
const bobMade = await admin('POST', '/api/auth/admin/create-user', { email: DEX.bob, name: 'Bob', password: 'bob-password-1' })
r = await dexSignIn(DEX.bob)
const bobRow = await userBy(DEX.bob)
ok(bobMade.status === 200 && r.error === 'account_not_linked', `V-6 (b) existing account with a login, same email → ${r.error}`)

// (c) bob links OIDC from his own session, then unlinks it; the last login cannot go
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(BASE + '/')
const bs = await page.evaluate(async () => (await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dex-bob@example.org', password: 'bob-password-1' }) })).status)
r = await dexSignIn(DEX.bob, { page, link: true })
const linked = await page.evaluate(async () => (await fetch('/api/auth/list-accounts')).json())
ok(bs === 200 && !r.error && linked.some((x) => x.providerId === 'oidc') && linked.some((x) => x.providerId === 'credential'), `V-6 (c) link from the account: ${linked.map((x) => x.providerId).join(', ')}`)
const unlink = async (id) => page.evaluate(async (accountId) => { const x = await fetch('/api/auth/unlink-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) }); return { status: x.status, body: await x.json().catch(() => null) } }, id)
const u1 = await unlink(linked.find((x) => x.providerId === 'oidc').id)
const left = await page.evaluate(async () => (await fetch('/api/auth/list-accounts')).json())
const u2 = await unlink(left[0]?.id)
ok(u1.status === 200 && left.length === 1 && left[0].providerId === 'credential', `V-6 (c) unlink OIDC → ${u1.status}, left: ${left.map((x) => x.providerId).join(', ')}`)
ok(u2.status >= 400, `V-6 (c) unlink the last login → ${u2.status} ${u2.body?.code ?? ''}`)
await ctx.close()
void bobRow

await browser.close()
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed')
process.exit(failed ? 1 : 0)
