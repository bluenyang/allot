// App tables. Better Auth's tables live in ./auth-schema.ts.
// Every row has an owner (user_id). References between tables carry user_id too, so a row can
// only point at rows of the same user (foreign-key checks do not go through row-level security).
// Deleting a user does not delete their data (restrict).
// Ids are text: seed ids ('claude', 'p1', ...) are kept, new rows use crypto.randomUUID().
// `seq` keeps insertion order for lists.
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, type PgColumn } from 'drizzle-orm/pg-core'
import type { HolidayRule, Plan } from '../../src/data/types'
import { user } from './auth-schema'

/**
 * A currency code (ISO 4217, three capitals; spec 013 S-23). KRW is the base, USD's rate is in `settings`, any other
 * code needs a `foreign_currency` row (checked in the API). Was the enum `currency` ('KRW' | 'USD') up to 0.1.7-rc.2.
 */
const currencyCode = (name: string) => text(name)
export const cycle = pgEnum('cycle', ['monthly', 'yearly'])
export const subStatus = pgEnum('sub_status', ['active', 'cancelled', 'company'])
export const payPath = pgEnum('pay_path', ['direct', 'google', 'apple', 'telecom'])
export const category = pgEnum('category', ['ai', 'telecom', 'content', 'tool', 'insurance', 'life', 'other'])
export const spendHow = pgEnum('spend_how', ['lump', 'installment', 'split', 'buffer'])
export const payBy = pgEnum('pay_by', ['card', 'salary', 'subs'])
export const spendInterval = pgEnum('spend_interval', ['monthly', 'biweekly', 'custom'])
export const roundState = pgEnum('round_state', ['left', 'paid', 'merged'])
export const eventState = pgEnum('event_state', ['done', 'doing', 'todo'])
/**
 * living: sum of the living items · subscriptions: needed subscription transfer · fixed: per-phase amount · remainder: the rest ·
 * saving / invest: sum of that menu's items (accounts with that group; spec 013 S-3)
 */
export const allocationKind = pgEnum('allocation_kind', ['living', 'subscriptions', 'fixed', 'remainder', 'saving', 'invest'])

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
  /** Monthly dates on a weekend or holiday: 'none' keeps them, 'before'/'after' move to a business day (spec 007 S-10). */
  dayShift: text('day_shift').$type<'none' | 'before' | 'after'>().notNull().default('none'),
  /** How the Savings and Investment menus split their total (spec 013 S-3). */
  savingSplit: text('saving_split').$type<'amount' | 'ratio'>().notNull().default('amount'),
  investSplit: text('invest_split').$type<'amount' | 'ratio'>().notNull().default('ratio'),
  /** USD rate refreshed once a day from the public rate (spec 013 S-23); off = by hand, as before. */
  fxAuto: boolean('fx_auto').notNull().default(false),
  /** When the server last refreshed it, and why the last try failed (null after a success). Written by the server only. */
  fxAutoAt: timestamp('fx_auto_at', { withTimezone: true, mode: 'string' }),
  fxAutoError: text('fx_auto_error'),
}, (t) => [
  userScoped(t.userId),
  check('settings_saving_split', sql`${t.savingSplit} in ('amount', 'ratio')`),
  check('settings_invest_split', sql`${t.investSplit} in ('amount', 'ratio')`),
])

/**
 * Display settings and theme, one row per user (spec 007 S-7, S-8). Text columns checked by zod,
 * so a new choice needs no enum migration. Null colours mean the default palette.
 */
export const preference = pgTable('preference', {
  userId: owner().primaryKey(),
  themeMode: text('theme_mode').$type<'system' | 'light' | 'dark'>().notNull().default('light'),
  primary: text('primary'),
  accent: text('accent'),
  radius: text('radius').$type<'sharp' | 'base' | 'soft'>().notNull().default('base'),
  density: text('density').$type<'base' | 'compact'>().notNull().default('base'),
  dateFormat: text('date_format').$type<'iso' | 'dot' | 'us'>().notNull().default('iso'),
  amountUnit: text('amount_unit').$type<'won' | 'thousand' | 'man'>().notNull().default('won'),
  negative: text('negative').$type<'minus' | 'paren' | 'red'>().notNull().default('minus'),
  // Screen and message language (spec 008 S-9); null = follow the browser.
  language: text('language').$type<'ko' | 'en'>(),
  /** IANA time zone of "today" and "this month" on the screen, the server and MCP (spec 013 S-22). */
  timezone: text('timezone').notNull().default('Asia/Seoul'),
}, (t) => [userScoped(t.userId)])

