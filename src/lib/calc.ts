import type {
  Account, AllocationKind, AllocationTarget, Balance, BudgetGroup, Card, Currency, Cycle, DayShift, ForeignCurrency, IncomeExtra, IncomeItem, IncomeReceipt, Living, LivingItem, MonthAdjust, MonthBasis, MonthNaming, PayBy, Phase, Plan, PlanChange, Priced,
  RemainderSplit, Settings, SpendHow, Spending, SpendingRound, SpendInterval, SplitMode, Subscription,
} from '../data/types'

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
/** The default time zone of "today" (spec 013 S-22). */
export const DEFAULT_TIMEZONE = 'Asia/Seoul'
/**
 * The canonical spelling of an IANA time zone name this runtime knows ('asia/seoul' → 'Asia/Seoul'), or null for
 * anything else, a UTC offset like '+09:00' included (spec 013 S-26: an IANA name).
 */
export function timeZoneName(tz: string): string | null {
  if (typeof tz !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone
  } catch {
    return null
  }
}
/** Is `tz` an IANA time zone name this runtime knows (spec 013 S-26)? */
export const isTimeZone = (tz: string): boolean => timeZoneName(tz) !== null
/**
 * Today's date in the time zone `tz` (spec 013 S-22), as a local midnight Date like today(); `now` for tests.
 * An unknown or missing zone falls back to the default one.
 */
export function todayIn(tz: string | null | undefined, now: Date = new Date()): Date {
  const zone = tz && isTimeZone(tz) ? tz : DEFAULT_TIMEZONE
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return new Date(n('year'), n('month') - 1, n('day'))
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

/** The three monthly dates of the settings; each has its own weekend and holiday rule (spec 018 S-1). */
export type ShiftDate = 'pay' | 'transfer' | 'billing'
type Shifts = Pick<Settings, 'payShift' | 'transferShift' | 'billingShift'>

/** The rule of one of the three dates ('none' when it is not set). A card's own billing day uses the billing rule. */
export function shiftOf(s: Partial<Shifts>, which: ShiftDate): DayShift {
  return (which === 'pay' ? s.payShift : which === 'transfer' ? s.transferShift : s.billingShift) ?? 'none'
}

/**
 * Does any rule move a date off weekends and holidays — one of the three dates', or a schedule item's own? When none
 * does, no holiday list is needed: every caller that skips loading one asks this (spec 018 S-1).
 */
export function needsHolidays(s: Partial<Shifts>, schedules: readonly { shift?: DayShift }[] = []): boolean {
  return shiftOf(s, 'pay') !== 'none' || shiftOf(s, 'transfer') !== 'none' || shiftOf(s, 'billing') !== 'none'
    || schedules.some((x) => (x.shift ?? 'none') !== 'none')
}

/** Pay day, transfer day and card billing day of `ym`, each moved by its own rule (spec 007 S-10, spec 018 S-1). */
export function monthDates(ym: string, s: Settings, off: ReadonlySet<string>) {
  return {
    pay: monthDay(ym, s.payDay, shiftOf(s, 'pay'), off),
    transfer: monthDay(ym, s.transferDay, shiftOf(s, 'transfer'), off),
    billing: monthDay(ym, s.billingDay, shiftOf(s, 'billing'), off),
  }
}

// ---------- plan state at a month ----------
/**
 * 해당 월까지 발효된 변경을 순서대로 적용한 플랜. A change counts from the month its effective date lies in: the month of
 * the basis `ctx` (spec 018 S-3), the calendar month without one.
 */
export function planAt(sub: Subscription, changes: PlanChange[], ym: string, ctx: MonthCtx = CALENDAR): Subscription {
  return changes
    .filter((c) => c.subId === sub.id && c.effective && ymOfDate(c.effective, ctx) <= ym)
    .sort((a, b) => (a.effective! < b.effective! ? -1 : 1))
    .reduce<Subscription>((acc, c) => ({ ...acc, ...c.to }), { ...sub })
}

/** Settings and the foreign currencies together (spec 013 S-23): what the subscription sums take. */
export const priced = (s: Settings, currencies: ForeignCurrency[] = []): Priced => ({ ...s, currencies })

/**
 * KRW per unit and the transfer buffer % of a currency (spec 013 S-23): 1 and 0 for KRW, the settings' for USD, the
 * list's for any other code. A code that is not in the list (it cannot be saved, A-35) counts as rate 0.
 */
export function rateOf(code: Currency, s: Priced): { rate: number; buffer: number } {
  if (code === 'KRW') return { rate: 1, buffer: 0 }
  if (code === 'USD') return { rate: s.fxRate, buffer: s.fxBuffer }
  const c = s.currencies.find((x) => x.code === code)
  return c ? { rate: c.rate, buffer: c.buffer } : { rate: 0, buffer: 0 }
}

export function chargeKrw(p: Plan, s: Priced): number {
  if (p.currency === 'KRW') return p.amount
  return p.amount * (1 + (p.vat || 0) / 100) * rateOf(p.currency, s).rate
}
export function monthlyKrw(p: Plan, s: Priced): number {
  const k = chargeKrw(p, s)
  return p.cycle === 'yearly' ? k / 12 : k
}

export interface TransferCalc {
  monthlySum: number
  yearlyMonthly: number
  usdMonthly: number
  /** every foreign-currency item, USD included (spec 013 S-23) */
  foreignMonthly: number
  buffer: number
  needed: number // 1,000원 올림
  transfer: number // 구독 이체 올림 단위로 올린 금액
  items: { sub: Subscription; monthly: number }[]
}

/**
 * 구독료 통장 계산기와 같은 식. `extra`: one-off spending paid from the subscription account that month (spec 011 S-5), added
 * before the round-ups. `ctx`: the month basis the plan changes are placed by (`planAt`).
 */
export function transferAt(subs: Subscription[], changes: PlanChange[], s: Priced, ym: string, extra = 0, ctx: MonthCtx = CALENDAR): TransferCalc {
  let monthlySum = 0
  let yearlyMonthly = 0
  let usdMonthly = 0
  let foreignMonthly = 0
  // the monthly sum per foreign currency: each takes its own buffer % (USD: the settings' one, the same sum as before)
  const byCode = new Map<string, number>()
  const items: TransferCalc['items'] = []
  for (const base of subs) {
    const p = planAt(base, changes, ym, ctx)
    if (p.status !== 'active') continue
    const m = monthlyKrw(p, s)
    if (p.cycle === 'yearly') yearlyMonthly += m
    else monthlySum += m
    if (p.currency === 'USD') usdMonthly += m
    if (p.currency !== 'KRW') {
      foreignMonthly += m
      byCode.set(p.currency, (byCode.get(p.currency) ?? 0) + m)
    }
    items.push({ sub: p, monthly: m })
  }
  items.sort((a, b) => b.monthly - a.monthly)
  let buffer = 0
  for (const [code, sum] of byCode) buffer += (sum * rateOf(code, s).buffer) / 100
  const raw = monthlySum + yearlyMonthly + buffer + extra
  const needed = Math.ceil(raw / 1000) * 1000
  const transfer = Math.ceil(needed / s.subRound) * s.subRound
  return { monthlySum, yearlyMonthly, usdMonthly, foreignMonthly, buffer, needed, transfer, items }
}

/** 해당 월에 처음 발효되는 변경 목록: the changes whose effective date lies in month `ym` of the basis `ctx` (the calendar month without one). */
export function changesIn(changes: PlanChange[], ym: string, ctx: MonthCtx = CALENDAR): PlanChange[] {
  return changes.filter((c) => c.effective && ymOfDate(c.effective, ctx) === ym)
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

interface Seg { start: number; end: number; cycle: Cycle; bill: number; active: boolean }
/**
 * The schedule's frame: the billing day, the one cycle ahead of a future anchor that may still be charged, and the cycle segments between plan-change months.
 * The charges are dates: their schedule and the plan of each charge go by the calendar month of the charge, whatever the
 * month basis is (spec 018 S-7 puts them on the charge date itself; only the monthly sums follow the basis, S-3).
 */
function frame(base: Subscription, changes: PlanChange[]) {
  const anchor = parseDate(base.nextDate)
  const idx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1
  const ymAt = (i: number) => `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`
  const cuts = [...new Set(changes.filter((c) => c.subId === base.id && c.effective).map((c) => idx(c.effective!.slice(0, 7))))].sort((x, y) => x - y)
  const segs: Seg[] = []
  let bill = anchor.getMonth()
  for (let i = 0; i <= cuts.length; i++) {
    const start = i === 0 ? -Infinity : cuts[i - 1]!
    // the plan is the same in every month of a segment: it only changes in a change month
    const plan = i === 0 ? base : planAt(base, changes, ymAt(start))
    if (i > 0 && plan.cycle === 'yearly' && segs[i - 1]!.cycle === 'monthly') bill = start % 12
    segs.push({ start, end: i < cuts.length ? cuts[i]! : Infinity, cycle: plan.cycle, bill, active: plan.status === 'active' })
  }
  return { day: anchor.getDate(), segs, floor: addMonths(anchor, base.cycle === 'yearly' ? -12 : -1) }
}
const dateIn = (i: number, day: number) => {
  const y = Math.floor(i / 12)
  const m = i % 12
  return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()))
}
const monthIdx = (d: Date) => d.getFullYear() * 12 + d.getMonth()
const okDate = (base: Subscription) => /^\d{4}-\d{2}-\d{2}$/.test(base.nextDate)

