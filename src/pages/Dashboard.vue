<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, ref, watch } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { pricedSettings, saveItem, store, subName } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { notReady, view } from '../lib/view'
import { allocColor } from '../lib/colors'
import { kindDetail, phaseTag, roundSuffix } from '../lib/labels'
import { fmtDate, fmtMoney, fmtMoneyClass } from '../lib/display'
import { manText, monthLong, monthShort, weekdayShort } from '../lib/format'
import { t, lang, type MessageKey } from '../i18n'
import { offDays } from '../lib/holidays-lazy'
import { whenShort } from '../lib/event-when'
import { downloadCsv, wonCell, type CsvCell } from '../lib/csv'
import {
  addYm, leftoverAfterTransfer, monthDates, monthMoney, parseDate, paysAfter31, splitRemainder, today, unallocated, upcomingPayments, upcomingSpendRounds, ymd, ymOf, ymRange,
} from '../lib/calc'
import {
  canUndo, changed, decide, fieldName, listFor, loadProposals, money, proposals, proposalTitle, rowFields, rowLabel, rowTitle, shown, summary, tableName, undo, when, worded,
  type Proposal,
} from '../lib/proposals'
import { localToday } from '../lib/now'
import type { AllocationKind } from '../data/types'

const AddRecord = defineAsyncComponent(() => import('../components/AddRecordModal.vue'))

// 현황 (spec 007 S-4, redrawn by spec 010 S-6): the canvas dashboard on the data we have. Not in the
// app yet (S-3): the last sync — it is "—". '결제 추가' opens the spending add editor (/spend/general?add) and
// the remainder's '관리' goes to the pay page's simulation (spec 013 S-16); '내보내기' saves the shown month's
// summary as a CSV made here from the state (S-17).
// "고정 지출 추이" looks ahead six months (the past is not stored; the user approved the change on 2026-11-15).
// Spec 014 S-1, S-7, S-11 (the canvas board NextHome): the page opens with the month's 여유 — 들어올 돈 − 나갈 돈 —,
// the two cards behind it and where the 여유 goes; the four tabs that were the page follow under '자세히', unchanged.
// The four KPI cards are gone: their numbers are in the tabs (31일 내 결제: the payment list; 확인 필요: the tab counts),
// the subscription total is the subscription line of 나갈 돈, and the remainder is the 여유 itself.
const now = localToday()
// The month comes from the header's month switch (spec 007 S-15); payments stay "from today".
const ym = computed(() => view.ym)
const year = computed(() => Number(view.ym.slice(0, 4)))
const month = computed(() => Number(view.ym.slice(5, 7)))

// The month's real money: one-off spendings are in the transfer and the remainder (spec 011 S-5).
const monthNow = computed(() => monthMoney(store, ym.value))
const dist = computed(() => monthNow.value.dist)
const xfer = computed(() => monthNow.value.transfer)
// What is due in the next 31 days: subscription charges and the rounds of one-off spendings (spec 011 S-8), by date.
interface Pay { key: string; date: Date; name: string; sub: string; krw: number; dday: number }
const pays = computed<Pay[]>(() => [
  ...upcomingPayments(store.subscriptions, store.planChanges, pricedSettings(), now, 31).map((p) => ({ key: p.sub.id + p.date.getTime(), date: p.date, name: p.sub.name, sub: p.sub.plan || '—', krw: p.krw, dday: p.dday })),
  ...upcomingSpendRounds(store.spendings, now, 31).map((d) => ({ key: `${d.spending.id}-${d.round.no}`, date: d.date, name: d.spending.name, sub: roundSuffix(d.spending, d.round) || t('dashboard.spendOne'), krw: d.krw, dday: d.dday })),
].sort((a, b) => a.date.getTime() - b.date.getTime()))
const paysSum = computed(() => pays.value.reduce((a, p) => a + p.krw, 0))
const later = computed(() => paysAfter31(store.subscriptions, store.planChanges, pricedSettings(), now))
// The closest payment when nothing falls in the next 31 days.
const nearest = computed(() => (pays.value.length ? null : upcomingPayments(store.subscriptions, store.planChanges, pricedSettings(), now, 800)[0] ?? null))
const split = computed(() => (dist.value.remainderTarget ? splitRemainder(dist.value.remainder, store.remainderSplit) : []))
const subsMonthly = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
// Active in the shown month, with scheduled plan changes applied (the same set as the monthly total).
const activeSubs = computed(() => xfer.value.items.length)
// shares of what comes in this month (spec 014 S-5): the rows are worked out from it, so the column adds up to 100%
const pct = (n: number) => (monthNow.value.income.total > 0 ? `${((n / monthNow.value.income.total) * 100).toFixed(1)}%` : '—')
// What the pay leaves when no target takes the remainder (negative = short).
const spare = computed(() => unallocated(dist.value))
const barRows = computed(() => dist.value.rows.filter((x) => x.amount > 0))

// ---------- 3초: 들어올 돈 − 나갈 돈 = 여유 (spec 014 S-1, S-5) ----------
const income = computed(() => monthNow.value.income)
const spend = computed(() => monthNow.value.spend)
/** 여유: what the remainder target gets, or what stays in the pay account without one (negative = short). */
const yeo = computed(() => dist.value.remainder)
const salary = computed(() => income.value.rows.find((r) => r.key === 'salary')!)
/** The basis badge: every line received, the salary not yet, or some other line not yet. */
const basis = computed(() =>
  income.value.allReceived ? { cls: 'ok', text: t('dashboard.home.basisReceived') }
  : salary.value.received === null ? { cls: 'acc', text: t('dashboard.home.basisBeforePay') }
  : { cls: 'acc', text: t('dashboard.home.basisPartly') })
