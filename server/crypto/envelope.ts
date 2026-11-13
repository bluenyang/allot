// Envelope encryption primitives (spec 006 S-5). No database here: see keys.ts.
//
//   master key (ALLOT_MASTER_KEY) ──wraps──▶ data key (one per user, one for the system)
//   data key ──encrypts──▶ field value
//
// Every sealed value is `v1.<kid>.<nonce>.<ciphertext>.<tag>` (base64url parts), AES-256-GCM
// with a 12-byte random nonce. `kid` names the key that sealed it: the master key's id for a
// wrapped data key, the data key's id for a field value. The AAD binds a value to where it
// belongs (table, column, row, owner), so a sealed value copied to another row does not open.
// Error messages never contain key material or plaintext.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

export class CryptoError extends Error {}

const b64u = (b: Buffer) => b.toString('base64url')
const unb64u = (s: string) => Buffer.from(s, 'base64url')

/** Public id of a master key: the first 8 hex digits of its SHA-256. */
export const kidOf = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8)

export interface MasterKeys {
  current: { kid: string; key: Buffer }
  /** Every known master key by kid: the current one and ALLOT_MASTER_KEY_PREVIOUS. */
  byKid: Map<string, Buffer>
}

function parseKey(name: string, raw: string): Buffer {
  const s = raw.trim()
  const key = Buffer.from(s, 'base64')
  // Buffer.from ignores bad characters; re-encode to make sure the text was clean base64.
  if (key.length !== KEY_BYTES || key.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) {
    throw new CryptoError(`${name} must be ${KEY_BYTES} bytes in base64 (generate one with: openssl rand -base64 32)`)
  }
  return key
}

/** Read ALLOT_MASTER_KEY (required) and ALLOT_MASTER_KEY_PREVIOUS (optional, comma-separated). */
export function parseMasterKeys(env: Record<string, string | undefined> = process.env): MasterKeys {
  const raw = env.ALLOT_MASTER_KEY
  if (!raw?.trim()) throw new CryptoError('ALLOT_MASTER_KEY must be set (generate one with: openssl rand -base64 32)')
  const key = parseKey('ALLOT_MASTER_KEY', raw)
  const current = { kid: kidOf(key), key }
  const byKid = new Map([[current.kid, key]])
  for (const [i, p] of (env.ALLOT_MASTER_KEY_PREVIOUS ?? '').split(',').map((x) => x.trim()).filter(Boolean).entries()) {
    const k = parseKey(`ALLOT_MASTER_KEY_PREVIOUS[${i}]`, p)
    byKid.set(kidOf(k), k)
  }
  return { current, byKid }
}

let cached: MasterKeys | undefined
/** The process's master keys, read once. Throws (with the reason) when the env is wrong. */
export function masterKeys(): MasterKeys {
  cached ??= parseMasterKeys()
  return cached
}

/** Seal `plain` with `key` (named `kid`) for `aad`. */
export function seal(key: Buffer, kid: string, plain: Buffer | string, aad: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoError('key must be 32 bytes')
  if (!/^[0-9a-f]{8}$/.test(kid)) throw new CryptoError('kid must be 8 hex digits')
  const nonce = randomBytes(NONCE_BYTES)
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  c.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([c.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), c.final()])
  return [VERSION, kid, b64u(nonce), b64u(ct), b64u(c.getAuthTag())].join('.')
}

/** The kid a sealed value names (without opening it). */
export function kidOfSealed(sealed: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) throw new CryptoError('not a sealed value (format v1)')
  return parts[1]!
}

/** Open a sealed value with the key its kid names. Any change to it or to `aad` fails. */
export function open(keyFor: (kid: string) => Buffer | undefined, sealed: string, aad: string): Buffer {
  const parts = sealed.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) throw new CryptoError('not a sealed value (format v1)')
  const [, kid, n, ct, tag] = parts as [string, string, string, string, string]
  const key = keyFor(kid)
  if (!key) throw new CryptoError(`decryption failed: unknown key (kid ${kid})`)
  const nonce = unb64u(n)
  const t = unb64u(tag)
  if (nonce.length !== NONCE_BYTES || t.length !== TAG_BYTES) throw new CryptoError(`decryption failed (kid ${kid})`)
  try {
    const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
    d.setAAD(Buffer.from(aad, 'utf8'))
    d.setAuthTag(t)
    return Buffer.concat([d.update(unb64u(ct)), d.final()])
  } catch {
    throw new CryptoError(`decryption failed (kid ${kid})`)
  }
}

/** A new random data key and its public id (random, not derived from the key). */
export function newDataKey(): { id: string; key: Buffer } {
  return { id: randomBytes(4).toString('hex'), key: randomBytes(KEY_BYTES) }
}

const wrapAad = (owner: string, dekId: string) => `allot:data-key:${owner}:${dekId}`

/** Wrap a data key with the current master key. */
export function wrapDataKey(mk: MasterKeys, owner: string, dekId: string, dek: Buffer): { kid: string; wrapped: string } {
  return { kid: mk.current.kid, wrapped: seal(mk.current.key, mk.current.kid, dek, wrapAad(owner, dekId)) }
}

/** Unwrap a data key with whichever known master key wrapped it. */
export function unwrapDataKey(mk: MasterKeys, owner: string, dekId: string, wrapped: string): Buffer {
  const key = open((kid) => mk.byKid.get(kid), wrapped, wrapAad(owner, dekId))
  if (key.length !== KEY_BYTES) throw new CryptoError('decryption failed: bad data key')
  return key
}

/** Where a field value lives; part of its AAD. */
export interface FieldRef { table: string; column: string; row: string }
export const fieldAad = (owner: string, f: FieldRef) => `allot:field:${f.table}:${f.column}:${f.row}:${owner}`
