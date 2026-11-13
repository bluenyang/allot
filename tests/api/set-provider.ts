// Test helper (spec 006): write one login-method row directly, the way the admin API stores it
// (client secret sealed with the system key). Restart the api afterwards, or use the admin API.
//   tsx tests/api/set-provider.ts <id> '<json: {enabled?, signup?, rules?, options?}>' [secret-env-var]
// The secret is read from the named env variable (never from the command line).
import { encryptField, SYSTEM } from '../../server/crypto/keys'
import { secretRef, type ProviderId } from '../../server/auth-config'
import { db, sqlClient } from '../../server/db/client'
import * as t from '../../server/db/schema'

const [id, json, secretVar] = process.argv.slice(2) as [ProviderId, string, string | undefined]
if (!id || !json) throw new Error("usage: set-provider.ts <id> '<json>' [secret-env-var]")
const v = JSON.parse(json) as { enabled?: boolean; signup?: string; rules?: Record<string, string[]>; options?: Record<string, unknown> }
const secret = secretVar ? process.env[secretVar] : undefined
if (secretVar && !secret) throw new Error(`${secretVar} is empty`)
const row = {
  id, enabled: v.enabled ?? null, signup: v.signup ?? null, rules: v.rules ?? null, options: v.options ?? null,
  clientSecretEnc: secret ? await encryptField(SYSTEM, secretRef(id), secret) : null, updatedBy: 'test',
}
await db.insert(t.authProvider).values(row).onConflictDoUpdate({ target: t.authProvider.id, set: { ...row, updatedAt: new Date() } })
console.log(`set ${id}`)
await sqlClient.end()
