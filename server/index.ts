import { serve } from '@hono/node-server'
import { root } from './app'
import { runMigrations } from './db/migrate'
import { checkRowLevelSecurity } from './db/rls-check'
import { startRetention } from './retention'

const port = Number(process.env.API_PORT ?? 3000)

// Apply committed migrations before accepting requests.
await runMigrations()
for (const w of await checkRowLevelSecurity()) console.warn(`WARNING: ${w}`)
await startRetention()

serve({ fetch: root.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`)
})
