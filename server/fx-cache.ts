// A short memory of the rate service's answers (review rc3-1 F-8, spec 013 S-23): "지금 갱신" (POST /api/currencies/refresh)
// and the daily job ask through it, so pressing the button again, or several users with the same code, reuse the answer
// of the last few minutes instead of asking the service again. Nothing is refused or capped: every call gets an answer,
// from memory or from the service. A failure (no answer, an error status, an answer without a KRW rate) is kept for a
// shorter time than a success, so a retry soon asks again. Answers sharing one request in flight get the same result.
import type { FetchFn } from './fx-rates'

/** How long a rate answer is reused. */
export const FX_CACHE_OK_MS = 10 * 60_000
/** How long a failed answer is reused (never longer than a success). */
export const FX_CACHE_FAIL_MS = 60_000

type Answer = Awaited<ReturnType<FetchFn>>
type Snapshot = { thrown: unknown } | { ok: boolean; status: number; body: { value: unknown } | { error: unknown } }
interface Entry { until: number; snap: Promise<Snapshot> }

const replay = (s: Snapshot): Answer => {
  if ('thrown' in s) throw s.thrown
  const { body } = s
  return { ok: s.ok, status: s.status, json: async () => { if ('error' in body) throw body.error; return body.value } }
}
const isRate = (s: Snapshot) =>
  !('thrown' in s) && s.ok && 'value' in s.body && typeof (s.body.value as { rates?: { KRW?: unknown } } | null)?.rates?.KRW === 'number'

/** `fetchFn` with a memory per URL: a success is reused for `okMs`, a failure for `failMs` (at most `okMs`). */
export function cachedFetch(fetchFn: FetchFn, opts: { okMs?: number; failMs?: number; now?: () => number } = {}): FetchFn {
  const okMs = opts.okMs ?? FX_CACHE_OK_MS
  const failMs = Math.min(opts.failMs ?? FX_CACHE_FAIL_MS, okMs)
  const now = opts.now ?? Date.now
  const memo = new Map<string, Entry>()
  return async (url, init) => {
    const at = now()
    for (const [k, e] of memo) if (e.until <= at) memo.delete(k) // old answers go; the map holds only live ones
    let entry = memo.get(url)
    if (!entry) {
      const snap: Promise<Snapshot> = (async () => {
        let res: Answer
        try {
          res = await fetchFn(url, init)
        } catch (thrown) {
          return { thrown }
        }
        let body: { value: unknown } | { error: unknown }
        try {
          body = { value: await res.json() }
        } catch (error) {
          body = { error }
        }
        return { ok: res.ok, status: res.status, body }
      })()
      const e: Entry = { until: Number.POSITIVE_INFINITY, snap } // in flight: shared until it settles
      memo.set(url, e)
      void snap.then((s) => { e.until = now() + (isRate(s) ? okMs : failMs) })
      entry = e
    }
    return replay(await entry.snap)
  }
}
