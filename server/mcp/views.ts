// What the MCP tools say about a user's data (spec 008 S-6, S-7): pure functions over the rows that
// readState() returns, computed with the same code the screens use (src/lib/calc.ts, holidays.ts),
// so the AI and the screen see the same numbers. No database here: the unit tests run without one.
// Output is plain JSON: enum values as stored, ISO dates, amounts in KRW as whole numbers.
import {
  addYm, changesIn, chargeKrw, distributionAt, monthDates, monthlyKrw, nextPayment, parseDate, planAt, splitRemainder,
  transferAt, upcomingPayments, ymd, ymOf, type MonthDate,
} from '../../src/lib/calc'
import { enabledSets, holidaysIn } from '../../src/lib/holidays'
import type {
  Account, AllocationTarget, CheckItem, Debt, HolidaySet, Living, Phase, PlanChange, PlanEvent, RemainderSplit, Settings, SubStatus, Subscription,
} from '../../src/data/types'

/** The part of GET /api/state the tools read. */
export interface Data {
  settings: Settings
  living: Living
  targets: AllocationTarget[]
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  phases: Phase[]
  events: PlanEvent[]
  checks: CheckItem[]
  accounts: Account[]
  debts: Debt[]
  remainderSplit: RemainderSplit[]
  holidaySets: HolidaySet[]
}

const krw = (n: number) => Math.round(n)
const lastDay = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
const firstOf = (ym: string) => `${ym}-01`

/** Holiday dates around a span of months: a monthly date moves up to 31 days, so two months before and after (as the dashboard does). */
function offDays(d: Data, firstYm: string, lastYm: string): Set<string> {
  return new Set(holidaysIn(enabledSets(d.holidaySets), firstOf(addYm(firstYm, -2)), firstOf(addYm(lastYm, 3))).map((h) => h.date))
}

const dateOf = (m: MonthDate) => ({ date: m.date, nominal: m.nominal, shifted: m.shifted, ...(m.unresolved ? { unresolved: true } : {}) })
function datesOf(d: Data, ym: string, off: ReadonlySet<string>) {
  const x = monthDates(ym, d.settings, off)
  return { pay: dateOf(x.pay), transfer: dateOf(x.transfer), billing: dateOf(x.billing) }
}

/** Charges falling in month `ym`. */
function paymentsIn(d: Data, ym: string) {
  const start = parseDate(firstOf(ym))
  return upcomingPayments(d.subscriptions, d.planChanges, d.settings, start, lastDay(ym) - 1)
    .filter((p) => ymOf(p.date) === ym)
    .map((p) => ({ date: ymd(p.date), subscriptionId: p.sub.id, name: p.sub.name, plan: p.sub.plan, amountKrw: krw(p.krw), cycle: p.sub.cycle }))
}

const changeView = (c: PlanChange, d: Data) => ({
  id: c.id,
  subscriptionId: c.subId,
  subscription: d.subscriptions.find((s) => s.id === c.subId)?.name ?? null,
  effective: c.effective,
  to: c.to,
  note: c.note,
})

/** How much the monthly subscription total moves in the month a change takes effect. */
function monthlyDelta(d: Data, c: PlanChange): number | null {
  if (!c.effective) return null
  const ym = c.effective.slice(0, 7)
  const sum = (changes: PlanChange[]) => {
    const t = transferAt(d.subscriptions, changes, d.settings, ym)
    return t.monthlySum + t.yearlyMonthly
  }
  return krw(sum(d.planChanges) - sum(d.planChanges.filter((x) => x.id !== c.id)))
}

