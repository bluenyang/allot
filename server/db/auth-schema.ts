// Better Auth core tables (user, session, account, verification) for the Drizzle adapter.
// Field names follow Better Auth's model; the app's own bank accounts live in `bank_account`.
import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const at = (name: string) => timestamp(name, { withTimezone: true })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  // spec 006: sign-up policy (server/auth-policy.ts). active | pending
  status: text('status').notNull().default('pending'),
  /** How the account got in: seed | admin | approval | rule | bootstrap */
  admission: text('admission').notNull().default('approval'),
  // Better Auth admin plugin
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: at('ban_expires'),
}, (t) => [
  check('user_status', sql`${t.status} in ('active', 'pending')`),
  check('user_admission', sql`${t.admission} in ('seed', 'admin', 'approval', 'rule', 'bootstrap')`),
  check('user_role', sql`${t.role} in ('admin', 'user')`),
])

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: at('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  // Better Auth admin plugin (impersonation is closed in server/auth.ts; the column is its schema)
  impersonatedBy: text('impersonated_by'),
}, (t) => [index('session_user_id_idx').on(t.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: at('access_token_expires_at'),
  refreshTokenExpiresAt: at('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
}, (t) => [index('account_user_id_idx').on(t.userId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
}, (t) => [index('verification_identifier_idx').on(t.identifier)])
