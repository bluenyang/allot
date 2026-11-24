// What the MCP tools say about a user's data (spec 008 S-6, S-7): pure functions over the rows that
// readState() returns, computed with the same code the screens use (src/lib/calc.ts, holidays.ts),
// so the AI and the screen see the same numbers. No database here: the unit tests run without one.
// Output is plain JSON: enum values as stored, ISO dates, amounts in KRW as whole numbers.
import {
  addYm, billingDayOf, bufferGauge, changesIn, chargeKrw, goalAlerts, goalMonth, groupAt, groupValue, lastBalance, livingAt, monthDates, monthlyKrw, monthMoney, nextPayment, parseDate,
  phaseAt, planAt, priced, projectAccount, spendingIn, spendingKrw, spendState, splitRemainder, transferAt, unallocated, upcomingPayments, yearContribution, ymd, ymOf,
  type AccountState, type MonthDate,
  maturityAlerts, maturityAmount,
} from '../../src/lib/calc'
import { enabledSets, holidaysIn } from '../../src/lib/holidays'
import { buildNotices, type Notice } from '../../src/lib/notices'
import { search, type SearchKind } from '../../src/lib/search'
import type {
  Account, AllocationTarget, Balance, BudgetGroup, Card, CheckItem, Debt, ForeignCurrency, HolidaySet, IncomeExtra, IncomeItem, IncomeReceipt, Living, LivingItem, MonthAdjust, Phase, PlanChange, PlanEvent, RemainderSplit, ScheduleItem, Settings, Spending,
  SubStatus, Subscription,
} from '../../src/data/types'
import { maturityOf } from './maturity'
import { whenSpan } from '../../src/lib/event-when'
import { scheduleItemsIn } from '../../src/lib/schedule-items'

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
  /** one-off spendings with their rounds (spec 011); absent = none */
  spendings?: Spending[]
  /** living items (spec 013 S-2); when present they make the living total, else the old `living` row does */
  livingItems?: LivingItem[]
  /** balance records (spec 013 S-6); absent = none */
  balances?: Balance[]
  /** cards (spec 013 S-13); absent = none */
  cards?: Card[]
  /** one month's amounts of targets (spec 013 S-14); absent = none */
  monthAdjusts?: MonthAdjust[]
  /** foreign currencies other than USD (spec 013 S-23); absent = none */
  currencies?: ForeignCurrency[]
  /** the user's own monthly dates (spec 013 S-22); absent = none */
  schedules?: ScheduleItem[]
  /** the display settings: their time zone is the user's "today" (spec 013 S-22) */
  preferences?: { timezone?: string }
  /** regular incomes, the money received for them and money that came in once (spec 014 S-2–S-4); absent = none */
  incomes?: IncomeItem[]
  incomeReceipts?: IncomeReceipt[]
  incomeExtras?: IncomeExtra[]
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
  return upcomingPayments(d.subscriptions, d.planChanges, priced(d.settings, d.currencies), start, lastDay(ym) - 1)
    .filter((p) => ymOf(p.date) === ym)
    .map((p) => ({ date: ymd(p.date), subscriptionId: p.sub.id, name: p.sub.name, plan: p.sub.plan, amountKrw: krw(p.krw), cycle: p.sub.cycle }))
}

/**
 * One-off spending rounds of a month (spec 011 S-8), as items of their own kind and never part of the subscription charges:
 * the rounds the month's transfer and remainder take (paid ones too, cancelled and merged ones not). `of` is the round count
 * of the plan; a round after it (an early payoff's) has `payoff: true`.
 */