export function overview(d: Data, ym: string) {
  const off = offDays(d, ym, ym)
  const dist = distributionAt(ym, d.settings.netPay, d.phases, d.targets, d.living, d.subscriptions, d.planChanges, d.settings)
  const xfer = transferAt(d.subscriptions, d.planChanges, d.settings, ym)
  const split = dist.remainderTarget ? splitRemainder(dist.remainder, d.remainderSplit) : []
  return {
    month: ym,
    settings: d.settings,
    dates: datesOf(d, ym, off),
    subscriptionTransfer: {
      monthlyKrw: krw(xfer.monthlySum),
      yearlyAsMonthlyKrw: krw(xfer.yearlyMonthly),
      usdAsMonthlyKrw: krw(xfer.usdMonthly),
      fxBufferKrw: krw(xfer.buffer),
      neededKrw: xfer.needed,
      transferKrw: xfer.transfer,
      items: xfer.items.map((i) => ({ subscriptionId: i.sub.id, name: i.sub.name, monthlyKrw: krw(i.monthly) })),
    },
    distribution: {
      phase: dist.phase ? { id: dist.phase.id, label: dist.phase.label, name: dist.phase.name, from: dist.phase.from, to: dist.phase.to } : null,
      rows: dist.rows.map((r) => ({ targetId: r.key, name: r.name, kind: r.kind, amountKrw: krw(r.amount) })),
      remainderKrw: krw(dist.remainder),
      livingKrw: dist.living,
      subscriptionsKrw: dist.subscriptions,
    },
    remainderSplit: split.map((s) => ({ id: s.id, name: s.name, code: s.code, ratio: s.ratio, amountKrw: s.amount })),
    payments: paymentsIn(d, ym),
    planChanges: changesIn(d.planChanges, ym).map((c) => changeView(c, d)),
  }
}

export function subscriptionList(d: Data, now: Date, status?: SubStatus) {
  const ym = ymOf(now)
  const rows = d.subscriptions.map((base) => {
    const p = planAt(base, d.planChanges, ym)
    const next = p.status === 'active' ? nextPayment(base, d.planChanges, now) : null
    return {
      id: base.id,
      name: base.name,
      category: base.category,
      plan: p.plan,
      amount: p.amount,
      currency: p.currency,
      vat: p.vat,
      cycle: p.cycle,
      status: p.status,
      chargeKrw: krw(chargeKrw(p, d.settings)),
      monthlyKrw: krw(monthlyKrw(p, d.settings)),
      nextPayment: next ? ymd(next) : null,
      payPath: base.path,
      receiptVerified: base.verified,
      ...(base.note ? { note: base.note } : {}),
    }
  })
  return { month: ym, subscriptions: status ? rows.filter((r) => r.status === status) : rows }
}

export function planChangeList(d: Data) {
  return {
    planChanges: [...d.planChanges]
      .sort((a, b) => (a.effective === b.effective ? 0 : a.effective === null ? 1 : b.effective === null ? -1 : a.effective < b.effective ? -1 : 1))
      .map((c) => ({ ...changeView(c, d), monthlyDeltaKrw: monthlyDelta(d, c) })),
  }
}

export function allocation(d: Data) {
  return {
    living: d.living,
    targets: d.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, ...(t.note ? { note: t.note } : {}) })),
    phases: d.phases.map((p) => ({
      id: p.id, label: p.label, name: p.name, from: p.from, to: p.to, ...(p.note ? { note: p.note } : {}),
      amounts: Object.entries(p.amounts).map(([targetId, amount]) => ({ targetId, amountKrw: krw(amount) })),
    })),
    remainderSplit: d.remainderSplit.map((s) => ({ id: s.id, name: s.name, code: s.code, ratio: s.ratio })),
    accounts: d.accounts.map((a) => ({ id: a.id, name: a.name, role: a.role, inflow: a.inflow, outflow: a.outflow })),
    debts: d.debts.map((x) => ({ id: x.id, name: x.name, principalKrw: krw(x.principal), rate: x.rate, method: x.method, plan: x.plan })),
  }
}

/** A plan event's `when` is YYYY-MM or YYYY-MM~MM (to a later month of the same year). */
const eventMonths = (when: string) => ({ from: when.slice(0, 7), to: when.length > 7 ? `${when.slice(0, 4)}-${when.slice(8, 10)}` : when.slice(0, 7) })

export function schedule(d: Data, from: string, months: number) {
  const list: string[] = Array.from({ length: months }, (_, i) => addYm(from, i))
  const last = list[list.length - 1]!
  const off = offDays(d, from, last)
  return {
    from,
    months: list.map((ym) => ({
      month: ym,
      dates: datesOf(d, ym, off),
      payments: paymentsIn(d, ym),
      planChanges: changesIn(d.planChanges, ym).map((c) => changeView(c, d)),
      planEvents: d.events
        .filter((e) => { const r = eventMonths(e.when); return r.from <= ym && ym <= r.to })
        .map((e) => ({ id: e.id, when: e.when, kind: e.kind, title: e.title, state: e.state })),
    })),
    checkItems: d.checks.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    holidays: holidaysIn(enabledSets(d.holidaySets), firstOf(from), `${last}-${String(lastDay(last)).padStart(2, '0')}`)
      .map((h) => ({ date: h.date, name: h.name, substitute: h.substitute })),
  }
}
