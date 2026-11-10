import { pathToFileURL } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sqlClient } from './client'

// Applies committed migrations in ./drizzle. Safe to run on every start.
export async function runMigrations() {
  await migrate(db, { migrationsFolder: 'drizzle' })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runMigrations()
  await sqlClient.end()
  console.log('migrations applied')
}