function spendRoundsIn(d: Data, ym: string) {
  return spendingIn(d.spendings ?? [], ym).items
    .sort((a, b) => (a.round.date < b.round.date ? -1 : a.round.date > b.round.date ? 1 : a.spending.name.localeCompare(b.spending.name) || a.round.no - b.round.no))
    .map(({ spending: sp, round }) => ({
      date: round.date, spendingId: sp.id, name: sp.name, how: sp.how, payBy: sp.payBy,
      round: round.no, of: sp.count, ...(round.no > sp.count ? { payoff: true } : {}), amountKrw: krw(round.amount), state: round.state,
    }))
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
    const t = transferAt(d.subscriptions, changes, priced(d.settings, d.currencies), ym)
    return t.monthlySum + t.yearlyMonthly
  }
  return krw(sum(d.planChanges) - sum(d.planChanges.filter((x) => x.id !== c.id)))
}

/**
 * The month adjustments of month `ym` (spec 013 S-14), each with the amount it replaces: a fixed target's phase amount, or a
 * Savings / Investment target's split (amount split: the items added up, which the adjustment is spread over in proportion;
 * ratio split: the phase amount the items share, which the adjustment replaces as that month's total).
 */
function adjustsIn(d: Data, ym: string) {
  const phase = phaseAt(d.phases, ym)
  return (d.monthAdjusts ?? []).filter((a) => a.ym === ym).map((a) => {
    const t = d.targets.find((x) => x.id === a.targetId)
    const group = t?.kind === 'saving' || t?.kind === 'invest' ? t.kind : null
    const g = group ? groupAt(group, d.accounts, d.phases, d.targets, d.settings, ym) : null
    const planned = g ? (g.mode === 'amount' ? g.sum : g.total) : (phase?.amounts[a.targetId] ?? 0)
    return {
      id: a.id, month: a.ym, targetId: a.targetId, target: t?.name ?? null, kind: t?.kind ?? null,
      amountKrw: krw(a.amount), plannedKrw: krw(planned), ...(a.reason ? { reason: a.reason } : {}),
    }
  })
}

/**
 * The foreign currencies (spec 013 S-23, A-39): USD from the settings, then the currency list; each with its rate (KRW per
 * unit), buffer %, whether the server refreshes it daily, and that refresh's last time and failure.
 */
export function currencyList(d: Data) {
  const s = d.settings
  return [
    { code: 'USD', rate: s.fxRate, buffer: s.fxBuffer, auto: !!s.fxAuto, autoAt: s.fxAutoAt ?? null, autoError: s.fxAutoError ?? null },
    ...(d.currencies ?? []).map((c) => ({ id: c.id, code: c.code, rate: c.rate, buffer: c.buffer, auto: c.auto, autoAt: c.autoAt ?? null, autoError: c.autoError ?? null })),
  ]
}

export function overview(d: Data, ym: string) {
  const off = offDays(d, ym, ym)
  // One-off spendings are in the month's transfer and remainder (spec 011 S-5).
  const { dist, transfer: xfer, spend, income } = monthMoney(d, ym)
  const split = dist.remainderTarget ? splitRemainder(dist.remainder, d.remainderSplit) : []
  return {
    month: ym,
    settings: d.settings,
    /** KRW is the base; these are the foreign currencies with their rates (spec 013 S-23) */
    currencies: currencyList(d),
    dates: datesOf(d, ym, off),
    subscriptionTransfer: {
      monthlyKrw: krw(xfer.monthlySum),
      yearlyAsMonthlyKrw: krw(xfer.yearlyMonthly),
      usdAsMonthlyKrw: krw(xfer.usdMonthly),
      /** every foreign-currency item, USD included (spec 013 S-23) */
      foreignAsMonthlyKrw: krw(xfer.foreignMonthly),
      fxBufferKrw: krw(xfer.buffer),
      neededKrw: xfer.needed,
      transferKrw: xfer.transfer,
      /** one-off spendings paid from the subscription account that month, included in neededKrw */
      spendingKrw: krw(spend.subs),
      items: xfer.items.map((i) => ({ subscriptionId: i.sub.id, name: i.sub.name, monthlyKrw: krw(i.monthly) })),
    },
    distribution: {
      phase: dist.phase ? { id: dist.phase.id, label: dist.phase.label, name: dist.phase.name, from: dist.phase.from, to: dist.phase.to } : null,
      rows: dist.rows.map((r) => ({ targetId: r.key, name: r.name, kind: r.kind, amountKrw: krw(r.amount) })),
      remainderKrw: krw(dist.remainder),
      /** one-off spendings (salary, card) taken off the remainder that month, included in remainderKrw */
      spendingKrw: krw(spend.remainder),
      /** What stays in the pay account when no target takes the remainder (0 when one does); negative = short. */
      unallocatedKrw: krw(unallocated(dist)),
      livingKrw: dist.living,
      subscriptionsKrw: dist.subscriptions,
    },
    /** what comes in that month (spec 014 S-10): expected, what counts (received, else expected; plus money that came in once) and the difference; get_income has the lines */
    income: { expectedKrw: krw(income.expected), totalKrw: krw(income.total), diffKrw: krw(income.diff) },
    /** the month's left over (여유): what is left after the distribution, the same as distribution.remainderKrw; negative = short */
    leftOverKrw: krw(dist.remainder),
    remainderSplit: split.map((s) => ({ id: s.id, name: s.name, code: s.code, ratio: s.ratio, amountKrw: s.amount })),
    /** the month's adjustments (spec 013 S-14): they replace the target's phase amount that month (already in distribution) */
    monthAdjusts: adjustsIn(d, ym),
    payments: paymentsIn(d, ym),
    spendingRounds: spendRoundsIn(d, ym),
    planChanges: changesIn(d.planChanges, ym).map((c) => changeView(c, d)),
  }
}

