// API check for spec 015 V-4 (the OAuth flow of /mcp) and the /mcp half of V-5.
//   bash scripts/test-server/disposable.sh oauth node tests/api/oauth.mjs        (a throwaway database and API)
//   or against the test server :15174 (BASE, ADMIN_EMAIL, ADMIN_PASSWORD; DATABASE_URL for the second user's cleanup)
// A fake client registers itself (DCR), the admin signs in, authorizes, consents (narrowing the request to one
// permission), trades the code for tokens with PKCE and calls /mcp. Checked:
//   metadata    the two PRM paths, the AS metadata (S256 only, iss, CIMD, `none`), the switch (off: 404 and 401)
//   flow        read: 12 tools · propose (screen): 16, apply_proposal refused · apply (chat): propose then apply,
//               the history says oauth_app and the app's name · refresh rotates, the old refresh token is refused
//   refusals    no PKCE, `plain`, another redirect URI, a token for another audience, /api/mcp with a token,
//               a token after disconnecting, a token after the switch goes off, user B's token cannot see A's data
// Exit 0 only if every check passed. The admin signs in once (the login limit is 5 a minute); user B once.
import { createHash, randomBytes } from 'node:crypto'
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const ACCEPT = 'application/json, text/event-stream'
const REDIRECT = 'http://127.0.0.1:7777/callback'
const RESOURCE = `${BASE}/mcp`
const b64url = (b) => Buffer.from(b).toString('base64url')

function client() {
  let cookie = ''
  const api = async (method, path, body, headers = {}, useCookie = true) => {
    const form = body instanceof URLSearchParams
    const all = { ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : { 'content-type': 'application/json' }), origin: BASE, ...(cookie && useCookie ? { cookie } : {}), ...headers }
    for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k]
    const res = await fetch(BASE + path, {
      method, headers: all, redirect: 'manual',
      body: body === undefined ? undefined : form ? body.toString() : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length && useCookie) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    return { status: res.status, json, text, headers: res.headers }
  }
  api.signIn = (email, password) => api('POST', '/api/auth/sign-in/email', { email, password })
  return api
}

const A = client()
const anon = client()
let rpcId = 0
/** One MCP call to `path` with an Authorization value (null: none). */
const mcp = (auth, body = { jsonrpc: '2.0', id: ++rpcId, method: 'tools/list' }, path = '/mcp') =>
  anon('POST', path, body, { accept: ACCEPT, origin: undefined, ...(auth ? { authorization: auth } : {}) }, false)
const tool = async (token, name, args = {}) => {
  const r = await mcp(`Bearer ${token}`, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })
  return { status: r.status, data: r.json?.result?.structuredContent, failed: !!r.json?.error || r.json?.result?.isError === true || r.status >= 400, text: r.text }
}

/** Where an answer sends the browser: a 302's Location, or the { redirect, url } Better Auth gives a fetch request. */
const dest = (r) => r.headers.get('location') ?? (r.json?.redirect && typeof r.json.url === 'string' ? r.json.url : '')
const sent = (r) => r.status === 302 || (r.status === 200 && r.json?.redirect === true)

