import type { AllocationKind, AllocationTarget, Living, Phase, Plan, PlanChange, RemainderSplit, Settings, Subscription } from '../data/types'

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

const KIND_DETAIL: Record<AllocationKind, string> = {
  living: '생활비 항목 합계',
  subscriptions: '구독 필요 이체액을 올림 단위로 올림',
  fixed: '구간별 금액',
  remainder: '나머지 전부',
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
      detail: t.note || KIND_DETAIL[t.kind],
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
export const won = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원'
export const num = (n: number) => Math.round(n).toLocaleString('ko-KR')
export const man = (n: number) => {
  const v = n / 10_000
  return (Number.isInteger(v) ? v.toString() : v.toFixed(1)) + '만'
}
export const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}.${ym.slice(5, 7)}`
export const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