/**
 * The dates `base` is charged on within [from, end]. The schedule is fixed by the billing anchor
 * (`nextDate`) and the scheduled plan changes alone, never by the window asked for: the billing day
 * is the anchor's day, or the month's last day when the month is shorter (Jan 31 → Feb 28 → Mar 31).
 * The plan's cycle is a series of segments between change months. A monthly segment charges every
 * month; a yearly one once a year, in the billing month — the anchor's month, or the month a change
 * from monthly to yearly came in (that month is charged too). Only the months of the window are
 * visited, so an old anchor or a far window costs the same. Nothing before one cycle ahead of the
 * anchor is charged (the date the user entered is the next one), and a cancelled plan is not charged.
 */
export function paymentDates(base: Subscription, changes: PlanChange[], from: Date, end: Date): Date[] {
  if (!okDate(base)) return []
  const { day, segs, floor } = frame(base, changes)
  const lo = new Date(Math.max(from.getTime(), floor.getTime()))
  const loI = monthIdx(lo)
  const hiI = monthIdx(end)
  const out: Date[] = []
  for (const g of segs) {
    if (!g.active) continue
    for (let i = Math.max(loI, g.start); i <= Math.min(hiI, g.end - 1); i++) {
      if (g.cycle === 'yearly' && i % 12 !== g.bill) continue
      const d = dateIn(i, day)
      if (d >= lo && d <= end) out.push(d)
    }
  }
  return out
}

/**
 * The next charge on or after `from`, by the same schedule as `paymentDates`, found segment by segment with
 * no horizon: a first charge any distance away is found. Null only when no segment charges again (a cancelled plan).
 */
export function nextPayment(base: Subscription, changes: PlanChange[], from: Date): Date | null {
  if (!okDate(base)) return null
  const { day, segs, floor } = frame(base, changes)
  const lo = new Date(Math.max(from.getTime(), floor.getTime()))
  const loI = monthIdx(lo)
  for (const g of segs) {
    if (!g.active) continue
    let i = Math.max(loI, g.start)
    if (g.cycle === 'yearly') i += (((g.bill - i) % 12) + 12) % 12
    if (dateIn(i, day) < lo) i += g.cycle === 'yearly' ? 12 : 1
    if (i <= g.end - 1) return dateIn(i, day)
  }
  return null
}