const pkce = () => {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}
const authorizeUrl = (clientId, scope, p, over = {}) => {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 's-' + randomBytes(4).toString('hex'), code_challenge: p.challenge, code_challenge_method: 'S256', resource: RESOURCE, ...over })
  for (const [k, v] of Object.entries(over)) if (v === null) q.delete(k)
  return `/api/auth/oauth2/authorize?${q}`
}
/** authorize (signed in) → consent with one permission → code → tokens. */
async function connect(who, clientId, permission, requested = 'openid offline_access allot:read allot:propose allot:apply') {
  const p = pkce()
  const az = await who('GET', authorizeUrl(clientId, requested, p))
  const to = dest(az)
  ok(sent(az) && to.startsWith('/oauth/consent?') && /[?&]sig=/.test(to), `authorize while signed in → the consent screen (${az.status} ${to.slice(0, 40)})`)
  const query = to.slice(to.indexOf('?') + 1)
  const info = await who('GET', `/api/oauth-apps/request?q=${encodeURIComponent(query)}`)
  ok(info.status === 200 && info.json?.name === 'V4 Test App' && info.json.redirectHost === '127.0.0.1:7777' && info.json.localhostOnly === true, `the consent screen names the app, its callback host and the localhost warning (${info.status} ${info.json?.name})`)
  const cs = await who('POST', '/api/auth/oauth2/consent', { accept: true, scope: `${permission} openid offline_access`, oauth_query: query })
  const back = new URL(cs.json?.url ?? 'http://x/', BASE)
  ok(cs.status === 200 && back.origin + back.pathname === REDIRECT && back.searchParams.get('code') && back.searchParams.get('iss') === BASE, `consent → back to the client with a code and iss (${cs.status} ${back.origin}${back.pathname} iss=${back.searchParams.get('iss')})`)
  const tk = await anon('POST', '/api/auth/oauth2/token', new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '', redirect_uri: REDIRECT, client_id: clientId, code_verifier: p.verifier, resource: RESOURCE }), {}, false)
  ok(tk.status === 200 && tk.json?.access_token?.split('.').length === 3 && tk.json.refresh_token && tk.json.expires_in <= 3600, `token (PKCE) → a JWT access token and a refresh token (${tk.status}, expires_in ${tk.json?.expires_in})`)
  return tk.json ?? {}
}

