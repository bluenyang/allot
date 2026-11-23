// spec 013 S-21: GET /api/docs lists every REST route the app has (each with a line, and the body of a data
// resource) and every MCP tool a write key sees (name, description, input schema). No database: nothing is called.
import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL ??= 'postgres://nobody@127.0.0.1:1/none'
process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(40)
const { app } = await import('../../server/app')
const { bodyOf, describeRoute, docsPage, listedRoutes, mcpToolDocs } = await import('../../server/docs')

const READ = ['get_overview', 'list_subscriptions', 'list_spendings', 'list_plan_changes', 'get_allocation', 'get_budget', 'list_accounts', 'get_schedule', 'list_changes', 'search', 'list_notifications']
const WRITE = ['propose_changes', 'propose_revert', 'get_proposal', 'apply_proposal']

test('every route of the app has a line on the page', () => {
  const routes = listedRoutes(app.routes)
  assert.ok(routes.length > 40)
  const missing = routes.filter((r) => !describeRoute(r)).map((r) => `${r.method} ${r.path}`)
  assert.deepEqual(missing, [])
  // each method and path once, no middleware
  assert.equal(new Set(routes.map((r) => `${r.method} ${r.path}`)).size, routes.length)
  assert.ok(!routes.some((r) => r.method === 'ALL' && r.path.endsWith('*')))
  for (const p of ['GET /api/docs', 'GET /api/state', 'POST /api/month-adjusts', 'PUT /api/accounts/:id', 'GET /api/changes', 'ALL /api/mcp']) {
    assert.ok(routes.some((r) => `${r.method} ${r.path}` === p), p)
  }
})

test('the data resources show their request body', () => {
  assert.ok(bodyOf({ method: 'POST', path: '/api/month-adjusts' }))
  assert.ok(bodyOf({ method: 'PUT', path: '/api/settings' }))
  assert.equal(bodyOf({ method: 'DELETE', path: '/api/cards/:id' }), null)
  assert.equal(bodyOf({ method: 'GET', path: '/api/state' }), null)
})

test('the MCP tools are the ones the endpoint serves to a write key, eleven read and four write', async () => {
  const tools = await mcpToolDocs()
  assert.deepEqual(tools.map((t) => t.name).sort(), [...READ, ...WRITE].sort())
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 20, t.name)
    assert.equal((t.inputSchema as { type?: string }).type, 'object', t.name)
  }
  assert.deepEqual(tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort(), [...READ, 'get_proposal'].sort())
  const search = tools.find((t) => t.name === 'search')!.inputSchema as { properties: Record<string, unknown>; required?: string[] }
  assert.deepEqual(Object.keys(search.properties).sort(), ['kinds', 'query'])
  assert.deepEqual(search.required, ['query'])
  const changes = tools.find((t) => t.name === 'list_changes')!.inputSchema as { properties: Record<string, unknown> }
  assert.ok('since' in changes.properties && 'until' in changes.properties)
})

test('the page: every tool and route, escaped, no script', async () => {
  const html = await docsPage(app.routes)
  for (const name of [...READ, ...WRITE]) assert.ok(html.includes(`id="tool-${name}"`), name)
  assert.ok(html.includes('<td class="p">/api/month-adjusts</td>'))
  assert.ok(!/<script/i.test(html))
  // descriptions are text: a quote or angle bracket in them is escaped
  assert.ok(html.includes('&lt;API key&gt;'))
  assert.ok(html.startsWith('<!doctype html>'))
})
