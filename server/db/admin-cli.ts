// pnpm db:admin [--replace-admin <old email>] — create or update the admin account from
// ADMIN_EMAIL / ADMIN_PASSWORD, without any data (spec 006 S-7). A fresh clone starts here.
import { runMigrations } from './migrate'
import { sqlClient } from './client'
import { ensureAdmin, replaceArg } from './seed'

await runMigrations()
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
if (!email || !password || password.length < 8) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) must be set')
const admin = await ensureAdmin(email, password, replaceArg(process.argv.slice(2)))
console.log(`admin account ${email}: ${admin.status}`)
await sqlClient.end()
