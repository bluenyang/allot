// The bell's marks per account (spec 016 S-1, S-2, S-8), behind the session check in app.ts:
//   GET  /api/notices/marks   { read: string[], maturityKept: string[] } — oldest first
//   POST /api/notices/marks   { read?: { add?, drop? }, maturityKept?: { add? } } → the new marks, as GET
// `read` holds notice ids the user read (src/lib/notices.ts), `maturityKept` the maturity cards answered 계속 보내기
// (`accountId@YYYY-MM`, src/lib/goals.ts). Screen state: no change set is recorded and nothing can be reverted.
// At most MAX_PER_KIND of each kind are kept; past that the oldest go (an add is never refused for it).
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { AppEnv } from './app-env'
import { body } from './body'
import type { Db } from './db/client'
import { asUser } from './db/scope'
import * as t from './db/schema'
import { noticeMarks as schema } from './validation'

export const MAX_PER_KIND = 2000
type Kind = 'read' | 'maturity_kept'
export interface Marks { read: string[]; maturityKept: string[] }

/** The user's marks, oldest first (inside the caller's user scope). */
export async function readMarks(q: Db, uid: string): Promise<Marks> {
  const rows = await q.select({ kind: t.noticeMark.kind, key: t.noticeMark.key }).from(t.noticeMark)
    .where(eq(t.noticeMark.userId, uid)).orderBy(asc(t.noticeMark.createdAt), asc(t.noticeMark.key))
  return {
    read: rows.filter((r) => r.kind === 'read').map((r) => r.key),
    maturityKept: rows.filter((r) => r.kind === 'maturity_kept').map((r) => r.key),
  }
}

async function add(q: Db, uid: string, kind: Kind, keys: readonly string[]) {
  if (!keys.length) return
  await q.insert(t.noticeMark).values([...new Set(keys)].map((key) => ({ userId: uid, kind, key }))).onConflictDoNothing()
  // keep the newest MAX_PER_KIND of this kind
  await q.execute(sql`delete from ${t.noticeMark} where ${t.noticeMark.userId} = ${uid} and ${t.noticeMark.kind} = ${kind} and ${t.noticeMark.key} in (
    select ${t.noticeMark.key} from ${t.noticeMark} where ${t.noticeMark.userId} = ${uid} and ${t.noticeMark.kind} = ${kind}
    order by ${t.noticeMark.createdAt} desc, ${t.noticeMark.key} desc offset ${MAX_PER_KIND})`)
}

async function drop(q: Db, uid: string, kind: Kind, keys: readonly string[]) {
  if (!keys.length) return
  await q.delete(t.noticeMark).where(and(eq(t.noticeMark.userId, uid), eq(t.noticeMark.kind, kind), inArray(t.noticeMark.key, [...keys])))
}

const uidOf = (c: Context<AppEnv>) => c.get('session').user.id

export const noticeMarkRoutes = new Hono<AppEnv>()

noticeMarkRoutes.get('/', async (c) => c.json(await asUser(uidOf(c), (q) => readMarks(q, uidOf(c)))))

noticeMarkRoutes.post('/', body(schema), async (c) => {
  const uid = uidOf(c)
  const b = c.req.valid('json')
  return c.json(await asUser(uid, async (q) => {
    // drops first: a key both dropped and added in one request stays
    await drop(q, uid, 'read', b.read?.drop ?? [])
    await add(q, uid, 'read', b.read?.add ?? [])
    await add(q, uid, 'maturity_kept', b.maturityKept?.add ?? [])
    return readMarks(q, uid)
  }))
})
