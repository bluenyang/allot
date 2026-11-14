// API check for spec 006 V-14: a fresh database with only the admin account (pnpm db:admin), and a new
// account made by the admin, both start from the defaults and save their first settings.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/new-account.mjs   (after pnpm db:admin on an empty database)
const BASE = process.env.BASE
let failed = 0
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++ }
function client() {
  let cookie = ''
  return async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const set = r.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null } catch { j = t }
    return { status: r.status, json: j }
  }
}
const A = client(), N = client()
ok((await A('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).status === 200, 'admin from db:admin signs in')
const me = await A('GET', '/api/me')
ok(me.json?.user?.role === 'admin' && me.json?.user?.status === 'active', `admin role ${me.json?.user?.role}, status ${me.json?.user?.status}`)
const st = await A('GET', '/api/state')
ok(st.status === 200 && st.json.settings.payDay === 25 && st.json.living.food === 0 && st.json.subscriptions.length === 0 && st.json.phases.length === 0, `admin /api/state → ${st.status}, defaults and empty lists`)
const email = `w8-${Date.now()}@example.com`
ok((await A('POST', '/api/auth/admin/create-user', { email, password: 'w8-password-1', name: 'W8' })).status === 200, 'admin creates a user')
ok((await N('POST', '/api/auth/sign-in/email', { email, password: 'w8-password-1' })).status === 200, 'new user signs in')
const ns = await N('GET', '/api/state')
ok(ns.status === 200 && ns.json.settings.netPay === 0 && ns.json.targets.length === 0, `new user /api/state → ${ns.status}, defaults`)
const put = await N('PUT', '/api/settings', { ...ns.json.settings, netPay: 123 })
const ns2 = await N('GET', '/api/state')
ok(put.status === 200 && ns2.json.settings.netPay === 123, `first save creates the row → ${put.status}, netPay ${ns2.json.settings.netPay}`)
process.exit(failed ? 1 : 0)