// Where each target is managed (S-1: every 나갈 돈 line goes to its menu).
const OUT_PATH: Record<AllocationKind, string> = {
  living: '/living', subscriptions: '/spend/subs', fixed: '/pay', saving: '/saving', invest: '/invest', remainder: '/pay?tab=sim',
}
interface Out { key: string; name: string; sub: string; amount: number; color: string; to: string }
/** 나갈 돈: every target but the remainder, then the month's spendings taken off the remainder. */
const outs = computed<Out[]>(() => [
  ...dist.value.rows.filter((r) => r.kind !== 'remainder').map((r) => ({
    key: r.key, name: r.name, amount: r.amount, color: allocColor(r.key), to: OUT_PATH[r.kind],
    sub: r.kind === 'subscriptions' ? t('dashboard.home.subsSub', { n: activeSubs.value, amount: fmtMoney(subsMonthly.value) }) : r.detail || kindDetail(r.kind),
  })),
  ...(spend.value.remainder > 0 ? [{
    key: 'spend', name: t('dashboard.home.spendLine'), amount: spend.value.remainder, color: 'var(--c7)', to: '/spend/general',
    sub: t('dashboard.home.spendSub', { n: spend.value.items.filter((x) => x.spending.payBy !== 'subs').length }),
  }] : []),
])
const outSum = computed(() => outs.value.reduce((a, o) => a + o.amount, 0))
/** A share of what comes in, for the legend. */
const ofIn = (n: number) => (income.value.total > 0 ? `${((n / income.value.total) * 100).toFixed(1)}%` : '—')
// The bar: the larger of in and out is the whole width, so a short month shows the out lines only.
const barBase = computed(() => Math.max(income.value.total, outSum.value, 1))
const barW = (n: number) => `${(Math.max(n, 0) / barBase.value) * 100}%`
const inNote = computed(() => {
  if (salary.value.received === null) return t('dashboard.home.inNoteWait', { date: mdShort(dates.value.pay.date) })
  const got = t('dashboard.home.inNoteGot', { n: income.value.rows.filter((r) => r.received !== null).length })
  return income.value.extras.length ? `${got} · ${t('dashboard.home.inNoteExtras', { n: income.value.extras.length })}` : got
})
/** The 들어올 돈 card: every income line of the month with its cycle, day and state. */
const inRows = computed(() => income.value.rows.map((r) => {
  const item = r.key === 'salary' ? null : store.incomes.find((i) => i.id === r.key)
  const dated = store.incomeReceipts.filter((x) => x.ym === ym.value && x.itemId === (item ? item.id : null) && x.date).map((x) => x.date!).sort().at(-1)
  return {
    key: r.key, expected: r.expected, received: r.received, diff: r.diff,
    name: r.name ?? t('dashboard.home.salary'),
    when: item?.cycle === 'yearly' && item.month ? t('dashboard.home.yearlyOn', { month: monthShort(item.month), day: r.day }) : t('dashboard.home.monthlyOn', { day: r.day }),
    state: r.received === null ? { cls: 'acc', text: t('dashboard.home.waiting') }
      : { cls: 'ok', text: dated ? t('dashboard.home.gotOn', { date: mdShort(dated) }) : t('dashboard.home.got') },
  }
}))
/** The next yearly income of another month (the note under the 들어올 돈 card). */
const laterIn = computed(() => {
  const x = income.value.later[0]
  return x ? t('dashboard.home.laterNote', { month: monthShort(Number(x.ym.slice(5))), name: x.name, amount: fmtMoney(x.amount) }) : ''
})
const SPLIT_COLORS = ['var(--info)', 'var(--c5)', 'var(--c6)', 'var(--c4)', 'var(--c3)']
/** 여유 어디에 둘까 (S-7): the remainder split, or the remainder target alone, or the pay account. */
const places = computed(() => {
  const d = dist.value
  if (!d.remainderTarget) return [{ key: 'pay', name: t('dashboard.home.payAccount'), sub: t('dashboard.home.noTarget'), amount: Math.max(spare.value, 0), color: '' }]
  if (!split.value.length) return [{ key: d.remainderTarget.id, name: d.remainderTarget.name, sub: t('dashboard.home.allOfIt'), amount: Math.max(yeo.value, 0), color: '' }]
  return split.value.map((x, i, all) => ({
    key: x.id, name: x.name, amount: x.amount, color: i === all.length - 1 ? '' : SPLIT_COLORS[i % SPLIT_COLORS.length]!,
    sub: i === all.length - 1 ? t('dashboard.home.restOfIt') : t('dashboard.home.ratioOf', { pct: Math.round(x.ratio * 10_000) / 100 }),
  }))
})
const why = computed(() => {
  if (yeo.value < 0) return t('dashboard.home.whyShort', { amount: fmtMoney(-yeo.value) })
  if (salary.value.received === null) return t('dashboard.home.whyWait')
  const d = income.value.diff
  return d > 0 ? t('dashboard.home.whyMore', { amount: fmtMoney(d) }) : d < 0 ? t('dashboard.home.whyLess', { amount: fmtMoney(-d) }) : ''
})

// Holidays for the day shift: the month before and after are needed too (a shift moves at most 31 days).
const off = computed<ReadonlySet<string>>(() => {
  if (store.settings.dayShift === 'none') return new Set()
  return offDays(store.holidaySets, `${addYm(ym.value, -2)}-01`, `${addYm(ym.value, 3)}-01`) ?? new Set()
})
const dates = computed(() => monthDates(ym.value, store.settings, off.value))
const mdd = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}(${weekdayShort(d)})`
const md = (s: string) => mdd(parseDate(s))
const mdShort = (s: string) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}` }
const moved = (s: 'before' | 'after' | null) => (s === 'before' ? t('dashboard.movedBefore') : s === 'after' ? t('dashboard.movedAfter') : '')
/** The note after a monthly date: moved, or no business day within the limit (review 2, F3). */
const note = (x: { shifted: 'before' | 'after' | null; unresolved?: true }) =>
  x.unresolved ? ` (${t('calendar.noBizDay')})` : x.shifted === 'before' ? ` (${t('calendar.before')})` : x.shifted === 'after' ? ` (${t('calendar.after')})` : ''

// "이체 후 남는 금액" (D-9): this transfer minus the payments until the next transfer.
const left = computed(() => leftoverAfterTransfer(store, ym.value, off.value, store.spendings))
const leftPct = computed(() => (left.value.transfer > 0 ? Math.min(100, (left.value.paid / left.value.transfer) * 100) : left.value.paid > 0 ? 100 : 0))

// Six months ahead: subscription monthly total with scheduled plan changes.
const trend = computed(() => ymRange(ym.value, 6).map((m) => {
  const t = monthMoney(store, m).transfer
  return { ym: m, v: t.monthlySum + t.yearlyMonthly }
}))
const trendMax = computed(() => Math.max(1, ...trend.value.map((x) => x.v)))
// The y axis as in the design: three equal steps to a round top (만원).
const trendTop = computed(() => { const step = Math.max(1, Math.ceil(trendMax.value / 30_000)) * 10_000; return step * 3 })
const ticks = computed(() => [3, 2, 1, 0].map((i) => (i ? manText(trendTop.value / 3 * i) : '0')))
const monthName = computed(() => (lang.value === 'en' ? monthLong(month.value) : month.value))
const monthTitle = computed(() => t('dashboard.monthText', { year: year.value, month: monthName.value }))
const trendLast = computed(() => trend.value.at(-1)!.ym)

const tab = ref('month')
const horizon = computed(() => addYm(ym.value, 9))
const nextChanges = computed(() =>
  store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) >= ym.value).sort((a, b) => (a.effective! < b.effective! ? -1 : 1)),
)
const undated = computed(() => store.planChanges.filter((c) => !c.effective))
const nextEvents = computed(() => store.events.filter((e) => e.state !== 'done' && e.when.slice(0, 7) <= horizon.value))
const openChecks = computed(() => store.checks.filter((c) => !c.done).length)
const tabs = computed(() => [
  { id: 'month', label: t('dashboard.tabMonth'), icon: 'chart' },
  { id: 'pending', label: t('dashboard.tabAi'), icon: 'sparkle', count: store.pendingProposals, signal: true },
  { id: 'next', label: t('dashboard.tabNext'), icon: 'events', count: nextChanges.value.length + nextEvents.value.length },
  { id: 'checks', label: t('dashboard.checks'), icon: 'check', count: openChecks.value },
])

