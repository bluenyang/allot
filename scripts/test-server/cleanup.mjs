// Removes what an interrupted, stopped or timed-out run left on the throwaway test server (:15174 only):
//   1. pending AI proposals made by tests (a test key's name, or an operation on a test row): rejected;
//   2. in every list of the test account, the rows whose name starts with a test marker;
//   3. the test account's API keys whose name is a test key's (retro 0.1.7);
//   4. the users whose email is a test pattern (retro 0.1.7): deleted with all their data.
// The seed rows ("Seed ...", scripts/test-server/seed.mjs) and the test account itself are not touched.
// Everything goes through the API as the test account; each removal is printed.
//   BASE=http://127.0.0.1:15174 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/test-server/cleanup.mjs
import { LISTS, connect, rowName } from './lib.mjs'

const MARKERS = ['E2E-', 'V8-marker', 'V5-marker', 'V4-fixture']

const isMarker = (name) => MARKERS.some((m) => name.startsWith(m))

// API key names the checks give their keys: prefixes (E2E specs, password-keys.mjs, older runs) and the
// exact names of tests/api/api-keys.mjs (its finally block) and mcp.mjs ('v4', the default of its key insert)
const KEY_PREFIXES = ['E2E-', 'PK-', 'F3-', 'v4']
const KEY_NAMES = new Set(['admin-key', 'first', 'y365', 'd1', 'forever', 'use', 'old', 'left', 'after-delete', 'eleventh', 'w-chat', 'w-default', 'w-ui'])
const isTestKey = (name) => KEY_NAMES.has(name) || KEY_PREFIXES.some((p) => name.startsWith(p))

// emails of the users the checks create (tests/api/*.mjs, tests/e2e/*.ts): <prefix>-...@example.com
const TEST_EMAIL = /^(?:v\d+[a-z]*|v8-admin|w8|pk|iso-b|e2e|p9|ops|i18n)-[^@]*@example\.com$/i

// a pending proposal is a test's when its key is a test key or one of its operations touches a test row
const opNames = (op) => {
  const d = op && typeof op === 'object' ? op.data : null
  return d && typeof d === 'object' ? [d.name, d.text, d.title, d.note].filter((x) => typeof x === 'string') : []
}
const isTestProposal = (p) => isTestKey(String(p.keyName ?? '')) ||
  (Array.isArray(p.ops) && p.ops.some((op) => opNames(op).some((n) => isMarker(n) || KEY_PREFIXES.some((k) => n.startsWith(k)))))

const { api, state } = await connect()
let bad = 0
const report = (what, r, okStatus = 204) => {
  console.log(`${r.status === okStatus ? 'removed' : `FAIL ${r.status}`} ${what}`)
  if (r.status !== okStatus) bad++
}

// ── 1. pending proposals made by tests ──
let nProposals = 0
const pending = []
for (let before = null; ;) {
  const q = before ? `&before=${encodeURIComponent(before.createdAt)}&beforeId=${encodeURIComponent(before.id)}` : ''
  const r = await api('GET', `/api/proposals?status=pending&limit=100${q}`)
  if (r.status !== 200 || !Array.isArray(r.json)) { console.log(`FAIL list pending proposals → ${r.status}`); bad++; break }
  pending.push(...r.json)
  if (r.json.length < 100) break
  before = r.json[r.json.length - 1]
}
for (const p of pending.filter(isTestProposal)) {
  nProposals++
  report(`proposal ${p.id} (key ${p.keyName}, rejected)`, await api('POST', `/api/proposals/${p.id}/reject`))
}
console.log(`${nProposals} leftover pending proposal(s)`)

// ── 2. marked list rows ──
const st = await state()
let n = 0
for (const [key, path] of Object.entries(LISTS)) {
  for (const row of st[key] ?? []) {
    const name = rowName(row)
    if (!isMarker(name)) continue
    // deleting a subscription also deletes its plan changes: a marker parent with a non-marker child stays
    if (key === 'subscriptions') {
      const kept = (st.planChanges ?? []).filter((c) => c.subId === row.id && !isMarker(rowName(c)))
      if (kept.length > 0) {
        console.log(`SKIP ${key} ${name}: it has ${kept.length} plan change(s) that are not test rows`)
        bad++
        continue
      }
    }
    const r = await api('DELETE', `/api/${path}/${row.id}`)
    n++
    report(`${key} ${name}`, r)
  }
}
console.log(`${n} leftover row(s)`)

// ── 3. the test account's test keys ──
let nKeys = 0
const keys = await api('GET', '/api/keys')
if (keys.status !== 200 || !Array.isArray(keys.json?.keys)) { console.log(`FAIL list API keys → ${keys.status}`); bad++ } else {
  for (const k of keys.json.keys.filter((x) => isTestKey(String(x.name ?? '')))) {
    nKeys++
    report(`API key ${k.name}`, await api('DELETE', `/api/keys/${k.id}`))
  }
}
console.log(`${nKeys} leftover API key(s)`)

// ── 4. test users ──
let nUsers = 0
const me = String(process.env.ADMIN_EMAIL ?? '').toLowerCase()
const users = []
for (let offset = 0; ; offset += 500) {
  const r = await api('GET', `/api/auth/admin/list-users?limit=500&offset=${offset}`)
  const page = r.json?.users
  if (r.status !== 200 || !Array.isArray(page)) { console.log(`FAIL list users → ${r.status}`); bad++; break }
  users.push(...page)
  if (page.length < 500) break
}
for (const u of users.filter((x) => TEST_EMAIL.test(String(x.email ?? '')) && String(x.email).toLowerCase() !== me)) {
  nUsers++
  report(`user ${u.email}`, await api('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: u.email }))
}
console.log(`${nUsers} leftover test user(s)`)

process.exit(bad ? 1 : 0)