/**
 * get_income (spec 014 S-10): what comes in in month `ym`, as incomeAt() works it out — the salary (settings.netPay on
 * payDay; it has no income row, so its id is null and it is named "salary") and every regular income of the month, each
 * with what is expected, what was received (the receipts of that month added up; null = nothing written down yet), what
 * counts (received, else expected) and the difference; the money that came in once; the totals; the month's left over
 * (monthMoney().dist.remainder, the remainder the screens call 여유); and the yearly incomes of other months with the
 * month each comes next.
 */
export function incomeView(d: Data, ym: string) {
  const { income, dist } = monthMoney(d, ym)
  const items = d.incomes ?? []
  const receipts = (d.incomeReceipts ?? []).filter((r) => r.ym === ym)
  return {
    month: ym,
    incomes: income.rows.map((r) => {
      const item = r.key === 'salary' ? null : items.find((i) => i.id === r.key) ?? null
      const itemId = item ? item.id : null
      return {
        incomeId: itemId,
        name: item ? item.name : 'salary',
        salary: !item,
        cycle: item ? item.cycle : 'monthly' as const,
        ...(item?.cycle === 'yearly' ? { yearlyMonth: item.month ?? null } : {}),
        day: r.day,
        accountId: item ? item.accountId ?? null : null,
        expectedKrw: krw(r.expected),
        /** null = nothing received is written down for it this month */
        receivedKrw: r.received === null ? null : krw(r.received),
        /** what the month counts: received, else expected */
        countedKrw: krw(r.used),
        diffKrw: krw(r.diff),
        receipts: receipts.filter((x) => x.itemId === itemId).map((x) => ({
          id: x.id, amountKrw: krw(x.amount), date: x.date ?? null, ...(x.note ? { note: x.note } : {}),
        })),
        ...(item?.note ? { note: item.note } : {}),
      }
    }),
    extras: income.extras.map((x) => ({ id: x.id, date: x.date, name: x.name, amountKrw: krw(x.amount), ...(x.note ? { note: x.note } : {}) })),
    extrasKrw: krw(income.extraSum),
    expectedKrw: krw(income.expected),
    totalKrw: krw(income.total),
    diffKrw: krw(income.diff),
    /** every income of the month has something received written down */
    allReceived: income.allReceived,
    /** the month's left over (여유): what is left after the distribution of totalKrw; negative = short */
    leftOverKrw: krw(dist.remainder),
    /** the yearly incomes of other months, soonest first, with the month each comes next */
    later: income.later.map((l) => ({ incomeId: l.id, name: l.name, amountKrw: krw(l.amount), month: l.ym })),
  }
}

