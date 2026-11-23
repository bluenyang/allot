// spec 013 S-24: "만들기" on a password field. Made in the browser and sent only when the user saves.
// 20 characters from crypto.getRandomValues, without modulo bias (a byte outside the last whole run of the alphabet is drawn again).

export const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+?'
export const PASSWORD_LENGTH = 20

export function generatePassword(length = PASSWORD_LENGTH, alphabet = PASSWORD_ALPHABET, rng: (a: Uint8Array<ArrayBuffer>) => unknown = (a) => crypto.getRandomValues(a)): string {
  const n = alphabet.length
  const limit = 256 - (256 % n)
  let out = ''
  const buf = new Uint8Array(new ArrayBuffer(length * 2))
  while (out.length < length) {
    rng(buf)
    for (const b of buf) {
      if (b >= limit) continue
      out += alphabet[b % n]
      if (out.length === length) break
    }
  }
  return out
}
