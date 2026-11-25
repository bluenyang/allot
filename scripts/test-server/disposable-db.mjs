// Create the app role and database in the throwaway PostgreSQL of disposable.sh: a role that is not a superuser
// (row-level security applies to it, as to allot-rc) owning its own database. Waits up to 60 s for the server.
// Reads PG_SUPER_URL (the container's superuser) and APP_PW from the environment; prints no value.
//   node scripts/test-server/disposable-db.mjs
import postgres from 'postgres'

const { PG_SUPER_URL, APP_PW } = process.env
if (!PG_SUPER_URL || !APP_PW) { console.log('PG_SUPER_URL and APP_PW must be set'); process.exit(2) }
let sql
for (let i = 0; ; i++) {
  try {
    sql = postgres(PG_SUPER_URL, { max: 1, onnotice: () => {} })
    await sql`select 1`
    console.log(`postgres answers after ${i}s`)
    break
  } catch {
    await sql?.end({ timeout: 1 }).catch(() => {})
    if (i >= 60) { console.log('postgres did not answer in 60s'); process.exit(1) }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
await sql.unsafe(`create role allot_disp login nosuperuser nobypassrls password '${APP_PW.replaceAll("'", "''")}'`)
await sql.unsafe('create database allot_disp owner allot_disp')
const [role] = await sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'allot_disp'`
console.log(`role allot_disp: superuser ${role.rolsuper}, bypassrls ${role.rolbypassrls}; database allot_disp created`)
await sql.end()
process.exit(role.rolsuper || role.rolbypassrls ? 1 : 0)