export type SpendFilter = { status?: 'active' | 'done' | 'cancelled' | 'all'; month?: string }

/** Every one-off spending with its rounds and derived state (spec 011 S-6); `state` is the general tab's, `progress` counts the rounds. */
export function spendingList(d: Data, now: Date, filter: SpendFilter = {}) {
  const all = d.spendings ?? []
  const today = ymd(now)
  const yms = all.map((x) => x.bought.slice(0, 7)).sort()
  const off = yms.length ? offDays(d, yms[0]!, addYm(yms[yms.length - 1]!, 1)) : new Set<string>()
  const rows = all.map((sp) => {
    const state = spendState(sp, today, d.settings, off)
    const live = sp.rounds.filter((r) => r.state !== 'merged')
    const next = sp.cancelled ? undefined : [...live].filter((r) => r.state === 'left').sort((a, b) => a.no - b.no)[0]
    return {
      id: sp.id,
      name: sp.name,
      category: sp.category,
      ...(sp.note ? { note: sp.note } : {}),
      bought: sp.bought,
      amount: sp.amount,
      currency: sp.currency,
      ...(sp.currency !== 'KRW' ? { fxRate: sp.fxRate, fxBuffer: sp.fxBuffer } : {}),
      principalKrw: krw(spendingKrw(sp.amount, sp.currency, { fxRate: sp.fxRate ?? d.settings.fxRate, fxBuffer: sp.fxBuffer ?? d.settings.fxBuffer })),
      feeKrw: krw(sp.fee),
      how: sp.how,
      payBy: sp.payBy,
      count: sp.count,
      ...(sp.interval ? { interval: sp.interval } : {}),
      cancelled: sp.cancelled,
      state,
      progress: {
        paid: sp.rounds.filter((r) => r.state === 'paid').length,
        left: sp.rounds.filter((r) => r.state === 'left').length,
        merged: sp.rounds.filter((r) => r.state === 'merged').length,
        next: next ? { round: next.no, date: next.date, amountKrw: krw(next.amount) } : null,
      },
      rounds: [...sp.rounds].sort((a, b) => a.no - b.no).map((r) => ({ round: r.no, date: r.date, amountKrw: krw(r.amount), state: r.state, edited: r.edited })),
    }
  })
  const status = filter.status ?? 'all'
  const byStatus = rows.filter((r) => status === 'all'
    || (status === 'cancelled' ? r.cancelled : status === 'done' ? r.state === 'paid' : !r.cancelled && r.state !== 'paid'))
  const month = filter.month
  const list = month
    ? byStatus.filter((r) => all.find((x) => x.id === r.id)!.rounds.some((x) => x.state !== 'merged' && x.date.slice(0, 7) === month))
    : byStatus
  const m = month ? spendingIn(all, month) : null
  return {
    ...(month ? { month, monthTotals: { subscriptionAccountKrw: krw(m!.subs), remainderKrw: krw(m!.remainder) } } : {}),
    spendings: list,
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
      chargeKrw: krw(chargeKrw(p, priced(d.settings, d.currencies))),
      monthlyKrw: krw(monthlyKrw(p, priced(d.settings, d.currencies))),
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
    targets: d.targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, ...(t.note ? { note: t.note } : {}), accountId: t.accountId ?? null })),
    phases: d.phases.map((p) => ({
      id: p.id, label: p.label, name: p.name, from: p.from, to: p.to, ...(p.note ? { note: p.note } : {}),
      amounts: Object.entries(p.amounts).map(([targetId, amount]) => ({ targetId, amountKrw: krw(amount) })),
    })),
    remainderSplit: d.remainderSplit.map((s) => ({ id: s.id, name: s.name, code: s.code, ratio: s.ratio })),
    accounts: d.accounts.map((a) => ({ id: a.id, name: a.name, role: a.role, inflow: a.inflow, outflow: a.outflow, group: a.group ?? null })),
    debts: d.debts.map((x) => ({ id: x.id, name: x.name, principalKrw: krw(x.principal), rate: x.rate, method: x.method, plan: x.plan })),
  }
}

