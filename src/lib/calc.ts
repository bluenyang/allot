import type { AllocationKind, AllocationTarget, Currency, Cycle, DayShift, Living, PayBy, Phase, Plan, PlanChange, RemainderSplit, Settings, SpendHow, Spending, SpendingRound, SpendInterval, Subscription } from '../data/types'

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

/** 구독료 통장 계산기와 같은 식. `extra`: one-off spending paid from the subscription account that month (spec 011 S-5), added before the round-ups. */
export function transferAt(subs: Subscription[], changes: PlanChange[], s: Settings, ym: string, extra = 0): TransferCalc {
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
  const raw = monthlySum + yearlyMonthly + buffer + extra
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

interface Seg { start: number; end: number; cycle: Cycle; bill: number; active: boolean }
/** The schedule's frame: the billing day, the one cycle ahead of a future anchor that may still be charged, and the cycle segments between plan-change months. */
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

export function upcomingPayments(subs: Subscription[], changes: PlanChange[], s: Settings, from: Date, days: number): Payment[] {
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
export function paysAfter31(subs: Subscription[], changes: PlanChange[], s: Settings, from: Date, max = 3): LaterPayment[] {
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
 * (the app holds none). `off` holds the holidays for the day shift, as in `monthDates`.
 */
export function leftoverAfterTransfer(
  state: { subscriptions: Subscription[]; planChanges: PlanChange[]; settings: Settings },
  ym: string,
  off: ReadonlySet<string> = new Set(),
  spendings: Spending[] = [],
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
  // One-off rounds paid from the subscription account count as paid too (spec 011 S-5).
  const spent = liveRounds(spendings).filter((x) => x.spending.payBy === 'subs' && x.round.date >= from && x.round.date <= to)
  const paid = inWindow.reduce((a, p) => a + p.krw, 0) + spent.reduce((a, x) => a + x.round.amount, 0)
  const transfer = transferAt(subscriptions, planChanges, settings, ym, spendingIn(spendings, ym).subs).transfer
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
  spendRemainder = 0,
  spendSubs = 0,
): Distribution {
  const phase = phaseAt(phases, ym)
  const livingSum = living.food + living.transit + living.allowance
  const subsTransfer = transferAt(subs, changes, s, ym, spendSubs).transfer
  const amountOf = (t: AllocationTarget) =>
    t.kind === 'living' ? livingSum
    : t.kind === 'subscriptions' ? subsTransfer
    : t.kind === 'fixed' ? (phase?.amounts[t.id] ?? 0)
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
  return {
    phase, rows, remainder, remainderTarget,
    living: targets.some((t) => t.kind === 'living') ? livingSum : 0,
    subscriptions: targets.some((t) => t.kind === 'subscriptions') ? subsTransfer : 0,
  }
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
}

/** The KRW principal of a spending: USD = amount × rate × (1 + buffer%), rounded to the won (S-3). */
export function spendingKrw(amount: number, currency: Currency, s: Pick<Settings, 'fxRate' | 'fxBuffer'>): number {
  return currency === 'USD' ? Math.round(amount * s.fxRate * (1 + s.fxBuffer / 100)) : amount
}

/** Rounds of a spending (S-4): total = principal + fee, each ⌊total ÷ n ÷ 10⌋ × 10, the last takes the rest. */
export function planRounds(input: SpendInput, s: Settings, off: ReadonlySet<string>): SpendingRound[] {
  const { how, payBy } = input
  const n = how === 'lump' ? 1 : input.count
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new RangeError(`rounds must be 1..60, got ${n}`)
  const fee = how === 'installment' && payBy === 'card' ? (input.fee ?? 0) : 0
  const total = input.principal + fee
  const each = Math.floor(total / n / 10) * 10
  const amounts = Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * (n - 1) : each))
  let dates: string[]
  if (how === 'split') {
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
    const shift = s.dayShift ?? 'none'
    const from = addYm(input.bought.slice(0, 7), 1)
    dates = Array.from({ length: n }, (_, i) => monthDay(addYm(from, i), s.billingDay, shift, off).date)
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
function liveRounds(spendings: Spending[]): { spending: Spending; round: SpendingRound }[] {
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
export interface SpendingMonth {
  /** paid from the subscription account: added to the month's subscription transfer */
  subs: number
  /** salary and card: taken off the month's remainder */
  remainder: number
  /** of `remainder`, the lump-sum part and the installment/split part */
  general: number
  installment: number
  items: SpendingItem[]
}

/** What the spendings put on calendar month `ym` (S-5). */
export function spendingIn(spendings: Spending[], ym: string): SpendingMonth {
  const out: SpendingMonth = { subs: 0, remainder: 0, general: 0, installment: 0, items: [] }
  for (const { spending, round } of liveRounds(spendings)) {
    if (round.date.slice(0, 7) !== ym) continue
    out.items.push({ spending, round, amount: round.amount })
    if (spending.payBy === 'subs') out.subs += round.amount
    else {
      out.remainder += round.amount
      if (spending.how === 'lump') out.general += round.amount
      else out.installment += round.amount
    }
  }
  return out
}

/** What `monthMoney` reads. `spendings` may be missing (none). */
export interface MonthState {
  settings: Settings
  phases: Phase[]
  targets: AllocationTarget[]
  living: Living
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  spendings?: Spending[]
}

/**
 * The month's real money in one call (spec 011 S-5): the subscription transfer with the month's
 * subscription-account spendings, the distribution with the same and with the salary/card spendings
 * off the remainder, and the spendings themselves. Every screen and tool that shows the user's month
 * goes through here so no half is forgotten. `pay` and `phases` are for what-if screens; a what-if
 * passes the same spendings to both of its sides.
 */
export function monthMoney(state: MonthState, ym: string, opt: { pay?: number; phases?: Phase[] } = {}) {
  const spend = spendingIn(state.spendings ?? [], ym)
  const transfer = transferAt(state.subscriptions, state.planChanges, state.settings, ym, spend.subs)
  const dist = distributionAt(
    ym, opt.pay ?? state.settings.netPay, opt.phases ?? state.phases, state.targets, state.living,
    state.subscriptions, state.planChanges, state.settings, spend.remainder, spend.subs,
  )
  return { transfer, dist, spend }
}

export type SpendStateName = 'cancelled' | 'paid' | 'billing' | 'planned'

/** The state shown in the general tab (S-6). `today` is YYYY-MM-DD. */
export function spendState(sp: Spending, today: string, s: Settings, off: ReadonlySet<string>): SpendStateName {
  if (sp.cancelled) return 'cancelled'
  const live = sp.rounds.filter((r) => r.state !== 'merged')
  if (live.length && live.every((r) => r.state === 'paid')) return 'paid'
  if (sp.payBy === 'card') {
    const bill = live[0]?.date ?? monthDay(addYm(sp.bought.slice(0, 7), 1), s.billingDay, s.dayShift ?? 'none', off).date
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
