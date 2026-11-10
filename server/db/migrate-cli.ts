// pnpm db:migrate — apply migrations and exit.
import { sqlClient } from './client'
import { runMigrations } from './migrate'

await runMigrations()
await sqlClient.end()
console.log('migrations applied')
