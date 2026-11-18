import type { AllocationKind, AllocationTarget, DayShift, Living, Phase, Plan, PlanChange, RemainderSplit, Settings, Subscription } from '../data/types'

export const DAY = 86_400_000

// ---------- dates ----------
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function ymOf(d: Date): string {
  return ymd(d).slice(0, 7)
}
export function today(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}
export function addMonths(d: Date, n: number): Date {
  const y = d.getFullYear()
  const m = d.getMonth() + n
  const last = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(d.getDate(), last))
}
export function addYm(ym: string, n: number): string {
  return ymOf(addMonths(parseDate(ym + '-01'), n))
}
export function ymRange(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addYm(from, i))
}

// ---------- monthly dates (spec 007 S-10) ----------
export interface MonthDate {
  nominal: string // YYYY-MM-DD: the set day, or the month's last day when the month is shorter
  date: string // after the weekend/holiday shift
  shifted: Exclude<DayShift, 'none'> | null
  /** No business day within SHIFT_LIMIT days: `date` is the set day, unshifted. */
  unresolved?: true
}

/**
 * One monthly day of `ym`, moved off weekends and holidays as `shift` says: 'before' = the
 * business day before, 'after' = the one after, 'none' = as set. `off` holds the holiday dates
 * (src/lib/holidays.ts makes them; this module stays free of that dependency).
 */
/** How far a monthly date may move (review 2, F1/F3): callers supply the holidays of the month before and after. */
export const SHIFT_LIMIT = 31
export function monthDay(ym: string, day: number, shift: DayShift, off: ReadonlySet<string>): MonthDate {
  const first = parseDate(ym + '-01')
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const nominal = new Date(first.getFullYear(), first.getMonth(), Math.min(day, last))
  const closed = (d: Date) => d.getDay() === 0 || d.getDay() === 6 || off.has(ymd(d))
  let d = nominal
  if (shift !== 'none') {
    const step = shift === 'before' ? -1 : 1
    for (let i = 0; closed(d) && i < SHIFT_LIMIT; i++) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step)
    // Never hand back a closed day as the result (review 1, R5).
    if (closed(d)) return { nominal: ymd(nominal), date: ymd(nominal), shifted: null, unresolved: true }
  }
  const moved = ymd(d) !== ymd(nominal)
  return { nominal: ymd(nominal), date: ymd(d), shifted: moved && shift !== 'none' ? shift : null }
}

/** Pay day, transfer day and card billing day of `ym` (spec 007 S-10). */
export function monthDates(ym: string, s: Settings, off: ReadonlySet<string>) {
  const shift = s.dayShift ?? 'none'
  return {
    pay: monthDay(ym, s.payDay, shift, off),
    transfer: monthDay(ym, s.transferDay, shift, off),
    billing: monthDay(ym, s.billingDay, shift, off),
  }
}

// ---------- plan state at a month ----------
/** 해당 월까지 발효된 변경을 순서대로 적용한 플랜. */
export function planAt(sub: Subscription, changes: PlanChange[], ym: string): Subscription {
  return changes
    .filter((c) => c.subId === sub.id && c.effective && c.effective.slice(0, 7) <= ym)
    .sort((a, b) => (a.effective! < b.effective! ? -1 : 1))
    .reduce<Subscription>((acc, c) => ({ ...acc, ...c.to }), { ...sub })
}

export function chargeKrw(p: Plan, s: Settings): number {
  if (p.currency === 'USD') return p.amount * (1 + (p.vat || 0) / 100) * s.fxRate
  return p.amount
}
export function monthlyKrw(p: Plan, s: Settings): number {
  const k = chargeKrw(p, s)
  return p.cycle === 'yearly' ? k / 12 : k
}

export interface TransferCalc {
  monthlySum: number
  yearlyMonthly: number
  usdMonthly: number
  buffer: number
  needed: number // 1,000원 올림
  transfer: number // 구독 이체 올림 단위로 올린 금액
  items: { sub: Subscription; monthly: number }[]
}

