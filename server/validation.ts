// Request bodies, one schema per resource. The same rules as the UI editors.
import { z } from 'zod'

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
