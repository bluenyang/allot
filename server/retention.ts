// Change-set retention (spec 005 S-4). CHANGE_LOG_RETENTION_DAYS unset or empty: keep everything.
// Set: at start and then once a day, each user's sets older than that many days are deleted.
// Row-level security sees one user at a time, so this runs per user.
import { db } from './db/client'
import { user } from './db/auth-schema'
import { asUser } from './db/scope'
import { pruneSets } from './changes'

export function retentionDays(): number | null {
  const raw = process.env.CHANGE_LOG_RETENTION_DAYS?.trim()
  if (!raw) return null
  const days = Number(raw)
  if (!Number.isInteger(days) || days < 1) throw new Error('CHANGE_LOG_RETENTION_DAYS must be a whole number of days (1 or more), or empty')
  return days
}

export async function pruneAll(days: number) {
  let total = 0
  for (const u of await db.select({ id: user.id }).from(user)) total += await asUser(u.id, (q) => pruneSets(q, u.id, days))
  return total
}

export async function startRetention() {
  const days = retentionDays()
  if (days === null) return
  const run = async () => {
    try {
      const n = await pruneAll(days)
      if (n) console.log(`change log: removed ${n} change set(s) older than ${days} day(s)`)
    } catch (e) {
      console.error('change log retention failed', e)
    }
  }
  await run()
  setInterval(run, 86_400_000).unref()
}