/** 구독료 통장 계산기와 같은 식. */
export function transferAt(subs: Subscription[], changes: PlanChange[], s: Settings, ym: string): TransferCalc {
  let monthlySum = 0
  let yearlyMonthly = 0
  let usdMonthly = 0
  const items: TransferCalc['items'] = []
  for (const base of subs) {
    const p = planAt(base, changes, ym)
    if (p.status !== 'active') continue
    const m = monthlyKrw(p, s)
    if (p.cycle === 'yearly') yearlyMonthly += m
    else monthlySum += m
    if (p.currency === 'USD') usdMonthly += m
    items.push({ sub: p, monthly: m })
  }
  items.sort((a, b) => b.monthly - a.monthly)
  const buffer = (usdMonthly * s.fxBuffer) / 100
  const raw = monthlySum + yearlyMonthly + buffer
  const needed = Math.ceil(raw / 1000) * 1000
  const transfer = Math.ceil(needed / s.subRound) * s.subRound
  return { monthlySum, yearlyMonthly, usdMonthly, buffer, needed, transfer, items }
}

/** 해당 월에 처음 발효되는 변경 목록. */
export function changesIn(changes: PlanChange[], ym: string): PlanChange[] {
  return changes.filter((c) => c.effective && c.effective.slice(0, 7) === ym)
}

// ---------- upcoming payments ----------
export function nextOccurrence(sub: Subscription, from: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sub.nextDate)) return null
  const a = parseDate(sub.nextDate)
  const step = sub.cycle === 'yearly' ? 12 : 1
  let d = a
  let k = 0
  while (d < from && k < 1200) {
    k++
    d = addMonths(a, k * step)
  }
  // nextDate가 미래면 그 이전 회차도 범위 안일 수 있으니 한 주기 앞을 확인
  const prev = addMonths(d, -step)
  return prev >= from ? prev : d
}

export interface Payment {
  date: Date
  sub: Subscription
  krw: number
  dday: number
}