/**
 * The months of a plan event's `when`: YYYY-MM, YYYY-MM~MM (to a later month of the same year) or YYYY-MM~YYYY-MM (into a
 * later year, spec 013 S-18). A range whose end is before its start counts as its start month only, as the screens show it.
 */
// The span of an event's `when`: the screens' rule (src/lib/event-when.ts `whenSpan`); an unreadable value is its first month.
export function eventMonths(when: string): { from: string; to: string } {
  return whenSpan(when) ?? { from: when.slice(0, 7), to: when.slice(0, 7) }
}

export function schedule(d: Data, from: string, months: number) {
  const list: string[] = Array.from({ length: months }, (_, i) => addYm(from, i))
  const last = list[list.length - 1]!
  const off = offDays(d, from, last)
  return {
    from,
    months: list.map((ym) => ({
      month: ym,
      dates: datesOf(d, ym, off),
      // the user's own monthly dates (spec 013 S-22, A-36), moved off weekends and holidays like the dates above; no amount
      ownDates: scheduleItemsIn(d.schedules ?? [], ym, d.settings.dayShift, off).map(({ item, at }) => ({
        id: item.id, name: item.name, day: item.day, ...dateOf(at), accountId: item.accountId, direction: item.direction, ...(item.note ? { note: item.note } : {}),
      })),
      payments: paymentsIn(d, ym),
      spendingRounds: spendRoundsIn(d, ym),
      planChanges: changesIn(d.planChanges, ym).map((c) => changeView(c, d)),
      planEvents: d.events
        .filter((e) => { const r = eventMonths(e.when); return r.from <= ym && ym <= r.to })
        .map((e) => { const r = eventMonths(e.when); return { id: e.id, when: e.when, from: r.from, to: r.to, kind: e.kind, title: e.title, state: e.state } }),
    })),
    checkItems: d.checks.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    holidays: holidaysIn(enabledSets(d.holidaySets), firstOf(from), `${last}-${String(lastDay(last)).padStart(2, '0')}`)
      .map((h) => ({ date: h.date, name: h.name, substitute: h.substitute })),
  }
}

// ---------- budget and accounts (spec 013 S-10) ----------
const phaseList = (amounts: Record<string, number> | undefined) => Object.entries(amounts ?? {}).map(([phaseId, amount]) => ({ phaseId, amountKrw: krw(amount) }))

/** The Savings or Investment menu in a month, as groupAt() works it out (S-3, S-4). */
function groupView(d: Data, group: BudgetGroup, ym: string) {
  const g = groupAt(group, d.accounts, d.phases, d.targets, d.settings, ym, d.monthAdjusts ?? [])
  const adjust = g.target ? (d.monthAdjusts ?? []).find((a) => a.ym === ym && a.targetId === g.target!.id) : undefined
  return {
    mode: g.mode,
    target: g.target ? { id: g.target.id, name: g.target.name, accountId: g.target.accountId ?? null } : null,
    /** ratio split: the phase amount of the target that month; amount split: the items added up */
    totalKrw: krw(g.total),
    items: g.rows.map(({ account: a, amount }) => ({
      accountId: a.id,
      name: a.name,
      kind: a.kind ?? '',
      bank: a.bank ?? '',
      last4: a.last4 ?? '',
      /** amount split: the monthly amount (a phase amount replaces it in that phase) */
      amountKrw: krw(a.amount ?? 0),
      phaseAmounts: phaseList(a.amounts),
      /** ratio split: the share of the total (0..1) */
      ratio: a.ratio ?? null,
      monthKrw: krw(amount),
      from: a.from ?? null,
      stopFrom: a.stopFrom ?? null,
      goalKrw: a.goal ?? null,
      annualLimitKrw: a.annualLimit ?? null,
    })),
    sumKrw: krw(g.sum),
    ratioSum: g.ratioSum,
    /** what the target gets that month: the items added up (an amount split's adjustment is spread over them; spec 013 S-14, review rc2-1 F-2) */
    targetKrw: krw(groupValue(g, adjust)),
    /** this month's adjustment of the target (amount split: spread over the items by amount; ratio split: the total the items share), or null */
    adjustment: adjust ? { id: adjust.id, amountKrw: krw(adjust.amount), ...(adjust.reason ? { reason: adjust.reason } : {}) } : null,
  }
}

