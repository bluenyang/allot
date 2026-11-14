// spec 006 V-3 (a)(b)(c)(e): envelope primitives, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import {
  CryptoError, fieldAad, kidOf, newDataKey, open, parseMasterKeys, seal, unwrapDataKey, wrapDataKey,
} from '../../server/crypto/envelope'

const key = () => randomBytes(32)
const b64 = (b: Buffer) => b.toString('base64')
const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)

test('(a) seal then open gives the plaintext', () => {
  const k = key()
  const kid = kidOf(k)
  const aad = fieldAad('u1', { table: 'account', column: 'access_token', row: 'oidc/abc' })
  for (const plain of ['', 'gho_token', '한글 값', 'x'.repeat(10_000)]) {
    const s = seal(k, kid, plain, aad)
    assert.match(s, /^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]*\.[\w-]+$/)
    assert.ok(!s.includes(plain) || plain === '')
    assert.equal(open(() => k, s, aad).toString('utf8'), plain)
  }
})

test('(a) the same plaintext seals differently each time (random nonce)', () => {
  const k = key()
  assert.notEqual(seal(k, kidOf(k), 'same', 'a'), seal(k, kidOf(k), 'same', 'a'))
})

test('(b) any change to nonce, ciphertext, tag or AAD fails', () => {
  const k = key()
  const kid = kidOf(k)
  const ref = { table: 'account', column: 'refresh_token', row: 'github/1' }
  const s = seal(k, kid, 'secret value', fieldAad('u1', ref))
  const [v, id, n, ct, tag] = s.split('.') as [string, string, string, string, string]
  const bad = [
    [v, id, flip(n), ct, tag].join('.'),
    [v, id, n, flip(ct), tag].join('.'),
    [v, id, n, ct, flip(tag)].join('.'),
  ]
  for (const b of bad) assert.throws(() => open(() => k, b, fieldAad('u1', ref)), CryptoError)
  // the same value in another row, column or owner does not open
  assert.throws(() => open(() => k, s, fieldAad('u1', { ...ref, row: 'github/2' })), CryptoError)
  assert.throws(() => open(() => k, s, fieldAad('u1', { ...ref, column: 'access_token' })), CryptoError)
  assert.throws(() => open(() => k, s, fieldAad('u2', ref)), CryptoError)
  // a wrong key under the right kid
  assert.throws(() => open(() => key(), s, fieldAad('u1', ref)), CryptoError)
})

test('(b) a wrapped data key is bound to its owner and id', () => {
  const mk = parseMasterKeys({ ALLOT_MASTER_KEY: b64(key()) })
  const d = newDataKey()
  const w = wrapDataKey(mk, 'u1', d.id, d.key)
  assert.deepEqual(unwrapDataKey(mk, 'u1', d.id, w.wrapped), d.key)
  assert.throws(() => unwrapDataKey(mk, 'u2', d.id, w.wrapped), CryptoError)
  assert.throws(() => unwrapDataKey(mk, 'u1', 'deadbeef', w.wrapped), CryptoError)
})

test('(c) an unknown kid fails without trying a key', () => {
  const k = key()
  const s = seal(k, kidOf(k), 'v', 'a')
  assert.throws(() => open(() => undefined, s, 'a'), /unknown key \(kid [0-9a-f]{8}\)/)
})

test('(c) a previous master key opens what it wrapped; an unrelated one does not', () => {
  const oldK = key()
  const newK = key()
  const before = parseMasterKeys({ ALLOT_MASTER_KEY: b64(oldK) })
  const d = newDataKey()
  const w = wrapDataKey(before, 'u1', d.id, d.key)
  const after = parseMasterKeys({ ALLOT_MASTER_KEY: b64(newK), ALLOT_MASTER_KEY_PREVIOUS: b64(oldK) })
  assert.equal(after.current.kid, kidOf(newK))
  assert.deepEqual(unwrapDataKey(after, 'u1', d.id, w.wrapped), d.key)
  const lost = parseMasterKeys({ ALLOT_MASTER_KEY: b64(newK) })
  assert.throws(() => unwrapDataKey(lost, 'u1', d.id, w.wrapped), /unknown key/)
})

test('(e) the master key must be set and be 32 bytes of base64', () => {
  assert.throws(() => parseMasterKeys({}), /ALLOT_MASTER_KEY must be set/)
  assert.throws(() => parseMasterKeys({ ALLOT_MASTER_KEY: '  ' }), /must be set/)
  assert.throws(() => parseMasterKeys({ ALLOT_MASTER_KEY: b64(randomBytes(16)) }), /32 bytes/)
  assert.throws(() => parseMasterKeys({ ALLOT_MASTER_KEY: 'change-me-32-bytes-base64' }), /32 bytes/)
  assert.throws(() => parseMasterKeys({ ALLOT_MASTER_KEY: b64(key()), ALLOT_MASTER_KEY_PREVIOUS: 'nope' }), /PREVIOUS\[0\].*32 bytes/)
})

test('errors never contain the key or the plaintext', () => {
  const k = key()
  const s = seal(k, kidOf(k), 'top-secret-plain', 'a')
  try {
    open(() => k, s, 'b')
    assert.fail('should fail')
  } catch (e) {
    const m = String((e as Error).message)
    assert.ok(!m.includes('top-secret-plain') && !m.includes(b64(k)) && !m.includes(k.toString('hex')))
  }
})
