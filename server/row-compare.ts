// Comparing a row with a logged one (spec 005 S-3): pure, no database, so it can be unit tested on its own.
type Row = Record<string, unknown>

/**
 * Columns only the server's rate refresh writes (spec 013 S-23): when it last refreshed a rate and why the last try
 * failed. They are not the user's data, so they stay out of every logged row and every comparison: a refresh that only
 * writes them is no change, and it does not stop a revert of an earlier change to the same row (a revert leaves them).
 */
export const SERVER_ONLY = new Set(['fxAutoAt', 'fxAutoError', 'autoAt', 'autoError'])

/** JSON-safe copy (what jsonb will hold) without the server-only columns, so comparisons see the same values. */
export const plain = (r: Row): Row => JSON.parse(JSON.stringify(userColumns(r))) as Row
/** The row without the server-only columns (top level only). */
export const userColumns = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !SERVER_ONLY.has(k)))

/** Same row content, key order ignored. The owner is not content (data can move to another account). */
export function same(a: Row | null | undefined, b: Row | null | undefined): boolean {
  if (!a || !b) return !a && !b
  const norm = (r: Row) => JSON.stringify(Object.keys(r).filter((k) => k !== 'userId').sort().map((k) => [k, r[k]]))
  return norm(plain(a)) === norm(plain(b))
}

/**
 * Does the row still look as the log left it? Only the columns the logged row has are compared: a column added by a later
 * migration (e.g. settings.fx_auto, preference.timezone in 0.1.7-rc.3) is not in logs written before it, and its value
 * now is no later change of this set (review rc3-1 F-1, A-44). A revert writes only the logged columns too.
 */
export function stillAsLogged(current: Row | null | undefined, logged: Row | null | undefined): boolean {
  if (!current || !logged) return !current && !logged
  const keys = new Set(Object.keys(logged))
  return same(Object.fromEntries(Object.entries(current).filter(([k]) => keys.has(k))), logged)
}