/**
 * The savings maturity schedule (spec 013 S-15): every Savings item whose term reads N개월 / N months / YYYY-MM까지 and that has a
 * from month (maturity.ts). Expected (calc maturityAmount) = with a balance record, the projected balance at the end of the
 * month before the maturity month; else what the pay split sends the item from its from month up to that month (0 without a
 * Savings target; review rc2-1 F-10). `state` is relative to month `ym`: past, due (that month) or upcoming.
 */
export function maturitySchedule(d: Data, ym: string) {
  const st = accountState(d)
  return d.accounts.filter((a) => a.group === 'saving').flatMap((a) => {
    const m = maturityOf(a)
    if (!m) return []
    // the screens' rule (calc maturityAmount): the projected balance before the maturity month, or what the plan sends
    const rec = lastBalance(st.balances, a.id)
    const recYm = rec?.date.slice(0, 7)
    const lo = recYm && recYm < m.month ? recYm : m.month
    const got = maturityAmount(a, st, offDays(d, lo, m.month), { ym: m.month, months: m.months })
    return [{
      accountId: a.id, name: a.name, bank: a.bank ?? '', term: a.term ?? '', from: a.from ?? null, stopFrom: a.stopFrom ?? null,
      maturityMonth: m.month, months: m.months, monthlyKrw: krw(a.amount ?? 0),
      expectedKrw: krw(got.amount),
      /** projection: the projected balance; amount: what the plan sends from `from` to the maturity month */
      basis: got.projected ? 'projection' as const : 'amount' as const,
      afterMaturity: a.afterMaturity ?? '',
      state: m.month < ym ? 'past' as const : m.month === ym ? 'due' as const : 'upcoming' as const,
    }]
  }).sort((x, y) => (x.maturityMonth < y.maturityMonth ? -1 : x.maturityMonth > y.maturityMonth ? 1 : 0))
}

/**
 * get_budget (S-10): the living items, the Savings and Investment menus and what each allocation target gets
 * in month `ym`, with the same functions the Living, Savings and Investment pages use.
 */
export function budget(d: Data, ym: string) {
  const items = d.livingItems ?? []
  const living = livingAt(items, d.phases, ym)
  const phase = phaseAt(d.phases, ym)
  const { dist } = monthMoney(d, ym)
  const got = new Map(dist.rows.map((r) => [r.key, r.amount]))
  return {
    month: ym,
    phase: phase ? { id: phase.id, label: phase.label, name: phase.name, from: phase.from, to: phase.to } : null,
    living: {
      items: living.rows.map(({ item: x, amount }) => ({
        id: x.id, name: x.name, kind: x.kind, payMethod: x.payMethod, amountKrw: krw(x.amount), from: x.from, code: x.code,
        ...(x.note ? { note: x.note } : {}), phaseAmounts: phaseList(x.amounts), monthKrw: krw(amount),
      })),
      sumKrw: krw(living.sum),
    },
    saving: groupView(d, 'saving', ym),
    invest: groupView(d, 'invest', ym),
    /** every target with what it gets that month (the remainder target: the remainder; negative = short) */
    targets: d.targets.map((t) => ({
      targetId: t.id, name: t.name, kind: t.kind, accountId: t.accountId ?? null,
      amountKrw: krw(t.kind === 'remainder' ? dist.remainder : (got.get(t.id) ?? 0)),
    })),
    remainderKrw: krw(dist.remainder),
    unallocatedKrw: krw(unallocated(dist)),
    /** the month's adjustments (spec 013 S-14) */
    monthAdjusts: adjustsIn(d, ym),
    /** the savings maturity schedule (spec 013 S-15) */
    maturity: maturitySchedule(d, ym),
  }
}