function changeDelta(id: string, eff: string) {
  // Same month's spendings on both sides: only the monthly sums are compared here, and they do not carry spendings.
  const before = monthMoney({ ...store, planChanges: store.planChanges.filter((c) => c.id !== id) }, eff.slice(0, 7)).transfer
  const after = monthMoney(store, eff.slice(0, 7)).transfer
  return (after.monthlySum + after.yearlyMonthly) - (before.monthlySum + before.yearlyMonthly)
}
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtMoney(Math.abs(n))
// The first dated plan change inside the six months shown: the note under the trend bars.
const trendChange = computed(() => {
  const c = nextChanges.value.find((x) => x.effective!.slice(0, 7) <= trendLast.value)
  if (!c) return null
  return { when: mdShort(c.effective!), name: subName(c.subId), plan: c.to.plan ?? '', delta: changeDelta(c.id, c.effective!) }
})
const chkEd = useEditor('checks', () => ({ id: '', text: '', done: false }), (c) => (!c.text.trim() ? t('dashboard.needDetails') : null))

// 기록 추가 (the header button and the 확인할 것 "+ 추가"): the modal opens on a record type.
const adding = ref<'todo' | 'event' | 'sub' | null>(null)

// AI 제안 tab: the waiting proposals, loaded when the tab opens.
watch(tab, (v) => { if (v === 'pending') void loadProposals() })
onActivated(() => { if (tab.value === 'pending') void loadProposals() })
const cards = computed(() => listFor('waiting'))
/** The rows a proposal card lists: each changed field, each added or removed row, and what it does to this month's transfer and remainder. */
function diffRows(p: Proposal) {
  const out: { k: string; from: string; to: string }[] = []
  for (const c of p.preview.rows) {
    if (c.op === 'update') {
      for (const f of rowFields(c)) out.push({ k: `${tableName(c.table)} · ${rowLabel(c) || fieldName(f.k, c.table)}${rowLabel(c) ? ` · ${fieldName(f.k, c.table)}` : ''}`, from: worded(f.k, f.b, c.before, c.table), to: worded(f.k, f.a, c.after, c.table) })
    } else out.push({ k: rowTitle(c), from: '', to: '' })
  }
  const m = p.preview.months[0]
  if (m) {
    const mon = monthShort(Number(m.month.slice(5)))
    if (changed(m.transferKrw)) out.push({ k: t('dashboard.propTransfer', { month: mon }), from: money(m.transferKrw.before), to: money(m.transferKrw.after) })
    const r = m.distribution.find((x) => x.kind === 'remainder')
    if (r && changed(r.amountKrw)) out.push({ k: t('dashboard.propRemainder', { month: mon, name: r.name }), from: money(r.amountKrw.before), to: money(r.amountKrw.after) })
  }
  return out
}
const cardMeta = (p: Proposal) => t('pending.meta', { key: p.keyName, at: when(p.createdAt), summary: summary(p) })
const wcls = (d: Date) => (d.getDay() === 6 ? 'sat' : d.getDay() === 0 ? 'sun' : '')
// ---------- 내보내기 (spec 013 S-17): the shown month's summary as CSV ----------
// Distribution rows (target, kind, amount), the subscription transfer, the remainder (and its split), then the
// month's subscription payments and spending rounds (date, name, amount) in date order.
function exportCsv() {
  const m = ym.value
  const H = (k: string) => t(`dashboard.csv.${k}` as MessageKey)
  const d = dist.value
  const xferDay = dates.value.transfer.date
  const rows: CsvCell[][] = [[H('section'), H('name'), H('kind'), H('date'), H('amount')]]
  for (const r of d.rows) rows.push([H('secDist'), r.name, r.detail || kindDetail(r.kind), xferDay, wonCell(r.amount)])
  const subsTarget = store.targets.find((x) => x.kind === 'subscriptions')?.name ?? t('subscriptions.transferName')
  rows.push([H('secTransfer'), subsTarget, t('calendar.kind.transfer'), xferDay, wonCell(xfer.value.transfer)])
  if (d.remainderTarget) {
    rows.push([H('secRemainder'), d.remainderTarget.name, kindDetail('remainder'), xferDay, wonCell(d.remainder)])
    for (const x of split.value) rows.push([H('secSplit'), x.name, '', xferDay, wonCell(x.amount)])
  } else rows.push([H('secRemainder'), spare.value < 0 ? t('dashboard.short') : t('dashboard.spare'), '', xferDay, wonCell(spare.value)])
  const first = parseDate(`${m}-01`)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate() - 1
  const due: { date: string; row: CsvCell[] }[] = []
  for (const p of upcomingPayments(store.subscriptions, store.planChanges, pricedSettings(), first, days)) {
    due.push({ date: ymd(p.date), row: [H('secPay'), p.sub.name, H('kindSub'), ymd(p.date), wonCell(p.krw)] })
  }
  // every round of the month that counts (paid or to pay; not merged, not a cancelled spending's open round)
  for (const s of store.spendings) for (const r of s.rounds) {
    if (r.state === 'merged' || (s.cancelled && r.state === 'left') || r.date.slice(0, 7) !== m) continue
    due.push({ date: r.date, row: [H('secRound'), s.name, roundSuffix(s, r) || t('dashboard.spendOne'), r.date, r.amount] })
  }
  for (const x of due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) rows.push(x.row)
  downloadCsv(`allot-summary-${m}.csv`, rows)
}

const pillCls = (state: string) => (state === 'doing' ? 'ok' : 'mute')
</script>

