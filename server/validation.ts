// Request bodies, one schema per resource. The same rules as the UI editors.
// Messages are keys of server/messages.ts (server/body.ts picks the language per request).
import { z } from 'zod'
import { ruleProblem } from '../src/lib/holidays'
import { ROUND_MAX, roundsProblem } from '../src/lib/spending-rules'
import { m, type MsgKey } from './messages'

/** A real calendar date (rejects 2031-02-30), YYYY-MM-DD. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFormat').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}, 'dateInvalid')
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'monthFormat')
// Bounds match the column types: integer, numeric(12,2), numeric(8,2), numeric(5,2).
const INT_MAX = 2_147_483_647
const won = z.number().int().min(0).max(INT_MAX, 'amountTooBig')
const day = z.number().int().min(1).max(31)
const text = z.string().trim()
const optText = z.string().trim().optional()

export const currency = z.enum(['KRW', 'USD'])
export const cycle = z.enum(['monthly', 'yearly'])
export const subStatus = z.enum(['active', 'cancelled', 'company'])
export const payPath = z.enum(['direct', 'google', 'apple', 'telecom'])
export const category = z.enum(['ai', 'telecom', 'content', 'tool', 'insurance', 'life'])

export const settings = z.object({
  netPay: won,
  fxRate: z.number().positive().max(999_999.99),
  fxBuffer: z.number().min(0).max(100),
  payDay: day,
  transferDay: day,
  billingDay: day,
  subRound: z.number().int().positive().max(INT_MAX),
  // Optional so a client that does not know it keeps the saved value (spec 007 S-10).
  dayShift: z.enum(['none', 'before', 'after']).optional(),
  // The same for the split of the Savings and Investment menus (spec 013 S-3).
  savingSplit: z.enum(['amount', 'ratio']).optional(),
  investSplit: z.enum(['amount', 'ratio']).optional(),
})

// ── Display settings and holiday sets (spec 007 S-7, S-8, S-9) ──
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'hexColor').transform((x) => x.toUpperCase())

export const preferences = z.object({
  themeMode: z.enum(['system', 'light', 'dark']),
  primary: hex.nullable(),
  accent: hex.nullable(),
  radius: z.enum(['sharp', 'base', 'soft']),
  density: z.enum(['base', 'compact']),
  dateFormat: z.enum(['iso', 'dot', 'us']),
  amountUnit: z.enum(['won', 'thousand', 'man']),
  negative: z.enum(['minus', 'paren', 'red']),
  // Optional so a client that does not know it keeps the saved value (spec 008 S-9).
  language: z.enum(['ko', 'en']).nullable().optional(),
}).strict()

const holidayRule = z.object({
  name: text.min(1, 'holidayNameReq').max(40),
  rrule: z.string().trim().min(1).max(200).superRefine((r, ctx) => {
    const problem = ruleProblem(r)
    if (problem) ctx.addIssue({ code: 'custom', message: JSON.stringify(m(`rule_${problem.code}` as MsgKey, problem.vars)) })
  }).optional(),
  rdate: z.array(date).max(100).optional(),
  exdate: z.array(date).max(100).optional(),
  substitute: z.object({
    on: z.array(z.enum(['SA', 'SU'])).min(1).max(2),
    since: z.number().int().min(1900).max(2200).optional(),
  }).strict().optional(),
}).strict().refine((x) => !!x.rrule || !!x.rdate?.length, 'ruleOrDate')

export const BUILTIN_HOLIDAY_SETS = ['kr'] as const

export const holidaySet = z.object({
  name: text.min(1, 'setNameReq').max(40),
  enabled: z.boolean(),
  builtin: z.enum(BUILTIN_HOLIDAY_SETS).nullable(),
  rules: z.array(holidayRule).max(100, 'rulesMax'),
}).strict().superRefine((x, ctx) => {
  // A built-in set's rules live in code; a user's own set needs at least one rule.
  if (x.builtin && x.rules.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'builtinRules' })
  if (!x.builtin && !x.rules.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: 'rulesNeeded' })
})

export const living = z.object({ food: won, transit: won, allowance: won })

// ── Budget core (spec 013 S-9) ──
const short = z.string().trim().max(40)
const memo = z.string().trim().max(200).optional()
const last4 = z.string().regex(/^(\d{4})?$/, 'last4Format')
/** A ratio of 0..1 with at most 4 decimals (0.01%), as numeric(5,4) stores it. */
const ratio = z.number().min(0).max(1).refine((n) => Math.round(n * 10_000) / 10_000 === n, 'ratioDecimals')
const phaseAmounts = z.record(z.string().min(1), won) // phaseId → amount

// No maximum on names, like the other names (S-9 "이름은 지금 규칙"); unknown keys are dropped, as for accounts in 0.1.6 (review 1 F-2, F-3).
export const livingItem = z.object({
  name: text.min(1, 'nameReq'),
  kind: short,
  payMethod: short,
  amount: won,
  from: ym.nullable(),
  code: z.enum(['food', 'transit', 'allowance']).nullable().optional(),
  note: memo,
  amounts: phaseAmounts.default({}),
})

