// Request bodies, one schema per resource. The same rules as the UI editors.
import { z } from 'zod'
import { ruleProblem } from '../src/lib/holidays'

/** A real calendar date (rejects 2031-02-30), YYYY-MM-DD. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}, '없는 날짜예요.')
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM')
// Bounds match the column types: integer, numeric(12,2), numeric(8,2), numeric(5,2).
const INT_MAX = 2_147_483_647
const won = z.number().int().min(0).max(INT_MAX, '금액이 너무 커요.')
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
})

// ── Display settings and holiday sets (spec 007 S-7, S-8, S-9) ──
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, '색은 #RRGGBB 형식이에요.').transform((x) => x.toUpperCase())

export const preferences = z.object({
  themeMode: z.enum(['system', 'light', 'dark']),
  primary: hex.nullable(),
  accent: hex.nullable(),
  radius: z.enum(['sharp', 'base', 'soft']),
  density: z.enum(['base', 'compact']),
  dateFormat: z.enum(['iso', 'dot', 'us']),
  amountUnit: z.enum(['won', 'thousand', 'man']),
  negative: z.enum(['minus', 'paren', 'red']),
}).strict()

const holidayRule = z.object({
  name: text.min(1, '공휴일 이름을 입력해 주세요.').max(40),
  rrule: z.string().trim().min(1).max(200).superRefine((r, ctx) => {
    const problem = ruleProblem(r)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }).optional(),
  rdate: z.array(date).max(100).optional(),
  exdate: z.array(date).max(100).optional(),
  substitute: z.object({
    on: z.array(z.enum(['SA', 'SU'])).min(1).max(2),
    since: z.number().int().min(1900).max(2200).optional(),
  }).strict().optional(),
}).strict().refine((x) => !!x.rrule || !!x.rdate?.length, '반복 규칙(RRULE)이나 날짜(RDATE) 중 하나는 있어야 해요.')

export const BUILTIN_HOLIDAY_SETS = ['kr'] as const

export const holidaySet = z.object({
  name: text.min(1, '세트 이름을 입력해 주세요.').max(40),
  enabled: z.boolean(),
  builtin: z.enum(BUILTIN_HOLIDAY_SETS).nullable(),
  rules: z.array(holidayRule).max(100, '규칙은 100개까지예요.'),
}).strict().superRefine((x, ctx) => {
  // A built-in set's rules live in code; a user's own set needs at least one rule.
  if (x.builtin && x.rules.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: '기본 세트의 규칙은 바꿀 수 없어요.' })
  if (!x.builtin && !x.rules.length) ctx.addIssue({ code: 'custom', path: ['rules'], message: '규칙을 하나 이상 넣어 주세요.' })
})

export const living = z.object({ food: won, transit: won, allowance: won })

const plan = z.object({
  plan: text,
  amount: z.number().min(0).max(9_999_999_999.99, '금액이 너무 커요.'),
  currency,
  vat: z.number().min(0).max(100),
  cycle,
  status: subStatus,
})

export const subscription = plan.extend({
  name: text.min(1, '서비스 이름을 입력해 주세요.'),
  category,
  nextDate: date,
  path: payPath,
  verified: z.boolean(),
  note: optText,
})

export const planChange = z.object({
  subId: text.min(1),
  effective: date.nullable(),
  to: plan.partial().refine((p) => Object.keys(p).length > 0, '바꿀 항목을 하나 이상 입력해 주세요.'),
  note: z.string().trim(),
})

export const phase = z.object({
  label: text,
  name: text.min(1),
  from: ym,
  to: ym.nullable(),
  amounts: z.record(z.string().min(1), won), // targetId → amount, fixed targets only
  note: optText,
}).refine((p) => p.to === null || p.to >= p.from, { message: '끝 월이 시작 월보다 빨라요.', path: ['to'] })

export const planEvent = z.object({
  when: z.string().regex(/^\d{4}-\d{2}(~\d{2})?$/, 'YYYY-MM 또는 YYYY-MM~MM'),
  kind: text.min(1),
  title: text.min(1),
  state: z.enum(['done', 'doing', 'todo']),
})

export const checkItem = z.object({ text: text.min(1), done: z.boolean() })

export const account = z.object({ name: text.min(1), role: z.string(), inflow: z.string(), outflow: z.string() })

export const debt = z.object({ name: text.min(1), principal: won, rate: z.string(), method: z.string(), plan: z.string() })

export const remainderSplit = z.object({ name: text.min(1), code: z.string(), ratio: z.number().min(0).max(1) })

export const target = z.object({
  name: text.min(1, '이름을 입력해 주세요.'),
  kind: z.enum(['living', 'subscriptions', 'fixed', 'remainder']),
  note: optText,
})

// ── Admin (spec 006 S-3) ──
const ruleList = (item: z.ZodString) => z.array(item).max(200)
const domain = z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, '도메인 형식이 아니에요.')

/** PUT /api/admin/providers/:id — only the fields sent change; clientSecret null removes it. */
export const providerUpdate = z.object({
  enabled: z.boolean().optional(),
  signup: z.enum(['closed', 'approval', 'rules']).optional(),
  rules: z.object({
    emails: ruleList(z.string().trim().toLowerCase().email('이메일 형식이 아니에요.').max(254)).optional(),
    groups: ruleList(z.string().trim().min(1).max(200)).optional(),
    orgs: ruleList(z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/, 'GitHub organization 이름이 아니에요.')).optional(),
    domains: ruleList(domain).optional(),
  }).strict().optional(),
  options: z.object({
    name: z.string().trim().min(1).max(40).optional(),
    clientId: z.string().trim().min(1).max(500).optional(),
    discoveryUrl: z.string().trim().url('URL 형식이 아니에요.').max(2000).optional(),
    scopes: z.array(z.string().regex(/^[\x21-\x7e]{1,100}$/, 'scope 형식이 아니에요.')).min(1).max(20).optional(),
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
