// App tables. Better Auth's tables live in ./auth-schema.ts.
// Every row has an owner (user_id). References between tables carry user_id too, so a row can
// only point at rows of the same user (foreign-key checks do not go through row-level security).
// Deleting a user does not delete their data (restrict).
// Ids are text: seed ids ('claude', 'p1', ...) are kept, new rows use crypto.randomUUID().
// `seq` keeps insertion order for lists.
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, type PgColumn } from 'drizzle-orm/pg-core'
import type { Plan } from '../../src/data/types'
import { user } from './auth-schema'

export const currency = pgEnum('currency', ['KRW', 'USD'])
export const cycle = pgEnum('cycle', ['monthly', 'yearly'])
export const subStatus = pgEnum('sub_status', ['active', 'cancelled', 'company'])
export const payPath = pgEnum('pay_path', ['direct', 'google', 'apple', 'telecom'])
export const category = pgEnum('category', ['ai', 'telecom', 'content', 'tool', 'insurance', 'life'])
export const eventState = pgEnum('event_state', ['done', 'doing', 'todo'])
/** living: sum of living costs · subscriptions: needed subscription transfer · fixed: per-phase amount · remainder: the rest */
export const allocationKind = pgEnum('allocation_kind', ['living', 'subscriptions', 'fixed', 'remainder'])

const seq = () => integer('seq').generatedAlwaysAsIdentity()
/**
 * Row-level security for a user's table: a row is visible and writable only when its user_id is
 * the transaction's app.user_id (server/db/scope.ts). Every owned table gets exactly this policy;
 * its FORCE (the policy applies to the table owner too) is in a custom migration, because
 * Drizzle cannot express it. The server warns at start if a table with user_id lacks either.
 */
const userScoped = (userId: PgColumn) =>
  pgPolicy('allot_owner', {
    for: 'all',
    using: sql`${userId} = current_setting('app.user_id', true)`,
    withCheck: sql`${userId} = current_setting('app.user_id', true)`,
  })

/** Owner of the row (Better Auth user.id). */
const owner = () => text('user_id').notNull().references(() => user.id, { onDelete: 'restrict' })
const ym = (name: string) => text(name)

export const settings = pgTable('settings', {
  userId: owner().primaryKey(),
  netPay: integer('net_pay').notNull(),
  fxRate: numeric('fx_rate', { precision: 8, scale: 2, mode: 'number' }).notNull(),
  fxBuffer: numeric('fx_buffer', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  payDay: smallint('pay_day').notNull(),
  transferDay: smallint('transfer_day').notNull(),
  billingDay: smallint('billing_day').notNull(),
  subRound: integer('sub_round').notNull().default(10_000),
}, (t) => [userScoped(t.userId)])

export const living = pgTable('living', {
  userId: owner().primaryKey(),
  food: integer('food').notNull(),
  transit: integer('transit').notNull(),
  allowance: integer('allowance').notNull(),
}, (t) => [userScoped(t.userId)])

export const subscription = pgTable('subscription', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  category: category('category').notNull(),
  plan: text('plan').notNull().default(''),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  currency: currency('currency').notNull(),
  vat: numeric('vat', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  cycle: cycle('cycle').notNull(),
  status: subStatus('status').notNull().default('active'),
  nextDate: date('next_date', { mode: 'string' }).notNull(),
  path: payPath('path').notNull().default('direct'),
  verified: boolean('verified').notNull().default(false),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('subscription_user_id_id').on(t.userId, t.id),
  check('subscription_amount_nonneg', sql`${t.amount} >= 0`),
])

export const planChange = pgTable('plan_change', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  subId: text('sub_id').notNull(),
  effective: date('effective', { mode: 'string' }),
  to: jsonb('patch').$type<Partial<Plan>>().notNull(),
  note: text('note').notNull().default(''),
}, (t) => [
  userScoped(t.userId),
  unique('plan_change_user_id_id').on(t.userId, t.id),
  foreignKey({ name: 'plan_change_sub_fk', columns: [t.userId, t.subId], foreignColumns: [subscription.userId, subscription.id] }).onDelete('cascade'),
  check('plan_change_patch_object', sql`jsonb_typeof(${t.to}) = 'object'`),
])

