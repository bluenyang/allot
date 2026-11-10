// App tables. Better Auth's tables live in ./auth-schema.ts.
// Ids are text: seed ids ('claude', 'p1', ...) are kept, new rows use crypto.randomUUID().
// `seq` keeps insertion order for lists.
import { sql } from 'drizzle-orm'
import { boolean, check, date, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { Plan } from '../../src/data/types'

export const currency = pgEnum('currency', ['KRW', 'USD'])
export const cycle = pgEnum('cycle', ['monthly', 'yearly'])
export const subStatus = pgEnum('sub_status', ['active', 'cancelled', 'company'])
export const payPath = pgEnum('pay_path', ['direct', 'google', 'apple', 'telecom'])
export const category = pgEnum('category', ['ai', 'telecom', 'content', 'tool', 'insurance', 'life'])
export const eventState = pgEnum('event_state', ['done', 'doing', 'todo'])
/** living: sum of living costs · subscriptions: needed subscription transfer · fixed: per-phase amount · remainder: the rest */
export const allocationKind = pgEnum('allocation_kind', ['living', 'subscriptions', 'fixed', 'remainder'])

const seq = () => integer('seq').generatedAlwaysAsIdentity()
const ym = (name: string) => text(name)

export const settings = pgTable('settings', {
  id: smallint('id').primaryKey().default(1),
  netPay: integer('net_pay').notNull(),
  fxRate: numeric('fx_rate', { precision: 8, scale: 2, mode: 'number' }).notNull(),
  fxBuffer: numeric('fx_buffer', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  payDay: smallint('pay_day').notNull(),
  transferDay: smallint('transfer_day').notNull(),
  billingDay: smallint('billing_day').notNull(),
  subRound: integer('sub_round').notNull().default(10_000),
}, (t) => [check('settings_single_row', sql`${t.id} = 1`)])

export const living = pgTable('living', {
  id: smallint('id').primaryKey().default(1),
  food: integer('food').notNull(),
  transit: integer('transit').notNull(),
  allowance: integer('allowance').notNull(),
}, (t) => [check('living_single_row', sql`${t.id} = 1`)])

export const subscription = pgTable('subscription', {
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
}, (t) => [check('subscription_amount_nonneg', sql`${t.amount} >= 0`)])

export const planChange = pgTable('plan_change', {
  id: text('id').primaryKey(),
  seq: seq(),
  subId: text('sub_id').notNull().references(() => subscription.id, { onDelete: 'cascade' }),
  effective: date('effective', { mode: 'string' }),
  to: jsonb('patch').$type<Partial<Plan>>().notNull(),
  note: text('note').notNull().default(''),
}, (t) => [check('plan_change_patch_object', sql`jsonb_typeof(${t.to}) = 'object'`)])

export const phase = pgTable('phase', {
  id: text('id').primaryKey(),
  seq: seq(),
  label: text('label').notNull(),
  name: text('name').notNull(),
  from: ym('from_month').notNull(),
  to: ym('to_month'),
  note: text('note'),
}, (t) => [
  check('phase_from_ym', sql`${t.from} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check('phase_to_ym', sql`${t.to} is null or ${t.to} ~ '^[0-9]{4}-[0-9]{2}$'`),
])

export const planEvent = pgTable('plan_event', {
  id: text('id').primaryKey(),
  seq: seq(),
  when: text('when').notNull(), // YYYY-MM or YYYY-MM~MM
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  state: eventState('state').notNull().default('todo'),
})

export const checkItem = pgTable('check_item', {
  id: text('id').primaryKey(),
  seq: seq(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
})

export const bankAccount = pgTable('bank_account', {
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  inflow: text('inflow').notNull().default(''),
  outflow: text('outflow').notNull().default(''),
})

export const debt = pgTable('debt', {
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  principal: integer('principal').notNull(),
  rate: text('rate').notNull().default(''),
  method: text('method').notNull().default(''),
  plan: text('plan').notNull().default(''),
})

/** Where the monthly pay goes. Names are the user's data, never code. */
export const allocationTarget = pgTable('allocation_target', {
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  kind: allocationKind('kind').notNull(),
  note: text('note'),
}, (t) => [
  // living, subscriptions and remainder exist at most once each
  uniqueIndex('allocation_target_single_kind').on(t.kind).where(sql`${t.kind} <> 'fixed'`),
])

/** Fixed amount per phase and target (fixed targets only; checked in the API). */
export const phaseAmount = pgTable('phase_amount', {
  phaseId: text('phase_id').notNull().references(() => phase.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => allocationTarget.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
}, (t) => [
  primaryKey({ columns: [t.phaseId, t.targetId] }),
  check('phase_amount_nonneg', sql`${t.amount} >= 0`),
])

/** How the remainder is split (the last item takes what is left). */
export const remainderSplit = pgTable('remainder_split', {
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  code: text('code').notNull().default(''),
  ratio: numeric('ratio', { precision: 5, scale: 4, mode: 'number' }).notNull(),
}, (t) => [check('remainder_split_ratio_range', sql`${t.ratio} >= 0 and ${t.ratio} <= 1`)])
