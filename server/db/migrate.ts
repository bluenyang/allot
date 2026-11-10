import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from './client'

// Applies committed migrations in ./drizzle. Safe to run on every start.
// No entry-point code here: this module is bundled into the server (dist-server/index.mjs),
// where an "am I the main module?" check would be true. The CLI is migrate-cli.ts.
export async function runMigrations() {
  await migrate(db, { migrationsFolder: 'drizzle' })
}
