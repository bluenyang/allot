// spec 013 rc.3 W-20: the password policy (S-24, S-26, A-37), the generator and the key update body (S-25). No database:
// the lockout counting runs on the pure rules with a fake clock.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyCreate, keyUpdate, passwordPolicy } from '../../server/validation'
import {
  CHECKED_WITHOUT_POLICY, DEFAULT_POLICY, failureKey, lockedMinutes, nextFailure, parsePolicy, PASSWORD_FIELDS, tooShort,
  type FailureRow,
} from '../../server/password-rules'
import { generatePassword, PASSWORD_ALPHABET, PASSWORD_LENGTH } from '../../src/lib/password-gen'

const ok = (schema: { safeParse: (x: unknown) => { success: boolean; error?: { issues: unknown[] } } }, x: unknown) => {
  const r = schema.safeParse(x)
  assert.equal(r.success, true, JSON.stringify(r.error?.issues))
}
const no = (schema: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) => assert.equal(schema.safeParse(x).success, false, JSON.stringify(x))

const P = (minLength: number, enabled = false, attempts = 5, minutes = 15) => ({ minLength, lockout: { enabled, attempts, minutes } })

test('the default policy is the behaviour before the policy: minimum 8, lockout off (S-24)', () => {
  assert.deepEqual(DEFAULT_POLICY, P(8))
  ok(passwordPolicy, DEFAULT_POLICY)
})

test('policy ranges are exactly S-26: minimum 8..128, attempts 3..20, minutes 1..1440, whole numbers', () => {
  for (const n of [8, 64, 128]) ok(passwordPolicy, P(n))
  for (const n of [7, 129, 8.5, 0, -1]) no(passwordPolicy, P(n))
  for (const a of [3, 20]) ok(passwordPolicy, P(8, true, a))
  for (const a of [2, 21, 4.5]) no(passwordPolicy, P(8, true, a))
  for (const m of [1, 1440]) ok(passwordPolicy, P(8, true, 5, m))
  for (const m of [0, 1441, 1.5]) no(passwordPolicy, P(8, true, 5, m))
  no(passwordPolicy, { minLength: 8 })
  no(passwordPolicy, { ...P(8), extra: 1 })
  no(passwordPolicy, { minLength: '8', lockout: DEFAULT_POLICY.lockout })
})

test('a stored policy is read only when it is valid; anything else is the default', () => {
  assert.deepEqual(parsePolicy(P(12, true, 3, 60)), P(12, true, 3, 60))
  for (const bad of [null, {}, 'x', P(7), P(8, true, 2), { minLength: 8, lockout: null }, { minLength: 8, lockout: { enabled: 'yes', attempts: 5, minutes: 15 } }]) {
    assert.equal(parsePolicy(bad), null, JSON.stringify(bad))
  }
})

test('the minimum applies on every path that sets a password; create-user only once a policy is stored', () => {
  const p = P(12)
  assert.equal(tooShort('/change-password', { newPassword: 'a'.repeat(11) }, p, true), 12)
  assert.equal(tooShort('/change-password', { newPassword: 'a'.repeat(12) }, p, true), null)
  assert.equal(tooShort('/admin/set-user-password', { userId: 'u', newPassword: 'short' }, p, true), 12)
  assert.equal(tooShort('/admin/create-user', { email: 'e@x.y', password: 'short' }, p, true), 12)
  // No policy stored: create-user keeps what it accepted before (Better Auth checks no minimum there).
  assert.equal(tooShort('/admin/create-user', { email: 'e@x.y', password: 'short' }, DEFAULT_POLICY, false), null)
  // The other paths keep Better Auth's own 8 without a policy, the same number.
  assert.equal(tooShort('/change-password', { newPassword: '1234567' }, DEFAULT_POLICY, false), 8)
  assert.equal(tooShort('/change-password', { newPassword: '12345678' }, DEFAULT_POLICY, false), null)
  // No password in the body (create-user without one), or a path that sets none.
  assert.equal(tooShort('/admin/create-user', { email: 'e@x.y' }, p, true), null)
  assert.equal(tooShort('/sign-in/email', { email: 'e@x.y', password: 'x' }, p, true), null)
  assert.deepEqual([...CHECKED_WITHOUT_POLICY].sort(), Object.keys(PASSWORD_FIELDS).filter((k) => k !== '/admin/create-user').sort())
})

