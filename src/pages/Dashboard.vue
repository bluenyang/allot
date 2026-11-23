<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onBeforeUnmount, ref, watch } from 'vue'
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
  addYm, clusterDots, leftoverAfterTransfer, monthDates, monthMoney, parseDate, paysAfter31, splitRemainder, today, unallocated, upcomingPayments, upcomingSpendRounds, ymd, ymOf, ymRange,
} from '../lib/calc'
import {
  canUndo, changed, decide, fieldName, listFor, loadProposals, money, proposals, proposalTitle, rowFields, rowLabel, rowTitle, shown, summary, tableName, undo, when, worded,
  type Proposal,
} from '../lib/proposals'
import { localToday } from '../lib/now'

const AddRecord = defineAsyncComponent(() => import('../components/AddRecordModal.vue'))

// 현황 (spec 007 S-4, redrawn by spec 010 S-6): the canvas dashboard on the data we have. Not in the
// app yet (S-3): the last sync — it is "—". '결제 추가' opens the spending add editor (/spend/general?add) and
// the remainder's '관리' goes to the pay page's simulation (spec 013 S-16); '내보내기' saves the shown month's
// summary as a CSV made here from the state (S-17).
// "고정 지출 추이" looks ahead six months (the past is not stored; the user approved the change on 2026-11-15).
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
const pct = (n: number) => (store.settings.netPay > 0 ? `${((n / store.settings.netPay) * 100).toFixed(1)}%` : '—')
// What the pay leaves when no target takes the remainder (negative = short).
const spare = computed(() => unallocated(dist.value))
const barRows = computed(() => dist.value.rows.filter((x) => x.amount > 0))

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
// KPI 2 side note: how the next month differs from this one (hidden at 0; down when it falls).
const nextDiff = computed(() => {
  const d = Math.round((trend.value[1]?.v ?? 0) - (trend.value[0]?.v ?? 0))
  return d === 0 ? null : { d, label: t(d > 0 ? 'dashboard.nextUp' : 'dashboard.nextDown', { month: monthShort(Number(trend.value[1]!.ym.slice(5))), amount: fmtMoney(Math.abs(d)) }) }
})
const trendLast = computed(() => trend.value.at(-1)!.ym)