export const phase = pgTable('phase', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  label: text('label').notNull(),
  name: text('name').notNull(),
  from: ym('from_month').notNull(),
  to: ym('to_month'),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('phase_user_id_id').on(t.userId, t.id),
  check('phase_from_ym', sql`${t.from} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check('phase_to_ym', sql`${t.to} is null or ${t.to} ~ '^[0-9]{4}-[0-9]{2}$'`),
])

export const planEvent = pgTable('plan_event', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  when: text('when').notNull(), // YYYY-MM or YYYY-MM~MM
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  state: eventState('state').notNull().default('todo'),
}, (t) => [unique('plan_event_user_id_id').on(t.userId, t.id), userScoped(t.userId)])

export const checkItem = pgTable('check_item', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
}, (t) => [unique('check_item_user_id_id').on(t.userId, t.id), userScoped(t.userId)])

export const bankAccount = pgTable('bank_account', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  inflow: text('inflow').notNull().default(''),
  outflow: text('outflow').notNull().default(''),
}, (t) => [unique('bank_account_user_id_id').on(t.userId, t.id), userScoped(t.userId)])

export const debt = pgTable('debt', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  principal: integer('principal').notNull(),
  rate: text('rate').notNull().default(''),
  method: text('method').notNull().default(''),
  plan: text('plan').notNull().default(''),
}, (t) => [unique('debt_user_id_id').on(t.userId, t.id), userScoped(t.userId)])

/** Where the monthly pay goes. Names are the user's data, never code. */
export const allocationTarget = pgTable('allocation_target', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  kind: allocationKind('kind').notNull(),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('allocation_target_user_id_id').on(t.userId, t.id),
  // living, subscriptions and remainder exist at most once each, per user
  uniqueIndex('allocation_target_single_kind').on(t.userId, t.kind).where(sql`${t.kind} <> 'fixed'`),
])

/** Fixed amount per phase and target (fixed targets only; checked in the API). */
export const phaseAmount = pgTable('phase_amount', {
  userId: owner(),
  phaseId: text('phase_id').notNull(),
  targetId: text('target_id').notNull(),
  amount: integer('amount').notNull(),
}, (t) => [
  userScoped(t.userId),
  primaryKey({ columns: [t.phaseId, t.targetId] }),
  foreignKey({ name: 'phase_amount_phase_fk', columns: [t.userId, t.phaseId], foreignColumns: [phase.userId, phase.id] }).onDelete('cascade'),
  foreignKey({ name: 'phase_amount_target_fk', columns: [t.userId, t.targetId], foreignColumns: [allocationTarget.userId, allocationTarget.id] }).onDelete('cascade'),
  check('phase_amount_nonneg', sql`${t.amount} >= 0`),
])

/** How the remainder is split (the last item takes what is left). */
export const remainderSplit = pgTable('remainder_split', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  code: text('code').notNull().default(''),
  ratio: numeric('ratio', { precision: 5, scale: 4, mode: 'number' }).notNull(),
}, (t) => [
  userScoped(t.userId),
  unique('remainder_split_user_id_id').on(t.userId, t.id),
  check('remainder_split_ratio_range', sql`${t.ratio} >= 0 and ${t.ratio} <= 1`),
])

// ── Change sets: one write request = one set, like a commit (spec 005 S-3) ──
export const actorKind = pgEnum('actor_kind', ['user', 'api_key'])
export const changeOp = pgEnum('change_op', ['insert', 'update', 'delete'])

export const changeSet = pgTable('change_set', {
  userId: owner(),
  id: text('id').primaryKey(),
  at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  actorKind: actorKind('actor_kind').notNull(),
  actorId: text('actor_id').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  /** This set undoes that one. */
  revertOf: text('revert_of'),
  /** That set undid this one. */
  revertedBy: text('reverted_by'),
}, (t) => [
  userScoped(t.userId),
  unique('change_set_user_id_id').on(t.userId, t.id),
  index('change_set_user_at').on(t.userId, t.at),
])

/** One row change. `before`/`after` are the whole row as the API reads it (null for insert/delete). */
export const changeLog = pgTable('change_log', {
  userId: owner(),
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  setId: text('set_id').notNull(),
  tableName: text('table_name').notNull(),
  rowKey: jsonb('row_key').$type<Record<string, string>>().notNull(),
  op: changeOp('op').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
}, (t) => [
  userScoped(t.userId),
  foreignKey({ name: 'change_log_set_fk', columns: [t.userId, t.setId], foreignColumns: [changeSet.userId, changeSet.id] }).onDelete('cascade'),
  index('change_log_set').on(t.setId),
])
