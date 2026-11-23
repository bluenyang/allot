// The daily rate refresh (spec 013 S-23, A-38), the part without the database: fetch a rate from the public rate service
// (Frankfurter, ECB rates) and work out what to write. server/fx-refresh.ts runs it per user against the database; the
// unit tests run it with a fake fetch.
//   ALLOT_FX_URL      the rate service (default https://api.frankfurter.app)
//   ALLOT_FX_REFRESH  'off' switches the refresh off for the whole server

export const FX_DEFAULT_URL = 'https://api.frankfurter.app'
/** How long one rate request may take. */
export const FX_TIMEOUT_MS = 10_000
/** The rate column is numeric(8,2): KRW per unit, above 0 (spec 013 S-26). */
const RATE_MAX = 999_999.99

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Why a refresh did not change a rate, stored in `*_auto_error` (the screen words the known ones):
 * unknown_code — the service has no rate for the code; http_<n> — another answer status; timeout; network — no answer;
 * bad_answer — an answer without a KRW rate; out_of_range — a rate the column cannot hold (0 after rounding, or too big).
 */
export type FxError = 'unknown_code' | `http_${number}` | 'timeout' | 'network' | 'bad_answer' | 'out_of_range'
export type FxResult = { rate: number } | { error: FxError }

export const fxBase = (env: Record<string, string | undefined> = process.env) => (env.ALLOT_FX_URL?.trim() || FX_DEFAULT_URL).replace(/\/+$/, '')
export const fxEnabled = (env: Record<string, string | undefined> = process.env) => env.ALLOT_FX_REFRESH?.trim().toLowerCase() !== 'off'

const round2 = (n: number) => Math.round(n * 100) / 100

/** KRW per one unit of `code`, rounded to 2 decimals, or why there is none. Never throws. */
export async function fetchRate(code: string, fetchFn: FetchFn, base = fxBase(), timeoutMs = FX_TIMEOUT_MS): Promise<FxResult> {
  let res: Awaited<ReturnType<FetchFn>>
  try {
    res = await fetchFn(`${base}/latest?from=${encodeURIComponent(code)}&to=KRW`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    const name = (e as { name?: string })?.name
    return { error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
  // Frankfurter answers 404 (and older versions 422) for a code it does not have (A-38: the switch stays on, the rate stays).
  if (res.status === 404 || res.status === 422) return { error: 'unknown_code' }
  if (!res.ok) return { error: `http_${res.status}` }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { error: 'bad_answer' }
  }
  const raw = (body as { rates?: Record<string, unknown> } | null)?.rates?.KRW
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: 'bad_answer' }
  const rate = round2(raw)
  if (!(rate > 0) || rate > RATE_MAX) return { error: 'out_of_range' }
  return { rate }
}

/** One user's rates as the refresh sees them: USD from the settings, the others from the currency list. */
export interface FxState {
  settings: { fxRate: number; fxAuto: boolean } | null
  currencies: { id: string; code: string; rate: number; auto: boolean }[]
}

/** The codes whose rate the refresh asks for: USD when its switch is on, every listed code with `auto` (each once). */
export function autoCodes(s: FxState): string[] {
  const codes = new Set<string>()
  if (s.settings?.fxAuto) codes.add('USD')
  for (const c of s.currencies) if (c.auto) codes.add(c.code)
  return [...codes]
}

/** What to write: the rate when it changed (a change set), and the refresh columns (not logged) on every row tried. */
export interface FxWrite {
  settings?: { fxRate?: number; fxAutoAt?: string; fxAutoError: string | null }
  currencies: { id: string; rate?: number; autoAt?: string; autoError: string | null }[]
}

/**
 * The writes for the fetched results. A success sets the time and clears the error (the rate only when it differs); a
 * failure keeps the rate and the time of the last success and writes the reason. Rows whose switch is off, or whose code
 * was not fetched, are left alone.
 */
export function planWrites(s: FxState, results: ReadonlyMap<string, FxResult>, now: string): FxWrite {
  const out: FxWrite = { currencies: [] }
  const usd = s.settings?.fxAuto ? results.get('USD') : undefined
  if (usd) {
    out.settings = 'rate' in usd
      ? { ...(usd.rate !== s.settings!.fxRate ? { fxRate: usd.rate } : {}), fxAutoAt: now, fxAutoError: null }
      : { fxAutoError: usd.error }
  }
  for (const c of s.currencies) {
    const r = c.auto ? results.get(c.code) : undefined
    if (!r) continue
    out.currencies.push('rate' in r
      ? { id: c.id, ...(r.rate !== c.rate ? { rate: r.rate } : {}), autoAt: now, autoError: null }
      : { id: c.id, autoError: r.error })
  }
  return out
}

/** The database side of a run, so the run itself can be tested without one. */
export interface FxStore {
  /** Every user id. */
  users(): Promise<string[]>
  /** The user's rates (read in its own short transaction). */
  read(uid: string): Promise<FxState>
  /** Write the results for the user (re-reads the rows under the user's lock; one change set when a rate changed). */
  write(uid: string, results: ReadonlyMap<string, FxResult>): Promise<void>
}

/**
 * Refresh one user's auto rates: nothing is fetched when no switch is on. The requests run outside any transaction, so
 * the user's data is not locked while the service answers. `cache` shares one answer per code within a run.
 */
export async function refreshUser(uid: string, store: FxStore, fetchFn: FetchFn, cache = new Map<string, Promise<FxResult>>(), base = fxBase()): Promise<boolean> {
  const codes = autoCodes(await store.read(uid))
  if (!codes.length) return false
  const results = new Map<string, FxResult>()
  for (const code of codes) {
    if (!cache.has(code)) cache.set(code, fetchRate(code, fetchFn, base))
    results.set(code, await cache.get(code)!)
  }
  await store.write(uid, results)
  return true
}

/** Refresh every user (one failing user does not stop the others); returns how many users had an auto rate. */
export async function refreshAll(store: FxStore, fetchFn: FetchFn, base = fxBase(), log: (msg: string, e: unknown) => void = console.error): Promise<number> {
  const cache = new Map<string, Promise<FxResult>>()
  let n = 0
  for (const uid of await store.users()) {
    try {
      if (await refreshUser(uid, store, fetchFn, cache, base)) n++
    } catch (e) {
      log('rate refresh failed for a user', e)
    }
  }
  return n
}
