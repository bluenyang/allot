// The bell's marks of the signed-in account (spec 016 S-1, S-2): notices read and maturity cards answered 계속 보내기,
// kept on the server (GET/POST /api/notices/marks) so every device shows the same. A mark shows at once; the server's
// answer then replaces the marks (the store takes the server's answer). Before 0.1.9-rc.2 they were in this browser's
// localStorage: the first sign-in here sends them to the account once and removes them (S-2).
import { reactive } from 'vue'
import { api } from './api'
import { sessionScope } from './store'
import { showToast } from './toast'
import { t } from '../i18n'

export const OLD_READ_KEY = 'allot.notices.read'
export const OLD_KEPT_KEY = 'allot.maturityKept'
/** One request carries at most this many marks (server/validation.ts noticeMarks). */
export const MAX_PER_REQUEST = 500

interface Marks { read: string[]; maturityKept: string[] }
export interface MarkChange { read?: { add?: string[]; drop?: string[] }; maturityKept?: { add?: string[] } }

export const marks = reactive({ read: new Set<string>(), kept: new Set<string>() })

const apply = (m: Marks) => {
  marks.read = new Set(m.read)
  marks.kept = new Set(m.maturityKept)
}

/** The session ended or changed: forget the marks of the last account. */
export function resetMarks() {
  marks.read = new Set()
  marks.kept = new Set()
}

/** The marks this browser kept before rc.2 (an unreadable or blocked storage has none). */
function oldList(key: string): string[] {
  try {
    const v: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200) : []
  } catch {
    return []
  }
}

/** The changes that send `read` and `kept` in requests of at most MAX_PER_REQUEST marks (pure; for the tests). */
export function uploadChunks(read: readonly string[], kept: readonly string[]): MarkChange[] {
  const out: MarkChange[] = []
  for (let i = 0; i < read.length; i += MAX_PER_REQUEST) out.push({ read: { add: read.slice(i, i + MAX_PER_REQUEST) } })
  for (let i = 0; i < kept.length; i += MAX_PER_REQUEST) out.push({ maturityKept: { add: kept.slice(i, i + MAX_PER_REQUEST) } })
  return out
}

/** S-2: send this browser's old marks to the account once; they are removed only after every request succeeded. */
async function uploadOld(scope: ReturnType<typeof sessionScope>) {
  const chunks = uploadChunks(oldList(OLD_READ_KEY), oldList(OLD_KEPT_KEY))
  if (!chunks.length) return
  let last: Marks | null = null
  for (const c of chunks) {
    if (!scope.alive()) return
    last = await api<Marks>('POST', '/api/notices/marks', c)
  }
  try {
    globalThis.localStorage?.removeItem(OLD_READ_KEY)
    globalThis.localStorage?.removeItem(OLD_KEPT_KEY)
  } catch { /* storage blocked: it had nothing to send */ }
  if (last && scope.alive()) apply(last)
}

/** Read the account's marks (after sign-in), then send the old ones of this browser if there are any. */
export async function loadMarks() {
  const scope = sessionScope()
  try {
    const m = await api<Marks>('GET', '/api/notices/marks')
    if (!scope.alive()) return
    apply(m)
    await uploadOld(scope)
  } catch {
    // the bell works without them (everything shows unread); the next load tries again, the old marks stay until then
  }
}

/** Save a change. The marks show at once; a refused or failed save puts the server's marks back and says so. */
export async function saveMarks(change: MarkChange) {
  const scope = sessionScope()
  const read = new Set(marks.read)
  for (const id of change.read?.drop ?? []) read.delete(id)
  for (const id of change.read?.add ?? []) read.add(id)
  const kept = new Set(marks.kept)
  for (const k of change.maturityKept?.add ?? []) kept.add(k)
  marks.read = read
  marks.kept = kept
  try {
    const m = await api<Marks>('POST', '/api/notices/marks', change)
    if (scope.alive()) apply(m)
  } catch {
    if (!scope.alive()) return
    showToast(t('shell.noticeSaveFailed'), { error: true })
    await loadMarks()
  }
}
