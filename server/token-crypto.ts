// External login tokens are stored sealed (spec 006 S-5): access, refresh and ID token of each
// `account` row, with the owner's data key, bound to the row by provider and account key.
// Nothing in 0.1.2 reads them back; the Better Auth endpoints that would (get-access-token,
// refresh-token, account-info) are closed in server/auth.ts.
import { encryptField, isSealed } from './crypto/keys'

const TOKENS = { accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token' } as const
type TokenField = keyof typeof TOKENS

export const tokenRef = (providerId: string, accountId: string, column: string) =>
  ({ table: 'account', column, row: `${providerId}/${accountId}` })

/** account.create.before: seal every token the new row carries. */
export async function sealNewAccountTokens<A extends { userId: string; providerId: string; accountId: string } & Partial<Record<TokenField, string | null>>>(acc: A): Promise<A> {
  const out = { ...acc }
  for (const [field, column] of Object.entries(TOKENS) as [TokenField, string][]) {
    const v = acc[field]
    if (typeof v === 'string' && v !== '' && !isSealed(v)) {
      out[field] = await encryptField(acc.userId, tokenRef(acc.providerId, acc.accountId, column), v) as A[TokenField]
    }
  }
  return out
}

/**
 * account.update.before only sees the changed fields, not which row they belong to, so it
 * cannot pick the owner's key. Token updates are dropped instead of being written in clear:
 * the stored tokens stay those sealed when the account was linked. (Sign-in does not update
 * them: account.updateAccountOnSignIn is off.) 0.1.7, the first reader, decides on refresh.
 */
export function dropTokenUpdates<D extends Record<string, unknown>>(data: D): D {
  const out: Record<string, unknown> = { ...data }
  for (const field of Object.keys(TOKENS)) if (field in out && !isSealed(out[field])) out[field] = undefined
  return out as D
}