<template>
  <section class="page-gap">
    <!-- On a phone the header bar is hidden: the month switch and the phase sit here (review 11). -->
    <div class="mnav" role="group" :aria-label="t('dashboard.monthNav')">
      <button class="btn icon ghost" type="button" :aria-label="t('shell.prevMonth')" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" /></button>
      <div class="mn-c"><b class="num">{{ monthTitle }}</b><small class="hint">{{ dist.phase ? phaseTag(store.phases, dist.phase) : t('shell.outOfPhase') }}</small></div>
      <button class="btn icon ghost" type="button" :aria-label="t('shell.nextMonth')" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" /></button>
    </div>
    <PageHeader :title="monthTitle" class="dash-ph">
      <template #desc>
        {{ t('calendar.kind.pay') }} <span :title="moved(dates.pay.shifted)">{{ md(dates.pay.date) }}<small v-if="note(dates.pay)">{{ note(dates.pay) }}</small></span>
        · {{ t('calendar.kind.transfer') }} <span :title="moved(dates.transfer.shifted)">{{ md(dates.transfer.date) }}<small v-if="note(dates.transfer)">{{ note(dates.transfer) }}</small></span>
      </template>
      <button class="btn ph-hide" type="button" :title="t('dashboard.exportLabel', { month: monthTitle })" @click="exportCsv"><Icon name="download" />{{ t('shell.export') }}</button>
      <button class="btn pri" type="button" @click="adding = 'todo'"><Icon name="plus" />{{ t('shell.addRecord') }}</button>
    </PageHeader>

    <!-- 3초 (spec 014 S-1): 들어올 돈 − 나갈 돈 = 여유 -->
    <section class="card hero" :aria-label="t('dashboard.home.heroLabel')">
      <div class="h-top">
        <span class="h-t"><b>{{ t('dashboard.home.heroTitle', { month: monthShort(month) }) }}</b><span class="pill" :class="basis.cls">{{ basis.text }}</span></span>
        <span class="hint">{{ t('dashboard.home.heroHint') }}</span>
      </div>
      <div class="h-big">
        <span class="num yv" :class="{ short: yeo < 0 }" data-testid="yeo">{{ fmtMoney(yeo) }}</span>
        <b v-if="yeo < 0" class="h-short">{{ t('dashboard.home.short', { amount: fmtMoney(-yeo) }) }}</b>
        <span v-if="income.diff !== 0" class="num h-diff" :class="income.diff > 0 ? 'plus' : 'minus'">{{ t('dashboard.home.vsExpected', { amount: signed(income.diff) }) }}</span>
      </div>
      <div class="eq">
        <RouterLink class="eqc" to="/income" :aria-label="t('dashboard.home.inLabel', { amount: fmtMoney(income.total) })">
          <span class="lab">{{ t('dashboard.home.in') }}</span>
          <span class="num big">{{ fmtMoney(income.total) }}</span>
          <span class="hint num">{{ t('dashboard.home.expected', { amount: fmtMoney(income.expected) }) }}<template v-if="income.diff !== 0"> · <b :class="income.diff > 0 ? 'plus' : 'minus'">{{ signed(income.diff) }}</b></template></span>
          <span class="hint">{{ inNote }}</span>
        </RouterLink>
        <span class="op" aria-hidden="true">−</span>
        <div class="eqc">
          <span class="lab">{{ t('dashboard.home.out') }}</span>
          <span class="num big">{{ fmtMoney(outSum) }}</span>
          <span class="hint">{{ outs.map((o) => o.name).join(' · ') || '—' }}</span>
          <span class="hint">{{ t('dashboard.home.autoOn', { day: Number(dates.transfer.date.slice(8)) }) }}</span>
        </div>
        <span class="op" aria-hidden="true">=</span>
        <div class="eqc yc" :class="{ short: yeo < 0 }">
          <span class="lab">{{ t('dashboard.home.yeo') }}</span>
          <span class="num big">{{ fmtMoney(yeo) }}</span>
          <span class="hint">{{ yeo < 0 ? t('dashboard.home.short', { amount: fmtMoney(-yeo) }) : t('dashboard.home.yeoHint') }}</span>
        </div>
      </div>
      <div>
        <div class="sbar" role="img" :aria-label="t('dashboard.home.barLabel', { list: [...outs.map((o) => `${o.name} ${ofIn(o.amount)}`), ...(yeo > 0 ? [`${t('dashboard.home.yeo')} ${ofIn(yeo)}`] : [])].join(', ') })">
          <span v-for="o in outs.filter((x) => x.amount > 0)" :key="o.key" :style="{ width: barW(o.amount), background: o.color }"></span>
          <span v-if="yeo > 0" class="yeo" :style="{ width: barW(yeo) }"></span>
        </div>
        <div class="legend">
          <span v-for="o in outs" :key="o.key"><i :style="{ background: o.color }"></i>{{ o.name }} <b class="num">{{ ofIn(o.amount) }}</b></span>
          <span><i class="yeo"></i>{{ t('dashboard.home.yeo') }} <b class="num" :class="yeo < 0 ? 'minus' : 'plus'">{{ yeo < 0 ? t('dashboard.home.shortWord') : ofIn(yeo) }}</b></span>
        </div>
      </div>
    </section>

    <div class="io">
      <!-- 들어올 돈 -->
      <section class="card iocard" :aria-label="t('dashboard.home.in')">
        <div class="card-hd"><h2>{{ t('dashboard.home.in') }}</h2><RouterLink to="/income" class="aux">{{ t('dashboard.home.manageIncome') }}</RouterLink></div>
        <div class="lrow lhd"><span class="l-n">{{ t('dashboard.home.colItem') }}</span><span class="l-e">{{ t('dashboard.home.colExpected') }}</span><span class="l-g">{{ t('dashboard.home.colReceived') }}</span></div>
        <div v-for="r in inRows" :key="r.key" class="lrow">
          <span class="l-n"><b>{{ r.name }}</b><small class="hint">{{ r.when }} · <span class="pill" :class="r.state.cls">{{ r.state.text }}</span></small></span>
          <span class="l-e num">{{ fmtMoney(r.expected) }}</span>
          <span class="l-g"><b class="num">{{ r.received === null ? '—' : fmtMoney(r.received) }}</b><small v-if="r.received !== null && r.diff !== 0" class="num" :class="r.diff > 0 ? 'plus' : 'minus'">{{ signed(r.diff) }}</small></span>
        </div>
        <div v-for="x in income.extras" :key="x.id" class="lrow">
          <span class="l-n"><b>{{ x.name }}</b><small class="hint">{{ mdShort(x.date) }} · <span class="pill mute">{{ t('dashboard.home.extra') }}</span></small></span>
          <span class="l-e num">—</span>
          <span class="l-g"><b class="num">{{ fmtMoney(x.amount) }}</b><small class="plus">{{ t('dashboard.home.extraIncome') }}</small></span>
        </div>
        <div class="lrow lsum"><b class="l-n">{{ t('dashboard.total') }}</b><span class="l-e num">{{ fmtMoney(income.expected) }}</span><b class="l-g num">{{ fmtMoney(income.total) }}</b></div>
        <div class="iofoot">
          <span class="hint">{{ laterIn }}</span>
          <RouterLink v-if="salary.received === null" class="btn sm pri" to="/income">{{ t('dashboard.home.writeSalary') }}</RouterLink>
          <RouterLink v-else class="btn sm" to="/income">{{ t('dashboard.home.writeExtra') }}</RouterLink>
        </div>
      </section>

      <!-- 나갈 돈 -->
      <section class="card iocard" :aria-label="t('dashboard.home.out')">
        <div class="card-hd"><h2>{{ t('dashboard.home.out') }}</h2><span class="aux">{{ t('dashboard.home.outAux', { day: Number(dates.transfer.date.slice(8)) }) }}</span></div>
        <RouterLink v-for="o in outs" :key="o.key" class="lrow olink" :to="o.to">
          <i class="sw" :style="{ background: o.color }"></i>
          <span class="l-n"><b>{{ o.name }}</b><small class="hint">{{ o.sub }}</small></span>
          <b class="num amt">{{ fmtMoney(o.amount) }}</b>
          <Icon name="next" class="chev" />
        </RouterLink>
        <p v-if="!outs.length" class="empty">{{ t('dashboard.home.noOut') }}</p>
        <div class="lrow lsum osum"><b>{{ t('dashboard.total') }}</b><b class="num amt">{{ fmtMoney(outSum) }}</b></div>
      </section>
    </div>

    <!-- 여유 어디에 둘까 (S-7) -->
    <section class="card" :aria-label="t('dashboard.home.placeLabel')">
      <div class="card-hd wrap">
        <h2>{{ t('dashboard.home.placeBefore') }} <span class="num" :class="yeo < 0 ? 'minus' : 'plus'">{{ fmtMoney(yeo) }}</span> {{ t('dashboard.home.placeAfter') }}</h2>
        <RouterLink class="btn sm" to="/pay?tab=sim">{{ t('dashboard.home.editSplit') }}</RouterLink>
      </div>
      <div v-for="x in places" :key="x.key" class="lrow">
        <i class="sw" :class="{ yeo: !x.color }" :style="x.color ? { background: x.color } : {}"></i>
        <span class="l-n"><b>{{ x.name }}</b><small class="hint">{{ x.sub }}</small></span>
        <b class="num amt">{{ fmtMoney(x.amount) }}</b>
      </div>
      <p v-if="why" class="why" :class="{ bad: yeo < 0 }">{{ why }}</p>
    </section>

    <div class="detail-hd">
      <h2>{{ t('dashboard.home.details') }}</h2>
      <span class="hint">{{ t('dashboard.home.detailsHint') }}</span>
    </div>

    <div>
      <SubTabs v-model="tab" :tabs="tabs" :aria-label="t('dashboard.viewLabel')" />

      <!-- this month shows the split, the trend and the payments; the plan changes, the schedule and the to-check list are on their own tabs (spec 010 D-1) -->
      <div class="tabbody">
      <p v-if="tab === 'month'" class="mhead hint">
        {{ t('calendar.kind.billing') }} <span :title="moved(dates.billing.shifted)">{{ md(dates.billing.date) }}<small v-if="note(dates.billing)">{{ note(dates.billing) }}</small></span>
        · <button class="linkish" type="button" @click="notReady('shell.lastSync')">{{ t('shell.lastSync') }} —</button>
      </p>
      <div v-if="tab === 'month'" class="flexcols stretch">
        <div class="col-main">
          <section class="card">
            <div class="card-hd"><h2>{{ t('dashboard.autoSplit', { day: dates.transfer.date.slice(8).replace(/^0/, '') }) }}</h2><span class="aux">{{ t('dashboard.takeHome', { pay: fmtMoney(monthNow.income.total) }) }}</span></div>
            <div class="rbar">
              <div class="ratio" role="img" :aria-label="t('dashboard.ratioLabel', { list: dist.rows.map((r) => `${r.name} ${pct(r.amount)}`).join(', ') })">
                <i v-for="r in barRows" :key="r.key" :style="{ flexGrow: r.amount, background: allocColor(r.key) }"></i>
              </div>
            </div>
            <div class="tbl">
              <table>
                <thead><tr><th scope="col">{{ t('dashboard.colTarget') }}</th><th scope="col" class="c-how">{{ t('dashboard.colHow') }}</th><th scope="col" class="n">{{ t('dashboard.colShare') }}</th><th scope="col" class="n">{{ t('dashboard.colAmount') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in dist.rows" :key="r.key">
                    <td><span class="tname"><i :style="{ background: allocColor(r.key) }"></i>{{ r.name }}</span></td>
                    <td class="muted c-how">{{ r.detail || kindDetail(r.kind) }}</td>
                    <td class="n muted num">{{ pct(r.amount) }}</td>
                    <td class="n" :class="fmtMoneyClass(r.amount)">{{ fmtMoney(r.amount) }}</td>
                  </tr>
                  <tr class="sum"><td>{{ t('dashboard.total') }}</td><td class="c-how"></td><td></td><td class="n">{{ fmtMoney(dist.rows.reduce((a, r) => a + r.amount, 0)) }}</td></tr>
                </tbody>
              </table>
            </div>
            <div v-if="dist.remainderTarget" class="splitbar">
              <span class="sl">{{ t('dashboard.splitName', { name: dist.remainderTarget.name }) }}</span>
              <span v-for="x in split" :key="x.name" class="pill num whitepill">{{ x.name }} {{ fmtMoney(x.amount) }}</span>
              <RouterLink class="manage" to="/pay?tab=sim">{{ t('dashboard.manageIn', { name: dist.remainderTarget.name }) }}</RouterLink>
            </div>
            <div v-else class="splitbar">
              <span class="sl">{{ spare < 0 ? t('dashboard.short') : t('dashboard.spare') }}</span>
              <b class="num" :class="{ 'neg-amt': spare < 0 }">{{ fmtMoney(Math.abs(spare)) }}</b>
              <span>{{ t('dashboard.inPayAccount') }}</span>
            </div>
          </section>

          <section class="card trendcard ph-hide">
            <div class="card-hd"><h2>{{ t('dashboard.trend') }}</h2><span class="aux">{{ t('dashboard.trendAux') }}</span></div>
            <div class="trend">
              <div class="axis" aria-hidden="true"><span v-for="t in ticks" :key="t">{{ t }}</span></div>
              <div class="plot" role="img" :aria-label="t('dashboard.trendLabel', { list: trend.map((b) => `${monthShort(Number(b.ym.slice(5)))} ${fmtMoney(b.v)}`).join(', ') })">
                <div class="bars">
                  <div v-for="b in trend" :key="b.ym" class="bar">
                    <span class="bv" :class="{ now: b.ym === ym }">{{ manText(b.v) }}</span>
                    <i :style="{ height: `${Math.max(2, (b.v / trendTop) * 100)}%` }" :class="{ now: b.ym === ym }"></i>
                  </div>
                </div>
                <div class="months"><span v-for="b in trend" :key="b.ym">{{ monthShort(Number(b.ym.slice(5))) }}</span></div>
              </div>
            </div>
            <p v-if="trendChange" class="tnote">{{ trendChange.plan ? t('dashboard.trendNote', { date: trendChange.when, name: trendChange.name, plan: trendChange.plan }) : t('dashboard.trendNotePrice', { date: trendChange.when, name: trendChange.name }) }} <span class="num" :class="trendChange.delta > 0 ? 'up' : 'down'">{{ signed(trendChange.delta) }}{{ t('dashboard.perMonth') }}</span></p>
          </section>
        </div>

        <section class="card col-side paycard">
          <div class="card-hd"><h2>{{ t('dashboard.upcomingPayments') }}</h2><RouterLink to="/spend/subs" class="aux">{{ t('dashboard.allSubs') }}</RouterLink></div>
          <template v-if="pays.length">
            <div class="psum"><span>{{ t('dashboard.fromToday') }}</span><b class="num">{{ t('dashboard.paySummary', { n: pays.length, amount: fmtMoney(paysSum) }) }}</b></div>
            <ul class="items pays">
              <li v-for="p in pays" :key="p.key">
                <span class="dbox"><b class="d num" :class="wcls(p.date)">{{ p.date.getDate() }}</b><small>{{ monthShort(p.date.getMonth() + 1) }} <b :class="wcls(p.date)">{{ weekdayShort(p.date) }}</b></small></span>
                <span class="pn"><b>{{ p.name }}</b><span>{{ p.sub }}</span></span>
                <span class="pa"><b class="num">{{ fmtMoney(p.krw) }}</b><span class="num" :class="{ soon: p.dday <= 3 }">D-{{ p.dday }}</span></span>
              </li>
            </ul>
            <template v-if="later.length">
              <div class="lhead">{{ t('dashboard.after31') }}</div>
              <ul class="later">
                <li v-for="p in later" :key="p.sub.id + p.date.getTime()"><span class="num ld">{{ String(p.date.getMonth() + 1).padStart(2, '0') }}/{{ String(p.date.getDate()).padStart(2, '0') }}</span><span class="grow">{{ p.sub.name }} · {{ p.reason === 'yearly' ? t('dashboard.yearly') : p.sub.plan || '—' }}</span><span class="num">{{ fmtMoney(p.krw) }}</span></li>
              </ul>
            </template>
          </template>
          <div v-else class="nopay">
            <span class="okbox"><Icon name="check" :stroke="1.9" /></span>
            <b>{{ t('dashboard.noPay31') }}</b>
            <span class="hint" v-if="nearest">{{ t('dashboard.nearest') }} <b class="num nb">{{ fmtDate(nearest.date) }} {{ nearest.sub.name }}</b></span>
            <span class="hint" v-else>{{ t('settings.general.noPayments') }}</span>
          </div>
          <div class="grow fill"></div>
          <div class="leftbox">
            <div class="lb-h"><span class="lb-t">{{ t('dashboard.leftTitle') }}</span><span class="num lb-f">{{ t('dashboard.leftFormula', { transfer: fmtMoney(left.transfer), paid: fmtMoney(left.paid) }) }}</span></div>
            <div class="lb-bar" :class="{ over: left.left < 0 }"><div :style="{ width: `${leftPct}%` }"></div></div>
            <div class="lb-n"><span>{{ left.left < 0 ? t('dashboard.leftShort') : t('dashboard.leftRange', { from: mdShort(left.from), to: mdShort(left.to) }) }}</span><b class="num" :class="left.left < 0 ? 'neg' : 'pos'">{{ fmtMoney(left.left) }}</b></div>
            <div class="lb-a">
              <RouterLink class="btn sm" to="/spend/general?add">{{ t('dashboard.addPayment') }}</RouterLink>
              <RouterLink class="btn sm ghost" to="/events">{{ t('dashboard.viewCalendar') }}</RouterLink>
            </div>
          </div>
        </section>
      </div>

      <div v-if="tab === 'pending'" class="aitab">
        <p class="intro">{{ t('dashboard.aiIntro') }}</p>
        <p v-if="proposals.error" class="save-err" role="alert">{{ proposals.error }} <button type="button" @click="proposals.error = ''">{{ t('common.close') }}</button></p>
        <div v-if="proposals.loaded && !cards.length" class="card nocards">
          <b>{{ t('pending.none') }}</b><span class="hint">{{ t('pending.noneHint') }}</span>
        </div>
        <section v-for="p in cards" :key="p.id" class="card prop" :class="{ wait: p.status === 'pending' }" :data-proposal="p.id" :aria-label="summary(p)">
          <div class="ph2">
            <span class="ico"><Icon name="sparkle" /></span>
            <div class="tt"><b>{{ proposalTitle(p) }}</b><small class="hint">{{ cardMeta(p) }}</small></div>
            <span class="pill" :class="shown(p).cls">{{ shown(p).label }}</span>
          </div>
          <table v-if="p.status === 'pending'" class="diff">
            <tbody>
              <tr v-for="(d, i) in diffRows(p)" :key="i">
                <td class="k">{{ d.k }}</td>
                <template v-if="d.to"><td class="from num">{{ d.from }}</td><td class="arr">→</td><td class="to num">{{ d.to }}</td></template>
                <td v-else colspan="3"></td>
              </tr>
            </tbody>
          </table>
          <div class="pfoot">
            <template v-if="p.status === 'pending'">
              <span class="note">{{ t('pending.expires', { at: when(p.expiresAt) }) }}<template v-if="p.confirm === 'chat'"> · {{ t('pending.inChat') }}</template></span>
              <p v-if="!p.keyUsable" class="small warn" role="note">{{ t('pending.keyGone') }}</p>
              <RouterLink class="btn sm ghost" to="/pending">{{ t('dashboard.detailsLink') }}</RouterLink>
              <button class="btn sm bad" type="button" :disabled="!!proposals.busy" @click="decide(p, 'reject')">{{ t('pending.rejectBtn') }}</button>
              <button class="btn sm pri" type="button" :disabled="!!proposals.busy || !p.keyUsable" @click="decide(p, 'apply')">{{ t('pending.confirmBtn') }}</button>
            </template>
            <template v-else>
              <span class="note">{{ proposals.decided[p.id] === 'reverted' ? t('pending.noteReverted') : t('pending.noteAfter') }}</span>
              <button v-if="canUndo(p)" class="btn sm" type="button" :disabled="!!proposals.busy" @click="undo(p.id)"><Icon name="undo" />{{ t('pending.undo') }}</button>
            </template>
          </div>
        </section>
      </div>

      <div v-if="tab === 'next'" class="grid2">
        <section class="card">
          <div class="card-hd"><h2>{{ t('dashboard.scheduledChanges') }}</h2><span class="aux">{{ t('dashboard.monthlyDelta') }}</span></div>
          <ul class="items">
            <li v-for="c in nextChanges" :key="c.id">
              <span class="when wide">{{ fmtDate(c.effective!) }} <b :class="wcls(parseDate(c.effective!))">{{ weekdayShort(parseDate(c.effective!)) }}</b></span>
              <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
              <b class="num" :class="changeDelta(c.id, c.effective!) > 0 ? 'up' : 'down'">{{ signed(changeDelta(c.id, c.effective!)) }}</b>
            </li>
            <li v-for="c in undated" :key="c.id" class="dim">
              <span class="when">{{ t('dashboard.tbd') }}</span>
              <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
              <span class="pill mute">{{ t('dashboard.notApplied') }}</span>
            </li>
          </ul>
          <p v-if="!nextChanges.length && !undated.length" class="empty">{{ t('dashboard.noChanges') }}</p>
        </section>
        <section class="card">
          <div class="card-hd"><h2>{{ t('dashboard.upcomingEvents') }}</h2><span class="aux">~ {{ horizon.replace('-', '. ') }}</span></div>
          <ul class="items">
            <li v-for="e in nextEvents" :key="e.id">
              <span class="when ev">{{ whenShort(e.when) }}</span>
              <span class="grow">{{ e.title }}</span>
              <span class="pill" :class="pillCls(e.state)">{{ e.kind }}</span>
            </li>
          </ul>
          <p v-if="!nextEvents.length" class="empty">{{ t('dashboard.noEvents') }}</p>
        </section>
      </div>

      <section v-if="tab === 'checks'" class="card checks">
        <div class="card-hd"><h2>{{ t('dashboard.checks') }}</h2><button class="btn sm add" type="button" :aria-label="t('dashboard.addCheckLabel')" @click="adding = 'todo'">{{ t('dashboard.addBtn') }}</button></div>
        <EditSheet v-if="chkEd.item.value" :key="chkEd.item.value.id || 'new'" :title="t('dashboard.editCheck')" :error="chkEd.error.value" :busy="chkEd.busy.value"
          :can-delete="!!chkEd.item.value.id" :delete-name="chkEd.item.value.text" @save="chkEd.save" @cancel="chkEd.close" @delete="chkEd.remove">
          <div class="field" style="grid-column:1/-1"><label for="ck-text">{{ t('dashboard.details') }}</label><input id="ck-text" v-model="chkEd.item.value.text" class="in"></div>
        </EditSheet>
        <ul class="items">
          <li v-for="c in store.checks" :key="c.id" class="ck">
            <input :id="'chk-' + c.id" :checked="c.done" type="checkbox" @change="saveItem('checks', { ...c, done: !c.done }).catch(() => {})">
            <label :for="'chk-' + c.id" :class="{ done: c.done }">{{ c.text }}</label>
            <button class="btn sm ghost" type="button" :aria-label="t('common.editLabel', { name: c.text })" @click="chkEd.open(c)">{{ t('common.edit') }}</button>
          </li>
        </ul>
        <p v-if="!store.checks.length" class="empty">{{ t('dashboard.noChecks') }}</p>
      </section>
      </div>
    </div>

    <AddRecord v-if="adding" :start="adding" @close="adding = null" />
  </section>
</template>

<style scoped>
/* 3초 (spec 014 S-1; the canvas board NextHome) */
.hero{padding:20px 22px;display:flex;flex-direction:column;gap:16px}
.h-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}
.h-t{display:inline-flex;align-items:center;gap:8px}
.h-t b{font-size:15px}
.h-big{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px}
.yv{font-size:44px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:var(--primary-text)}
.yv.short,.h-short{color:var(--neg-text)}
.h-short{font-size:15px}
.h-diff{font-size:14px;font-weight:600}
.plus{color:var(--primary-text)}
.minus{color:var(--neg-text)}
.eq{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr) 28px minmax(0,1fr);align-items:stretch;gap:8px}
.eq .op{display:grid;place-items:center;font-size:22px;font-weight:600;color:var(--subtle)}
.eqc{border:1px solid var(--border);border-radius:var(--r-card);padding:12px 14px;display:flex;flex-direction:column;gap:4px;background:var(--surface);min-width:0;color:var(--text);text-decoration:none}
a.eqc:hover{background:var(--surface-2)}
.eqc .hint{overflow-wrap:anywhere}
.eqc.yc{border:2px solid var(--primary);background:var(--primary-tint);padding:11px 13px}
.eqc.yc .lab,.eqc.yc .big{color:var(--primary-text)}
.eqc.yc.short{border-color:var(--neg);background:var(--neg-soft)}
.eqc.yc.short .lab,.eqc.yc.short .big{color:var(--neg-text)}
.lab{font-size:12px;font-weight:600;color:var(--muted)}
.big{font-size:22px;font-weight:700;letter-spacing:-.01em}
.sbar{display:flex;height:14px;gap:2px;border-radius:var(--r-badge);overflow:hidden}
.sbar span{display:block;min-width:2px}
.yeo{background:repeating-linear-gradient(45deg,var(--primary-soft) 0 4px,var(--primary-tint) 4px 8px);box-shadow:inset 0 0 0 1px var(--primary)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:12px;color:var(--muted)}
.legend > span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:10px;height:10px;border-radius:var(--r-tag);flex:none}
.legend b{color:var(--text-2)}
.legend b.plus{color:var(--primary-text)}
.legend b.minus{color:var(--neg-text)}
.io{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:20px;align-items:stretch}
.iocard{display:flex;flex-direction:column;min-width:0}
.lrow{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--divider);color:var(--text);text-decoration:none}
.lrow.lhd{padding-top:8px;padding-bottom:8px;font-size:12px;font-weight:600;color:var(--subtle);background:var(--surface-2)}
.lrow.lsum{background:var(--surface-2);border-bottom:0}
.osum{margin-top:auto;border-top:1px solid var(--border)}
a.lrow:hover{background:var(--surface-2)}
.l-n{flex:1;min-width:0;display:flex;flex-direction:column}
.l-n b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.l-n .pill{padding:0 6px}
.l-e{width:104px;flex:none;text-align:right;color:var(--muted)}
.l-g{width:120px;flex:none;text-align:right;display:flex;flex-direction:column}
.l-g small{font-size:12px}
.sw{width:10px;height:10px;border-radius:var(--r-tag);flex:none}
.amt{margin-left:auto;text-align:right;white-space:nowrap}
.chev{width:16px;height:16px;flex:none;color:var(--subtle)}
.osum .amt{margin-right:28px}
.iofoot{margin-top:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:12px 18px;border-top:1px solid var(--border)}
.card-hd.wrap{flex-wrap:wrap}
.why{margin:0;padding:10px 18px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
.why.bad{color:var(--neg-text)}
.detail-hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:8px}
.detail-hd h2{margin:0;font-size:16px}
.mhead{margin:0}
.grow{flex-grow:1;min-width:0}
@media (max-width:760px){
  .hero{padding:16px}
  .yv{font-size:36px}
  .eq{grid-template-columns:minmax(0,1fr)}
  .eq .op{font-size:16px;height:16px}
  .lrow{padding:10px 14px;gap:8px}
  .l-e{width:84px}
  .l-g{width:96px}
}
.col-main{flex:2 1 600px;display:flex;flex-direction:column;gap:20px}
.col-side{flex:1 1 340px}
.stretch{align-items:stretch}
.rbar{padding:16px 18px 6px}
.ratio{display:flex;height:12px;border-radius:var(--r-tag);overflow:hidden;gap:2px}
.ratio i{display:block;min-width:2px}
.tname{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.tname i{width:10px;height:10px;border-radius:var(--r-tag);flex:none}
tr.sum td{font-weight:600;border-bottom:0}
tr.sum td.n{font-weight:700}
.splitbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card);font-size:12px}
.splitbar .sl{font-weight:600;color:var(--text-2)}
.whitepill{background:var(--surface);border:1px solid var(--border);color:var(--text-2)}
.manage{margin-left:auto;color:var(--primary-text);font-weight:600;text-decoration:none}
.manage:hover{text-decoration:underline}
.trendcard{display:flex;flex-direction:column}
.trend{display:flex;gap:12px;padding:16px 18px 14px;min-height:200px}
.axis{display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:var(--subtle);text-align:right;font-variant-numeric:tabular-nums;padding-bottom:22px}
.plot{flex-grow:1;display:flex;flex-direction:column;gap:6px;min-width:0}
.bars{flex-grow:1;min-height:150px;display:flex;align-items:flex-end;gap:18px;border-bottom:1px solid var(--border-strong);background:linear-gradient(var(--fill) 1px,transparent 1px) 0 0/100% 33.33%}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;min-width:0}
.bar i{display:block;width:100%;max-width:48px;background:var(--primary-mid);border-radius:var(--r-tag) var(--r-tag) 0 0}
.bar i.now{background:var(--primary)}
.bv{font-size:11px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.bv.now{color:var(--primary-text)}
.months{display:flex;gap:18px;font-size:12px;color:var(--subtle)}
.months span{flex:1;text-align:center}
.tnote{margin:0;padding:10px 18px;border-top:1px solid var(--divider);font-size:12px;color:var(--muted)}
.paycard{display:flex;flex-direction:column}
.psum{display:flex;justify-content:space-between;padding:8px 18px;background:var(--surface-2);border-bottom:1px solid var(--divider);font-size:12px;color:var(--muted)}
.psum b{color:var(--text)}
.pays > li{gap:12px;padding:10px 18px}
.dbox{width:44px;flex-shrink:0;text-align:center;border:1px solid var(--border);border-radius:var(--r-ctl);padding:3px 0;line-height:1.2}
.dbox .d{display:block;font-size:16px;font-weight:700}
.dbox small{font-size:11px;color:var(--subtle)}
.dbox small b{font-weight:700}
/* Saturday blue, Sunday red: the day number and the weekday only (the user, 2026-11-15; canvas) */
.dbox b.sat{color:var(--sat)}
.dbox b.sun{color:var(--sun)}
.pn{flex-grow:1;display:flex;flex-direction:column;min-width:0}
.pn b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pn span{font-size:12px;color:var(--subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap}
.pa b{font-weight:400}
.pa span{font-size:12px;font-weight:600;color:var(--subtle)}
.pa span.soon{color:var(--accent-text)}
.lhead{padding:10px 18px 6px;font-size:11px;font-weight:600;color:var(--subtle);letter-spacing:.04em}
.later{list-style:none;margin:0;padding:0 0 4px}
.later li{display:flex;align-items:center;gap:12px;padding:8px 18px;color:var(--muted);font-size:13px}
.later .ld{width:44px;text-align:center;font-size:12px}
.nopay{padding:28px 18px 8px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.okbox{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-ctl);background:var(--primary-soft);color:var(--primary-text)}
.okbox svg{width:20px;height:20px}
.nb{color:var(--text-2)}
.fill{min-height:16px}
.leftbox{margin:0 18px 16px;padding:12px 14px;border:1px dashed var(--border-strong);border-radius:var(--r-card);display:flex;flex-direction:column;gap:8px}
.lb-h{display:flex;justify-content:space-between;gap:8px;font-size:12px}
.lb-t{font-weight:600;color:var(--text-2)}
.lb-f{color:var(--muted)}
.lb-bar{height:6px;border-radius:var(--r-tag);background:var(--fill);overflow:hidden}
.lb-bar div{height:100%;background:var(--primary)}
.lb-bar.over div{background:var(--neg)}
.lb-n{display:flex;justify-content:space-between;font-size:12px;color:var(--subtle)}
.lb-n .pos{color:var(--primary-text)}
.lb-n .neg{color:var(--neg-text)}
.lb-a{display:flex;gap:8px;margin-top:2px}
.when{width:52px;flex:none;font:12px var(--f-mono);color:var(--muted)}
.when.wide{width:auto;min-width:104px}
.when.wide b{font-family:var(--f-sans, inherit);font-weight:700}
.when.ev{width:auto;min-width:64px;white-space:nowrap}
.linkish{all:unset;cursor:pointer}
.linkish:hover{text-decoration:underline}
.linkish:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px;border-radius:var(--r-ctl)}
.mnav{display:none;align-items:center;gap:8px;padding:6px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pop)}
.mn-c{flex:1;text-align:center;line-height:1.3}
.mn-c b{display:block;font-size:17px}
.mnav .btn{width:44px;height:44px;flex:none;color:var(--muted)}
.mnav .btn svg{width:20px;height:20px}
@media (max-width:760px){.mnav{display:flex}.ph-hide{display:none !important}.dash-ph :deep(h1){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@media (max-width:760px){.c-how{display:none}.bars,.months{gap:8px}}
.items > li.dim{opacity:.6}
.tabbody{display:flex;flex-direction:column;gap:20px;margin-top:20px}
.aitab{display:flex;flex-direction:column;gap:12px;max-width:920px}
.intro{margin:0;font-size:13px;color:var(--muted)}
.nocards{display:flex;flex-direction:column;align-items:center;gap:6px;padding:36px 18px;text-align:center}
.prop{display:flex;flex-direction:column}
.prop.wait{border-color:var(--accent-line)}
.ph2{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--divider)}
.ico{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:var(--r-ctl);background:var(--accent-soft);color:var(--accent-text)}
.ico svg{width:15px;height:15px}
.tt{flex:1 1 200px;min-width:0;display:flex;flex-direction:column}
.tt b{overflow-wrap:anywhere}
.diff{width:100%;border-collapse:collapse;font-size:13px}
.diff td{padding:8px 12px;border-bottom:1px solid var(--divider)}
.diff td.k{width:34%;padding-left:18px;color:var(--muted)}
.diff td.from{color:var(--subtle);text-decoration:line-through}
.diff td.arr{color:var(--subtle);padding:8px 0}
.diff td.to{padding-right:18px;font-weight:600}
.pfoot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 18px;background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card)}
.pfoot .note{flex:1 1 200px;font-size:12px;color:var(--muted)}
.pfoot .warn{flex-basis:100%;color:var(--neg-text);margin:0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr));gap:20px}
.checks{max-width:760px}
.ck{gap:12px !important;padding:0 18px !important;min-height:46px}
.ck input{width:16px;height:16px;margin:0;accent-color:var(--primary)}
.ck label{flex-grow:1;cursor:pointer}
.ck label.done{color:var(--subtle);text-decoration:line-through}
@media (max-width:760px){.diff td.k{width:auto}.diff{white-space:nowrap}}
</style>
