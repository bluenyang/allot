import { serve } from '@hono/node-server'
import { root } from './app'
import { runMigrations } from './db/migrate'

const port = Number(process.env.API_PORT ?? 3000)

// Apply committed migrations before accepting requests.
await runMigrations()

serve({ fetch: root.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`)
})
