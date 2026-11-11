// Start-up check (spec 005 S-7): row-level security only protects anything if the app's role
// cannot bypass it and every owned table has it enabled and forced. Warn, never refuse to start.
import { getTableName, sql } from 'drizzle-orm'
import * as authSchema from './auth-schema'
import { db } from './client'

/** Better Auth's tables are read before anyone is signed in: they have user_id but no row-level security. */
const AUTH_TABLES = Object.values(authSchema).filter((x) => typeof x === 'object' && x !== null && Symbol.for('drizzle:Name') in x).map((x) => getTableName(x as never))

export async function checkRowLevelSecurity(): Promise<string[]> {
  const warnings: string[] = []
  const [role] = await db.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(sql`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
  if (role && (role.rolsuper || role.rolbypassrls)) {
    warnings.push(`database role "${role.rolname}" is ${role.rolsuper ? 'a superuser' : 'BYPASSRLS'}: row-level security does not apply to it. `
      + 'Use a dedicated role that is neither (README: 운영 배포 → 전용 DB 롤).')
  }
  const missing = await db.execute<{ table: string; rls: boolean; force: boolean }>(sql`
    select c.relname as "table", c.relrowsecurity as rls, c.relforcerowsecurity as force
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped)
      and c.relname not in (${sql.join(AUTH_TABLES.map((n) => sql`${n}`), sql`, `)})
      and not (c.relrowsecurity and c.relforcerowsecurity)
    order by c.relname`)
  for (const m of missing) {
    warnings.push(`table "${m.table}" has user_id but row-level security is ${m.rls ? 'not forced' : 'off'}: add it to a custom migration.`)
  }
  return warnings
}
