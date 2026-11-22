// What the MCP tools say about a user's data (spec 008 S-6, S-7): pure functions over the rows that
// readState() returns, computed with the same code the screens use (src/lib/calc.ts, holidays.ts),
// so the AI and the screen see the same numbers. No database here: the unit tests run without one.
// Output is plain JSON: enum values as stored, ISO dates, amounts in KRW as whole numbers.
import {
  addYm, billingDayOf, bufferGauge, changesIn, chargeKrw, goalMonth, groupAt, lastBalance, livingAt, monthDates, monthlyKrw, monthMoney, nextPayment, parseDate,
  phaseAt, planAt, projectAccount, spendingIn, spendingKrw, spendState, splitRemainder, transferAt, unallocated, upcomingPayments, yearContribution, ymd, ymOf,
  type AccountState, type MonthDate,
} from '../../src/lib/calc'
import { enabledSets, holidaysIn } from '../../src/lib/holidays'
import type {
  Account, AllocationTarget, Balance, BudgetGroup, Card, CheckItem, Debt, HolidaySet, Living, LivingItem, Phase, PlanChange, PlanEvent, RemainderSplit, Settings, Spending,
  SubStatus, Subscription,
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
  /** one-off spendings with their rounds (spec 011); absent = none */
  spendings?: Spending[]
  /** living items (spec 013 S-2); when present they make the living total, else the old `living` row does */
  livingItems?: LivingItem[]
  /** balance records (spec 013 S-6); absent = none */
  balances?: Balance[]
  /** cards (spec 013 S-13); absent = none */
  cards?: Card[]
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
    const t = transferAt(d.subscriptions, changes, d.settings, ym)
    return t.monthlySum + t.yearlyMonthly
  }
  return krw(sum(d.planChanges) - sum(d.planChanges.filter((x) => x.id !== c.id)))
}

export function overview(d: Data, ym: string) {
  const off = offDays(d, ym, ym)
  // One-off spendings are in the month's transfer and remainder (spec 011 S-5).
  const { dist, transfer: xfer, spend } = monthMoney(d, ym)
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
    remainderSplit: split.map((s) => ({ id: s.id, name: s.name, code: s.code, ratio: s.ratio, amountKrw: s.amount })),
    payments: paymentsIn(d, ym),
    spendingRounds: spendRoundsIn(d, ym),
    planChanges: changesIn(d.planChanges, ym).map((c) => changeView(c, d)),
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
      ...(sp.currency === 'USD' ? { fxRate: sp.fxRate, fxBuffer: sp.fxBuffer } : {}),
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
      spendingRounds: spendRoundsIn(d, ym),
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

// ---------- budget and accounts (spec 013 S-10) ----------
const phaseList = (amounts: Record<string, number> | undefined) => Object.entries(amounts ?? {}).map(([phaseId, amount]) => ({ phaseId, amountKrw: krw(amount) }))

/** The Savings or Investment menu in a month, as groupAt() works it out (S-3, S-4). */
function groupView(d: Data, group: BudgetGroup, ym: string) {
  const g = groupAt(group, d.accounts, d.phases, d.targets, d.settings, ym)
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
  }
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
        balances: recs.map((b) => ({ id: b.id, date: b.date, amountKrw: krw(b.amount), ...(b.note ? { note: b.note } : {}) })),
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
