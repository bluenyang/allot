import { serve } from '@hono/node-server'
import { root } from './app'
import { enforceKeyPolicyAtStart } from './api-key-policy'
import { initAuth } from './auth'
import { initOAuthPolicy } from './oauth'
import { promoteEnvAdmin } from './auth-policy'
import { masterKeys } from './crypto/envelope'
import { forgetLostKeys, rotateDataKeys } from './crypto/keys'
import { sqlClient } from './db/client'
import { runMigrations } from './db/migrate'
import { checkRowLevelSecurity } from './db/rls-check'
import { startRetention } from './retention'
import { startFxRefresh } from './fx-refresh'

const port = Number(process.env.API_PORT ?? 3000)

// The master key is required (spec 006 S-5): without it, refuse to start and say why.
try {
  masterKeys()
} catch (e) {
  console.error(`allot: ${(e as Error).message}`)
  process.exit(1)
}

// Apply committed migrations before accepting requests.
await runMigrations()

// `node dist-server/index.mjs keys:rotate` (pnpm keys:rotate): re-wrap every data key with the
// current ALLOT_MASTER_KEY, the old one given in ALLOT_MASTER_KEY_PREVIOUS, then exit.
if (process.argv[2] === 'keys:rotate') {
  const n = await rotateDataKeys()
  console.log(`re-wrapped data keys: ${n.users} user, ${n.system} system`)
  await sqlClient.end()
  process.exit(0)
}

await promoteEnvAdmin()
await initOAuthPolicy()
await initAuth()
await enforceKeyPolicyAtStart()
// `node dist-server/index.mjs keys:forget-lost` (pnpm keys:forget-lost): after a master key is lost
// for good, drop the data keys no configured master key opens and clear what they sealed.
if (process.argv[2] === 'keys:forget-lost') {
  const n = await forgetLostKeys()
  console.log(`forgot data keys no master key opens: ${n.users} user (their login tokens cleared), ${n.system} system (stored client secrets cleared)`)
  await sqlClient.end()
  process.exit(0)
}

for (const w of await checkRowLevelSecurity()) console.warn(`WARNING: ${w}`)
await startRetention()
startFxRefresh()

serve({ fetch: root.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`)
})
