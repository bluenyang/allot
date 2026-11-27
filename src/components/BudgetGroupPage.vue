<script setup lang="ts">
// 저축 · 투자 (spec 013 S-1, S-3, S-4; canvas AppSave · AppInvest): the menu's items are the bank accounts whose
// `group` is this menu. `groupAt` gives the month: amount split = each item's monthly (or phase) amount;
// ratio split = the phase's total for the menu's target × the item's ratio, rounded to 1,000. The split is a
// setting (`savingSplit` / `investSplit`), saved the moment it changes. Without the menu's target the page
// offers to create it; the list still works and says it is not in the pay split yet. KPIs from the data rc.1
// has (spec "범위 밖"): Savings = saved so far and in a year (balance records + projection, no interest) and the
// way to the goals; Investment = sent this year (planned), the annual-limit use, the next transfer.
// rc.2 (spec 013 rev 1): this month's adjustment of the menu's target (S-14) — the month reads it, and 총액 수정 offers
// "이번 달만" (both splits) beside "구간 끝까지" (ratio split, as before); the second tab (S-15): Savings 만기 일정,
// Investment 월별 기록.
// spec 014 S-8 (W-6): the first KPI row is what the menu sends every month — this month's amount with the items it is
// made of, and the next transfer (Investment had it; Savings gets the same card) — and the cards about balances, totals
// so far, projections and goals (saved so far, in a year, to the goals; sent this year, the annual limits) move to the
// second row. No value is worked out differently.
import { computed, ref } from 'vue'
import { t, type MessageKey } from '../i18n'
import BudgetPage from './BudgetPage.vue'
import BudgetItemEditor from './BudgetItemEditor.vue'
import BudgetAdjustEditor from './BudgetAdjustEditor.vue'
import BudgetHistory from './BudgetHistory.vue'
import BudgetMaturity from './BudgetMaturity.vue'
import Seg from './Seg.vue'
import { saveItem, saveSettings, store } from '../lib/store'
import { showToast } from '../lib/toast'
import { fmtDate, fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { rateText } from '../lib/labels'
import { addYm, groupAt, groupValue, nextTransferYm, phaseAt, phaseNumbers, projectAccount, yearContribution, ymd } from '../lib/calc'
import { monthDatesOf, thisYm } from '../lib/month'
import {
  accountLine, adjustOf, adjustStart, baseAmount, itemColor, limitTone, monthParts, monthPlans, pctOf, shareOf, sumStatus, yearSent,
  type BudgetCell, type BudgetKpi, type BudgetRow, type LimitTone, type Tone,
} from '../lib/budget-page'
import type { Account, BudgetGroup, SplitMode } from '../data/types'
import { localToday } from '../lib/now'

const props = defineProps<{ group: BudgetGroup }>()
const saving = props.group === 'saving'
const m = (key: string, vars?: Record<string, string | number>) => t(`budget.${props.group}.${key}` as MessageKey, vars)
const cat = computed(() => m('cat'))

const now = thisYm()
const todayStr = ymd(localToday())
// the yearly limit counts a calendar year on every month basis (spec 018 S-3)
const year = Number(todayStr.slice(0, 4))
const g = computed(() => groupAt(props.group, store.accounts, store.phases, store.targets, store.settings, now, store.monthAdjusts))
const items = computed(() => g.value.rows.map((r) => r.account))
const phase = computed(() => phaseAt(store.phases, now))
const numbers = computed(() => phaseNumbers(store.phases))
const target = computed(() => g.value.target)
const ratio = computed(() => g.value.mode === 'ratio')
/** This month's adjustment of the menu's target (S-14) and the value it replaces. */
const adjust = computed(() => (target.value ? adjustOf(store.monthAdjusts, now, target.value.id) : undefined))
// in the ratio split the value it replaces is the phase's total, as the strip shows the total (review rc2-1 F-1)
const adjustBase = computed(() => (adjust.value && target.value ? adjustStart(store, now, target.value).base : 0))
/** What the target gets this month: the ratio split's total, or the items' sum (an adjustment of the amount split replaces it). */
const targetValue = computed(() => (ratio.value ? g.value.total : groupValue(g.value, adjust.value)))
/** Holidays for the dates and projections: from the oldest balance record of the menu's accounts to a year ahead. */
const off = computed(() => {
  const ids = new Set(items.value.map((a) => a.id))
  // a range of dates for the holidays, by calendar months (the months themselves are read with the store's own list)
  const first = store.balances.filter((b) => ids.has(b.accountId)).reduce((lo, b) => (b.date < lo ? b.date : lo), `${addYm(now, -1)}-01`)
  return offDays(store.holidaySets, `${first.slice(0, 7)}-01`, `${addYm(now, 14)}-01`) ?? new Set<string>()
})
const nextYm = computed(() => nextTransferYm(todayStr, store.settings, store.off ?? off.value, store.cards))
// that month's transfer date: the transfer day inside its period
const nextDate = computed(() => monthDatesOf(nextYm.value).transfer.date)

// ---------- the strip ----------
const linked = computed(() => (target.value?.accountId ? store.accounts.find((a) => a.id === target.value!.accountId) ?? null : null))
const cells = computed<BudgetCell[]>(() => {
  const p = phase.value
  const a = linked.value
  return [
    {
      label: t('budget.fromPay', { name: target.value?.name ?? m('targetName') }),
      value: fmtMoney(targetValue.value),
      sub: adjust.value ? t('budget.adjustedSub', { amount: fmtMoney(adjustBase.value) })
        : ratio.value ? (p ? t('budget.total.nowLine', { n: numbers.value[p.id] ?? 0, phase: p.name }) : t('budget.total.noPhase')) : t('budget.itemsTotal'),
      action: target.value ? { label: t('budget.editTotal'), aria: t('budget.editTotalOf', { cat: cat.value }) } : undefined,
    },
    {
      label: t('budget.account'), value: a ? a.name : t('budget.notLinked'),
      sub: a ? accountLine(a) || undefined : t('budget.itemAccounts', { n: items.value.length }),
    },
    { label: t('budget.day'), value: t('budget.dayValue', { day: store.settings.transferDay }), sub: t('budget.nextTransfer', { date: fmtDate(nextDate.value) }) },
  ]
})
const splitOpts = computed(() => [{ id: 'amount', label: t('budget.splitAmount') }, { id: 'ratio', label: t('budget.splitRatio') }])
async function setSplit(mode: SplitMode) {
  try {
    await saveSettings(saving ? { savingSplit: mode } : { investSplit: mode })
    showToast(t('budget.splitSaved'))
  } catch { /* the store shows why and puts the saved value back */ }
}
const creating = ref(false)
async function createTarget() {
  creating.value = true
  try {
    const saved = await saveItem('targets', { id: '', name: m('targetName'), kind: props.group, accountId: null })
    showToast(t('budget.targetCreated', { name: saved.name }))
  } catch { /* shown by the store */ } finally {
    creating.value = false
  }
}

// ---------- KPIs ----------
/** Each item's projection from its last balance record (null without one): this month's end and a year on. */
const proj = computed(() => new Map(items.value.map((a) => [a.id, projectAccount(a, store, off.value, now, 12)] as const)))
const paidThisYear = computed(() => new Map(items.value.map((a) => [a.id, yearContribution(a, store, off.value, year)] as const)))
const toneOf = (x: LimitTone): Tone => (x === 'over' ? 'bad' : x === 'near' ? 'warn' : 'ok')

/** This month's amount and what it is made of, and the next transfer: the first row (spec 014 S-8). */
const monthKpis = computed<BudgetKpi[]>(() => {
  const sum = g.value.sum
  const parts = monthParts(g.value.rows.map((r) => ({ name: r.account.name, amount: r.amount })))
  const next = groupAt(props.group, store.accounts, store.phases, store.targets, store.settings, nextYm.value, store.monthAdjusts)
  return [
    {
      label: m('kpiMonth'), value: fmtMoney(sum), sub: m('kpiMonthSub', { n: g.value.rows.filter((r) => r.amount > 0).length }),
      progs: [
        ...parts.shown.map((r) => ({ label: r.name, value: fmtMoney(r.amount), w: shareOf(r.amount, sum) })),
        ...(parts.rest ? [{ label: t('budget.kpiMore', { n: parts.rest.n }), value: fmtMoney(parts.rest.amount), w: shareOf(parts.rest.amount, sum) }] : []),
      ],
    },
    { label: m('kpiNext'), value: fmtDate(nextDate.value), sub: m('kpiNextSub', { amount: fmtMoney(next.sum), n: next.rows.filter((r) => r.amount > 0).length }) },
  ]
})

/** Balances, totals so far, projections and goals: the second row (spec 014 S-8). */
const laterKpis = computed<BudgetKpi[]>(() => {
  const list = items.value
  if (saving) {
    const withRec = list.filter((a) => proj.value.get(a.id))
    const cur = (a: Account) => proj.value.get(a.id)?.[0]?.end ?? 0
    const later = (a: Account) => proj.value.get(a.id)?.[11]?.end ?? 0
    const goals = withRec.filter((a) => a.goal !== null && a.goal !== undefined)
    return [
      withRec.length
        ? { label: m('kpiSaved'), value: fmtMoney(withRec.reduce((s, a) => s + cur(a), 0)), sub: m('kpiSavedSub', { n: withRec.length }) }
        : { label: m('kpiSaved'), value: '—', sub: m('kpiNoRecord') },
      withRec.length
        ? { label: m('kpiYear'), value: fmtMoney(withRec.reduce((s, a) => s + later(a), 0)), sub: m('kpiYearSub', { ym: addYm(now, 11) }) }
        : { label: m('kpiYear'), value: '—', sub: m('kpiNoRecord') },
      goals.length
        ? {
            label: m('kpiGoal'), value: fmtMoney(goals.reduce((s, a) => s + Math.max(0, a.goal! - cur(a)), 0)), sub: m('kpiGoalSub', { n: goals.length }),
            progs: goals.map((a) => ({ label: a.name, value: `${fmtMoney(cur(a))} / ${fmtMoney(a.goal!)}`, w: shareOf(cur(a), a.goal!) })),
          }
        : { label: m('kpiGoal'), value: m('kpiGoalNone'), sub: m('kpiGoalNoneSub') },
    ]
  }
  const limited = list.filter((a) => a.annualLimit !== null && a.annualLimit !== undefined)
  const tones = limited.map((a) => limitTone(paidThisYear.value.get(a.id) ?? 0, a.annualLimit!))
  const worst: LimitTone = tones.includes('over') ? 'over' : tones.includes('near') ? 'near' : 'ok'
  return [
    { label: m('kpiYear'), value: fmtMoney(yearSent(props.group, store.accounts, store.phases, store.targets, store.settings, now, store.monthAdjusts)), sub: m('kpiYearSub', { m: Number(now.slice(5)) }) },
    limited.length
      ? {
          label: m('kpiLimit'), value: m(worst === 'over' ? 'limitOver' : worst === 'near' ? 'limitNear' : 'limitOk'), tone: toneOf(worst), sub: m('kpiLimitSub', { n: limited.length }),
          progs: limited.map((a, i) => {
            const paid = paidThisYear.value.get(a.id) ?? 0
            return { label: a.name, value: `${fmtMoney(paid)} / ${fmtMoney(a.annualLimit!)}`, w: shareOf(paid, a.annualLimit!), tone: toneOf(tones[i]!) }
          }),
        }
      : { label: m('kpiLimit'), value: m('kpiLimitNone'), sub: m('kpiLimitNoneSub') },
  ]
})
const kpis = computed<BudgetKpi[]>(() => [...monthKpis.value, ...laterKpis.value.map((k) => ({ ...k, later: true }))])

// ---------- the list ----------
const whole = computed(() => (ratio.value ? g.value.total : g.value.sum))
const rows = computed<BudgetRow[]>(() => g.value.rows.map(({ account: a, amount }, i) => {
  const flags: string[] = []
  if (a.from && a.from > now) flags.push(t('budget.fromMonth', { ym: a.from }))
  if (a.stopFrom) flags.push(t('budget.stopped', { ym: a.stopFrom }))
  const base = baseAmount(a, phase.value)
  let meta: string
  let prog: BudgetRow['prog']
  if (saving) {
    meta = [a.rate ? rateText(a.rate) : '', a.term ?? '', a.goal !== null && a.goal !== undefined ? m('metaGoal', { amount: fmtMoney(a.goal) }) : '', a.note ?? ''].filter(Boolean).join(' · ')
    const p = proj.value.get(a.id)
    const cur = p?.[0]?.end ?? 0
    prog = !p ? { w: null, text: m('progNoRecord') }
      : a.goal !== null && a.goal !== undefined ? { w: shareOf(cur, a.goal), text: m('progGoal', { cur: fmtMoney(cur), goal: fmtMoney(a.goal), pct: Math.round(shareOf(cur, a.goal)) }) }
      : { w: null, text: m('progSaved', { cur: fmtMoney(cur) }) }
  } else {
    meta = [a.annualLimit !== null && a.annualLimit !== undefined ? m('metaLimit', { amount: fmtMoney(a.annualLimit) }) : m('metaNoLimit'), a.note ?? ''].filter(Boolean).join(' · ')
    const paid = paidThisYear.value.get(a.id) ?? 0
    prog = a.annualLimit !== null && a.annualLimit !== undefined
      ? { w: shareOf(paid, a.annualLimit), text: m('progLimit', { paid: fmtMoney(paid), limit: fmtMoney(a.annualLimit), pct: Math.round(shareOf(paid, a.annualLimit)) }), tone: toneOf(limitTone(paid, a.annualLimit)) === 'ok' ? undefined : toneOf(limitTone(paid, a.annualLimit)) }
      : { w: null, text: m('progYear', { paid: fmtMoney(paid) }) }
  }
  return {
    id: a.id, name: a.name, tag: a.kind ?? '', flags, line: accountLine(a),
    main: ratio.value ? `${pctOf(a.ratio ?? 0)}%` : fmtMoney(base.amount),
    sub: ratio.value ? t('budget.perMonth', { amount: fmtMoney(amount) })
      : base.phased && phase.value ? t('budget.phaseAmount', { n: numbers.value[phase.value.id] ?? 0 }) : t('budget.monthly'),
    meta, prog, color: itemColor(i), amount,
  }
}))
const bar = computed(() => rows.value.filter((r) => r.amount > 0).map((r) => ({
  id: r.id, name: r.name, w: shareOf(r.amount, whole.value), color: r.color, share: ratio.value ? r.main : fmtMoney(r.amount),
})))
const gap = computed(() => (ratio.value && whole.value > g.value.sum ? shareOf(whole.value - g.value.sum, whole.value) : 0))
const sumLine = computed(() => (ratio.value
  ? t('budget.sumRatio', { pct: pctOf(g.value.ratioSum), sum: fmtMoney(g.value.sum), total: fmtMoney(g.value.total) })
  : t('budget.sumItems', { n: rows.value.length, amount: fmtMoney(g.value.sum) })))
const total = computed(() => {
  const s = sumStatus(g.value, phase.value)
  const c = cat.value
  const [msg, tone]: [string, Tone] =
    // no item sends that month: nothing is spread and the target takes the adjustment itself (A-29; review rc2-3 F-1)
    adjust.value && !ratio.value ? (g.value.sum > 0 ? [t('budget.status.adjusted', { amount: fmtMoney(adjust.value.amount) }), 'ok'] : [t('budget.status.adjustedNoItem', { amount: fmtMoney(adjust.value.amount) }), 'warn'])
    : s.code === 'noTarget' ? [t('budget.status.noTarget', { cat: c }), 'warn']
    : s.code === 'noPhase' ? [t('budget.status.noPhase'), 'warn']
    : s.code === 'same' ? [t(s.ratio ? 'budget.status.sameRatio' : 'budget.status.same', { cat: c }), 'ok']
    : s.code === 'under' ? [t('budget.status.under', { amount: fmtMoney(s.amount) }), 'warn']
    : s.code === 'over' ? [t('budget.status.over', { amount: fmtMoney(s.amount), cat: c }), 'bad']
    : s.code === 'ratioUnder' ? [t('budget.status.ratioUnder', { pct: s.pct, rest: s.rest }), 'warn']
    : s.code === 'ratioOver' ? [t('budget.status.ratioOver', { pct: s.pct, over: s.over }), 'bad']
    : [t('budget.status.living'), 'muted']
  return { amount: fmtMoney(g.value.sum), msg, tone }
})

// ---------- editors ----------
/** undefined = closed, null = a new item. */
const editing = ref<Account | null | undefined>(undefined)
const editStep = ref(0)
const openEdit = (id: string, step = 0) => { editStep.value = step; editing.value = store.accounts.find((a) => a.id === id) ?? undefined }
const openNew = () => { editStep.value = 0; editing.value = null }
const totalOpen = ref(false)

// ---------- the second tab (S-15) ----------
const tab = ref('list')
const tabs = computed(() => [
  { id: 'list', label: m('tabList'), icon: 'list' },
  saving ? { id: 'maturity', label: t('budget.tabMaturity'), icon: 'events' } : { id: 'history', label: t('budget.tabHistory'), icon: 'chart' },
])
const plans = computed(() => (saving ? [] : monthPlans(store, 'invest', now)))
</script>

<template>
  <BudgetPage
    :title="m('title')" :desc="m('desc')" :add-label="m('addLabel')"
    :cells="cells" :split-label="t('budget.split')" :kpis="kpis" :list-title="m('listTitle')" :sum-line="sumLine"
    :cols="{ name: m('colName'), amount: ratio ? t('budget.colRatioAmount') : t('budget.colAmount'), meta: m('colMeta'), prog: m('colProg') }"
    :rows="rows" :bar="bar" :gap="gap" :total="total" :note="m(ratio ? 'noteRatio' : 'noteAmount')"
    v-model:tab="tab" :tabs="tabs"
    @add="openNew" @edit="openEdit" @action="totalOpen = true"
  >
    <template v-if="!target" #notice>
      <div class="notice" data-testid="no-target">
        <p>{{ t('budget.noTargetNote', { cat }) }}</p>
        <button class="btn sm pri" type="button" :disabled="creating" @click="createTarget">{{ t('budget.createTarget', { cat }) }}</button>
      </div>
    </template>
    <template #split>
      <Seg :model-value="g.mode" :options="splitOpts" :label="t('budget.split')" @update:model-value="setSplit" />
      <span class="hint">{{ m(ratio ? 'ratioHint' : 'amountHint') }}</span>
    </template>
    <template #tab>
      <BudgetMaturity v-if="saving" :items="items" @edit="openEdit($event, 1)" />
      <BudgetHistory
        v-else :title="t('budget.history.titleInvest')" :rows="plans" :now="now"
        :cols="[t('budget.history.colMonth'), t('budget.history.colPlan'), t('budget.history.colSent'), t('budget.history.colDiff')]"
        :note="target ? '' : t('budget.history.noTarget', { cat })"
      />
    </template>
    <BudgetItemEditor v-if="editing !== undefined" :group="props.group" :initial="editing" :mode="g.mode" :total="g.total" :start-step="editStep" @close="editing = undefined" />
    <BudgetAdjustEditor v-if="totalOpen && target" :target="target" :ym="now" total @close="totalOpen = false" />
  </BudgetPage>
</template>

<style scoped>
.notice{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 18px;background:var(--accent-soft);border-bottom:1px solid var(--border);color:var(--accent-text);font-size:13px}
.notice p{margin:0;flex:1 1 280px}
</style>