let clientId = ''
/** The change set the app applied (a check item v4-oauth-chat): A's marked data for the isolation check, reverted at the end. */
let appliedSet = ''
const userB = { id: '', email: '' }
let mainErr = null
try {
  const sa = await A.signIn(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
  ok(sa.status === 200, `admin sign-in ${sa.status}`)
  if (failures()) process.exit(1)
  arm()

  // ── the switch: off ──
  const off = await A('PUT', '/api/admin/oauth', { enabled: false })
  if (off.status === 409) {
    console.log('NOTE the switch is set by env (ALLOT_OAUTH_ENABLED): the off checks are skipped')
  } else {
    ok(off.status === 200 && off.json?.enabled === false && off.json.possible === true, `switch off → ${off.status} (possible ${off.json?.possible})`)
    for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/api/auth/oauth2/register', '/api/auth/oauth2/authorize']) {
      const r = await anon(p.includes('register') ? 'POST' : 'GET', p, p.includes('register') ? {} : undefined, {}, false)
      ok(r.status === 404, `off: ${p} → ${r.status}`)
    }
    const noAuth = await mcp(null)
    ok(noAuth.status === 401 && noAuth.headers.get('www-authenticate') === 'Bearer', `off: /mcp without a token → 401, plain Bearer (${noAuth.headers.get('www-authenticate')})`)
    const on = await A('PUT', '/api/admin/oauth', { enabled: true })
    ok(on.status === 200 && on.json?.enabled === true, `switch on → ${on.status}`)
  }

  // ── metadata ──
  for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const r = await anon('GET', p, undefined, {}, false)
    ok(r.status === 200 && r.json?.resource === RESOURCE && r.json.authorization_servers?.[0] === BASE && r.json.scopes_supported?.join(' ') === 'allot:read allot:propose allot:apply', `PRM ${p}: resource ${r.json?.resource}`)
  }
  const as = await anon('GET', '/.well-known/oauth-authorization-server', undefined, {}, false)
  const md = as.json ?? {}
  ok(as.status === 200 && md.issuer === BASE && md.code_challenge_methods_supported?.join() === 'S256' && md.authorization_response_iss_parameter_supported === true
    && md.client_id_metadata_document_supported === true && md.token_endpoint_auth_methods_supported?.includes('none') && md.registration_endpoint,
  `AS metadata: issuer, S256 only, iss, CIMD, none, registration (${as.status})`)
  const oidc = await anon('GET', '/.well-known/openid-configuration', undefined, {}, false)
  ok(oidc.status === 200 && oidc.json?.issuer === BASE, `openid-configuration → ${oidc.status}`)
  const noAuth = await mcp(null)
  ok(noAuth.status === 401 && noAuth.headers.get('www-authenticate') === `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`, `/mcp without a token → 401 naming the PRM (${noAuth.headers.get('www-authenticate')})`)
  const apiNoAuth = await mcp(null, undefined, '/api/mcp')
  ok(apiNoAuth.status === 401 && apiNoAuth.headers.get('www-authenticate') === 'Bearer', `/api/mcp without a token → its 401 as before (${apiNoAuth.headers.get('www-authenticate')})`)
  for (const p of ['/api/auth/oauth2/get-clients', '/api/auth/oauth2/get-consents', '/api/auth/admin/oauth2/resources']) {
    const r = await A('GET', p)
    ok(r.status === 404, `client and consent management is closed: ${p} → ${r.status}`)
  }

  // review 1 R1-3: the OAuth screens are not framed (served by the production image; the API alone answers 404 there)
  const page = await anon('GET', '/oauth/consent', undefined, {}, false)
  ok(page.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') ?? ''), `/oauth/consent cannot be framed (${page.status} ${page.headers.get('x-frame-options')})`)

  // ── DCR ──
  const reg = await anon('POST', '/api/auth/oauth2/register', { client_name: 'V4 Test App', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, {}, false)
  clientId = reg.json?.client_id ?? ''
  ok(reg.status === 200 || reg.status === 201, `DCR → ${reg.status} (${clientId ? 'client id' : reg.text.slice(0, 160)})`)

  // ── refusals before a code ──
  const p0 = pkce()
  const loggedOut = await anon('GET', authorizeUrl(clientId, 'openid allot:read', p0), undefined, {}, false)
  ok(sent(loggedOut) && dest(loggedOut).startsWith('/oauth/login?'), `authorize signed out → the sign-in screen (${loggedOut.status} ${dest(loggedOut).slice(0, 30) || loggedOut.text.slice(0, 200)})`)
  const noPkce = await A('GET', authorizeUrl(clientId, 'openid allot:read', p0, { code_challenge: null, code_challenge_method: null }))
  ok(/error=/.test(dest(noPkce)) || noPkce.status >= 400, `authorize without PKCE → an error (${noPkce.status} ${(dest(noPkce) || noPkce.text).slice(0, 120)})`)
  const plain = await A('GET', authorizeUrl(clientId, 'openid allot:read', p0, { code_challenge: p0.verifier, code_challenge_method: 'plain' }))
  ok(/error=/.test(dest(plain)) || plain.status >= 400, `authorize with plain → an error (${plain.status} ${(dest(plain) || plain.text).slice(0, 120)})`)
  const otherBack = await A('GET', authorizeUrl(clientId, 'openid allot:read', p0, { redirect_uri: 'https://evil.example/cb' }))
  ok(!dest(otherBack).startsWith('https://evil.example') && !dest(otherBack).startsWith('/oauth/consent'), `another redirect URI is refused (${otherBack.status} ${(dest(otherBack) || otherBack.text).slice(0, 90)})`)
  const portAuth = await A('GET', authorizeUrl(clientId, 'openid allot:read', p0, { redirect_uri: 'http://127.0.0.1:8888/callback' }))
  ok(dest(portAuth).startsWith('/oauth/consent?'), `the same loopback callback on another port is accepted (${(dest(portAuth) || portAuth.text).slice(0, 60)})`)

  // ── read ──
  const read = await connect(A, clientId, 'allot:read')
  const rl = await mcp(`Bearer ${read.access_token}`)
  const rtools = rl.json?.result?.tools ?? []
  ok(rl.status === 200 && rtools.length === 12 && !rtools.some((t) => t.name === 'propose_changes'), `read: tools/list → ${rl.status}, ${rtools.length} tools`)
  const ov = await tool(read.access_token, 'get_overview')
  ok(!ov.failed && ov.data, `read: get_overview works (${ov.status})`)
  const viaApi = await mcp(`Bearer ${read.access_token}`, undefined, '/api/mcp')
  ok(viaApi.status === 401, `an OAuth token on /api/mcp → ${viaApi.status}`)
  const tampered = read.access_token.slice(0, -4) + (read.access_token.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  ok((await mcp(`Bearer ${tampered}`)).status === 401, 'a token with a broken signature → 401')
  const apps1 = await A('GET', '/api/oauth-apps')
  const app1 = apps1.json?.apps?.find((x) => x.clientId === clientId)
  ok(apps1.status === 200 && app1?.name === 'V4 Test App' && app1.scope === 'allot:read' && app1.lastUsedAt, `connected apps: the app, its permission and its last use (${app1?.scope}, ${app1?.lastUsedAt ? 'used' : 'never'})`)

  // ── propose, confirmed on the screen ──
  const ui = await connect(A, clientId, 'allot:propose')
  const ul = await mcp(`Bearer ${ui.access_token}`)
  ok((ul.json?.result?.tools ?? []).length === 16, `propose (screen): ${ul.json?.result?.tools?.length} tools`)
  const oldRead = await mcp(`Bearer ${read.access_token}`)
  ok(oldRead.status === 200 && (oldRead.json?.result?.tools ?? []).length === 12, 'the earlier read token keeps its narrower permission')
  const pu = await tool(ui.access_token, 'propose_changes', { note: 'v4 oauth', changes: [{ resource: 'checks', action: 'create', data: { text: 'v4-oauth-ui', done: false } }] })
  ok(!pu.failed && pu.data?.confirm === 'ui', `propose (screen): a proposal confirmed on the screen (${pu.data?.confirm})`)
  const au = await tool(ui.access_token, 'apply_proposal', { proposalId: pu.data?.proposalId ?? 'x' })
  ok(au.failed && /Pending changes|screen/.test(au.text), 'propose (screen): apply_proposal is refused')
  const pend = await A('GET', '/api/proposals?status=pending')
  const mine = (pend.json?.proposals ?? pend.json ?? []).find?.((x) => x.id === pu.data?.proposalId)
  ok(mine?.source === 'oauth' && mine.keyName === 'V4 Test App' && mine.keyUsable === true, `pending changes: from the app, usable (${mine?.source} ${mine?.keyName} ${mine?.keyUsable})`)
  const rej = await A('POST', `/api/proposals/${pu.data?.proposalId}/reject`)
  ok(rej.status === 200 || rej.status === 204, `reject the screen proposal → ${rej.status}`)

  // ── apply, confirmed in the chat ──
  const chat = await connect(A, clientId, 'allot:apply')
  const pc = await tool(chat.access_token, 'propose_changes', { note: 'v4 oauth', changes: [{ resource: 'checks', action: 'create', data: { text: 'v4-oauth-chat', done: false } }] })
  ok(!pc.failed && pc.data?.confirm === 'chat', `apply (chat): a chat proposal (${pc.data?.confirm})`)
  const ac = await tool(chat.access_token, 'apply_proposal', { proposalId: pc.data?.proposalId ?? 'x' })
  ok(!ac.failed && ac.data?.changeSetId, `apply (chat): applied → change set ${ac.data?.changeSetId ? 'made' : 'none'}`)
  const hist = await A('GET', '/api/changes?limit=5')
  const set = (hist.json?.sets ?? hist.json ?? []).find?.((s) => s.id === ac.data?.changeSetId)
  ok(set?.actorKind === 'oauth_app' && set.actorLabel === 'V4 Test App', `the history: by oauth_app "${set?.actorLabel}"`)
  appliedSet = set?.id ?? ''

  // review 1 R1-1: narrowed to "confirm on the screen", the app can no longer apply its earlier chat proposal itself
  const pc2 = await tool(chat.access_token, 'propose_changes', { note: 'v4 oauth', changes: [{ resource: 'checks', action: 'create', data: { text: 'v4-oauth-narrowed', done: false } }] })
  ok(!pc2.failed && pc2.data?.confirm === 'chat', `a second chat proposal (${pc2.data?.confirm})`)
  const narrowed = await connect(A, clientId, 'allot:propose')
  for (const [label, token] of [['the old chat token', chat.access_token], ['the new screen token', narrowed.access_token]]) {
    const ap = await tool(token, 'apply_proposal', { proposalId: pc2.data?.proposalId ?? 'x' })
    ok(ap.failed && /Pending changes|screen/.test(ap.text), `after narrowing, ${label} cannot apply the chat proposal`)
  }
  const still = await A('GET', `/api/proposals/${pc2.data?.proposalId}`)
  ok(still.json?.status === 'pending', `the proposal still waits for the user (${still.json?.status})`)
  const rej2 = await A('POST', `/api/proposals/${pc2.data?.proposalId}/reject`)
  ok(rej2.status === 200 || rej2.status === 204, `reject it → ${rej2.status}`)
  const chat2 = await connect(A, clientId, 'allot:apply')
  chat.refresh_token = chat2.refresh_token

  // ── refresh: rotation, no reuse ──
  const r1 = await anon('POST', '/api/auth/oauth2/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: chat.refresh_token, client_id: clientId, resource: RESOURCE }), {}, false)
  ok(r1.status === 200 && r1.json?.refresh_token && r1.json.refresh_token !== chat.refresh_token && r1.json.access_token, `refresh → a new refresh token (${r1.status})`)
  const r2 = await anon('POST', '/api/auth/oauth2/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: chat.refresh_token, client_id: clientId, resource: RESOURCE }), {}, false)
  ok(r2.status >= 400, `the old refresh token again → ${r2.status} (${r2.json?.error})`)

  // ── a token for another audience ──
  const p2 = pkce()
  const az2 = await A('GET', authorizeUrl(clientId, 'openid allot:read', p2, { resource: null }))
  const to2 = dest(az2)
  if (to2.startsWith('/oauth/consent?')) {
    const cs2 = await A('POST', '/api/auth/oauth2/consent', { accept: true, scope: 'allot:read openid', oauth_query: to2.slice(to2.indexOf('?') + 1) })
    const code2 = new URL(cs2.json?.url ?? 'http://x/', BASE).searchParams.get('code') ?? ''
    const tk2 = await anon('POST', '/api/auth/oauth2/token', new URLSearchParams({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: clientId, code_verifier: p2.verifier }), {}, false)
    const other = tk2.json?.access_token
    ok(!other || (await mcp(`Bearer ${other}`)).status === 401, `a token not bound to ${RESOURCE} → refused by /mcp (${tk2.status})`)
  } else {
    ok(/error=/.test(to2), `authorize without a resource → ${to2.slice(0, 60)}`)
  }

  // ── user B cannot see A's data with B's token ──
  userB.email = `v4-oauth-b-${Date.now()}@example.com`
  const cu = await A('POST', '/api/auth/admin/create-user', { email: userB.email, password: 'v4-pass-12345', name: 'V4 OAuth B', role: 'user' })
  userB.id = cu.json?.user?.id ?? ''
  ok(cu.status === 200 && userB.id, `create user B → ${cu.status}`)
  const B = client()
  const sb = await B.signIn(userB.email, 'v4-pass-12345')
  ok(sb.status === 200, `user B sign-in → ${sb.status}`)
  const tb = await connect(B, clientId, 'allot:read')
  const bApps = await B('GET', '/api/oauth-apps')
  ok((bApps.json?.apps ?? []).length === 1, `user B sees only B's own connection (${(bApps.json?.apps ?? []).length})`)
  const aChecks = await tool(read.access_token, 'search', { query: 'v4-oauth-chat' })
  const bChecks = await tool(tb.access_token, 'search', { query: 'v4-oauth-chat' })
  ok(!aChecks.failed && aChecks.data?.count === 1, `A's token finds A's marked check item (${aChecks.status} ${aChecks.text.slice(0, 120)})`)
  ok(!bChecks.failed && bChecks.data?.count === 0, `B's token finds nothing of A's (${bChecks.status} ${bChecks.text.slice(0, 120)})`)
  const bOv = await tool(tb.access_token, 'get_overview')
  const aOv = await tool(read.access_token, 'get_overview')
  ok(JSON.stringify(bOv.data) !== JSON.stringify(aOv.data), "B's overview is not A's")

  // ── disconnect: refused at once ──
  const dis = await A('DELETE', `/api/oauth-apps/${encodeURIComponent(clientId)}`)
  ok(dis.status === 200, `disconnect → ${dis.status}`)
  const afterDis = await mcp(`Bearer ${read.access_token}`)
  ok(afterDis.status === 401 && /invalid_token/.test(afterDis.headers.get('www-authenticate') ?? ''), `the same token after disconnecting → ${afterDis.status}`)
  const rAfter = await anon('POST', '/api/auth/oauth2/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r1.json?.refresh_token ?? '', client_id: clientId, resource: RESOURCE }), {}, false)
  ok(rAfter.status >= 400, `its refresh token after disconnecting → ${rAfter.status}`)
  // review 1 R1-4: connecting again does not bring the old token back
  await new Promise((r) => setTimeout(r, 1100)) // the new consent is in a later second than the old token
  const again = await connect(A, clientId, 'allot:read')
  ok((await mcp(`Bearer ${read.access_token}`)).status === 401, 'after connecting again, a token from before the disconnect stays refused')
  ok((await mcp(`Bearer ${again.access_token}`)).status === 200, 'the new connection works')
  await A('DELETE', `/api/oauth-apps/${encodeURIComponent(clientId)}`)
  const bStill = await mcp(`Bearer ${tb.access_token}`)
  ok(bStill.status === 200, "B's connection to the same app is untouched")

  // ── the switch off refuses tokens already given ──
  const off2 = await A('PUT', '/api/admin/oauth', { enabled: false })
  if (off2.status === 200) {
    const bOff = await mcp(`Bearer ${tb.access_token}`)
    ok(bOff.status === 401, `switch off: a token already given → ${bOff.status}`)
    const on2 = await A('PUT', '/api/admin/oauth', { enabled: true })
    ok(on2.status === 200, 'switch on again')
    const bOn = await mcp(`Bearer ${tb.access_token}`)
    ok(bOn.status === 200, `switch on: the connection works again (${bOn.status})`)
  }
} catch (e) {
  mainErr = e
  threw(e)
} finally {
  disarm()
  if (appliedSet) await cleanupStep("revert the app's change", async () => {
    const r = await A('POST', `/api/changes/${appliedSet}/revert`)
    return r.status === 200 ? undefined : r.status
  })
  if (userB.id) await cleanupStep('delete user B', async () => {
    const r = await A('DELETE', `/api/admin/users/${userB.id}`, { confirmEmail: userB.email })
    return r.status === 200 || r.status === 204 ? undefined : r.status
  })
  if (clientId) await cleanupStep('disconnect the app', async () => {
    const r = await A('DELETE', `/api/oauth-apps/${encodeURIComponent(clientId)}`)
    return r.status === 200 || r.status === 404 ? undefined : r.status
  })
}
console.log(failures() ? `FAILED ${failures()} check(s)` : 'ALL PASSED')
process.exit(failures() || mainErr ? 1 : 0)
