// Better Auth core tables (user, session, account, verification) for the Drizzle adapter.
// Field names follow Better Auth's model; the app's own bank accounts live in `bank_account`.
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

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

// @better-auth/api-key (spec 008 S-1): API keys. Field names and types follow the plugin's schema.
// `key` is the SHA-256 (base64url) of the key, never the key itself; `start` is its first 6
// characters. referenceId is the owner's user id (no foreign key in the plugin's schema, so the
// admin "delete user" removes the rows itself). Auth table: no row-level security, like `session`.
export const apikey = pgTable('apikey', {
  id: text('id').primaryKey(),
  configId: text('config_id').notNull().default('default'),
  name: text('name'),
  start: text('start'),
  referenceId: text('reference_id').notNull(),
  prefix: text('prefix'),
  key: text('key').notNull(),
  refillInterval: integer('refill_interval'),
  refillAmount: integer('refill_amount'),
  lastRefillAt: at('last_refill_at'),
  enabled: boolean('enabled').default(true),
  rateLimitEnabled: boolean('rate_limit_enabled').default(true),
  rateLimitTimeWindow: integer('rate_limit_time_window'),
  rateLimitMax: integer('rate_limit_max'),
  requestCount: integer('request_count').default(0),
  remaining: integer('remaining'),
  lastRequest: at('last_request'),
  expiresAt: at('expires_at'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  permissions: text('permissions'),
  metadata: text('metadata'),
}, (t) => [
  index('apikey_config_id_idx').on(t.configId),
  index('apikey_reference_id_idx').on(t.referenceId),
  index('apikey_key_idx').on(t.key),
])
