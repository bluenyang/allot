// Writes GET /api/state of the ADMIN_EMAIL account to a file, so two runs can be compared (spec 009 V-2).
//   docker exec -w /app -e BASE=http://127.0.0.1:3000 allot-dev-api-1 node tests/api/state-dump.mjs <out.json>
// One sign-in. The output holds the account's data: write it under .loctx/, never commit it.
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
if (!out) throw new Error('usage: state-dump.mjs <out.json>')
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const headers = { 'content-type': 'application/json', origin: BASE }
const login = await fetch(BASE + '/api/auth/sign-in/email', {
  method: 'POST', headers, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
})
if (login.status !== 200) throw new Error(`sign-in → ${login.status}`)
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const res = await fetch(BASE + '/api/state', { headers: { ...headers, cookie } })
if (res.status !== 200) throw new Error(`state → ${res.status}`)
writeFileSync(out, JSON.stringify(await res.json(), null, 1) + '\n')
console.log(`state written to ${out}`)
