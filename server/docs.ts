// GET /api/docs — the API documentation (spec 013 S-21): one page the server makes, for a signed-in user (it sits behind
// the session check in app.ts like every other /api route). It lists the REST routes the app really has (read from the
// Hono app, so a route nobody described shows up as missing in the unit test), the shape of their request bodies (the
// same zod schemas the routes validate with, as JSON Schema) and the MCP tools a write key sees, with their names,
// descriptions and input schemas (taken from the MCP server's own tools/list). Plain HTML with inline CSS, no script.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { buildMcpServer } from './mcp/tools'
import { RESOURCES, singleSchema, type ListName } from './ops'
import * as v from './validation'

export interface RouteInfo { method: string; path: string }
export interface ToolDoc { name: string; title?: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }

/** What each route that is not a data resource does, by "METHOD path". */
const ROUTES: Record<string, string> = {
  'GET /api/auth/*': 'Better Auth: sign-in, sign-out, the session (password sign-up is closed; accounts are made by an admin).',
  'POST /api/auth/*': 'Better Auth: sign-in, sign-out, the session (password sign-up is closed; accounts are made by an admin).',
  'GET /api/auth-methods': 'The sign-in methods the login screen offers (ids and names); no session needed.',
  'ALL /api/mcp': 'The MCP endpoint (Streamable HTTP, JSON responses): Authorization: Bearer <API key>, no session. Its tools are listed below.',
  'GET /api/me': 'The signed-in user (name, email, role).',
  'GET /api/password-policy': 'The minimum length of a new password ({ minLength }).',
  'POST /api/app-login/ticket': 'A one-time sign-in link for a listed app URL ({ returnTo }).',
  'GET /api/docs': 'This page.',
  'GET /api/keys': 'Your API keys (for MCP): name, scope, expiry, last use; never the key itself.',
  'POST /api/keys': 'Create an API key; the key is shown once in the answer.',
  'DELETE /api/keys/:id': 'Delete an API key.',
  'GET /api/admin/providers': 'Admin: the sign-in providers and their settings.',
  'PUT /api/admin/providers/:id': 'Admin: change a sign-in provider.',
  'GET /api/admin/api-keys': 'Admin: the API key policy.',
  'PUT /api/admin/api-keys': 'Admin: change the API key policy.',
  'POST /api/admin/users/:id/role': 'Admin: change a user\'s role.',
  'POST /api/admin/users/:id/ban': 'Admin: ban a user (signs them out everywhere).',
  'DELETE /api/admin/users/:id': 'Admin: delete a user and all their data (confirmed with their email).',
  'GET /api/admin/password-policy': 'Admin: the password policy (minimum length, lockout) and whether one is stored.',
  'PUT /api/admin/password-policy': 'Admin: change the password policy.',
  'GET /api/admin/login-locks': 'Admin: the emails locked now after failed sign-ins, with until when.',
  'DELETE /api/admin/login-locks/:email': 'Admin: unlock an email.',
  'GET /api/state': 'Everything the app shows (settings, lists in insertion order) and the number of pending proposals.',
  'GET /api/proposals': 'AI proposals, newest first, with their previews: ?status=pending|applied|rejected|expired|stale|handled&limit=&before=&beforeId=.',
  'GET /api/proposals/:id': 'One AI proposal.',
  'POST /api/proposals/:id/apply': 'Confirm an AI proposal: it is applied as one change set.',
  'POST /api/proposals/:id/reject': 'Reject an AI proposal.',
  'GET /api/changes': 'The change history, newest first: ?limit=&before=&beforeId= (the next page) and ?since=&until= (a period, ISO times).',
  'GET /api/changes/:id': 'One change set with its row changes.',
  'POST /api/changes/:id/revert': 'Revert a change set: the opposite change, as a new set.',
}

/** The request body of the routes that are not data resources. */
const BODIES: Record<string, z.ZodType> = {
  'POST /api/keys': v.keyCreate,
  'PUT /api/admin/api-keys': v.keyPolicy,
  'PUT /api/admin/password-policy': v.passwordPolicy,
  'PUT /api/admin/providers/:id': v.providerUpdate,
  'POST /api/admin/users/:id/role': v.userRole,
  'POST /api/admin/users/:id/ban': v.userBan,
  'DELETE /api/admin/users/:id': v.userDelete,
}

const SINGLE_PATHS = { '/api/settings': 'settings', '/api/living': 'living', '/api/preferences': 'preferences' } as const

/** The data resource of a path (`/api/<resource>` or `/api/<resource>/:id`), if it is one. */
function resourceOf(path: string): { name: ListName; item: boolean } | null {
  const m = /^\/api\/([a-z-]+)(\/:id)?$/.exec(path)
  return m && Object.hasOwn(RESOURCES, m[1]!) ? { name: m[1] as ListName, item: !!m[2] } : null
}

/** One line for a route; null when nobody described it. */
export function describeRoute(r: RouteInfo): string | null {
  const key = `${r.method} ${r.path}`
  if (ROUTES[key]) return ROUTES[key]
  if (r.method === 'PUT' && r.path in SINGLE_PATHS) return `Replace the ${SINGLE_PATHS[r.path as keyof typeof SINGLE_PATHS]} record (the whole record; body below).`
  const res = resourceOf(r.path)
  if (!res) return null
  if (r.method === 'POST' && !res.item) return `Create a ${res.name} row; the server assigns the id and answers with the row (body below).`
  if (r.method === 'PUT' && res.item) return `Replace a ${res.name} row (the whole row; body below).`
  if (r.method === 'DELETE' && res.item) return `Delete a ${res.name} row.`
  return null
}