export function upcomingPayments(subs: Subscription[], changes: PlanChange[], s: Settings, from: Date, days: number): Payment[] {
  const end = new Date(from.getTime() + days * DAY)
  const out: Payment[] = []
  for (const base of subs) {
    let d = nextOccurrence(base, from)
    while (d && d <= end) {
      const p = planAt(base, changes, ymOf(d))
      if (p.status === 'active') {
        out.push({ date: d, sub: p, krw: chargeKrw(p, s), dday: Math.round((d.getTime() - from.getTime()) / DAY) })
      }
      d = addMonths(d, p.cycle === 'yearly' ? 12 : 1)
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** The first calendar day after `from` + `days` (local dates; no millisecond math, so a clock change cannot move it). */
const dayPlus = (from: Date, days: number) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)

export interface LaterPayment {
  date: Date
  sub: Subscription
  krw: number
  /** why it is listed: a yearly charge, or a new plan / amount */
  reason: 'yearly' | 'plan'
}

/**
 * Payments after the next 31 days, for the "31일 이후" list (spec 010 S-6): within one year of `from`,
 * per subscription the first payment that is yearly or charges a new plan or amount (a plan change
 * that comes in), at most `max` rows (3), the soonest first. A subscription whose only payments
 * are the plain monthly ones it pays now is left out.
 */
export function paysAfter31(subs: Subscription[], changes: PlanChange[], s: Settings, from: Date, max = 3): LaterPayment[] {
  const start = dayPlus(from, 31)
  const end = dayPlus(from, 365)
  const out: LaterPayment[] = []
  for (const base of subs) {
    const now = planAt(base, changes, ymOf(from))
    let d = nextOccurrence(base, from)
    // Walk by the plan in force at each date (a plan change can change the cycle), as upcomingPayments does.
    for (let k = 0; d && d <= end && k < 400; k++) {
      const p = planAt(base, changes, ymOf(d))
      if (d > start && p.status === 'active') {
        const krw = chargeKrw(p, s)
        const yearly = p.cycle === 'yearly'
        const changed = p.plan !== now.plan || krw !== chargeKrw(now, s)
        if (yearly || changed) {
          out.push({ date: d, sub: p, krw, reason: yearly ? 'yearly' : 'plan' })
          break
        }
      }
      d = addMonths(d, p.cycle === 'yearly' ? 12 : 1)
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, max)
}

export interface Leftover {
  /** the subscription transfer of `ym` (after rounding up) */
  transfer: number
  /** this transfer's day, and the day before the next month's transfer day (YYYY-MM-DD, both counted) */
  from: string
  to: string
  /** what is charged in that window */
  paid: number
  count: number
  /** transfer − paid; negative = the transfer does not cover the window */
  left: number
}

/**
 * "이체 후 남는 금액" (spec 010 D-9): the subscription transfer of `ym` minus the payments from that
 * transfer day to the day before the next month's transfer day. This is not an account balance
 * (the app holds none). `off` holds the holidays for the day shift, as in `monthDates`.
 */
export function leftoverAfterTransfer(
  state: { subscriptions: Subscription[]; planChanges: PlanChange[]; settings: Settings },
  ym: string,
  off: ReadonlySet<string> = new Set(),
): Leftover {
  const { subscriptions, planChanges, settings } = state
  const shift = settings.dayShift ?? 'none'
  const from = monthDay(ym, settings.transferDay, shift, off).date
  const nextStart = monthDay(addYm(ym, 1), settings.transferDay, shift, off).date
  const startD = parseDate(from)
  const last = ymd(dayPlus(parseDate(nextStart), -1))
  const to = last < from ? from : last
  // Ask for a few days more than the window, then cut by date: no clock arithmetic decides the edge.
  const span = Math.round((parseDate(to).getTime() - startD.getTime()) / DAY) + 3
  const inWindow = upcomingPayments(subscriptions, planChanges, settings, startD, span).filter((p) => ymd(p.date) >= from && ymd(p.date) <= to)
  const paid = inWindow.reduce((a, p) => a + p.krw, 0)
  const transfer = transferAt(subscriptions, planChanges, settings, ym).transfer
  return { transfer, from, to, paid, count: inWindow.length, left: transfer - paid }
}

/** What is left of the pay when no target takes the remainder: the pay minus every target (negative = short). 0 when a remainder target exists. */
export function unallocated(dist: Pick<Distribution, 'remainder' | 'remainderTarget'>): number {
  return dist.remainderTarget ? 0 : dist.remainder
}

// ---------- payroll ----------
export function phaseAt(phases: Phase[], ym: string): Phase | null {
  return phases.find((p) => p.from <= ym && (p.to === null || ym <= p.to)) ?? null
}

export interface AllocRow {
  key: string // target id
  name: string
  kind: AllocationKind
  amount: number
  detail: string
}

export interface Distribution {
  phase: Phase | null
  rows: AllocRow[]
  remainder: number // what the remainder target gets (negative = short)
  living: number
  subscriptions: number
  /** the remainder target, if the user defined one */
  remainderTarget: AllocationTarget | null
}

/**
 * The month's pay split over the user's targets, in their order:
 * living = sum of living costs, subscriptions = needed subscription transfer,
 * fixed = the phase's amount for that target, remainder = pay minus everything else.
 * Zero rows are hidden, except the remainder.
 */
export function distributionAt(
  ym: string,
  netPay: number,
  phases: Phase[],
  targets: AllocationTarget[],
  living: Living,
  subs: Subscription[],
  changes: PlanChange[],
  s: Settings,
): Distribution {
  const phase = phaseAt(phases, ym)
  const livingSum = living.food + living.transit + living.allowance
  const subsTransfer = transferAt(subs, changes, s, ym).transfer
  const amountOf = (t: AllocationTarget) =>
    t.kind === 'living' ? livingSum
    : t.kind === 'subscriptions' ? subsTransfer
    : t.kind === 'fixed' ? (phase?.amounts[t.id] ?? 0)
    : 0
  const remainderTarget = targets.find((t) => t.kind === 'remainder') ?? null
  const others = targets.filter((t) => t.kind !== 'remainder').reduce((sum, t) => sum + amountOf(t), 0)
  const remainder = netPay - others
  const rows: AllocRow[] = targets
    .map((t) => ({
      key: t.id,
      name: t.name,
      kind: t.kind,
      amount: t.kind === 'remainder' ? remainder : amountOf(t),
      detail: t.note || '', // the user's own note; the screens show how the amount is worked out when it is empty (src/lib/labels.ts)
    }))
    .filter((r) => r.amount !== 0 || r.kind === 'remainder')
  return {
    phase, rows, remainder, remainderTarget,
    living: targets.some((t) => t.kind === 'living') ? livingSum : 0,
    subscriptions: targets.some((t) => t.kind === 'subscriptions') ? subsTransfer : 0,
  }
}

/** The remainder split by ratio: every item but the last is rounded to 10,000; the last takes what is left. */
export function splitRemainder(remainder: number, split: RemainderSplit[]): (RemainderSplit & { amount: number })[] {
  const total = Math.max(remainder, 0)
  let left = total
  return split.map((x, i) => {
    const amount = i === split.length - 1 ? left : Math.round((total * x.ratio) / 10_000) * 10_000
    left -= amount
    return { ...x, amount }
  })
}

// ---------- format ----------
// Plain numbers only. Amounts with a unit (원, 만, ₩ …) are in src/lib/format.ts, which follows the screen language.
export const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
export const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}.${ym.slice(5, 7)}`
export const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