const tab = ref('month')
const horizon = computed(() => addYm(ym.value, 9))
const nextChanges = computed(() =>
  store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) >= ym.value).sort((a, b) => (a.effective! < b.effective! ? -1 : 1)),
)
const undated = computed(() => store.planChanges.filter((c) => !c.effective))
const nextEvents = computed(() => store.events.filter((e) => e.state !== 'done' && e.when.slice(0, 7) <= horizon.value))
const openChecks = computed(() => store.checks.filter((c) => !c.done).length)
const needCount = computed(() => store.pendingProposals + openChecks.value)
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
/** The 31-day strip: payments whose dots would touch (by the strip's rendered width) share one dot with a count (spec 010 A-27). */
const DOT_PX = 18
const stripEl = ref<HTMLElement | null>(null)
const stripW = ref(240)
let ro: ResizeObserver | undefined
watch(stripEl, (el) => {
  ro?.disconnect()
  if (!el) return
  stripW.value = el.clientWidth || stripW.value
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => { stripW.value = el.clientWidth || stripW.value }); ro.observe(el) }
}, { flush: 'post' })
onBeforeUnmount(() => ro?.disconnect())
const payText = (p: Pay) => `${mdd(p.date)} ${p.name} ${fmtMoney(p.krw)}`
const dots = computed(() => clusterDots(pays.value.map((p) => p.dday), stripW.value, DOT_PX).map((c, i) => {
  const ms = c.members.map((k) => pays.value[k]!)
  const text = ms.length === 1 ? payText(ms[0]!) : `${t('dashboard.paymentCount', { n: ms.length })}: ${ms.map(payText).join(' · ')}`
  return { id: ms.map((m) => m.key).join('+'), left: `${c.pct}%`, first: i === 0, n: ms.length, text }
}))
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
    <PageHeader :title="t('dashboard.title', { year, month: monthName })" class="dash-ph">
      <template #desc>
        {{ t('calendar.kind.pay') }} <span :title="moved(dates.pay.shifted)">{{ md(dates.pay.date) }}<small v-if="note(dates.pay)">{{ note(dates.pay) }}</small></span>
        · {{ t('calendar.kind.transfer') }} <span :title="moved(dates.transfer.shifted)">{{ md(dates.transfer.date) }}<small v-if="note(dates.transfer)">{{ note(dates.transfer) }}</small></span>
        · {{ t('calendar.kind.billing') }} <span :title="moved(dates.billing.shifted)">{{ md(dates.billing.date) }}<small v-if="note(dates.billing)">{{ note(dates.billing) }}</small></span>
        · <button class="linkish" type="button" @click="notReady('shell.lastSync')">{{ t('shell.lastSync') }} —</button>
      </template>
      <button class="btn ph-hide" type="button" :title="t('dashboard.exportLabel', { month: monthTitle })" @click="exportCsv"><Icon name="download" />{{ t('shell.export') }}</button>
      <button class="btn pri" type="button" @click="adding = 'todo'"><Icon name="plus" />{{ t('shell.addRecord') }}</button>
    </PageHeader>

    <section class="kpis" :aria-label="t('dashboard.summaryLabel')">
      <div v-if="dist.remainderTarget" class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('dashboard.leftThisMonth', { name: dist.remainderTarget.name }) }}</span><span class="pill ok num">{{ pct(dist.remainder) }}</span></div>
        <div class="k-v"><span class="num v" :class="fmtMoneyClass(dist.remainder)">{{ fmtMoney(dist.remainder) }}</span><span class="num hint k-side">{{ t('dashboard.ofPay', { pay: fmtMoney(store.settings.netPay) }) }}</span></div>
        <div class="k-bar bars6" role="img" :aria-label="t('dashboard.ratioBarLabel')"><span v-for="r in barRows" :key="r.key" :style="{ flexGrow: r.amount, background: allocColor(r.key) }"></span></div>
        <div class="k-f"><span>{{ t('dashboard.basis') }}</span><span>{{ t('dashboard.distOn', { date: md(dates.transfer.date) }) }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('dashboard.subsMonthly') }}</span><span class="pill mute">{{ t('dashboard.active', { n: activeSubs }) }}</span></div>
        <div class="k-v"><span class="num v">{{ fmtMoney(subsMonthly) }}</span><span v-if="nextDiff" class="num k-side diff" :class="nextDiff.d > 0 ? 'up' : 'down'">{{ nextDiff.label }}</span></div>
        <div class="k-bar minis" role="img" :aria-label="t('dashboard.subsBarsLabel')"><span v-for="(b, i) in trend" :key="b.ym" :class="{ now: i === 0 }" :style="{ height: `${Math.max(8, (b.v / trendMax) * 100)}%` }"></span></div>
        <div class="k-f"><span>{{ t('dashboard.transferAmt', { amount: fmtMoney(dist.subscriptions || xfer.transfer) }) }}</span><span>{{ monthShort(Number(trend[0]!.ym.slice(5))) }} → {{ monthShort(Number(trendLast.slice(5))) }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('dashboard.dueIn31') }}</span><span v-if="pays.length" class="pill acc">D-{{ pays[0]!.dday }}</span></div>
        <div class="k-v"><span class="num v">{{ fmtMoney(paysSum) }}</span><span class="hint k-side">{{ t('dashboard.paymentCount', { n: pays.length }) }}</span></div>
        <div ref="stripEl" class="k-bar dots" role="group" :aria-label="t('dashboard.dotsLabel')"><i v-for="d in dots" :key="d.id" role="img" :class="{ first: d.first, multi: d.n > 1 }" :style="{ left: d.left }" :title="d.text" :aria-label="d.text">{{ d.n > 1 ? d.n : '' }}</i></div>
        <div class="k-f"><span v-if="pays.length">{{ t('dashboard.nextPay', { name: pays[0]!.name, amount: fmtMoney(pays[0]!.krw) }) }}</span><span v-else></span><span v-if="pays.length">{{ mdd(pays[0]!.date) }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('dashboard.needCheck') }}</span><button class="btn ghost sm k-go" type="button" @click="tab = 'pending'">{{ t('dashboard.view') }}</button></div>
        <div class="k-v"><span class="num v" :class="{ sig: needCount > 0 }">{{ needCount }}<small class="unit"> {{ t('dashboard.countUnit') }}</small></span></div>
        <div class="k-lines">
          <div><span class="sq acc"></span><span class="grow">{{ t('dashboard.aiWaiting') }}</span><b class="num">{{ store.pendingProposals }}</b></div>
          <div><span class="sq"></span><span class="grow">{{ t('dashboard.checks') }}</span><b class="num">{{ openChecks }}</b></div>
        </div>
      </div>
    </section>

    <div>
      <SubTabs v-model="tab" :tabs="tabs" :aria-label="t('dashboard.viewLabel')" />

      <!-- this month shows the split, the trend and the payments; the plan changes, the schedule and the to-check list are on their own tabs (spec 010 D-1) -->
      <div class="tabbody">
      <div v-if="tab === 'month'" class="flexcols stretch">
        <div class="col-main">
          <section class="card">
            <div class="card-hd"><h2>{{ t('dashboard.autoSplit', { day: dates.transfer.date.slice(8).replace(/^0/, '') }) }}</h2><span class="aux">{{ t('dashboard.takeHome', { pay: fmtMoney(store.settings.netPay) }) }}</span></div>
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
.unit{font-size:14px;font-weight:500;color:var(--muted)}
/* KPI cards (spec 010 HM-6..11) */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.kpi{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.k-h{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:22px}
.k-l{font-size:12px;font-weight:600;color:var(--muted)}
.k-v{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.k-v .v{font-size:24px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
.k-v .v.sig{color:var(--accent-text)}
.k-side{font-size:12px;white-space:nowrap}
.k-side.diff{font-weight:600}
.k-f{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--subtle)}
.k-bar{height:6px}
.bars6{display:flex;gap:2px;border-radius:var(--r-tag);overflow:hidden}
.bars6 span{display:block;min-width:2px}
.minis{display:flex;align-items:flex-end;gap:4px;height:24px}
.minis span{flex:1;background:var(--border-strong);border-radius:1px}
.minis span.now{background:var(--primary)}
.dots{position:relative;height:24px}
.dots::before{content:"";position:absolute;left:0;right:0;top:11px;height:2px;background:var(--border)}
.dots i{position:absolute;top:7px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--primary);border:2px solid var(--surface);box-sizing:content-box}
.dots i.multi{top:3px;width:12px;height:12px;margin-left:-8px;display:grid;place-items:center;font:700 9px/1 var(--f-ui);font-style:normal;color:var(--primary-ink)}
.dots i.first{top:6px;width:12px;height:12px;margin-left:-6px;background:var(--accent)}
.dots i.first.multi{top:3px;width:12px;height:12px;margin-left:-8px;color:var(--accent-ink)}
.k-go{height:22px;padding:0 6px;font-size:12px;color:var(--primary-text)}
.k-lines{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-2)}
.k-lines > div{display:flex;align-items:center;gap:6px}
.sq{width:6px;height:6px;border-radius:1px;background:var(--subtle);flex:none}
.sq.acc{background:var(--accent)}
.grow{flex-grow:1;min-width:0}
@media (max-width:760px){
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .kpi{padding:12px;gap:4px}
  .k-bar,.k-f,.k-lines,.k-side,.k-h > :not(:first-child){display:none}
  .k-v .v{font-size:18px}
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
