// API check for spec 017 V-3 and V-4: the skills download and the MCP server's self-description.
//   bash scripts/test-server/run.sh skills node tests/api/skills.mjs     (on the test server :15174; BASE, ADMIN_EMAIL, ADMIN_PASSWORD)
// It signs in once as ADMIN_EMAIL, makes one read key for `initialize` and revokes it at the end. Nothing else is written.
//   skills   no session → 401; the list has the seven skills; each ZIP is 200, application/zip, an attachment, starts
//            with PK and names <name>/SKILL.md; a name that is not listed, a path, a name without .zip → 404
//   mcp      initialize on /mcp with the key: serverInfo name allot, version 0.1, title Allot, a description, websiteUrl
// Exit 0 only if every check passed.
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:15174'
const SEVEN = ['allot-assets', 'allot-month-end', 'allot-month-start', 'allot-payday', 'allot-receipt', 'allot-spending-plan', 'allot-subscriptions']
let cookie = ''
async function call(method, path, { body, headers = {}, raw = false, session = true } = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: BASE, ...(session && cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  if (raw) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, headers: res.headers, json, text }
}

let keyId = null
try {
  const anon = await call('GET', '/api/skills', { session: false })
  ok(anon.status === 401, `GET /api/skills without a session → ${anon.status} (want 401)`)
  const anonZip = await call('GET', '/api/skills/allot-payday.zip', { session: false, raw: true })
  ok(anonZip.status === 401, `GET a ZIP without a session → ${anonZip.status} (want 401)`)

  const login = await call('POST', '/api/auth/sign-in/email', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })
  ok(login.status === 200, `sign in → ${login.status}`)
  if (failures()) process.exit(1)
  arm()

  // ── skills ──
  const list = await call('GET', '/api/skills')
  const names = (list.json?.skills ?? []).map((s) => s.name)
  ok(list.status === 200 && JSON.stringify(names) === JSON.stringify(SEVEN), `list → ${list.status}: ${names.join(', ')}`)
  for (const s of list.json.skills) {
    const z = await call('GET', `/api/skills/${s.file}`, { raw: true })
    const entry = z.bytes.subarray(30, 30 + z.bytes.readUInt16LE(26)).toString('utf8')
    ok(z.status === 200 && z.headers.get('content-type') === 'application/zip', `${s.file} → ${z.status} ${z.headers.get('content-type')}`)
    ok((z.headers.get('content-disposition') ?? '').startsWith('attachment;') && z.headers.get('content-disposition').includes(`${s.name}.zip`), `${s.file} is an attachment (${z.headers.get('content-disposition')})`)
    ok(z.bytes.subarray(0, 2).toString('latin1') === 'PK' && entry === `${s.name}/SKILL.md` && z.bytes.length === s.bytes, `${s.file}: PK, ${entry}, ${z.bytes.length} bytes = listed ${s.bytes}`)
  }
  for (const bad of ['allot-nothing.zip', 'allot-payday', '..%2Fpackage.json', '..%2F..%2Fpackage.json.zip', 'allot-payday.zip.zip', '%2Fetc%2Fpasswd.zip']) {
    const r = await call('GET', `/api/skills/${bad}`, { raw: true })
    ok(r.status === 404, `GET /api/skills/${bad} → ${r.status} (want 404)`)
  }

  // ── MCP self-description ──
  const made = await call('POST', '/api/keys', { body: { name: 'skills-check' } })
  keyId = made.json?.item?.id ?? null
  ok(made.status === 201 && typeof made.json?.key === 'string', `read key made → ${made.status}`)
  const init = await call('POST', '/mcp', {
    session: false,
    headers: { authorization: `Bearer ${made.json.key}`, accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v4', version: '1' } } },
  })
  const json = typeof init.json === 'string' ? JSON.parse(/data: (.*)/.exec(init.json)?.[1] ?? 'null') : init.json
  const info = json?.result?.serverInfo ?? {}
  ok(init.status === 200 && info.name === 'allot' && info.version === '0.1', `initialize → ${init.status}: name ${info.name}, version ${info.version}`)
  ok(info.title === 'Allot' && typeof info.description === 'string' && info.description.length > 20 && info.websiteUrl === 'https://github.com/bluenyang/allot', `serverInfo: title ${info.title}, websiteUrl ${info.websiteUrl}, description ${info.description?.length} chars`)
} catch (e) {
  threw(e)
} finally {
  disarm()
  if (keyId) await cleanupStep('revoke the key', async () => {
    const r = await call('DELETE', `/api/keys/${keyId}`)
    ok(r.status === 200 || r.status === 204, `key revoked → ${r.status}`)
  })
}
console.log(failures() ? `${failures()} FAILED` : 'ALL PASSED')
process.exit(failures() ? 1 : 0)
