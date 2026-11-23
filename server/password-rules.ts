// Password policy rules (spec 013 S-24, S-26, A-37), pure: no database, so the unit tests can run them with a fake clock.
// server/password-policy.ts reads and writes the rows and calls these.
//
// The policy, stored in app_setting id 'password':
//   { minLength, lockout: { enabled, attempts, minutes } }
// Nothing stored is DEFAULT_POLICY, which is the behaviour before the policy existed: Better Auth's own minimum of 8
// and no lockout. A stored value that is not a valid policy (it cannot come from our route) is read as the default too.

export interface Lockout { enabled: boolean; attempts: number; minutes: number }
export interface PasswordPolicy { minLength: number; lockout: Lockout }

/** S-26: the ranges an admin may choose (whole numbers). */
export const LIMITS = { minLength: [8, 128], attempts: [3, 20], minutes: [1, 1440] } as const

export const DEFAULT_POLICY: PasswordPolicy = { minLength: 8, lockout: { enabled: false, attempts: 5, minutes: 15 } }

const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi

/** The stored jsonb as a policy, or null when it is not one. */
export function parsePolicy(value: unknown): PasswordPolicy | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { minLength?: unknown; lockout?: { enabled?: unknown; attempts?: unknown; minutes?: unknown } | null }
  const l = v.lockout
  if (!inRange(v.minLength, LIMITS.minLength) || !l || typeof l !== 'object') return null
  if (typeof l.enabled !== 'boolean' || !inRange(l.attempts, LIMITS.attempts) || !inRange(l.minutes, LIMITS.minutes)) return null
  return { minLength: v.minLength, lockout: { enabled: l.enabled, attempts: l.attempts, minutes: l.minutes } }
}

// ── Where a password is set ──
/**
 * Better Auth paths that set a password, and the body field that holds it. Sign-up is closed (disableSignUp), so the
 * admin's create-user is the sign-up path ("가입 때 같은 규칙"). /set-password is server-only and /reset-password has no
 * way to get a token (no reset mail is configured); they are listed so a later change cannot open them without the rule.
 */
export const PASSWORD_FIELDS: Record<string, string> = {
  '/change-password': 'newPassword',
  '/set-password': 'newPassword',
  '/reset-password': 'newPassword',
  '/sign-up/email': 'password',
  '/admin/create-user': 'password',
  '/admin/set-user-password': 'newPassword',
}

/**
 * Better Auth checks its own minimum (8) on every one of these paths except /admin/create-user. Before the policy, an
 * admin could create an account with a shorter password through the API; that stays so while no policy is stored
 * (nothing new is refused by default, S-24). Once the admin saves a policy, its minimum applies there too.
 */
export const CHECKED_WITHOUT_POLICY = new Set(Object.keys(PASSWORD_FIELDS).filter((p) => p !== '/admin/create-user'))

/** The minimum a new password on `path` must reach, or null when the path sets none or the rule does not apply. */
export function minimumFor(path: string, body: unknown, policy: PasswordPolicy, stored: boolean): { min: number; password: string } | null {
  const field = PASSWORD_FIELDS[path]
  if (!field) return null
  const password = (body as Record<string, unknown> | null | undefined)?.[field]
  // No password (create-user without one, or a malformed body): Better Auth's own schema answers.
  if (typeof password !== 'string' || password === '') return null
  if (!stored && !CHECKED_WITHOUT_POLICY.has(path)) return null
  return { min: policy.minLength, password }
}

/** Is the new password shorter than the minimum? Length as Better Auth counts it (string length). */
export function tooShort(path: string, body: unknown, policy: PasswordPolicy, stored: boolean): number | null {
  const r = minimumFor(path, body, policy, stored)
  return r && r.password.length < r.min ? r.min : null
}

// ── Lockout (A-37) ──
/** The row key: the email as typed, trimmed and in lower case (also for an email with no account). */
export const failureKey = (email: unknown): string | null => {
  if (typeof email !== 'string') return null
  const k = email.trim().toLowerCase()
  return k ? k : null
}

export interface FailureRow { count: number; lockedUntil: Date | null; updatedAt: Date }

const DAY_MS = 86_400_000
/** A row this old that is not locked counts for nothing (and is deleted when the table is touched). */
export const STALE_MS = DAY_MS

/** Whole minutes left of a lock (at least 1), or 0 when the row is not locked at `now`. */
export function lockedMinutes(row: Pick<FailureRow, 'lockedUntil'> | null | undefined, now: Date): number {
  if (!row?.lockedUntil) return 0
  const left = row.lockedUntil.getTime() - now.getTime()
  return left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : 0
}

/**
 * The row after one more failed sign-in at `now`. A lock that has ended, or failures older than a day, start the count
 * again; reaching `attempts` locks the email for `minutes`.
 */
export function nextFailure(row: FailureRow | null | undefined, now: Date, lockout: Lockout): FailureRow {
  if (row && lockedMinutes(row, now) > 0) return row // still locked: refused before the password is checked
  const fresh = !row || row.lockedUntil !== null || now.getTime() - row.updatedAt.getTime() > STALE_MS
  const count = (fresh ? 0 : row.count) + 1
  const lockedUntil = count >= lockout.attempts ? new Date(now.getTime() + lockout.minutes * 60_000) : null
  return { count, lockedUntil, updatedAt: now }
}

/** Rows that may be deleted at `now`: not locked, and last touched more than a day ago. */
export const isPrunable = (row: FailureRow, now: Date): boolean =>
  lockedMinutes(row, now) === 0 && now.getTime() - row.updatedAt.getTime() > STALE_MS