/** What list_accounts computes with: the state with its balance records and cards. */
const accountState = (d: Data): AccountState => ({ ...d, balances: d.balances ?? [], cards: d.cards ?? [] })

/**
 * list_accounts (S-10, S-13): every account with its balance records and, as the account sheet shows them, the
 * projection from this month, the goal month, this year's contribution against the yearly limit and the buffer gauge;
 * plus every card with its paying account and billing day.
 */
export function accountList(d: Data, now: Date, months = 12) {
  const st = accountState(d)
  const today = ymd(now)
  const ym = ymOf(now)
  const year = now.getFullYear()
  const firstRec = st.balances.map((b) => b.date.slice(0, 7)).sort()[0]
  const off = offDays(d, firstRec && firstRec < ym ? firstRec : ym, addYm(ym, Math.max(months, 12)))
  const name = (id: string | null | undefined) => (id ? d.accounts.find((a) => a.id === id)?.name ?? null : null)
  const cardOut = (c: Card) => ({
    id: c.id, name: c.name, last4: c.last4, accountId: c.accountId, account: name(c.accountId),
    billingDay: c.billingDay, effectiveBillingDay: billingDayOf(c, d.settings), ...(c.note ? { note: c.note } : {}),
  })
  return {
    month: ym,
    accounts: d.accounts.map((a) => {
      const recs = st.balances.filter((b) => b.accountId === a.id).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
      const last = lastBalance(st.balances, a.id)
      const rows = projectAccount(a, st, off, ym, months)
      const contribution = yearContribution(a, st, off, year)
      const limit = a.annualLimit ?? null
      const gauge = bufferGauge(a, st, today)
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        inflow: a.inflow,
        outflow: a.outflow,
        bank: a.bank ?? '',
        last4: a.last4 ?? '',
        kind: a.kind ?? '',
        rate: a.rate ?? '',
        term: a.term ?? '',
        /** the month the term matures (spec 013 S-15: N개월 / N months / YYYY-MM까지 with a from month), else null */
        maturityMonth: maturityOf(a)?.month ?? null,
        afterMaturity: a.afterMaturity ?? '',
        group: a.group ?? null,
        amountKrw: krw(a.amount ?? 0),
        ratio: a.ratio ?? null,
        phaseAmounts: phaseList(a.amounts),
        from: a.from ?? null,
        stopFrom: a.stopFrom ?? null,
        bufferKrw: a.buffer ?? 0,
        goalKrw: a.goal ?? null,
        goalAck: a.goalAck ?? null,
        annualLimitKrw: limit,
        ...(a.note ? { note: a.note } : {}),
        balances: recs.map((b) => ({ id: b.id, date: b.date, amountKrw: krw(b.amount), depositKrw: b.deposit ?? null, ...(b.note ? { note: b.note } : {}) })),
        lastBalance: last ? { date: last.date, amountKrw: krw(last.amount) } : null,
        /** null without a balance record */
        projection: rows ? rows.map((r) => ({ month: r.ym, inflowKrw: krw(r.inflow), outflowKrw: krw(r.outflow), endKrw: krw(r.end) })) : null,
        goalMonth: goalMonth(a, st, off),
        year: {
          year,
          contributionKrw: krw(contribution),
          limitKrw: limit,
          leftKrw: limit === null ? null : krw(limit - contribution),
          /** near = at least 90% of the limit, over = above it (spec 013 S-7) */
          state: limit === null ? null : contribution > limit ? 'over' : contribution >= limit * 0.9 ? 'near' : 'under',
        },
        buffer: { bufferKrw: krw(gauge.buffer), usedKrw: krw(gauge.used), leftKrw: krw(gauge.left) },
        targets: d.targets.filter((t) => t.accountId === a.id).map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        cards: st.cards.filter((c) => c.accountId === a.id).map((c) => ({ id: c.id, name: c.name, last4: c.last4, effectiveBillingDay: billingDayOf(c, d.settings) })),
      }
    }),
    cards: st.cards.map(cardOut),
  }
}

