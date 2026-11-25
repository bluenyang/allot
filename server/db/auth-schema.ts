// Better Auth core tables (user, session, account, verification) for the Drizzle adapter.
// Field names follow Better Auth's model; the app's own bank accounts live in `bank_account`.
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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

// ── OAuth (spec 015 S-2, S-3): better-auth/plugins/jwt, @better-auth/mcp (oauth-provider), @better-auth/cimd ──
// Generated from the plugins' schemas by the installed Drizzle adapter's generator (the one the Better Auth
// CLI runs), with this file's conventions: timestamps with time zone, snake_case index names, and
// notNull where the plugin's field is required. Auth tables: no row-level security; the app filters by
// user id itself (server/oauth-apps.ts). Deleting a user removes their rows (cascade, as generated).

/** Signing keys of the JWT plugin; the private key is encrypted with BETTER_AUTH_SECRET by the plugin. */
export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: at('created_at').notNull(),
  expiresAt: at('expires_at'),
  alg: text('alg'),
  crv: text('crv'),
})

export const oauthClient = pgTable('oauth_client', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  clientDiscoveryId: text('client_discovery_id'),
  disabled: boolean('disabled').default(false),
  skipConsent: boolean('skip_consent'),
  enableEndSession: boolean('enable_end_session'),
  subjectType: text('subject_type'),
  scopes: text('scopes').array(),
  clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: text('contacts').array(),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  redirectUris: text('redirect_uris').array().notNull(),
  postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
  backchannelLogoutUri: text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  applicationType: text('application_type'),
  jwks: text('jwks'),
  jwksUri: text('jwks_uri'),
  grantTypes: text('grant_types').array(),
  responseTypes: text('response_types').array(),
  requirePKCE: boolean('require_pkce'),
  dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
  referenceId: text('reference_id'),
  metadata: jsonb('metadata'),
}, (t) => [index('oauth_client_user_id_idx').on(t.userId)])

export const oauthResource = pgTable('oauth_resource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata'),
})

export const oauthClientResource = pgTable('oauth_client_resource', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  resourceId: text('resource_id').notNull().references(() => oauthResource.identifier, { onDelete: 'cascade' }),
  metadata: jsonb('metadata'),
  createdAt: at('created_at'),
}, (t) => [
  uniqueIndex('oauth_client_resource_client_id_resource_id_uidx').on(t.clientId, t.resourceId),
  index('oauth_client_resource_client_id_idx').on(t.clientId),
  index('oauth_client_resource_resource_id_idx').on(t.resourceId),
])

export const oauthRefreshToken = pgTable('oauth_refresh_token', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  authorizationCodeId: text('authorization_code_id'),
  resources: text('resources').array(),
  requestedUserInfoClaims: text('requested_user_info_claims').array(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull(),
  revoked: at('revoked'),
  rotatedAt: at('rotated_at'),
  rotationReplayResponse: text('rotation_replay_response'),
  rotationReplayExpiresAt: at('rotation_replay_expires_at'),
  authTime: at('auth_time'),
  confirmation: jsonb('confirmation'),
  scopes: text('scopes').array().notNull(),
}, (t) => [
  index('oauth_refresh_token_client_id_idx').on(t.clientId),
  index('oauth_refresh_token_session_id_idx').on(t.sessionId),
  index('oauth_refresh_token_user_id_idx').on(t.userId),
  index('oauth_refresh_token_authorization_code_id_idx').on(t.authorizationCodeId),
])

export const oauthAccessToken = pgTable('oauth_access_token', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  authorizationCodeId: text('authorization_code_id'),
  resources: text('resources').array(),
  requestedUserInfoClaims: text('requested_user_info_claims').array(),
  refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull(),
  revoked: at('revoked'),
  confirmation: jsonb('confirmation'),
  scopes: text('scopes').array().notNull(),
}, (t) => [
  index('oauth_access_token_client_id_idx').on(t.clientId),
  index('oauth_access_token_session_id_idx').on(t.sessionId),
  index('oauth_access_token_user_id_idx').on(t.userId),
  index('oauth_access_token_authorization_code_id_idx').on(t.authorizationCodeId),
  index('oauth_access_token_refresh_id_idx').on(t.refreshId),
])

export const oauthConsent = pgTable('oauth_consent', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
  resources: text('resources').array(),
  requestedUserInfoClaims: text('requested_user_info_claims').array(),
  scopes: text('scopes').array().notNull(),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
}, (t) => [
  index('oauth_consent_client_id_idx').on(t.clientId),
  index('oauth_consent_user_id_idx').on(t.userId),
])

export const oauthClientAssertion = pgTable('oauth_client_assertion', {
  id: text('id').primaryKey(),
  expiresAt: at('expires_at').notNull(),
})

/** Allot's own: when a connected app last called /mcp (spec 015 W-5, S-10), one row per user and client. */
export const oauthAppUse = pgTable('oauth_app_use', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  lastUsedAt: at('last_used_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.clientId] })])