const plan = z.object({
  plan: text,
  amount: z.number().min(0).max(9_999_999_999.99, 'amountTooBig'),
  currency,
  vat: z.number().min(0).max(100),
  cycle,
  status: subStatus,
})

export const subscription = plan.extend({
  name: text.min(1, 'serviceNameReq'),
  category,
  nextDate: date,
  path: payPath,
  verified: z.boolean(),
  note: optText,
})

export const planChange = z.object({
  subId: text.min(1),
  effective: date.nullable(),
  to: plan.partial().refine((p) => Object.keys(p).length > 0, 'changeFieldsReq'),
  note: z.string().trim(),
})

export const phase = z.object({
  label: text,
  name: text.min(1),
  from: ym,
  to: ym.nullable(),
  amounts: z.record(z.string().min(1), won), // targetId → amount, fixed targets only
  note: optText,
}).refine((p) => p.to === null || p.to >= p.from, { message: 'phaseEndEarly', path: ['to'] })

export const planEvent = z.object({
  when: z.string().regex(/^\d{4}-\d{2}(~\d{2})?$/, 'ymRange'),
  kind: text.min(1),
  title: text.min(1),
  state: z.enum(['done', 'doing', 'todo']),
})

export const checkItem = z.object({ text: text.min(1), done: z.boolean() })

// The fields up to 0.1.6 stay as they were (name, role, inflow, outflow); the rest are optional, so a
// client that sends only those keeps the stored values of the others (spec 013 S-11).
export const account = z.object({
  name: text.min(1),
  role: z.string(),
  inflow: z.string(),
  outflow: z.string(),
  bank: short.optional(),
  last4: last4.optional(),
  kind: short.optional(),
  rate: short.optional(),
  term: short.optional(),
  buffer: won.optional(),
  goal: won.nullable().optional(),
  annualLimit: won.nullable().optional(),
  group: z.enum(['saving', 'invest']).nullable().optional(),
  amount: won.optional(),
  ratio: ratio.nullable().optional(),
  from: ym.nullable().optional(),
  stopFrom: ym.nullable().optional(),
  goalAck: won.nullable().optional(),
  note: memo,
  amounts: phaseAmounts.optional(),
}).superRefine((x, ctx) => {
  // Only a Savings / Investment item carries a monthly amount, a ratio or phase amounts.
  if (x.group === null || x.group === undefined) {
    if (x.group === null && ((x.amount ?? 0) !== 0 || (x.ratio ?? null) !== null || Object.keys(x.amounts ?? {}).length)) {
      ctx.addIssue({ code: 'custom', path: ['group'], message: 'groupOnly' })
    }
  }
})

export const balance = z.object({
  accountId: text.min(1),
  date,
  amount: won,
  note: memo,
})

export const card = z.object({
  name: text.min(1, 'nameReq'),
  last4: last4,
  accountId: text.min(1).nullable(),
  billingDay: day.nullable(),
  note: memo,
})

export const debt = z.object({ name: text.min(1), principal: won, rate: z.string(), method: z.string(), plan: z.string() })

export const remainderSplit = z.object({ name: text.min(1), code: z.string(), ratio: z.number().min(0).max(1) })

export const target = z.object({
  name: text.min(1, 'nameReq'),
  kind: z.enum(['living', 'subscriptions', 'fixed', 'remainder', 'saving', 'invest']),
  note: optText,
  // Optional: a client that does not send it keeps the stored link (spec 013 S-5).
  accountId: text.min(1).nullable().optional(),
})

// ── One-off spending (spec 011 S-2, S-4, S-6) ──
export const spendHow = z.enum(['lump', 'installment', 'split', 'buffer'])
export const payBy = z.enum(['card', 'salary', 'subs'])
export const spendInterval = z.enum(['monthly', 'biweekly', 'custom'])
export const roundState = z.enum(['left', 'paid', 'merged'])

const spendingRound = z.object({
  no: z.number().int().min(1).max(120),
  date,
  amount: won,
  state: roundState,
  edited: z.boolean(),
}).strict()

/** Up to 60 rounds, plus those an early payoff adds (each payoff merges at least one round and adds one). */
export const MAX_ROUNDS = 120

/** A value that is exactly its own 2-decimal rounding (3.46, 1380.25), so what the numeric(_,2) column stores is what was typed. */
export const twoDecimals = (n: number | null) => n === null || Math.round(n * 100) / 100 === n