export function upcomingPayments(subs: Subscription[], changes: PlanChange[], s: Priced, from: Date, days: number): Payment[] {
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  const out: Payment[] = []
  for (const base of subs) {
    for (const d of paymentDates(base, changes, from, end)) {
      const p = planAt(base, changes, ymOf(d))
      out.push({ date: d, sub: p, krw: chargeKrw(p, s), dday: Math.round((d.getTime() - from.getTime()) / DAY) })
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** Where a payment sits on the 31-day strip, in percent of its width (kept 2..97 so a dot stays inside). */
export const dotPercent = (dday: number, days = 31) => Math.min(97, Math.max(2, (dday / days) * 100))

/**
 * The dots of the 31-day strip: payments (sorted by date) whose dots would sit closer than `dotPx` on a strip
 * `widthPx` wide share one dot. A cluster keeps all its members (indexes into `ddays`); its dot sits where its
 * first member does (spec 010 A-27).
 */
export function clusterDots(ddays: number[], widthPx: number, dotPx: number, days = 31): { pct: number; members: number[] }[] {
  const out: { pct: number; members: number[] }[] = []
  let anchor = -Infinity
  ddays.forEach((d, i) => {
    const pct = dotPercent(d, days)
    const x = (pct / 100) * widthPx
    const last = out[out.length - 1]
    if (last && x - anchor < dotPx) last.members.push(i)
    else { out.push({ pct, members: [i] }); anchor = x }
  })
  return out
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
export function paysAfter31(subs: Subscription[], changes: PlanChange[], s: Priced, from: Date, max = 3): LaterPayment[] {
  const start = dayPlus(from, 31)
  const end = dayPlus(from, 365)
  const out: LaterPayment[] = []
  for (const base of subs) {
    const now = planAt(base, changes, ymOf(from))
    for (const d of paymentDates(base, changes, start, end)) {
      if (d <= start) continue
      const p = planAt(base, changes, ymOf(d))
      const krw = chargeKrw(p, s)
      const yearly = p.cycle === 'yearly'
      const changed = p.plan !== now.plan || krw !== chargeKrw(now, s)
      if (yearly || changed) {
        out.push({ date: d, sub: p, krw, reason: yearly ? 'yearly' : 'plan' })
        break
      }
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
 * (the app holds none). `off` holds the holidays for the day shift, as in `monthDates`. With a month basis (the
 * state's settings and `cards`), the transfer day is the one inside the month's period.
 */
export function leftoverAfterTransfer(
  state: { subscriptions: Subscription[]; planChanges: PlanChange[]; settings: Settings; currencies?: ForeignCurrency[]; cards?: readonly Card[]; off?: ReadonlySet<string> },
  ym: string,
  off: ReadonlySet<string> = new Set(),
  spendings: Spending[] = [],
): Leftover {
  const { subscriptions, planChanges, settings } = state
  const s = priced(settings, state.currencies)
  // the month's transfer date and the next month's, each inside its own period (spec 018 S-3)
  const ctx = ctxOf(state, off)
  const from = dayIn(ym, settings.transferDay, 'transfer', ctx).date
  const nextStart = dayIn(addYm(ym, 1), settings.transferDay, 'transfer', ctx).date
  const startD = parseDate(from)
  const last = ymd(dayPlus(parseDate(nextStart), -1))
  const to = last < from ? from : last
  // Ask for a few days more than the window, then cut by date: no clock arithmetic decides the edge.
  const span = Math.round((parseDate(to).getTime() - startD.getTime()) / DAY) + 3
  const inWindow = upcomingPayments(subscriptions, planChanges, s, startD, span).filter((p) => ymd(p.date) >= from && ymd(p.date) <= to)
  // One-off rounds paid from the subscription account count as paid too (spec 011 S-5).
  const spent = liveRounds(spendings).filter((x) => x.spending.payBy === 'subs' && x.round.date >= from && x.round.date <= to)
  const paid = inWindow.reduce((a, p) => a + p.krw, 0) + spent.reduce((a, x) => a + x.round.amount, 0)
  const transfer = transferAt(subscriptions, planChanges, s, ym, spendingIn(spendings, ym, ctx).subs, ctx).transfer
  return { transfer, from, to, paid, count: inWindow.length + spent.length, left: transfer - paid }
}

/** What is left of the pay when no target takes the remainder: the pay minus every target (negative = short). 0 when a remainder target exists. */
export function unallocated(dist: Pick<Distribution, 'remainder' | 'remainderTarget'>): number {
  return dist.remainderTarget ? 0 : dist.remainder
}

// ---------- payroll ----------
export function phaseAt(phases: Phase[], ym: string): Phase | null {
  return phases.find((p) => p.from <= ym && (p.to === null || ym <= p.to)) ?? null
}

/**
 * The phase numbers shown on screen: 1, 2, 3 … in the order of the start months (the screen never
 * asks for a symbol). Phases that start in the same month keep their list order. Keyed by phase id.
 */
export function phaseNumbers(phases: Pick<Phase, 'id' | 'from'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  phases
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.from < b.p.from ? -1 : a.p.from > b.p.from ? 1 : a.i - b.i))
    .forEach((x, n) => { out[x.p.id] = n + 1 })
  return out
}

export interface AllocRow {
  key: string // target id
  name: string
  kind: AllocationKind
  amount: number
  detail: string
}

/**
 * What one account gets in a month for the bills paid from it (spec 018 S-6, the allocation table's paying-account
 * block), in parts: `subscriptions` = the subscription transfer, when the subscriptions target is linked to the account;
 * `card` = the month's rounds paid through its cards (the card bills the month counts, `roundYm`); `refill` = the
 * month's buffer refills through its cards; `total` = the three added up.
 */
export interface Payout { accountId: string; subscriptions: number; card: number; refill: number; total: number }

export interface Distribution {
  phase: Phase | null
  rows: AllocRow[]
  remainder: number // what the remainder target gets (negative = short)
  living: number
  subscriptions: number
  /** the remainder target, if the user defined one */
  remainderTarget: AllocationTarget | null
  /**
   * What goes to each paying account that month (spec 018 S-6): one entry per account that is a card's paying account
   * or the subscriptions target's account and gets something, in the order of the account list. The rows and the remainder do not change with it: `card`
   * and `refill` are the part of the month's spendings (already off the remainder) that goes through that account, and
   * `subscriptions` repeats the subscriptions row.
   */
  payouts: Payout[]
}

/**
 * The month's pay split over the user's targets, in their order:
 * living = sum of living costs, subscriptions = needed subscription transfer,
 * fixed = the phase's amount for that target, remainder = pay minus everything else.
 * Zero rows are hidden, except the remainder. `ym` is a month's name: the phases, the adjustments and the items' from
 * and stop months are compared as names (spec 018 S-4); `ctx` only places the plan changes of the subscription transfer.
 * `paid` is what the month's spendings send through each paying account (`spendingIn().byAccount`): with the
 * subscriptions target's account it makes `payouts`.
 */
export function distributionAt(
  ym: string,
  netPay: number,
  phases: Phase[],
  targets: AllocationTarget[],
  living: Living | LivingItem[],
  subs: Subscription[],
  changes: PlanChange[],
  s: Priced,
  spendRemainder = 0,
  spendSubs = 0,
  accounts: Account[] = [],
  adjusts: MonthAdjust[] = [],
  ctx: MonthCtx = CALENDAR,
  paid: readonly PaidThrough[] = [],
): Distribution {
  const phase = phaseAt(phases, ym)
  // one month's amount of a target, in place of its phase amount (spec 013 S-14)
  const adjustOf = (t: AllocationTarget) => adjusts.find((a) => a.ym === ym && a.targetId === t.id)
  const livingSum = Array.isArray(living) ? livingAt(living, phases, ym).sum : living.food + living.transit + living.allowance
  const subsTransfer = transferAt(subs, changes, s, ym, spendSubs, ctx).transfer
  const stopped = (t: AllocationTarget) => {
    const acc = t.accountId ? accounts.find((a) => a.id === t.accountId) : undefined
    return !!acc?.stopFrom && ym >= acc.stopFrom
  }
  const amountOf = (t: AllocationTarget) =>
    t.kind === 'living' ? livingSum
    : t.kind === 'subscriptions' ? subsTransfer
    : t.kind === 'fixed' ? (stopped(t) ? 0 : (adjustOf(t)?.amount ?? phase?.amounts[t.id] ?? 0))
    : t.kind === 'saving' || t.kind === 'invest' ? groupValue(groupAt(t.kind, accounts, phases, targets, s, ym, adjusts), adjustOf(t))
    : 0
  const remainderTarget = targets.find((t) => t.kind === 'remainder') ?? null
  const others = targets.filter((t) => t.kind !== 'remainder').reduce((sum, t) => sum + amountOf(t), 0)
  const remainder = netPay - others - spendRemainder
  const rows: AllocRow[] = targets
    .map((t) => ({
      key: t.id,
      name: t.name,
      kind: t.kind,
      amount: t.kind === 'remainder' ? remainder : amountOf(t),
      detail: t.note || '', // the user's own note; the screens show how the amount is worked out when it is empty (src/lib/labels.ts)
    }))
    .filter((r) => r.amount !== 0 || r.kind === 'remainder')
  // the paying accounts (spec 018 S-6), in the order of the account list so every month lists them alike (an account
  // that is not in the list comes after, in the order found: the subscriptions target's, then the cards')
  const payouts: Payout[] = []
  const payout = (accountId: string) => {
    let p = payouts.find((x) => x.accountId === accountId)
    if (!p) payouts.push(p = { accountId, subscriptions: 0, card: 0, refill: 0, total: 0 })
    return p
  }
  for (const t of targets) if (t.kind === 'subscriptions' && t.accountId) payout(t.accountId).subscriptions += subsTransfer
  for (const x of paid) {
    const p = payout(x.accountId)
    p.card += x.card
    p.refill += x.refill
  }
  for (const p of payouts) p.total = p.subscriptions + p.card + p.refill
  const place = (p: Payout) => { const i = accounts.findIndex((a) => a.id === p.accountId); return i < 0 ? accounts.length : i }
  payouts.sort((a, b) => place(a) - place(b))
  return {
    phase, rows, remainder, remainderTarget,
    living: targets.some((t) => t.kind === 'living') ? livingSum : 0,
    subscriptions: targets.some((t) => t.kind === 'subscriptions') ? subsTransfer : 0,
    payouts: payouts.filter((p) => p.total !== 0),
  }
}

// ---------- budget core (spec 013) ----------
/** An item's amount in `phase`: the phase's own amount when it has one, else the item's (S-4). */
const amountIn = (base: number, amounts: Record<string, number> | undefined, phase: Phase | null) =>
  phase && amounts && Object.hasOwn(amounts, phase.id) ? amounts[phase.id]! : base

/** Living items in month `ym` (S-2, S-4): an item counts from its `from` month on. */
export function livingAt(items: LivingItem[], phases: Phase[], ym: string) {
  const phase = phaseAt(phases, ym)
  const rows = items.map((item) => ({ item, amount: item.from && ym < item.from ? 0 : amountIn(item.amount, item.amounts, phase) }))
  return { rows, sum: rows.reduce((a, r) => a + r.amount, 0) }
}

/** Is a Savings / Investment account sending in month `ym` (from its `from` month, until `stopFrom`, S-3, S-7)? */
export const accountSends = (a: Account, ym: string) => (!a.from || ym >= a.from) && (!a.stopFrom || ym < a.stopFrom)

/**
 * What a Savings / Investment target gets in a month: its items added up, in both splits (`groupAt` spreads a month
 * adjustment over the items; S-14, review rc2-1 F-2). The one exception: an amount split whose items send nothing that
 * month has no item to carry an adjustment, so the target gets the adjustment itself.
 */
export const groupValue = (g: GroupMonth, adjust: MonthAdjust | undefined) => (adjust && g.mode === 'amount' ? adjust.amount : g.sum)

/**
 * `total` spread over `amounts` in proportion to them (review rc2-1 F-2): each gets ⌊amount × total ÷ sum⌋ and the last
 * non-zero one takes the rest, so the parts add up to `total`. With a sum of 0 nothing is spread (all stay 0).
 */
export function spreadOver(amounts: number[], total: number): number[] {
  const sum = amounts.reduce((a, x) => a + x, 0)
  if (sum <= 0) return [...amounts]
  const exact = Number.isInteger(sum) && Number.isInteger(total) && amounts.every(Number.isInteger)
  const share = (x: number) => (exact ? Number((BigInt(x) * BigInt(total)) / BigInt(sum)) : Math.floor((x * total) / sum))
  const last = amounts.reduce((at, x, i) => (x > 0 ? i : at), -1)
  const parts = amounts.map((x, i) => (i === last || x <= 0 ? 0 : share(x)))
  parts[last] = total - parts.reduce((a, x) => a + x, 0)
  return parts
}

/** The split of a menu (S-3): saving defaults to amount, invest to ratio. */
export const splitOf = (group: BudgetGroup, s: Pick<Settings, 'savingSplit' | 'investSplit'>): SplitMode =>
  (group === 'saving' ? s.savingSplit ?? 'amount' : s.investSplit ?? 'ratio')

export interface GroupMonth {
  group: BudgetGroup
  mode: SplitMode
  /** the menu's target (at most one per user), if there is one */
  target: AllocationTarget | null
  /** ratio split: the phase's total for the target; amount split: the sum of the items */
  total: number
  rows: { account: Account; amount: number }[]
  /** what the target gets: the items added up */
  sum: number
  /** ratio split: the ratios added up (1 = 100%) */
  ratioSum: number
}

/**
 * The Savings or Investment menu in month `ym` (S-3, S-4): amount split = each item's monthly amount (its
 * phase amount when it has one); ratio split = the phase's total for the target × the item's ratio,
 * rounded to the nearest 1,000. The target gets the items added up, so a ratio sum under 100% leaves
 * the rest in the remainder. An item counts from `from` until `stopFrom`.
 */
export function groupAt(group: BudgetGroup, accounts: Account[], phases: Phase[], targets: AllocationTarget[], s: Pick<Settings, 'savingSplit' | 'investSplit'>, ym: string, adjusts: MonthAdjust[] = []): GroupMonth {
  const phase = phaseAt(phases, ym)
  const mode = splitOf(group, s)
  const target = targets.find((t) => t.kind === group) ?? null
  const items = accounts.filter((a) => a.group === group)
  // a ratio split's month adjustment is that month's total (S-14); an amount split's is spread over the month's
  // items in proportion to their amounts, so every view of the items follows it (review rc2-1 F-2)
  const adjust = target ? adjusts.find((a) => a.ym === ym && a.targetId === target.id) : undefined
  const ratioTotal = adjust ? adjust.amount : target && phase ? (phase.amounts[target.id] ?? 0) : 0
  const amounts = items.map((account) =>
    !accountSends(account, ym) ? 0
    : mode === 'ratio' ? Math.round((ratioTotal * (account.ratio ?? 0)) / 1000) * 1000
    : amountIn(account.amount ?? 0, account.amounts, phase))
  const spread = adjust && mode === 'amount' ? spreadOver(amounts, adjust.amount) : amounts
  const rows = items.map((account, i) => ({ account, amount: spread[i]! }))
  const sum = rows.reduce((a, r) => a + r.amount, 0)
  const ratioSum = Math.round(items.reduce((a, x) => a + (x.ratio ?? 0), 0) * 10_000) / 10_000
  return { group, mode, target, total: mode === 'ratio' ? ratioTotal : sum, rows, sum, ratioSum }
}

/**
 * What a Savings / Investment item really gets in month `ym`: its item amount, but only while the menu has its
 * target — without one, the salary split sends nothing to the items (the remainder keeps it; review 1 F-4).
 */
export function itemSent(acc: Account, st: Pick<MonthState, 'phases' | 'targets' | 'settings' | 'monthAdjusts'> & { accounts?: Account[] }, ym: string): number {
  if (!acc.group) return 0
  const g = groupAt(acc.group, st.accounts ?? [acc], st.phases, st.targets, st.settings, ym, st.monthAdjusts ?? [])
  return g.target ? (g.rows.find((r) => r.account.id === acc.id)?.amount ?? 0) : 0
}

/** Does the remainder target send to this account? Its money is the remainder after the month's spendings (review 1 F-9). */
export const takesRemainder = (acc: Account, targets: AllocationTarget[]) => targets.some((t) => t.kind === 'remainder' && t.accountId === acc.id)

/** Targets whose money a linked account receives as a transfer: not the Savings / Investment totals, whose money goes to their items (review 1 F-9). */
export const sendsToLinked = (t: AllocationTarget) => t.kind !== 'saving' && t.kind !== 'invest'

/** What a bill date reads from a card: its billing day and the first day of its usage period (both may be empty). */
export type BillCard = { billingDay?: number | null; usageFrom?: number | null }

/** The billing day of a card spending: the card's own, else the settings' (S-13). */
export const billingDayOf = (card: Pick<BillCard, 'billingDay'> | null | undefined, s: Pick<Settings, 'billingDay'>) => card?.billingDay ?? s.billingDay

/** Day `day` of month `ym` as set, or the month's last day when it is shorter: before any weekend and holiday rule. */
const NO_DAYS: ReadonlySet<string> = new Set()
const nominalDay = (ym: string, day: number) => monthDay(ym, day, 'none', NO_DAYS).nominal

/**
 * The usage period of a card that holds `date` (spec 018 S-2), both ends included: from day `usageFrom` of a month to
 * the day before day `usageFrom` of the next month. A month shorter than `usageFrom` starts on its last day, as a
 * billing day does. Without a first day the period is the calendar month, which is also what a first day of 1 gives.
 */
export function usagePeriod(date: string, usageFrom: number | null | undefined): { start: string; end: string } {
  const from = usageFrom ?? 1
  const ym = date.slice(0, 7)
  const here = nominalDay(ym, from)
  const startYm = date >= here ? ym : addYm(ym, -1)
  const next = nominalDay(addYm(startYm, 1), from)
  return { start: date >= here ? here : nominalDay(startYm, from), end: ymd(dayPlus(parseDate(next), -1)) }
}

/**
 * The month whose billing date pays for something bought on `bought` (spec 018 S-2): the first billing date after the
 * usage period that holds the purchase has ended. The month is found by the billing day as set (not moved for weekends
 * and holidays). A card without a usage period, or no card: the month after the purchase (spec 011 S-4).
 */
export function cardBillYm(bought: string, card: BillCard | null | undefined, s: Pick<Settings, 'billingDay'>): string {
  if (card?.usageFrom == null) return addYm(bought.slice(0, 7), 1)
  const end = usagePeriod(bought, card.usageFrom).end
  const ym = end.slice(0, 7)
  return nominalDay(ym, billingDayOf(card, s)) > end ? ym : addYm(ym, 1)
}

/**
 * The date a card bill for something bought on `bought` is paid (spec 011 S-4, S-13; spec 018 S-2): the billing day
 * (the card's own, else the settings') of `cardBillYm`, moved by the billing rule.
 */
export function cardBillDate(bought: string, card: BillCard | null | undefined, s: Settings, off: ReadonlySet<string>): string {
  return monthDay(cardBillYm(bought, card, s), billingDayOf(card, s), shiftOf(s, 'billing'), off).date
}

/**
 * The first pay day on or after `date` (the default refill start of a buffer use, S-8). The pay dates themselves are
 * the same on every month basis (one in each calendar month), so this looks through calendar months.
 */
export function payDayFrom(date: string, s: Settings, off: ReadonlySet<string>): string {
  const ym = date.slice(0, 7)
  const here = monthDay(ym, s.payDay, shiftOf(s, 'pay'), off).date
  return here >= date ? here : monthDay(addYm(ym, 1), s.payDay, shiftOf(s, 'pay'), off).date
}

// ---------- what a month is (spec 018 S-3) ----------
/**
 * The basis of a month, worked out once from the settings (`monthCtx`) and handed to `periodOf`, `ymOfDate` and `dayIn`.
 * `basis` is the one in use: 'calendar' also for a card basis whose card is gone or has no first day.
 */
export interface MonthCtx {
  basis: MonthBasis
  /** 'start': a month is named after the calendar month its period starts in; 'end': after the next one, where it ends. */
  naming: Exclude<MonthNaming, 'auto'>
  /** The period's first day as set: 1 (calendar), the card's `usageFrom`, or the pay day. */
  day: number
  settings: Pick<Settings, 'payDay'> & Partial<Shifts>
  off: ReadonlySet<string>
  /** First days already worked out, by month name: a pay basis asks the same months many times. Only a memo. */
  firsts: Map<string, string>
  /** The month a card bill counts in, by the bill's date (`roundYm`): the same dates are asked for every month. Only a memo. */
  bills: Map<string, string>
}

type MonthSettings = Pick<Settings, 'payDay' | 'monthBasis' | 'monthBasisCardId' | 'monthNaming'> & Partial<Shifts>

/**
 * The month basis of the settings (spec 018 S-3). A card basis needs its card and that card's first day of the usage
 * period: without either it is the calendar month. The naming 'auto' is 'start' when the period's first day as set (the
 * pay day, or the card's first day) is the 15th or earlier, 'end' from the 16th. `off` holds the holidays (a pay basis
 * starts on the actual pay date); the calendar and card bases do not read it.
 */
export function monthCtx(s: MonthSettings, cards: readonly Pick<Card, 'id' | 'usageFrom'>[], off: ReadonlySet<string>): MonthCtx {
  const settings = { payDay: s.payDay, payShift: s.payShift, transferShift: s.transferShift, billingShift: s.billingShift }
  const calendar: MonthCtx = { basis: 'calendar', naming: 'start', day: 1, settings, off, firsts: new Map(), bills: new Map() }
  const basis = s.monthBasis ?? 'calendar'
  const usageFrom = basis === 'card' ? cards.find((c) => c.id === s.monthBasisCardId)?.usageFrom ?? null : null
  if (basis === 'calendar' || (basis === 'card' && usageFrom === null)) return calendar
  const day = basis === 'pay' ? s.payDay : usageFrom!
  const picked = s.monthNaming ?? 'auto'
  return { ...calendar, basis, naming: picked === 'auto' ? (day <= 15 ? 'start' : 'end') : picked, day }
}

/**
 * The calendar month: what a call that names no basis counts by. It has no holidays and its pay day is the 1st, never
 * moved, so one value serves every call: a card bill (`roundYm`) counts in the calendar month of its date, one dated on
 * the 1st in the month before. Every sum of the app passes the user's own basis, which carries their pay day.
 */
const CALENDAR: MonthCtx = { basis: 'calendar', naming: 'start', day: 1, settings: { payDay: 1 }, off: NO_DAYS, firsts: new Map(), bills: new Map() }

/**
 * The month basis of a state (spec 018 S-3): its settings, its cards (a card basis reads its card's usage period) and
 * its holiday dates (a pay basis starts on the actual pay date). The holidays are the state's own (`off`: the screens'
 * store holds one list for every question, so a month has the same dates on every screen), else the ones the caller
 * passes. A state without cards and holidays, with settings that name no basis, counts by the calendar month.
 */
export function ctxOf(st: { settings: MonthSettings; cards?: readonly Pick<Card, 'id' | 'usageFrom'>[]; off?: ReadonlySet<string> }, off?: ReadonlySet<string>): MonthCtx {
  return monthCtx(st.settings, st.cards ?? [], st.off ?? off ?? NO_DAYS)
}

/** The calendar month the period of month `ym` starts in: `ym` itself, or the month before when months are named by their end. */
const baseYm = (ym: string, ctx: MonthCtx) => (ctx.naming === 'start' ? ym : addYm(ym, -1))

/**
 * The first day of the month named `ym`. Calendar: the 1st. Card: the card's first day in the base month, as set (the
 * last day in a shorter month, never moved). Pay: the actual pay date of the base month, moved by the pay rule.
 */
function monthStart(ym: string, ctx: MonthCtx): string {
  if (ctx.basis === 'calendar') return ym + '-01'
  const known = ctx.firsts.get(ym)
  if (known) return known
  const m0 = baseYm(ym, ctx)
  const first = ctx.basis === 'pay' ? monthDay(m0, ctx.day, shiftOf(ctx.settings, 'pay'), ctx.off).date : nominalDay(m0, ctx.day)
  ctx.firsts.set(ym, first)
  return first
}

/** The dates of month `ym`, both included (spec 018 S-3): from its first day to the day before the next month's. */
export function periodOf(ym: string, ctx: MonthCtx): { ym: string; start: string; end: string } {
  return { ym, start: monthStart(ym, ctx), end: ymd(dayPlus(parseDate(monthStart(addYm(ym, 1), ctx)), -1)) }
}

/** The name of the month whose period holds `date` (spec 018 S-3). Calendar: the date's own month. */
export function ymOfDate(date: string, ctx: MonthCtx): string {
  const own = date.slice(0, 7)
  if (ctx.basis === 'calendar') return own
  // the month whose period starts in the date's calendar month, then a step either way: the date may come before that
  // first day, and a pay date moved off a weekend may lie in the calendar month before or after its own. A first day
  // moves SHIFT_LIMIT days at most, so two steps reach any date; the count only keeps a malformed date from looping.
  let ym = ctx.naming === 'start' ? own : addYm(own, 1)
  for (let i = 0; i < 3 && date < monthStart(ym, ctx); i++) ym = addYm(ym, -1)
  for (let i = 0; i < 3 && date >= monthStart(addYm(ym, 1), ctx); i++) ym = addYm(ym, 1)
  return ym
}

/**
 * Day `day` of month `ym` (spec 018 S-3): the occurrence of that day inside the month's period, moved by the rule of
 * `which` date. Calendar: `monthDay(ym, …)` as it is. Otherwise the period touches two calendar months: a day on or
 * after the period's first day (by number) is taken in the first, an earlier one in the second; then it is moved. So
 * with a pay basis the pay day is the period's first day. When the second month is too short for the day to come before
 * the next period (first day 31, day 29, February), it is the last day of the period as set.
 * A date moved off a weekend or holiday may leave the period by a day or two (spec 018, concern 4): it is not pulled back.
 */
export function dayIn(ym: string, day: number, which: ShiftDate, ctx: MonthCtx): MonthDate {
  return dayOn(ym, day, shiftOf(ctx.settings, which), ctx)
}

/**
 * `dayIn` for a day that is not one of the three dates: the occurrence of day `day` inside the period of month `ym`,
 * moved by the rule `shift` (a user's own monthly date has its own; an income's day has none).
 */
export function dayOn(ym: string, day: number, shift: DayShift, ctx: MonthCtx): MonthDate {
  if (ctx.basis === 'calendar') return monthDay(ym, day, shift, ctx.off)
  const m0 = baseYm(ym, ctx)
  if (day >= ctx.day) return monthDay(m0, day, shift, ctx.off)
  const m1 = addYm(m0, 1)
  const next = nominalDay(m1, ctx.day)
  return monthDay(m1, nominalDay(m1, day) < next ? day : Number(next.slice(8)) - 1, shift, ctx.off)
}

/**
 * Pay day, transfer day and card billing day of the month named `ym`, each the one inside the month's period and moved
 * by its own rule (spec 018 S-3). The calendar basis gives `monthDates`.
 */
export function monthDatesIn(ym: string, s: Pick<Settings, 'payDay' | 'transferDay' | 'billingDay'>, ctx: MonthCtx) {
  return { pay: dayIn(ym, s.payDay, 'pay', ctx), transfer: dayIn(ym, s.transferDay, 'transfer', ctx), billing: dayIn(ym, s.billingDay, 'billing', ctx) }
}

/** What `projectAccount` and the goal and limit checks read. */
export interface AccountState extends MonthState {
  accounts: Account[]
  balances: Balance[]
  cards: Card[]
}

/** One dated movement of an account (S-6). */
interface Move { date: string; amount: number }

/**
 * The movements of account `acc` in month `ym`: transfers in on the transfer day, refills in, card bills out (S-6, S-8, S-13).
 * The month is the one of the basis `ctx` (spec 018 S-3): its transfers are dated on the transfer day inside its period,
 * and the dated movements (bills, rounds) are the ones whose date its period holds.
 */
function movesIn(acc: Account, st: AccountState, ym: string, off: ReadonlySet<string>, ctx: MonthCtx): Move[] {
  const s = st.settings
  const moves: Move[] = []
  const transfer = dayIn(ym, s.transferDay, 'transfer', ctx).date
  const here = (date: string) => ymOfDate(date, ctx) === ym
  if (acc.group) {
    const sent = itemSent(acc, st, ym)
    if (sent) moves.push({ date: transfer, amount: sent })
  } else {
    const dist = monthMoney(st, ym, { ctx }).dist
    for (const r of dist.rows) {
      const t = st.targets.find((x) => x.id === r.key)
      if (t?.accountId === acc.id && sendsToLinked(t) && r.amount > 0) moves.push({ date: transfer, amount: r.amount })
    }
  }
  // An account that takes the remainder gets it after the month's spendings: its ordinary card bills are taken off it
  // already. A buffer use is not: its bill leaves the buffer and its refills come back (review 2 F-2).
  const remainder = takesRemainder(acc, st.targets)
  const cards = new Set(st.cards.filter((c) => c.accountId === acc.id).map((c) => c.id))
  for (const sp of st.spendings ?? []) {
    if (!sp.cardId || !cards.has(sp.cardId)) continue
    const card = st.cards.find((c) => c.id === sp.cardId)
    const live = sp.rounds.filter((r) => r.state !== 'merged' && !(sp.cancelled && r.state === 'left'))
    if (sp.how === 'buffer') {
      // the bill leaves the account's buffer on the billing date; the refills come back on their dates
      const bill = cardBillDate(sp.bought, card, s, off)
      if (here(bill)) moves.push({ date: bill, amount: -live.reduce((a, r) => a + r.amount, 0) })
      for (const r of live) if (here(r.date)) moves.push({ date: r.date, amount: r.amount })
    } else if (!remainder) {
      for (const r of live) if (here(r.date)) moves.push({ date: r.date, amount: -r.amount })
    }
  }
  return moves
}

/** The last balance record of an account (latest date; on the same date, the later one). */
export function lastBalance(balances: Balance[], accountId: string): Balance | null {
  let last: Balance | null = null
  for (const b of balances) if (b.accountId === accountId && (!last || b.date >= last.date)) last = b
  return last
}

export interface ProjectedMonth { ym: string; inflow: number; outflow: number; end: number }

/**
 * The balance of an account month by month (S-6), no interest: from its last record, every movement dated
 * after the record. Months `from` .. `from` + `months` − 1 are returned; null without a record.
 * The months are the ones of the state's basis (spec 018 S-3: its settings and cards, with the holidays `off`); the
 * record belongs to the month whose period holds its date.
 */
export function projectAccount(acc: Account, st: AccountState, off: ReadonlySet<string>, from: string, months = 12): ProjectedMonth[] | null {
  const rec = lastBalance(st.balances, acc.id)
  if (!rec) return null
  const ctx = ctxOf(st, off)
  const recYm = ymOfDate(rec.date, ctx)
  let bal = rec.amount
  const out: ProjectedMonth[] = []
  const start = recYm < from ? recYm : from
  const last = addYm(from, months - 1)
  for (let ym = start; ym <= last; ym = addYm(ym, 1)) {
    let inflow = 0
    let outflow = 0
    if (ym >= recYm) {
      for (const mv of movesIn(acc, st, ym, off, ctx)) {
        if (mv.date <= rec.date) continue
        if (mv.amount >= 0) inflow += mv.amount
        else outflow -= mv.amount
      }
    }
    bal += inflow - outflow
    if (ym >= from) out.push({ ym, inflow, outflow, end: bal })
  }
  return out
}

/** The first month the projected balance reaches the goal (S-7): the record's month if it already does; null if not within 50 years or without a goal or a record. */
export function goalMonth(acc: Account, st: AccountState, off: ReadonlySet<string>): string | null {
  const rec = lastBalance(st.balances, acc.id)
  if (acc.goal === null || acc.goal === undefined || !rec) return null
  const recYm = ymOfDate(rec.date, ctxOf(st, off))
  if (rec.amount >= acc.goal) return recYm
  const rows = projectAccount(acc, st, off, recYm, 600) ?? []
  return rows.find((r) => r.end >= acc.goal!)?.ym ?? null
}

/**
 * What goes into an account in calendar year `year` (S-7): the planned transfers and refills of that year, plus the
 * money put in at once that the balance records of that year name (`deposit`; review 1 F-12, user: "잔액 기록에 '넣은 돈'
 * 표시" — a balance alone is not counted as paid in).
 * The year stays the calendar year on every month basis (spec 018 S-3: the tax year is the calendar year). With the
 * calendar basis that is the twelve months named in the year, as before. With a card or pay basis a month's name and
 * its dates differ, so the movements are taken by their date: the twelve months and one on either side are looked
 * through, and what is dated in the year counts.
 */
export function yearContribution(acc: Account, st: AccountState, off: ReadonlySet<string>, year: number): number {
  let total = 0
  const ctx = ctxOf(st, off)
  if (ctx.basis === 'calendar') {
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`
      for (const mv of movesIn(acc, st, ym, off, ctx)) if (mv.amount > 0) total += mv.amount
    }
  } else {
    for (let ym = `${year - 1}-12`; ym <= `${year + 1}-01`; ym = addYm(ym, 1)) {
      for (const mv of movesIn(acc, st, ym, off, ctx)) if (mv.amount > 0 && mv.date.slice(0, 4) === String(year)) total += mv.amount
    }
  }
  for (const r of st.balances) if (r.accountId === acc.id && r.date.slice(0, 4) === String(year)) total += r.deposit ?? 0
  return total
}

export interface BufferGauge {
  buffer: number
  /** buffer-use principal not refilled yet (refills dated after `today`) */
  used: number
  left: number
}
/** The buffer of an account on `today` (S-8): its buffer, minus what buffer uses through its cards took and have not refilled yet. */
export function bufferGauge(acc: Account, st: Pick<AccountState, 'cards' | 'spendings'>, today: string, exceptId?: string): BufferGauge {
  const cards = new Set(st.cards.filter((c) => c.accountId === acc.id).map((c) => c.id))
  let used = 0
  for (const sp of st.spendings ?? []) {
    if (sp.how !== 'buffer' || sp.cancelled || !sp.cardId || !cards.has(sp.cardId) || sp.id === exceptId) continue
    for (const r of sp.rounds) if (r.state !== 'merged' && r.date > today) used += r.amount
  }
  const buffer = acc.buffer ?? 0
  return { buffer, used, left: buffer - used }
}

/**
 * The month a stop starts: this month when its transfer day is still to come, else the next one (S-7). "This month" is
 * the month of the basis that holds `today` (spec 018 S-3; `cards` for a card basis), and the transfer day the one
 * inside that month's period.
 */
export function nextTransferYm(today: string, s: Settings, off: ReadonlySet<string>, cards: readonly Pick<Card, 'id' | 'usageFrom'>[] = []): string {
  const ctx = monthCtx(s, cards, off)
  const transfer = (ym: string) => dayIn(ym, s.transferDay, 'transfer', ctx).date
  const ym = ymOfDate(today, ctx)
  if (transfer(ym) > today) return ym
  const next = addYm(ym, 1)
  // with a card or pay basis a transfer date moved off a weekend can come before its own period (spec 018, concern 4):
  // when the next month's has passed too, it is the month after
  return ctx.basis !== 'calendar' && transfer(next) <= today ? addYm(next, 1) : next
}

export interface GoalAlert { account: Account; month: string; stopFrom: string }
/**
 * The goal cards of 대기 중인 변경 (S-7): an account with a goal whose projected balance has reached it by this
 * month, still sending (no stop), and whose goal the user has not chosen to keep sending past.
 */
export function goalAlerts(st: AccountState, today: string, off: ReadonlySet<string>): GoalAlert[] {
  const now = ymOfDate(today, ctxOf(st, off))
  const out: GoalAlert[] = []
  for (const a of st.accounts) {
    if (a.goal === null || a.goal === undefined || a.stopFrom || a.goalAck === a.goal) continue
    const month = goalMonthBy(a, st, off, now)
    // the next transfer month reads the same holidays as this month does (the state's own, else the caller's)
    if (month) out.push({ account: a, month, stopFrom: nextTransferYm(today, st.settings, st.off ?? off, st.cards) })
  }
  return out
}

/** The goal month if it is `until` or earlier: projects only up to `until`, so the badge does not work out decades (review 1 F-15). */
function goalMonthBy(acc: Account, st: AccountState, off: ReadonlySet<string>, until: string): string | null {
  const rec = lastBalance(st.balances, acc.id)
  if (acc.goal === null || acc.goal === undefined || !rec) return null
  const from = ymOfDate(rec.date, ctxOf(st, off))
  if (rec.amount >= acc.goal) return from <= until ? from : null
  if (from > until) return null
  let n = 1
  for (let ym = from; ym < until; ym = addYm(ym, 1)) n++
  return (projectAccount(acc, st, off, from, n) ?? []).find((r) => r.end >= acc.goal!)?.ym ?? null
}

// ---------- one-off spending (spec 011 S-3..S-6) ----------
export interface SpendInput {
  bought: string // YYYY-MM-DD
  how: SpendHow
  payBy: PayBy
  count: number // 1..60
  /** the KRW principal (spendingKrw) */
  principal: number
  /** total fee in KRW; only a card installment carries one */
  fee?: number
  interval?: SpendInterval | null
  /** split: the first date (default `bought`) */
  first?: string
  /** split with interval 'custom': one date per round */
  dates?: string[]
  /** card: the card's billing day (S-13); default the settings' one */
  billingDay?: number | null
  /** card: the first day of the card's usage period (spec 018 S-2); empty = billed the month after the purchase */
  usageFrom?: number | null
  /** buffer use: the first refill date (S-8); the next ones are the pay days after it */
  refillFrom?: string
}

/** The KRW principal of a spending: USD = amount × rate × (1 + buffer%), rounded to the won (S-3). */
export function spendingKrw(amount: number, currency: Currency, s: Pick<Settings, 'fxRate' | 'fxBuffer'>): number {
  return currency !== 'KRW' ? Math.round(amount * s.fxRate * (1 + s.fxBuffer / 100)) : amount
}

/**
 * Rounds of a spending (S-4): total = principal + fee, each ⌊total ÷ n ÷ 10⌋ × 10, the last takes the rest.
 * A buffer use (spec 013 S-8) has no fee; its rounds are the refills: the first on `refillFrom`, then the pay day of each month after.
 * A card's rounds are its billing dates: the first is the bill of the purchase (`cardBillYm`, spec 018 S-2).
 */
export function planRounds(input: SpendInput, s: Settings, off: ReadonlySet<string>): SpendingRound[] {
  const { how, payBy } = input
  const n = how === 'lump' ? 1 : input.count
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new RangeError(`rounds must be 1..60, got ${n}`)
  const fee = how === 'installment' && payBy === 'card' ? (input.fee ?? 0) : 0
  const total = input.principal + fee
  const each = Math.floor(total / n / 10) * 10
  const amounts = Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * (n - 1) : each))
  let dates: string[]
  if (how === 'buffer') {
    const first = input.refillFrom ?? payDayFrom(input.bought, s, off)
    // the refills are pay days: the pay day's rule. Like the billing dates below they are a run of dates, one in each
    // calendar month, the same on every month basis (spec 018 S-3): which month a round counts in is decided when it is summed
    dates = Array.from({ length: n }, (_, i) => (i === 0 ? first : monthDay(addYm(first.slice(0, 7), i), s.payDay, shiftOf(s, 'pay'), off).date))
  } else if (how === 'split') {
    const first = input.first ?? input.bought
    if (input.interval === 'custom') {
      if (!input.dates || input.dates.length !== n) throw new RangeError(`custom dates must have ${n} entries`)
      dates = [...input.dates]
    } else if (input.interval === 'biweekly') {
      dates = Array.from({ length: n }, (_, i) => ymd(dayPlus(parseDate(first), 14 * i)))
    } else {
      dates = Array.from({ length: n }, (_, i) => ymd(addMonths(parseDate(first), i)))
    }
  } else if (payBy === 'card') {
    // the first round is the bill that follows the purchase's usage period (spec 018 S-2), then one billing date a month
    const from = cardBillYm(input.bought, input, s)
    const day = billingDayOf(input, s)
    // card rounds are billing dates: the billing rule, also for a card's own billing day
    dates = Array.from({ length: n }, (_, i) => monthDay(addYm(from, i), day, shiftOf(s, 'billing'), off).date)
  } else {
    dates = Array.from({ length: n }, () => input.bought)
  }
  return amounts.map((amount, i) => ({ no: i + 1, date: dates[i]!, amount, state: 'left' as const, edited: false }))
}

/** Early payoff (S-6): every left round is merged into one new left round on `date` (the sum, or `amount`). Paid rounds stay. */
export function payOffEarly(rounds: SpendingRound[], date: string, amount?: number): SpendingRound[] {
  const left = rounds.filter((r) => r.state === 'left')
  if (!left.length) return rounds.map((r) => ({ ...r }))
  // The rounds still to count add up to at most ROUND_MAX (server rule), so the sum fits one round; an `amount` the user types is checked by the server.
  const sum = left.reduce((a, r) => a + r.amount, 0)
  const no = Math.max(...rounds.map((r) => r.no)) + 1
  return [
    ...rounds.map((r) => (r.state === 'left' ? { ...r, state: 'merged' as const } : { ...r })),
    { no, date, amount: amount ?? sum, state: 'left' as const, edited: false },
  ]
}

/** Rounds that count in the month sums: not merged; a cancelled spending keeps only its paid rounds (S-5). */
function liveRounds(spendings: readonly Spending[]): { spending: Spending; round: SpendingRound }[] {
  const out: { spending: Spending; round: SpendingRound }[] = []
  for (const spending of spendings)
    for (const round of spending.rounds) {
      if (round.state === 'merged') continue
      if (spending.cancelled && round.state === 'left') continue
      out.push({ spending, round })
    }
  return out
}

export interface SpendingItem {
  spending: Spending
  round: SpendingRound
  amount: number
}

// ---------- the month's outgoing rounds (spec 018 S-5, S-6) ----------
/**
 * The last actual pay date — the pay day of a calendar month, moved by the pay rule — strictly before `date`. A date
 * that is itself a pay date gets the pay date before it.
 */
function payDateBefore(date: string, ctx: MonthCtx): string {
  const pay = (ym: string) => monthDay(ym, ctx.settings.payDay, shiftOf(ctx.settings, 'pay'), ctx.off).date
  // a pay date moved off a weekend may lie in the calendar month before or after its own: from the month after the
  // date's, back until one comes before the date. The count only keeps a malformed date from looping.
  let ym = addYm(date.slice(0, 7), 1)
  let p = pay(ym)
  for (let i = 0; i < 4 && !(p < date); i++) {
    ym = addYm(ym, -1)
    p = pay(ym)
  }
  return p
}

/** A card bill: a round of a lump sum or an installment paid by card. A buffer use's rounds are refills, a split's the dates the user pays on. */
const isCardBill = (sp: Pick<Spending, 'how' | 'payBy'>) => sp.payBy === 'card' && (sp.how === 'lump' || sp.how === 'installment')

/**
 * The month a round counts in (spec 018 S-5). A card bill is paid with the pay that came in last before it: it counts
 * in the month that holds the last actual pay date strictly before the bill's date (a bill dated on a pay date: the pay
 * date before). Pay day 25, calendar months: a bill of 12-14 or 12-25 counts in November, one of 12-26 in December.
 * Every other round — a buffer refill, a split, a round paid from the salary or the subscription account — counts in
 * the month whose period holds its date.
 */
export function roundYm(spending: Pick<Spending, 'how' | 'payBy'>, round: Pick<SpendingRound, 'date'>, ctx: MonthCtx): string {
  if (!isCardBill(spending)) return ymOfDate(round.date, ctx)
  const known = ctx.bills.get(round.date)
  if (known) return known
  const ym = ymOfDate(payDateBefore(round.date, ctx), ctx)
  ctx.bills.set(round.date, ym)
  return ym
}

/** One outgoing round of a month: what `monthOutgo` lists, and what the left over, the allocation table and the balance projection all read (spec 018 S-6). */
export interface Outgo extends SpendingItem {
  /** the month it counts in (`roundYm`) */
  ym: string
  /** 'remainder': taken off the month's left over; 'subs': added to the month's subscription transfer */
  from: 'remainder' | 'subs'
  /** 'card': paid through a card (a bill, or a split paid by card); 'refill': a buffer use's refill; 'direct': paid from the salary or the subscription account */
  kind: 'card' | 'refill' | 'direct'
  /**
   * The account the money goes through, when there is one: the paying account of the spending's card (a card round,
   * a refill), or the account linked to the subscriptions target (a round paid from the subscription account).
   */
  accountId: string | null
}

/** What `monthOutgo` reads of a state: the spendings, the cards (their paying accounts) and the targets (the subscriptions target's account). */
export interface OutgoState {
  spendings?: readonly Spending[]
  cards?: readonly Pick<Card, 'id' | 'accountId'>[]
  targets?: readonly Pick<AllocationTarget, 'kind' | 'accountId'>[]
}

/** Every round that counts (`liveRounds`: not merged, and of a cancelled spending only the paid ones) with the month it counts in and how it is paid. */
export function outgoOf(state: OutgoState, ctx: MonthCtx): Outgo[] {
  const cards = state.cards ?? []
  const subsAccount = (state.targets ?? []).find((t) => t.kind === 'subscriptions' && t.accountId)?.accountId ?? null
  return liveRounds(state.spendings ?? []).map(({ spending, round }) => {
    const byCard = spending.payBy === 'card'
    return {
      spending, round, amount: round.amount, ym: roundYm(spending, round, ctx),
      from: spending.payBy === 'subs' ? 'subs' as const : 'remainder' as const,
      kind: spending.how === 'buffer' ? 'refill' as const : byCard ? 'card' as const : 'direct' as const,
      accountId: byCard ? (spending.cardId ? cards.find((c) => c.id === spending.cardId)?.accountId ?? null : null) : spending.payBy === 'subs' ? subsAccount : null,
    }
  })
}

/**
 * The outgoing rounds of month `ym` (spec 018 S-6): every round that counts in it (`roundYm`), each with where it is
 * taken from, its kind and the account it goes through. The one list behind the month's left over (`spendingIn`), the
 * allocation table's paying-account block (`Distribution.payouts`) and the balance projection (`movesIn`).
 */
export function monthOutgo(state: OutgoState, ym: string, ctx: MonthCtx): Outgo[] {
  return outgoOf(state, ctx).filter((o) => o.ym === ym)
}

/** What an account gets in a month for the rounds paid through its cards: the card rounds and the buffer refills. */
export interface PaidThrough { accountId: string; card: number; refill: number }

export interface SpendingMonth {
  /** paid from the subscription account: added to the month's subscription transfer */
  subs: number
  /** salary and card: taken off the month's remainder */
  remainder: number
  /** of `remainder`, the lump-sum part and the installment/split part */
  general: number
  installment: number
  items: Outgo[]
  /** of `remainder`, what goes through each paying account: its cards' rounds and its buffer refills (spec 018 S-6). Accounts with nothing are left out. */
  byAccount: PaidThrough[]
}

/**
 * What the spendings put on month `ym` (S-5): the sum of the month's outgoing rounds (`monthOutgo`, spec 018 S-6) —
 * the rounds that count in it by the basis `ctx` (`roundYm`: a card bill by the pay date before it, the others by
 * their date). `links` are the state's cards and targets, for the account each round goes through (`byAccount`).
 */
export function spendingIn(spendings: readonly Spending[], ym: string, ctx: MonthCtx = CALENDAR, links: Pick<OutgoState, 'cards' | 'targets'> = {}): SpendingMonth {
  const out: SpendingMonth = { subs: 0, remainder: 0, general: 0, installment: 0, items: [], byAccount: [] }
  for (const o of monthOutgo({ spendings, cards: links.cards, targets: links.targets }, ym, ctx)) {
    out.items.push(o)
    if (o.from === 'subs') { out.subs += o.amount; continue }
    out.remainder += o.amount
    if (o.spending.how === 'lump') out.general += o.amount
    else out.installment += o.amount
    if (!o.accountId) continue
    let a = out.byAccount.find((x) => x.accountId === o.accountId)
    if (!a) out.byAccount.push(a = { accountId: o.accountId, card: 0, refill: 0 })
    if (o.kind === 'refill') a.refill += o.amount
    else a.card += o.amount
  }
  return out
}

export interface Replan {
  /** the new rounds with the states that carry over */
  rounds: SpendingRound[]
  /** old paid rounds whose paid mark stays on the round with the same number */
  keptPaid: number
  /** old paid rounds that have no round with their number any more, or whose mark a lump sum does not keep */
  droppedPaid: number
  /** edited rounds (not merged): their date and amount go back to the calculated ones */
  droppedEdited: number
  /** rounds an early payoff merged: they are gone */
  droppedMerged: number
  /** a lump sum made of these rounds: paid only if every round that still counted was paid (spec 011 A-22, A-38, A-39) */
  lumpDefault: 'left' | 'paid'
}
/**
 * What happens to a spending's stored rounds when its rounds are worked out again (`next`, from planRounds): the one rule the editor
 * shows in its warning and saves, so the two cannot differ.
 * - a new round is paid when the old round with the same number was paid (a merged round is not);
 * - an old paid round whose number is gone, a payoff round above the new count included, is dropped;
 * - every edited and every merged round is dropped (the new rounds are the calculated ones);
 * - a lump sum is one round: `lump` says its state (paid, or left / cancelled = left, A-38); without it, `lumpDefault`.
 *   A lump sum worked out again as a lump sum (one old round) keeps whatever `lump` says and counts nothing as dropped.
 */
export function replan(old: SpendingRound[], next: SpendingRound[], toHow: SpendHow, lump?: 'left' | 'paid' | 'cancelled'): Replan {
  const counted = old.filter((r) => r.state !== 'merged')
  const lumpDefault = counted.length > 0 && counted.every((r) => r.state === 'paid') ? 'paid' : 'left'
  const oldPaid = old.filter((r) => r.state === 'paid')
  const droppedEdited = old.filter((r) => r.edited && r.state !== 'merged').length
  const droppedMerged = old.length - counted.length
  if (toHow === 'lump') {
    const state = (lump ?? lumpDefault) === 'paid' ? 'paid' : 'left'
    const again = old.length === 1 // a lump sum that is a lump sum again: the user's state is a choice, not a loss
    return {
      rounds: next.map((r) => ({ ...r, state, edited: false })),
      keptPaid: again || state !== 'paid' ? 0 : oldPaid.length,
      droppedPaid: again || state === 'paid' ? 0 : oldPaid.length,
      droppedEdited, droppedMerged, lumpDefault,
    }
  }
  const keep = new Set(oldPaid.map((r) => r.no))
  const rounds = next.map((r) => ({ ...r, state: keep.has(r.no) ? ('paid' as const) : ('left' as const), edited: false }))
  const keptPaid = rounds.filter((r) => r.state === 'paid').length
  return { rounds, keptPaid, droppedPaid: oldPaid.length - keptPaid, droppedEdited, droppedMerged, lumpDefault }
}

export interface SpendDue {
  date: Date
  spending: Spending
  round: SpendingRound
  krw: number
  dday: number
}
/**
 * The rounds still to pay (left, not cancelled) from `from` through `from` + `days` (both inclusive, local dates), by date (spec 011 S-8):
 * what the home's upcoming payments and the schedule calendar show next to the subscription charges.
 */
export function upcomingSpendRounds(spendings: Spending[], from: Date, days: number): SpendDue[] {
  const lo = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  const out: SpendDue[] = []
  for (const { spending, round } of liveRounds(spendings)) {
    if (round.state !== 'left' || !/^\d{4}-\d{2}-\d{2}$/.test(round.date)) continue
    const d = parseDate(round.date)
    if (d >= lo && d <= end) out.push({ date: d, spending, round, krw: round.amount, dday: Math.round((d.getTime() - lo.getTime()) / DAY) })
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.spending.name.localeCompare(b.spending.name) || a.round.no - b.round.no)
}

/**
 * What `monthMoney` reads. `spendings` may be missing (none). With `livingItems` the living sum is theirs
 * (spec 013 S-2), else the old `living` row's; `accounts` are the Savings / Investment items and the
 * accounts whose stop ends a fixed target (S-3, S-7).
 */
export interface MonthState {
  settings: Settings
  phases: Phase[]
  targets: AllocationTarget[]
  living: Living
  livingItems?: LivingItem[]
  accounts?: Account[]
  /** one month's amounts of targets (spec 013 S-14) */
  monthAdjusts?: MonthAdjust[]
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  spendings?: Spending[]
  /** foreign currencies other than USD (spec 013 S-23); none = USD and KRW only */
  currencies?: ForeignCurrency[]
  /** regular incomes, money received for them, money that came in once (spec 014 S-2–S-4) */
  incomes?: IncomeItem[]
  incomeReceipts?: IncomeReceipt[]
  incomeExtras?: IncomeExtra[]
  /**
   * What a month is read from, next to the settings (spec 018 S-3, `ctxOf`): the cards (a card basis is its card's usage
   * period) and the holiday dates (a pay basis starts on the actual pay date). Missing = no cards; no holidays but the
   * ones a function is handed (`off`).
   */
  cards?: Card[]
  off?: ReadonlySet<string>
}

/** One income line of a month (spec 014 S-5): `received` is the sum of its receipts, null when none; `used` is what counts. */
export interface IncomeLine {
  key: string // 'salary' or the income's id
  name: string | null // null = the salary (the screens name it)
  day: number
  expected: number
  received: number | null
  used: number
  diff: number // used − expected (0 until something is received)
}

/** A yearly income of another month, with the month it comes next (after the month asked for). */
export interface IncomeLater { id: string; name: string; amount: number; ym: string }

/**
 * What comes in in month `ym` (spec 014 S-5): the salary (settings.netPay on payDay) and every regular income of that
 * month (monthly ones always, yearly ones in their month), each with what was received for it that month or else its
 * expected amount, plus the money that came in once in that month. With no incomes, receipts or extras, `total` is
 * netPay: the month is what it was before 0.1.8.
 * `ym` is the month's name (spec 018 S-4): the salary line, the receipts (their saved month) and a yearly income (its
 * month number) go by the name; only money that came in once has a date, and counts in the month whose period holds it.
 */
export function incomeAt(state: Pick<MonthState, 'settings' | 'incomes' | 'incomeReceipts' | 'incomeExtras' | 'cards' | 'off'>, ym: string, ctx: MonthCtx = ctxOf(state)) {
  const receipts = (state.incomeReceipts ?? []).filter((r) => r.ym === ym)
  const got = (itemId: string | null) => {
    const mine = receipts.filter((r) => r.itemId === itemId)
    return mine.length ? mine.reduce((a, r) => a + r.amount, 0) : null
  }
  const line = (key: string, itemId: string | null, name: string | null, day: number, expected: number): IncomeLine => {
    const received = got(itemId)
    const used = received ?? expected
    return { key, name, day, expected, received, used, diff: used - expected }
  }
  const month = Number(ym.slice(5, 7))
  const items = state.incomes ?? []
  const rows: IncomeLine[] = [
    line('salary', null, null, state.settings.payDay, state.settings.netPay),
    // an income of another month (yearly) shows only when something was written down for it in this month: it counts
    // with nothing expected, so a receipt is never dropped (an early bonus is this month's, and its own month still expects it)
    ...items.filter((i) => i.cycle === 'monthly' || i.month === month || got(i.id) !== null)
      .map((i) => line(i.id, i.id, i.name, i.day, i.cycle === 'monthly' || i.month === month ? i.amount : 0)),
  ]
  const extras = (state.incomeExtras ?? []).filter((x) => ymOfDate(x.date, ctx) === ym)
  const extraSum = extras.reduce((a, x) => a + x.amount, 0)
  const expected = rows.reduce((a, r) => a + r.expected, 0)
  const total = rows.reduce((a, r) => a + r.used, 0) + extraSum
  // the yearly incomes of other months, each with the next month it comes in (after ym)
  const later: IncomeLater[] = items.filter((i) => i.cycle === 'yearly' && i.month && i.month !== month).map((i) => {
    const y = Number(ym.slice(0, 4)) + ((i.month as number) < month ? 1 : 0)
    return { id: i.id, name: i.name, amount: i.amount, ym: `${y}-${String(i.month).padStart(2, '0')}` }
  }).sort((a, b) => a.ym.localeCompare(b.ym))
  return { rows, extras, extraSum, expected, total, diff: total - expected, allReceived: rows.every((r) => r.received !== null), later }
}

/**
 * The month's real money in one call (spec 011 S-5): the subscription transfer with the month's
 * subscription-account spendings, the distribution with the same and with the salary/card spendings
 * off the remainder, and the spendings themselves. Every screen and tool that shows the user's month
 * goes through here so no half is forgotten. `pay` and `phases` are for what-if screens; a what-if
 * passes the same spendings to both of its sides.
 * `ym` is the name of a month of the state's basis (spec 018 S-3, `ctxOf`: its settings, cards and holidays): what has
 * a date counts in the month whose period holds it, what is saved by month name stays with that name (S-4). `ctx` is
 * for a caller that has worked the basis out already.
 */
export function monthMoney(state: MonthState, ym: string, opt: { pay?: number; phases?: Phase[]; ctx?: MonthCtx } = {}) {
  const ctx = opt.ctx ?? ctxOf(state)
  const spend = spendingIn(state.spendings ?? [], ym, ctx, state)
  const s = priced(state.settings, state.currencies)
  const transfer = transferAt(state.subscriptions, state.planChanges, s, ym, spend.subs, ctx)
  const income = incomeAt(state, ym, ctx)
  const dist = distributionAt(
    ym, opt.pay ?? income.total, opt.phases ?? state.phases, state.targets, state.livingItems ?? state.living,
    state.subscriptions, state.planChanges, s, spend.remainder, spend.subs, state.accounts ?? [], state.monthAdjusts ?? [], ctx, spend.byAccount,
  )
  return { transfer, dist, spend, income }
}

export type SpendStateName = 'cancelled' | 'paid' | 'billing' | 'planned'

/** The state shown in the general tab (S-6). `today` is YYYY-MM-DD; `card` is the spending's card, for one that has no round. */
export function spendState(sp: Spending, today: string, s: Settings, off: ReadonlySet<string>, card?: BillCard | null): SpendStateName {
  if (sp.cancelled) return 'cancelled'
  const live = sp.rounds.filter((r) => r.state !== 'merged')
  if (live.length && live.every((r) => r.state === 'paid')) return 'paid'
  if (sp.payBy === 'card') {
    const bill = live[0]?.date ?? cardBillDate(sp.bought, card, s, off)
    if (today >= sp.bought && today < bill) return 'billing'
  }
  return 'planned'
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

// ---------- maturity (spec 013 S-15, rc.2) ----------
/** How many months from `from` to `to` (YYYY-MM each; negative when `to` is earlier). */
export const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))

export interface Maturity {
  /** the maturity month */
  ym: string
  /** the months paid in before it: `from` up to the month before `ym` */
  months: number
}
// "N개월" / "N months" and "YYYY-MM까지" / "until YYYY-MM" (the Hangul as escapes: the screen-code check reads this file)
const TERM_MONTHS = /^(\d{1,4})\s*(?:\uAC1C\uC6D4|months?)$/i
const TERM_UNTIL = /^(\d{4})-(0[1-9]|1[0-2])\s*\uAE4C\uC9C0$/
const TERM_UNTIL_EN = /^until\s+(\d{4})-(0[1-9]|1[0-2])$/i

/**
 * The maturity of a Savings item (S-15): its free-text `term` read as "N개월" (N months after `from`) or
 * "YYYY-MM까지" (that month), and only with a `from` month. Anything else is not read (null): the term stays
 * free text, nothing is refused.
 */
export function maturityOf(a: Pick<Account, 'term' | 'from'>): Maturity | null {
  const term = (a.term ?? '').trim()
  if (!a.from || !term) return null
  const n = TERM_MONTHS.exec(term)
  if (n) {
    const months = Number(n[1])
    return months > 0 ? { ym: addYm(a.from, months), months } : null
  }
  const u = TERM_UNTIL.exec(term) ?? TERM_UNTIL_EN.exec(term)
  if (!u) return null
  const ym = `${u[1]}-${u[2]}`
  const months = monthsBetween(a.from, ym)
  return months >= 0 ? { ym, months } : null
}

export interface MaturityAmount {
  amount: number
  /** true = the projected balance from the last balance record; false = what the plan sends from `from` on */
  projected: boolean
}
/**
 * What a Savings item holds at maturity, before tax and without interest (S-15): with a balance record, the projected
 * balance after the last transfer before the maturity month (`projectAccount`); without one, what the pay split sends
 * it from `from` up to that month (its monthly amount × the months, with its phase amounts, stop month and adjustments).
 */
export function maturityAmount(acc: Account, st: AccountState, off: ReadonlySet<string>, m: Maturity): MaturityAmount {
  const last = addYm(m.ym, -1)
  if (lastBalance(st.balances, acc.id)) return { amount: projectAccount(acc, st, off, last, 1)?.[0]?.end ?? 0, projected: true }
  let amount = 0
  // the whole account list: an amount-split month adjustment is spread over all of the month's items (review rc2-2 F-1)
  const all = st.accounts.some((a) => a.id === acc.id) ? st : { ...st, accounts: [...st.accounts, acc] }
  for (let ym = acc.from ?? m.ym; ym < m.ym; ym = addYm(ym, 1)) amount += itemSent(acc, all, ym)
  return { amount, projected: false }
}

/**
 * The maturity cards of 대기 중인 변경 (S-15, the goal card's shape): a Savings item whose maturity month is this month
 * or past and which still sends (no stop month), unless `handled` says the user chose to keep sending for that maturity.
 * 멈추기 writes `stopFrom` = the next transfer month, as a goal card does.
 */
export function maturityAlerts(st: AccountState, today: string, off: ReadonlySet<string>, handled: (accountId: string, ym: string) => boolean = () => false): GoalAlert[] {
  // this month by the basis; the maturity month is a name (the item's start month + its term) and is compared as one
  const now = ymOfDate(today, ctxOf(st, off))
  const out: GoalAlert[] = []
  for (const a of st.accounts) {
    if (a.group !== 'saving' || a.stopFrom) continue
    const m = maturityOf(a)
    if (!m || m.ym > now || handled(a.id, m.ym)) continue
    out.push({ account: a, month: m.ym, stopFrom: nextTransferYm(today, st.settings, st.off ?? off, st.cards) })
  }
  return out
}