/**
 * Holiday rule sets (spec 007 S-9). A built-in set ('kr') keeps its rules in code
 * (src/data/holidays-kr.ts) and only its on/off here; a user's own set keeps its rules (RRULE,
 * RDATE, EXDATE, substitute rule) in `rules`.
 */
export const holidaySet = pgTable('holiday_set', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  builtin: text('builtin'),
  rules: jsonb('rules').$type<HolidayRule[]>().notNull().default([]),
}, (t) => [
  unique('holiday_set_user_id_id').on(t.userId, t.id),
  uniqueIndex('holiday_set_user_builtin').on(t.userId, t.builtin).where(sql`${t.builtin} is not null`),
  userScoped(t.userId),
])

/** A living-cost item (spec 013 S-2); `code` marks the three moved from the old living row (food, transit, allowance). */
export const livingItem = pgTable('living_item', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default(''),
  payMethod: text('pay_method').notNull().default(''),
  amount: integer('amount').notNull().default(0),
  from: ym('from_month'),
  code: text('code').$type<'food' | 'transit' | 'allowance'>(),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('living_item_user_id_id').on(t.userId, t.id),
  uniqueIndex('living_item_user_code').on(t.userId, t.code).where(sql`${t.code} is not null`),
  check('living_item_amount_nonneg', sql`${t.amount} >= 0`),
  check('living_item_from_ym', sql`${t.from} is null or ${t.from} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check('living_item_code', sql`${t.code} is null or ${t.code} in ('food', 'transit', 'allowance')`),
])

export const subscription = pgTable('subscription', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  category: category('category').notNull(),
  plan: text('plan').notNull().default(''),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  currency: currencyCode('currency').notNull(),
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
  check('subscription_currency_code', sql`${t.currency} ~ '^[A-Z]{3}$'`),
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

/**
 * A bank account (spec 013 S-5). With a `group` it is also an item of the Savings or Investment menu:
 * its monthly `amount` (amount split; per phase in account_phase_amount) or `ratio` (ratio split) goes
 * to it from `from_month` on, until `stop_from` (that month and later get nothing). `buffer` is money kept
 * in the account; `goal` and `annual_limit` are optional; `goal_ack` is the goal the user chose to keep
 * sending past (S-7).
 */
export const bankAccount = pgTable('bank_account', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  inflow: text('inflow').notNull().default(''),
  outflow: text('outflow').notNull().default(''),
  bank: text('bank').notNull().default(''),
  last4: text('last4').notNull().default(''),
  kind: text('kind').notNull().default(''),
  rate: text('rate').notNull().default(''),
  term: text('term').notNull().default(''),
  buffer: integer('buffer').notNull().default(0),
  goal: integer('goal'),
  annualLimit: integer('annual_limit'),
  group: text('group').$type<'saving' | 'invest'>(),
  amount: integer('amount').notNull().default(0),
  ratio: numeric('ratio', { precision: 5, scale: 4, mode: 'number' }),
  from: ym('from_month'),
  stopFrom: ym('stop_from'),
  goalAck: integer('goal_ack'),
  note: text('note'),
  /** Where the money goes at maturity (free text; spec 013 S-15). */
  afterMaturity: text('after_maturity').notNull().default(''),
}, (t) => [
  unique('bank_account_user_id_id').on(t.userId, t.id),
  userScoped(t.userId),
  check('bank_account_last4', sql`${t.last4} = '' or ${t.last4} ~ '^[0-9]{4}$'`),
  check('bank_account_group', sql`${t.group} is null or ${t.group} in ('saving', 'invest')`),
  check('bank_account_amounts_nonneg', sql`${t.buffer} >= 0 and ${t.amount} >= 0 and (${t.goal} is null or ${t.goal} >= 0) and (${t.annualLimit} is null or ${t.annualLimit} >= 0)`),
  check('bank_account_ratio_range', sql`${t.ratio} is null or (${t.ratio} >= 0 and ${t.ratio} <= 1)`),
  check('bank_account_from_ym', sql`${t.from} is null or ${t.from} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check('bank_account_stop_ym', sql`${t.stopFrom} is null or ${t.stopFrom} ~ '^[0-9]{4}-[0-9]{2}$'`),
])