export const spending = z.object({
  name: text.min(1, 'nameReq'),
  note: optText,
  category: text.min(1, 'nameReq').max(40),
  bought: date,
  amount: z.number().min(0).max(9_999_999_999.99, 'amountTooBig'),
  currency,
  fxRate: z.number().positive().max(999_999.99).nullable(),
  fxBuffer: z.number().min(0).max(100).nullable().default(null),
  how: spendHow,
  payBy,
  count: z.number().int().min(1).max(60),
  fee: won,
  interval: spendInterval.nullable(),
  cancelled: z.boolean(),
  // Optional, so a client that does not know them keeps the stored ones (spec 013 S-8, S-13).
  cardId: text.min(1).nullable().optional(),
  refillFrom: date.nullable().optional(),
  rounds: z.array(spendingRound).min(1).max(MAX_ROUNDS),
}).strict().superRefine((x, ctx) => {
  const bad = (path: string, message: MsgKey) => ctx.addIssue({ code: 'custom', path: [path], message })
  // A buffer use is a card purchase with a card, no fee and no interval, and a refill start (S-8, S-9);
  // the card must have a paying account (checked in the API, it needs the card row).
  if (x.how === 'buffer') {
    if (x.payBy !== 'card' || !x.cardId) bad('cardId', 'bufferNeedsCard')
    if (!x.refillFrom) bad('refillFrom', 'spendHow')
  } else if (x.refillFrom) bad('refillFrom', 'refillOnlyBuffer')
  if (x.cardId && x.payBy !== 'card') bad('cardId', 'cardOnlyCard')
  if (x.currency === 'USD' ? x.fxRate === null : x.fxRate !== null) bad('fxRate', 'spendFx')
  // the columns are numeric(8,2) and numeric(5,2): what is stored must be what the rounds were worked out with
  if (!twoDecimals(x.fxRate)) bad('fxRate', 'spendFxDecimals')
  if (!twoDecimals(x.fxBuffer)) bad('fxBuffer', 'spendFxDecimals')
  if (x.currency === 'USD' ? x.fxBuffer === null : x.fxBuffer !== null) bad('fxBuffer', 'spendFx')
  if (x.currency === 'KRW' && !Number.isInteger(x.amount)) bad('amount', 'spendKrwWhole')
  // Only a card installment carries a fee; only a split an interval.
  if (x.fee !== 0 && !(x.how === 'installment' && x.payBy === 'card')) bad('fee', 'spendHow')
  if ((x.how === 'split') !== (x.interval !== null)) bad('interval', 'spendHow')
  // A KRW amount and its fee are one total that must fit a round (the same bound as the rounds' sum).
  if (x.currency === 'KRW' && x.amount + x.fee > ROUND_MAX) bad('amount', 'amountTooBig')
  // The count, the numbering and the sums of the rounds: one rule, also checked after a revert (src/lib/spending-rules.ts).
  const problem = roundsProblem(x)
  if (problem) bad(problem, problem === 'count' ? 'spendHow' : 'spendRounds')
})

// ── Admin (spec 006 S-3) ──
const ruleList = (item: z.ZodString) => z.array(item).max(200)
const domain = z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'domainFormat')

/** PUT /api/admin/providers/:id — only the fields sent change; clientSecret null removes it. */
export const providerUpdate = z.object({
  enabled: z.boolean().optional(),
  signup: z.enum(['closed', 'approval', 'rules']).optional(),
  rules: z.object({
    emails: ruleList(z.string().trim().toLowerCase().email('emailFormat').max(254)).optional(),
    groups: ruleList(z.string().trim().min(1).max(200)).optional(),
    orgs: ruleList(z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/, 'orgFormat')).optional(),
    domains: ruleList(domain).optional(),
  }).strict().optional(),
  options: z.object({
    name: z.string().trim().min(1).max(40).optional(),
    clientId: z.string().trim().min(1).max(500).optional(),
    discoveryUrl: z.string().trim().url('urlFormat').max(2000).optional(),
    scopes: z.array(z.string().regex(/^[\x21-\x7e]{1,100}$/, 'scopeFormat')).min(1).max(20).optional(),
    groupsClaim: z.string().trim().min(1).max(100).optional(),
  }).strict().optional(),
  clientSecret: z.union([z.string().min(1).max(2000), z.null()]).optional(),
}).strict()

/** POST /api/admin/users/:id/role */
export const userRole = z.object({ role: z.enum(['admin', 'user']) }).strict()

/** POST /api/admin/users/:id/ban */
export const userBan = z.object({ reason: z.string().trim().max(200).optional() }).strict()

/** DELETE /api/admin/users/:id — the user's email, typed again. */
export const userDelete = z.object({ confirmEmail: z.string().trim().min(1).max(254) }).strict()

// ── API keys (spec 008 S-1, S-3) ──
/**
 * POST /api/keys — expiresInDays: absent = 90 days, null = no expiry (only while the server allows it).
 * `write` adds the write scope (spec 009 S-5); `confirm` says where its proposals are confirmed
 * (default 'ui') and belongs to a write key only. Neither can be changed after the key is made.
 */
export const keyCreate = z.object({
  name: z.string().trim().min(1, 'keyNameReq').max(32, 'keyNameMax'),
  expiresInDays: z.number().int('keyDaysInt').min(1, 'keyDaysMin').max(365, 'keyDaysMax').nullable().optional(),
  write: z.boolean().optional(),
  confirm: z.enum(['ui', 'chat']).optional(),
}).strict().refine((k) => k.confirm === undefined || k.write === true, { message: 'keyConfirmNeedsWrite', path: ['confirm'] })

/** PUT /api/admin/api-keys */
export const keyPolicy = z.object({ noExpiry: z.boolean() }).strict()