test('the lockout key is the email as typed, trimmed and in lower case', () => {
  assert.equal(failureKey('  Me@Example.COM '), 'me@example.com')
  assert.equal(failureKey(''), null)
  assert.equal(failureKey('   '), null)
  assert.equal(failureKey(undefined), null)
  assert.equal(failureKey(42), null)
})

test('lockout counting with a fake clock: N failures lock for M minutes, then the count starts again (A-37)', () => {
  const lock = { enabled: true, attempts: 3, minutes: 10 }
  const t0 = new Date('2031-01-01T00:00:00Z')
  const at = (min: number) => new Date(t0.getTime() + min * 60_000)
  let row: FailureRow | null = null
  row = nextFailure(row, at(0), lock)
  assert.deepEqual([row.count, row.lockedUntil], [1, null])
  row = nextFailure(row, at(1), lock)
  assert.deepEqual([row.count, row.lockedUntil], [2, null])
  assert.equal(lockedMinutes(row, at(1)), 0)
  row = nextFailure(row, at(2), lock)
  assert.equal(row.count, 3)
  assert.equal(row.lockedUntil?.toISOString(), at(12).toISOString())
  assert.equal(lockedMinutes(row, at(2)), 10)
  assert.equal(lockedMinutes(row, at(11.5)), 1) // rounds up: never "0 minutes" while locked
  // While locked, a failure (cannot normally reach the count) changes nothing.
  assert.deepEqual(nextFailure(row, at(5), lock), row)
  // After the lock: unlocked, and the next failure counts from 1.
  assert.equal(lockedMinutes(row, at(12)), 0)
  const after = nextFailure(row, at(13), lock)
  assert.deepEqual([after.count, after.lockedUntil], [1, null])
})

test('failures older than a day count for nothing', () => {
  const lock = { enabled: true, attempts: 5, minutes: 15 }
  const t0 = new Date('2031-01-01T00:00:00Z')
  const old: FailureRow = { count: 4, lockedUntil: null, updatedAt: t0 }
  const day = new Date(t0.getTime() + 86_400_000 + 1)
  assert.equal(nextFailure(old, day, lock).count, 1)
  assert.equal(nextFailure(old, new Date(t0.getTime() + 3_600_000), lock).count, 5)
})

test('the generator: 20 characters from the alphabet, from the random source given', () => {
  const pw = generatePassword()
  assert.equal(pw.length, PASSWORD_LENGTH)
  assert.equal(PASSWORD_LENGTH, 20)
  for (const ch of pw) assert.ok(PASSWORD_ALPHABET.includes(ch), ch)
  assert.ok(/[A-Za-z]/.test(PASSWORD_ALPHABET) && /[0-9]/.test(PASSWORD_ALPHABET) && /[^A-Za-z0-9]/.test(PASSWORD_ALPHABET))
  assert.notEqual(generatePassword(), generatePassword())
  // Bytes at or past the last whole run of the alphabet are drawn again (no modulo bias).
  const n = PASSWORD_ALPHABET.length
  const limit = 256 - (256 % n)
  let calls = 0
  const rng = (a: Uint8Array) => { a.fill(calls++ === 0 ? limit : 1); return a }
  assert.equal(generatePassword(4, PASSWORD_ALPHABET, rng), PASSWORD_ALPHABET[1].repeat(4))
  assert.equal(calls, 2)
})

test('key update body (S-25): any of name, write, confirm, extendDays; the create rules', () => {
  ok(keyUpdate, { name: 'New name' })
  ok(keyUpdate, { name: '  x  ' })
  no(keyUpdate, { name: '   ' })
  no(keyUpdate, { name: 'x'.repeat(33) })
  ok(keyUpdate, { name: 'x'.repeat(32) })
  ok(keyUpdate, { write: true, confirm: 'chat' })
  ok(keyUpdate, { write: false })
  ok(keyUpdate, { confirm: 'ui' }) // the route checks the key is (or stays) a write key
  no(keyUpdate, { write: false, confirm: 'ui' })
  no(keyUpdate, { confirm: 'mail' })
  for (const d of [1, 30, 365, null]) ok(keyUpdate, { extendDays: d })
  for (const d of [0, 366, 1.5, '30']) no(keyUpdate, { extendDays: d })
  no(keyUpdate, {})
  no(keyUpdate, { name: 'x', expiresInDays: 30 })
  // The create body is unchanged.
  ok(keyCreate, { name: 'k', expiresInDays: 90, write: true, confirm: 'chat' })
  no(keyCreate, { name: 'k', confirm: 'chat' })
})