/**
 * A balance written down on a date (spec 013 S-6): the projection starts from the last one. `deposit` is money put in at
 * once that day (a maturity payout, …): the yearly contribution counts it (review 1 F-12, user: "잔액 기록에 '넣은 돈' 표시").
 */
export const accountBalance = pgTable('account_balance', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  accountId: text('account_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  amount: integer('amount').notNull(),
  deposit: integer('deposit'),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('account_balance_user_id_id').on(t.userId, t.id),
  check('account_balance_deposit_nonneg', sql`${t.deposit} is null or ${t.deposit} >= 0`),
  foreignKey({ name: 'account_balance_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }).onDelete('cascade'),
  check('account_balance_amount_nonneg', sql`${t.amount} >= 0`),
])

/**
 * A regular income (spec 014 S-2): monthly, or yearly in `month`. The salary is not a row: it is the settings'
 * netPay and payDay (S-2). `day` past a month's end means that month's last day (monthDay, as payDay).
 */
export const incomeItem = pgTable('income_item', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  cycle: text('cycle').notNull(),
  month: integer('month'),
  day: integer('day').notNull(),
  amount: integer('amount').notNull(),
  accountId: text('account_id'),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('income_item_user_id_id').on(t.userId, t.id),
  check('income_item_cycle', sql`(${t.cycle} = 'monthly' and ${t.month} is null) or (${t.cycle} = 'yearly' and ${t.month} between 1 and 12)`),
  check('income_item_day_range', sql`${t.day} between 1 and 31`),
  check('income_item_amount_nonneg', sql`${t.amount} >= 0`),
  foreignKey({ name: 'income_item_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }),
])

/**
 * Money received for one income in one month (spec 014 S-3); `itemId` null is the salary. A month may hold several:
 * their sum is what came in that month.
 */
export const incomeReceipt = pgTable('income_receipt', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  itemId: text('item_id'),
  ym: text('ym').notNull(),
  amount: integer('amount').notNull(),
  date: date('date', { mode: 'string' }),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('income_receipt_user_id_id').on(t.userId, t.id),
  check('income_receipt_amount_nonneg', sql`${t.amount} >= 0`),
  foreignKey({ name: 'income_receipt_item_fk', columns: [t.userId, t.itemId], foreignColumns: [incomeItem.userId, incomeItem.id] }).onDelete('cascade'),
])

/** Money that came in once (spec 014 S-4, "기타"): it counts in the month of its date. */
export const incomeExtra = pgTable('income_extra', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  date: date('date', { mode: 'string' }).notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('income_extra_user_id_id').on(t.userId, t.id),
  check('income_extra_amount_nonneg', sql`${t.amount} >= 0`),
])

/** A card (spec 013 S-13): the account its bill is paid from, and its billing day (null = the settings' one). */
export const card = pgTable('card', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  last4: text('last4').notNull().default(''),
  accountId: text('account_id'),
  billingDay: smallint('billing_day'),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('card_user_id_id').on(t.userId, t.id),
  foreignKey({ name: 'card_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }),
  check('card_last4', sql`${t.last4} = '' or ${t.last4} ~ '^[0-9]{4}$'`),
  check('card_billing_day', sql`${t.billingDay} is null or ${t.billingDay} between 1 and 31`),
])

/**
 * A monthly date of the user's own (spec 013 S-22, A-36): shown on the calendar and the schedule with the pay, transfer
 * and billing days (moved like them on a weekend or holiday). Not part of any sum.
 */
export const scheduleItem = pgTable('schedule_item', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  day: smallint('day').notNull(),
  accountId: text('account_id'),
  /** in: money comes into the account · out: money goes out of it */
  direction: text('direction').$type<'in' | 'out'>().notNull(),
  note: text('note'),
}, (t) => [
  userScoped(t.userId),
  unique('schedule_item_user_id_id').on(t.userId, t.id),
  foreignKey({ name: 'schedule_item_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }),
  check('schedule_item_day', sql`${t.day} between 1 and 31`),
  check('schedule_item_direction', sql`${t.direction} in ('in', 'out')`),
])

/**
 * A foreign currency other than USD (spec 013 S-23, A-35; USD keeps its rate in `settings`): the rate (KRW per unit) and
 * the buffer % used for subscriptions in that code, and whether the server refreshes the rate once a day.
 */
export const foreignCurrency = pgTable('foreign_currency', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  code: text('code').notNull(),
  // 6 decimals: a small unit (e.g. VND, about 0.05 KRW) keeps its rate (review rc3-1 F-2, A-43)
  rate: numeric('rate', { precision: 14, scale: 6, mode: 'number' }).notNull(),
  buffer: numeric('buffer', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  auto: boolean('auto').notNull().default(false),
  /** Written by the server only: the last refresh, and why the last try failed (null after a success). */
  autoAt: timestamp('auto_at', { withTimezone: true, mode: 'string' }),
  autoError: text('auto_error'),
}, (t) => [
  userScoped(t.userId),
  unique('foreign_currency_user_id_id').on(t.userId, t.id),
  unique('foreign_currency_user_code').on(t.userId, t.code),
  check('foreign_currency_code', sql`${t.code} ~ '^[A-Z]{3}$' and ${t.code} not in ('KRW', 'USD')`),
  check('foreign_currency_rate_pos', sql`${t.rate} > 0`),
  check('foreign_currency_buffer_range', sql`${t.buffer} >= 0 and ${t.buffer} <= 100`),
])

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

/**
 * One-off spending (spec 011 S-2): one row per purchase, its rounds in `spending_round`.
 * `amount` is in `currency`; the rounds are always whole KRW. `fx_rate` and `fx_buffer` are the rate and the buffer % used for a USD amount (fixed when it is saved, S-3); both null for KRW.
 */
export const spending = pgTable('spending', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  note: text('note'),
  category: text('category').notNull(),
  bought: date('bought', { mode: 'string' }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }).notNull(),
  currency: currencyCode('currency').notNull(),
  // 6 decimals like the currency list (A-43); USD's settings rate stays numeric(8,2)
  fxRate: numeric('fx_rate', { precision: 14, scale: 6, mode: 'number' }),
  fxBuffer: numeric('fx_buffer', { precision: 5, scale: 2, mode: 'number' }),
  how: spendHow('how').notNull(),
  payBy: payBy('pay_by').notNull(),
  count: smallint('count').notNull(),
  fee: integer('fee').notNull().default(0),
  interval: spendInterval('interval'),
  cancelled: boolean('cancelled').notNull().default(false),
  /** The card it was paid with (spec 013 S-13); a buffer use needs one with a paying account. */
  cardId: text('card_id'),
  /** Buffer use: the first refill date (spec 013 S-8). */
  refillFrom: date('refill_from', { mode: 'string' }),
}, (t) => [
  userScoped(t.userId),
  unique('spending_user_id_id').on(t.userId, t.id),
  foreignKey({ name: 'spending_card_fk', columns: [t.userId, t.cardId], foreignColumns: [card.userId, card.id] }),
  check('spending_amount_nonneg', sql`${t.amount} >= 0`),
  check('spending_fee_nonneg', sql`${t.fee} >= 0`),
  check('spending_count_range', sql`${t.count} between 1 and 60`),
  check('spending_currency_code', sql`${t.currency} ~ '^[A-Z]{3}$'`),
])

/** A round of a spending: when and how much (KRW) is billed or paid. Written with its spending, never alone. */
export const spendingRound = pgTable('spending_round', {
  userId: owner(),
  spendingId: text('spending_id').notNull(),
  no: smallint('no').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  amount: integer('amount').notNull(),
  state: roundState('state').notNull(),
  edited: boolean('edited').notNull().default(false),
}, (t) => [
  userScoped(t.userId),
  primaryKey({ columns: [t.spendingId, t.no] }),
  foreignKey({ name: 'spending_round_spending_fk', columns: [t.userId, t.spendingId], foreignColumns: [spending.userId, spending.id] }).onDelete('cascade'),
  check('spending_round_amount_nonneg', sql`${t.amount} >= 0`),
  check('spending_round_no_range', sql`${t.no} between 1 and 120`),
])

/** Where the monthly pay goes. Names are the user's data, never code. */
export const allocationTarget = pgTable('allocation_target', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  name: text('name').notNull(),
  kind: allocationKind('kind').notNull(),
  note: text('note'),
  /** The account the target's money goes to (spec 013 S-5). */
  accountId: text('account_id'),
}, (t) => [
  userScoped(t.userId),
  unique('allocation_target_user_id_id').on(t.userId, t.id),
  foreignKey({ name: 'allocation_target_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }),
  // living, subscriptions, remainder, saving and invest exist at most once each, per user
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

/** A living item's amount in one phase (spec 013 S-4); without one the item's own amount applies. */
export const livingPhaseAmount = pgTable('living_phase_amount', {
  userId: owner(),
  phaseId: text('phase_id').notNull(),
  itemId: text('item_id').notNull(),
  amount: integer('amount').notNull(),
}, (t) => [
  userScoped(t.userId),
  primaryKey({ columns: [t.phaseId, t.itemId] }),
  foreignKey({ name: 'living_phase_amount_phase_fk', columns: [t.userId, t.phaseId], foreignColumns: [phase.userId, phase.id] }).onDelete('cascade'),
  foreignKey({ name: 'living_phase_amount_item_fk', columns: [t.userId, t.itemId], foreignColumns: [livingItem.userId, livingItem.id] }).onDelete('cascade'),
  check('living_phase_amount_nonneg', sql`${t.amount} >= 0`),
])

/** A Savings / Investment account's amount in one phase (amount split; spec 013 S-4). */
export const accountPhaseAmount = pgTable('account_phase_amount', {
  userId: owner(),
  phaseId: text('phase_id').notNull(),
  accountId: text('account_id').notNull(),
  amount: integer('amount').notNull(),
}, (t) => [
  userScoped(t.userId),
  primaryKey({ columns: [t.phaseId, t.accountId] }),
  foreignKey({ name: 'account_phase_amount_phase_fk', columns: [t.userId, t.phaseId], foreignColumns: [phase.userId, phase.id] }).onDelete('cascade'),
  foreignKey({ name: 'account_phase_amount_account_fk', columns: [t.userId, t.accountId], foreignColumns: [bankAccount.userId, bankAccount.id] }).onDelete('cascade'),
  check('account_phase_amount_nonneg', sql`${t.amount} >= 0`),
])

/**
 * One month's amount of one target, in place of its phase amount for that month only (spec 013 S-14): fixed,
 * saving and invest targets (checked in the API). Deleting the target deletes it.
 */
export const monthAdjust = pgTable('month_adjust', {
  userId: owner(),
  id: text('id').primaryKey(),
  seq: seq(),
  ym: ym('ym').notNull(),
  targetId: text('target_id').notNull(),
  amount: integer('amount').notNull(),
  reason: text('reason'),
}, (t) => [
  userScoped(t.userId),
  unique('month_adjust_user_id_id').on(t.userId, t.id),
  unique('month_adjust_user_ym_target').on(t.userId, t.ym, t.targetId),
  foreignKey({ name: 'month_adjust_target_fk', columns: [t.userId, t.targetId], foreignColumns: [allocationTarget.userId, allocationTarget.id] }).onDelete('cascade'),
  check('month_adjust_amount_nonneg', sql`${t.amount} >= 0`),
  check('month_adjust_ym', sql`${t.ym} ~ '^[0-9]{4}-[0-9]{2}$'`),
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
/** system: the server itself (the daily rate refresh, spec 013 S-23). */
export const actorKind = pgEnum('actor_kind', ['user', 'api_key', 'system'])
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
  /** The key's name when an AI key made the set; stays when the key is deleted (spec 009 S-7). */
  actorLabel: text('actor_label'),
  /** The proposal this set applied (spec 009 S-3). */
  proposalId: text('proposal_id'),
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

// ── Proposals from an AI key (spec 009 S-3): a list of operations with the preview computed by applying
// them and rolling back, kept until it is confirmed, rejected or expired. No foreign keys to the key
// (a key may be revoked) or to the set it produced (the history is pruned by age). ──
export const mcpProposal = pgTable('mcp_proposal', {
  userId: owner(),
  id: text('id').primaryKey(),
  /** 'api_key': key_id/key_name are the API key's; 'oauth': the OAuth client's id and app name (spec 015 S-9). */
  sourceKind: text('source_kind').notNull().default('api_key'),
  keyId: text('key_id').notNull(),
  keyName: text('key_name').notNull(),
  /** Where it is confirmed: 'ui' (Pending changes) or 'chat' (the apply tool). Copied from the key. */
  confirm: text('confirm').notNull(),
  ops: jsonb('ops').$type<unknown[]>().notNull(),
  note: text('note'),
  /** SHA-256 of the user's data when it was proposed; a different one at apply time means stale. */
  baseHash: text('base_hash').notNull(),
  preview: jsonb('preview').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }),
  /** 'user' (on the screen) or 'key' (the apply tool). */
  decidedBy: text('decided_by'),
  changeSetId: text('change_set_id'),
  /** A proposal to revert that set (then `ops` is empty). */
  revertOf: text('revert_of'),
}, (t) => [
  userScoped(t.userId),
  unique('mcp_proposal_user_id_id').on(t.userId, t.id),
  index('mcp_proposal_user_status').on(t.userId, t.status),
  check('mcp_proposal_confirm', sql`${t.confirm} in ('ui', 'chat')`),
  check('mcp_proposal_source_kind', sql`${t.sourceKind} in ('api_key', 'oauth')`),
  check('mcp_proposal_status', sql`${t.status} in ('pending', 'applied', 'rejected', 'expired', 'stale')`),
  check('mcp_proposal_decided_by', sql`${t.decidedBy} is null or ${t.decidedBy} in ('user', 'key')`),
])

// ── Data keys for envelope encryption (spec 006 S-5, server/crypto/) ──
/** One data key per user, wrapped by the master key whose id is `kid`. */
export const userKey = pgTable('user_key', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'restrict' }),
  dekId: text('dek_id').notNull(),
  kid: text('kid').notNull(),
  wrapped: text('wrapped').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [userScoped(t.userId)])

/** Data keys that belong to no user (provider client secrets). Not user data: no row-level security. */
export const systemKey = pgTable('system_key', {
  id: text('id').primaryKey(),
  dekId: text('dek_id').notNull(),
  kid: text('kid').notNull(),
  wrapped: text('wrapped').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Login methods (spec 006 S-1). Global settings, not user data: no user_id, no row-level
// security. Read when the auth instance is built; written only through the admin API.
// Env values win over these (server/auth-config.ts). ──
export const authProvider = pgTable('auth_provider', {
  /** password | oidc | github | google */
  id: text('id').primaryKey(),
  enabled: boolean('enabled'),
  /** closed | approval | rules */
  signup: text('signup'),
  /** { emails?, groups?, orgs?, domains? } */
  rules: jsonb('rules').$type<Record<string, string[]>>(),
  /** { name?, clientId?, discoveryUrl?, scopes?, groupsClaim? } */
  options: jsonb('options').$type<Record<string, unknown>>(),
  /** Sealed with the system data key (server/crypto/keys.ts), never returned by the API. */
  clientSecretEnc: text('client_secret_enc'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
}, (t) => [check('auth_provider_id', sql`${t.id} in ('password', 'oidc', 'github', 'google')`),
  check('auth_provider_signup', sql`${t.signup} is null or ${t.signup} in ('closed', 'approval', 'rules')`)])

// ── Server-wide settings (spec 008 S-3): one row per setting; no user_id, so no row-level security
// (like auth_provider). Env values win over these (server/api-key-policy.ts). ──
export const appSetting = pgTable('app_setting', {
  /** api_keys | password */
  id: text('id').primaryKey(),
  /** api_keys: { noExpiry: boolean } · password: { minLength, lockout: { enabled, attempts, minutes } } (spec 013 S-24) */
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
}, (t) => [check('app_setting_id', sql`${t.id} in ('api_keys', 'password')`)])

/**
 * Failed password sign-ins per email (spec 013 S-24, A-37): only counted while the admin's lockout is on. Keyed by the
 * email as typed (lower case), also for an email with no account, so the answer never tells whether one exists.
 * A server table (no user_id, no row-level security), like app_setting.
 */
export const loginFailure = pgTable('login_failure', {
  email: text('email').primaryKey(),
  count: integer('count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
