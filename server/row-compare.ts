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

/**
 * A logged row in the shape its table has now. A settings row logged up to 0.1.9 has the one weekend and holiday rule
 * `dayShift`, which became the rule of each date (spec 018 S-1, migration 0045): read it as that rule on all three, the
 * way the migration moved the saved row, so a change set logged before the upgrade still compares and reverts
 * (A-2). A rule the logged row names itself wins. Every other row is returned as it is.
 */
export function asNow(table: string, logged: Row | null | undefined): Row | null {
  if (!logged) return null
  if (table !== 'settings' || !('dayShift' in logged)) return logged
  const { dayShift: all, ...row } = logged
  return { ...row, payShift: row.payShift ?? all, transferShift: row.transferShift ?? all, billingShift: row.billingShift ?? all }
}

/** A logged row change, as the change log holds it (the part the comparisons read). */
export interface LoggedChange { tableName: string; op: string; rowKey: Record<string, string>; before: unknown; after: unknown }

/**
 * Is `log` the settings change a card's delete makes in its own set to let go of the month basis card (spec 018 S-3,
 * ops `dropBasisCard`)? It is an update of the settings row that clears `monthBasisCardId`, of the very card the set
 * deletes, and changes nothing but the two month keys (`monthBasis` goes back to 'calendar' when it was 'card'). The
 * revert of such a set handles this row by those two keys alone (review 2 F-3 a, A-26): a later change of any other
 * column of the settings row — the daily rate refresh makes one — is no reason to refuse bringing the card back.
 */
export function isBasisDrop(log: LoggedChange, set: readonly LoggedChange[]): boolean {
  if (log.tableName !== 'settings' || log.op !== 'update' || !log.before || !log.after) return false
  const [before, after] = [log.before as Row, log.after as Row]
  const cardId = before.monthBasisCardId
  if (typeof cardId !== 'string' || after.monthBasisCardId !== null) return false
  if (!set.some((l) => l.tableName === 'card' && l.op === 'delete' && l.rowKey.id === cardId)) return false
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].every((k) => k === 'monthBasis' || k === 'monthBasisCardId' || JSON.stringify(before[k]) === JSON.stringify(after[k]))
}

/** Are the settings' month keys still what that change left them (so the revert may put the basis back)? */
export const basisAsLeft = (current: Row | null | undefined, after: Row): boolean =>
  !!current && current.monthBasis === after.monthBasis && (current.monthBasisCardId ?? null) === null