/** The body schema of a route, if it takes one. */
export function bodyOf(r: RouteInfo): z.ZodType | null {
  const key = `${r.method} ${r.path}`
  if (BODIES[key]) return BODIES[key]
  if (r.method === 'PUT' && r.path in SINGLE_PATHS) return singleSchema(SINGLE_PATHS[r.path as keyof typeof SINGLE_PATHS])
  const res = resourceOf(r.path)
  if (res && ((r.method === 'POST' && !res.item) || (r.method === 'PUT' && res.item))) return RESOURCES[res.name].schema
  return null
}

/** The routes worth listing: each method and path once, without the middleware (ALL on a path ending in *). */
export function listedRoutes(all: readonly RouteInfo[]): RouteInfo[] {
  const seen = new Set<string>()
  const out: RouteInfo[] = []
  for (const r of all) {
    if (r.method === 'ALL' && r.path.endsWith('*')) continue
    const key = `${r.method} ${r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ method: r.method, path: r.path })
  }
  return out
}

/** A zod schema as JSON Schema (the input side; what JSON Schema cannot say is left open). */
export const jsonSchema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' })

let tools: Promise<ToolDoc[]> | null = null
/**
 * The MCP tools of a write key (the read tools and the proposal tools), as tools/list answers them: built once from the
 * same server the endpoint builds, through its own transport, with no database and no key (nothing is called).
 */
export function mcpToolDocs(): Promise<ToolDoc[]> {
  tools ??= (async () => {
    const server = buildMcpServer('docs', { id: 'docs', name: 'docs', confirm: 'ui' })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await server.connect(transport)
      const res = await transport.handleRequest(new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }))
      const body = await res.json() as { result?: { tools?: ToolDoc[] } }
      return body.result?.tools ?? []
    } finally {
      await server.close().catch(() => undefined)
    }
  })()
  tools.catch(() => { tools = null }) // a failure is not kept: the next request tries again
  return tools
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
const pre = (x: unknown) => `<pre>${esc(JSON.stringify(x, null, 2))}</pre>`

const CSS = `
:root{color-scheme:light dark;--bg:#F9FAF9;--fg:#16201B;--muted:#47534D;--line:#E2E5E3;--card:#FFFFFF;--code:#F1F3F2;--pri:#14705A}
@media (prefers-color-scheme:dark){:root{--bg:#111714;--fg:#E7ECE9;--muted:#A3AEA8;--line:#2A332E;--card:#171E1A;--code:#1D2521;--pri:#3DB591}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:14px;margin:0 0 4px;font-family:ui-monospace,monospace}
p{margin:0 0 8px;color:var(--muted)}
nav a{color:var(--pri);margin-right:16px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:6px}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font-size:12px;color:var(--muted);font-weight:600}
td.m{font-family:ui-monospace,monospace;font-weight:600;white-space:nowrap}
td.p{font-family:ui-monospace,monospace;word-break:break-all}
section.tool{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:0 0 10px}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 6px;border-radius:3px;border:1px solid var(--line);color:var(--muted);margin-left:6px;font-family:system-ui,sans-serif}
.desc{white-space:pre-wrap;color:var(--fg)}
details{margin-top:6px}summary{cursor:pointer;color:var(--pri)}
pre{margin:6px 0 0;padding:10px;background:var(--code);border-radius:4px;overflow:auto;font-size:12px;line-height:1.45}
`

/** The page: the routes of `app` (app.routes) and the MCP tools. */
export async function docsPage(all: readonly RouteInfo[]): Promise<string> {
  const routes = listedRoutes(all)
  const toolList = await mcpToolDocs()
  const rows = routes.map((r) => {
    const body = bodyOf(r)
    return `<tr><td class="m">${esc(r.method)}</td><td class="p">${esc(r.path)}</td><td>${esc(describeRoute(r) ?? '')}${body ? `<details><summary>Body</summary>${pre(jsonSchema(body))}</details>` : ''}</td></tr>`
  }).join('\n')
  const toolHtml = toolList.map((x) => `<section class="tool" id="tool-${esc(x.name)}"><h3>${esc(x.name)}<span class="tag">${x.annotations?.readOnlyHint ? 'read' : 'write key'}</span></h3>`
    + `${x.title ? `<p>${esc(x.title)}</p>` : ''}<div class="desc">${esc(x.description ?? '')}</div>`
    + `<details><summary>Input schema</summary>${pre(x.inputSchema ?? {})}</details></section>`).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Allot API</title><style>${CSS}</style></head>
<body><main>
<h1>Allot API</h1>
<p>Every route below <code>/api</code> needs a signed-in session (a cookie), except sign-in, the sign-in methods and <code>/api/mcp</code>, which takes an API key. Amounts are whole KRW; dates are ISO (YYYY-MM-DD, months YYYY-MM). Every write is recorded in the change history and can be reverted.</p>
<nav><a href="#rest">REST routes</a><a href="#mcp">MCP tools</a></nav>
<h2 id="rest">REST routes</h2>
<p>A data resource takes the whole row as JSON on create and replace; a field the rules refuse is answered with 400 and the reason.</p>
<table><thead><tr><th>Method</th><th>Path</th><th>What</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2 id="mcp">MCP tools</h2>
<p>Endpoint <code>POST /api/mcp</code> with <code>Authorization: Bearer &lt;API key&gt;</code>. A read key sees the read tools; a key with the write scope also sees the proposal tools, whose changes wait for the user's confirmation. ${toolList.length} tools.</p>
${toolHtml}
</main></body></html>`
}
