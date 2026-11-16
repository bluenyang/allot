// API keys for the read-only MCP endpoint (spec 008 S-1, S-3), behind the session check in app.ts:
//   GET    /api/keys        my keys (never the key or its hash) and the expiry policy
//   POST   /api/keys        { name, expiresInDays? }  → { key, item }; `key` is in this response only
//   DELETE /api/keys/:id    my key; someone else's id is 404
// A key itself cannot reach these routes: it is no session, and the plugin's own HTTP paths are closed.
import { zValidator } from '@hono/zod-validator'
import { and, count, eq, gt, isNull, or } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import { loadKeyPolicy, applyExpiryCap } from './api-key-policy'
import type { AppEnv } from './app-env'
import { getAuth } from './auth'
import { db } from './db/client'
import * as a from './db/auth-schema'
import * as v from './validation'

/** At most this many live keys per user. */
export const MAX_KEYS = 10
const DEFAULT_DAYS = 90
const DAY = 86_400

const body = <S extends z.ZodType>(schema: S) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) {
      const issue = r.error.issues[0]
      return c.json({ error: issue?.message ?? '입력값을 확인해 주세요.', path: issue?.path.join('.') ?? '' }, 400)
    }
  })

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

interface PluginKey {
  id: string
  name?: string | null
  start?: string | null
  permissions?: Record<string, string[]> | null
  createdAt: Date | string
  expiresAt?: Date | string | null
  lastRequest?: Date | string | null
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

/** What the screen and the API show of a key: no key, no hash. */
function item(k: PluginKey) {
  return {
    id: k.id, name: k.name ?? '', start: k.start ?? '', permissions: k.permissions ?? {},
    createdAt: iso(k.createdAt), expiresAt: iso(k.expiresAt), lastUsedAt: iso(k.lastRequest),
  }
}

/** Live keys of a user (an expired key is not live: the plugin removes it when it is next seen). */
const liveKeys = (uid: string) =>
  db.select({ n: count() }).from(a.apikey)
    .where(and(eq(a.apikey.referenceId, uid), or(isNull(a.apikey.expiresAt), gt(a.apikey.expiresAt, new Date()))))

export const keyRoutes = new Hono<AppEnv>()

keyRoutes.get('/', async (c) => {
  const [policy, list] = await Promise.all([
    loadKeyPolicy(),
    getAuth().api.listApiKeys({ headers: c.req.raw.headers }),
  ])
  const keys = (list.apiKeys as PluginKey[]).map(item)
    .sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''))
  return c.json({ keys, policy: { noExpiry: policy.noExpiry }, max: MAX_KEYS })
})

keyRoutes.post('/', body(v.keyCreate), async (c) => {
  const uid = uidOf(c)
  const { name, expiresInDays } = c.req.valid('json')
  const policy = await loadKeyPolicy()
  if (expiresInDays === null && !policy.noExpiry) {
    return c.json({ error: '이 서버는 만료 없는 키를 허용하지 않아요.', path: 'expiresInDays' }, 400)
  }
  const [live] = await liveKeys(uid)
  if ((live?.n ?? 0) >= MAX_KEYS) return c.json({ error: `키는 ${MAX_KEYS}개까지 만들 수 있어요.` }, 400)
  const days = expiresInDays === undefined ? DEFAULT_DAYS : expiresInDays
  let created
  try {
    created = await getAuth().api.createApiKey({
      headers: c.req.raw.headers,
      body: { name, expiresIn: days === null ? null : days * DAY },
    })
  } catch (e) {
    // The plugin's own checks (name length, expiry range) are already covered by the schema; anything else is ours to hide.
    console.warn(`api keys: create failed: ${(e as Error).message}`)
    return c.json({ error: '키를 만들지 못했어요.' }, 400)
  }
  const { key, ...made } = created
  const rest = made as PluginKey
  // Two requests at once can both pass the count above: the later one takes its key back.
  const [after] = await liveKeys(uid)
  if ((after?.n ?? 0) > MAX_KEYS) {
    await db.delete(a.apikey).where(eq(a.apikey.id, created.id))
    return c.json({ error: `키는 ${MAX_KEYS}개까지 만들 수 있어요.` }, 400)
  }
  // A save that turned no-expiry keys off while this key was being made: give it its year too.
  let shown: PluginKey = rest
  if (days === null && !(await loadKeyPolicy()).noExpiry) {
    await applyExpiryCap()
    const [row] = await db.select({ expiresAt: a.apikey.expiresAt }).from(a.apikey).where(eq(a.apikey.id, created.id))
    shown = { ...rest, expiresAt: row?.expiresAt ?? null }
  }
  return c.json({ key, item: item(shown) }, 201)
})

keyRoutes.delete('/:id', async (c) => {
  try {
    await getAuth().api.deleteApiKey({ headers: c.req.raw.headers, body: { keyId: c.req.param('id') } })
  } catch (e) {
    const status = (e as { statusCode?: number; status?: number | string }).statusCode
    if (status === 404) return c.json({ error: '없는 키예요.' }, 404)
    throw e
  }
  return c.body(null, 204)
})
