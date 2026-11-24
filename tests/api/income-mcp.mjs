// API check for spec 014 V-5: the MCP side of the incomes over HTTP, with a key made through the screen's API (no
// database access): tools/list has get_income; get_income and get_overview agree; a money-received proposal applied
// in the conversation moves the month's left over by exactly its difference, and its revert moves it back.
//   BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node tests/api/income-mcp.mjs
// The key and the proposal's rows are removed in `finally`; the change history stays (throwaway test server only).
import { arm, cleanupStep, disarm, failures, ok, threw } from './lib/check.mjs'

const BASE = process.env.BASE ?? 'http://localhost:15174'
const NAME = 'E2E-income-mcp'
let cookie = ''
async function api(method, path, body, headers = {}, withCookie = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, ...(withCookie && cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() ?? []
  if (withCookie && set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json }
}
let raw = null
const rpc = (method, params) => api('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method, params },
  { authorization: `Bearer ${raw}`, accept: 'application/json, text/event-stream' }, false)
async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  const res = r.json?.result
  ok(r.status === 200 && res && res.isError !== true, `${name} → ${r.status}${res?.isError ? ` ${JSON.stringify(res.content)}` : ''}`)
  return res?.structuredContent ?? JSON.parse(res?.content?.[0]?.text ?? 'null')
}

const si = await api('POST', '/api/auth/sign-in/email', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
ok(si.status === 200, `sign-in → ${si.status}`)
if (failures()) process.exit(1)
let keyId = null
const proposals = [] // made by this run; a stop before their apply leaves them pending, so `finally` rejects them (review 3 F-3)
arm()
try {
  const k = await api('POST', '/api/keys', { name: NAME, expiresInDays: 1, write: true, confirm: 'chat' })
  ok(k.status === 201 && typeof k.json?.key === 'string', `write key (confirm in chat) → ${k.status}`)
  raw = k.json.key
  keyId = k.json.item.id

  const list = await rpc('tools/list', {})
  ok((list.json?.result?.tools ?? []).some((t) => t.name === 'get_income'), 'tools/list has get_income')

  const inc0 = await tool('get_income')
  const ov0 = await tool('get_overview')
  const month = inc0.month ?? ov0.month
  ok(typeof month === 'string' && /^\d{4}-\d{2}$/.test(month), `get_income names its month (${month})`)
  ok(inc0.leftOverKrw === ov0.leftOverKrw && inc0.totalKrw === ov0.income?.totalKrw && inc0.expectedKrw === ov0.income?.expectedKrw,
    `get_income and get_overview agree (left over ${inc0.leftOverKrw}, total ${inc0.totalKrw})`)
  const salary = (inc0.incomes ?? []).find((l) => l.salary === true && l.incomeId === null)
  ok(!!salary, `get_income has the salary line (${JSON.stringify(salary)})`)

  // receive the salary plus 12,345 this month (on top of whatever is already written down)
  const before = salary.countedKrw
  const add = (salary.receivedKrw == null ? salary.expectedKrw : 0) + 12_345
  const p = await tool('propose_changes', { note: NAME, changes: [{ resource: 'income-receipts', action: 'create', data: { itemId: null, ym: month, amount: add, note: NAME } }] })
  ok(p.status === 'pending' && !!p.proposalId, `propose a receipt → ${p.status}`)
  if (p.proposalId) proposals.push(p.proposalId)
  const a = await tool('apply_proposal', { proposalId: p.proposalId })
  ok(a.status === 'applied' && !!a.changeSetId, `apply it → ${a.status}`)
  const inc1 = await tool('get_income', { month })
  const ov1 = await tool('get_overview', { month })
  ok(ov1.leftOverKrw - ov0.leftOverKrw === 12_345 && ov1.income?.totalKrw === inc1.totalKrw, `get_overview's left over moved by the same (${ov0.leftOverKrw} → ${ov1.leftOverKrw}; review 2 F-3)`)
  ok(inc1.leftOverKrw - inc0.leftOverKrw === 12_345, `left over moved by the difference (${inc0.leftOverKrw} → ${inc1.leftOverKrw}, salary ${before} → +12,345)`)
  ok(inc1.totalKrw - inc0.totalKrw === 12_345, `total coming in moved by the same (${inc0.totalKrw} → ${inc1.totalKrw})`)

  const rv = await tool('propose_revert', { changeSetId: a.changeSetId, note: NAME })
  if (rv.proposalId) proposals.push(rv.proposalId)
  const ra = await tool('apply_proposal', { proposalId: rv.proposalId })
  ok(ra.status === 'applied', `revert applied → ${ra.status}`)
  const inc2 = await tool('get_income', { month })
  ok(inc2.leftOverKrw === inc0.leftOverKrw && inc2.totalKrw === inc0.totalKrw, `the revert puts the month back (${inc2.leftOverKrw})`)
  const ov2 = await tool('get_overview', { month })
  ok(ov2.leftOverKrw === ov0.leftOverKrw, `get_overview's left over is back too (${ov2.leftOverKrw})`)
} catch (e) {
  threw(e)
} finally {
  disarm()
  for (const id of proposals) {
    await cleanupStep(`reject proposal ${id} if it still waits`, async () => {
      const g = await api('GET', `/api/proposals/${id}`)
      if (g.json?.status !== 'pending') return g.json?.status ?? g.status
      const r = await api('POST', `/api/proposals/${id}/reject`)
      ok(r.status === 204, `reject the waiting proposal → ${r.status}`)
    })
  }
  await cleanupStep('delete the key', async () => {
    if (!keyId) return 'no key'
    const d = await api('DELETE', `/api/keys/${keyId}`)
    ok(d.status === 204 || d.status === 200, `delete the key → ${d.status}`)
  })
  // a run stopped after the apply leaves its receipt: remove every row this run wrote (review 2 F-1)
  await cleanupStep('delete this run\'s receipts', async () => {
    const left = ((await api('GET', '/api/state')).json?.incomeReceipts ?? []).filter((r) => r.note === NAME)
    for (const r of left) {
      const d = await api('DELETE', `/api/income-receipts/${r.id}`)
      ok(d.status === 204, `delete receipt ${r.id} → ${d.status}`)
    }
    return `${left.length} removed`
  })
  const st = (await api('GET', '/api/state')).json
  ok(!(st?.incomeReceipts ?? []).some((r) => r.note === NAME), 'no receipt of this run is left')
}
console.log(failures() ? `FAILED: ${failures()} check(s)` : 'ALL PASS')
process.exit(failures() ? 1 : 0)