// ---------- search and notifications (spec 013 S-19, S-20) ----------
/** search: the same matching as the header search (src/lib/search.ts), with each row's page in the app. */
export function searchView(d: Data, query: string, kinds?: readonly SearchKind[]) {
  const results = search({ ...d, spendings: d.spendings ?? [], livingItems: d.livingItems ?? [], cards: d.cards ?? [] }, query, kinds)
    .map((h) => ({ kind: h.kind, id: h.id, name: h.name, ...(h.note ? { note: h.note } : {}), matched: h.field, page: h.path }))
  return { query, count: results.length, results }
}

const won = (n: number) => `${Math.round(n).toLocaleString('en-US')} KRW`
const when = (dday: number) => (dday <= 0 ? 'today' : dday === 1 ? 'tomorrow' : `in ${dday} days`)
/** One sentence in English for a notification (the bell writes its own in the screen language). */
export function noticeText(n: Notice): string {
  switch (n.kind) {
    case 'proposals': return `${n.count} AI proposal(s) wait for the user's confirmation under Pending changes.`
    case 'goals': return `${n.count} account(s) reached their goal; the user decides under Pending changes whether to stop sending.`
    case 'maturities': return `${n.count} savings item(s) reached maturity and still send; the user decides under Pending changes whether to stop sending.`
    case 'charge': return `${n.name} is charged ${won(n.amount)} on ${n.date} (${when(n.dday)}).`
    case 'round': return `Round ${n.round}/${n.of} of ${n.name}: ${won(n.amount)} on ${n.date} (${when(n.dday)}).`
    case 'remainderShort': return `The remainder of ${n.month} is short by ${won(-n.remainder)}.`
    case 'yearLimit': return `${n.name} has ${won(n.contribution)} of its ${won(n.limit)} yearly limit for ${n.year}${n.over ? ' (over the limit)' : ' (90% or more)'}.`
    case 'bufferShort': return `The buffer of ${n.name} (${won(n.buffer)}) is short: buffer uses took ${won(n.used)}, ${won(-n.left)} more than it holds.`
  }
}

/**
 * list_notifications: what the bell lists on `now` (src/lib/notices.ts) — pending proposals (`proposals`, counted by the
 * caller), goal cards and maturity cards (a Savings item due this month or past that still sends; the "keep sending"
 * choice is kept in the user's browser and cannot be seen here, so a maturity kept there is listed until it is stopped;
 * review rc2-1 F-5), the charges and rounds of the next three days, this month's remainder short, a yearly limit used 90%
 * or more, a buffer short — each with a sentence. The read marks are the browser's and are not here.
 */
export function notificationList(d: Data, now: Date, proposals: number) {
  const st = accountState(d)
  const today = ymd(now)
  const ym = ymOf(now)
  const firstRec = st.balances.map((b) => b.date.slice(0, 7)).sort()[0]
  const jan = `${ym.slice(0, 4)}-01`
  const off = offDays(d, firstRec && firstRec < jan ? firstRec : jan, addYm(ym, 3))
  const goals = goalAlerts(st, today, off)
  const due = maturityAlerts(st, today, off)
  const list = buildNotices(st, today, off, { proposals, goalAccounts: goals.map((g) => g.account.id), maturities: due.map((m) => `${m.account.id}@${m.month}`) })
  return {
    date: today,
    notifications: list.map((n) => ({
      ...n,
      ...(n.kind === 'goals' ? { accounts: goals.map((g) => ({ accountId: g.account.id, name: g.account.name, goalMonth: g.month, stopFrom: g.stopFrom })) } : {}),
      ...(n.kind === 'maturities' ? { accounts: due.map((m) => ({ accountId: m.account.id, name: m.account.name, maturityMonth: m.month, stopFrom: m.stopFrom })) } : {}),
      message: noticeText(n),
    })),
  }
}
