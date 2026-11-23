<script setup lang="ts">
// 생활 (spec 013 S-1, S-2; canvas AppLiving): the living-cost items. Their sum in a month (`livingAt`: an
// item counts from its `from` month; a phase amount replaces its monthly amount, S-4) is the value of the
// pay split's living target. KPIs from the data rc.1 has (spec "범위 밖"): this month's living costs, the
// number of items, and the buffer of the account the living target is linked to.
// rc.2 (spec 013 S-15): the 월별 기록 tab — the planned living costs of the last six months and this month.
import { computed, ref } from 'vue'
import { t } from '../i18n'
import BudgetPage from '../components/BudgetPage.vue'
import LivingItemEditor from '../components/LivingItemEditor.vue'
import BudgetHistory from '../components/BudgetHistory.vue'
import { store } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { addYm, bufferGauge, livingAt, monthDay, nextTransferYm, phaseAt, phaseNumbers, today, ymd, ymOf } from '../lib/calc'
import { accountLine, baseAmount, itemColor, monthPlans, shareOf, type BudgetCell, type BudgetKpi, type BudgetRow } from '../lib/budget-page'
import type { LivingItem } from '../data/types'

const now = ymOf(today())
const todayStr = ymd(today())
const off = computed(() => offDays(store.holidaySets, `${addYm(now, -1)}-01`, `${addYm(now, 3)}-01`) ?? new Set<string>())
const lv = computed(() => livingAt(store.livingItems, store.phases, now))
const phase = computed(() => phaseAt(store.phases, now))
const numbers = computed(() => phaseNumbers(store.phases))
const target = computed(() => store.targets.find((x) => x.kind === 'living') ?? null)
const linked = computed(() => (target.value?.accountId ? store.accounts.find((a) => a.id === target.value!.accountId) ?? null : null))
const nextDate = computed(() => {
  const s = store.settings
  return monthDay(nextTransferYm(todayStr, s, off.value), s.transferDay, s.dayShift ?? 'none', off.value).date
})

const cells = computed<BudgetCell[]>(() => {
  const a = linked.value
  return [
    { label: t('budget.fromPay', { name: target.value?.name ?? t('budget.living.cat') }), value: fmtMoney(lv.value.sum), sub: t('budget.living.srcSub', { day: store.settings.transferDay }) },
    {
      label: t('budget.account'), value: a ? a.name : t('budget.notLinked'),
      sub: a ? [accountLine(a), t('budget.bufferOf', { amount: fmtMoney(a.buffer ?? 0) })].filter(Boolean).join(' · ') : t('budget.linkHint'),
    },
    { label: t('budget.day'), value: t('budget.dayValue', { day: store.settings.transferDay }), sub: t('budget.nextTransfer', { date: fmtDate(nextDate.value) }) },
  ]
})

const kpis = computed<BudgetKpi[]>(() => {
  const a = linked.value
  const g = a ? bufferGauge(a, store, todayStr) : null
  return [
    { label: t('budget.living.kpiSum'), value: fmtMoney(lv.value.sum), sub: t('budget.living.kpiSumSub', { amount: fmtMoney(livingAt(store.livingItems, store.phases, addYm(now, 1)).sum) }) },
    {
      label: t('budget.living.kpiCount'), value: t('budget.living.kpiCountValue', { n: store.livingItems.length }),
      sub: t('budget.living.kpiCountSub', { n: store.livingItems.filter((x) => Object.keys(x.amounts ?? {}).length).length }),
    },
    g
      ? { label: t('budget.living.kpiBuffer'), value: fmtMoney(g.buffer), sub: t('budget.living.kpiBufferSub', { used: fmtMoney(g.used), left: fmtMoney(g.left) }), tone: g.left < 0 ? 'bad' : undefined }
      : { label: t('budget.living.kpiBuffer'), value: t('budget.notLinked'), sub: t('budget.living.kpiBufferNone') },
  ]
})

const rows = computed<BudgetRow[]>(() => lv.value.rows.map(({ item, amount }, i) => {
  const base = baseAmount(item, phase.value)
  const share = shareOf(amount, lv.value.sum)
  return {
    id: item.id, name: item.name, tag: item.kind, line: item.payMethod,
    flags: item.from && item.from > now ? [t('budget.fromMonth', { ym: item.from })] : [],
    main: fmtMoney(base.amount),
    sub: base.phased && phase.value ? t('budget.phaseAmount', { n: numbers.value[phase.value.id] ?? 0 }) : t('budget.monthly'),
    meta: item.note ?? '',
    prog: { w: share, text: t('budget.living.share', { pct: Math.round(share) }) },
    color: itemColor(i), amount,
  }
}))
const bar = computed(() => rows.value.filter((r) => r.amount > 0).map((r) => ({ id: r.id, name: r.name, w: shareOf(r.amount, lv.value.sum), color: r.color, share: fmtMoney(r.amount) })))

// The editor: undefined = closed, null = a new item.
const editing = ref<LivingItem | null | undefined>(undefined)
const openEdit = (id: string) => { editing.value = store.livingItems.find((x) => x.id === id) ?? undefined }

// ---------- 월별 기록 (S-15) ----------
const tab = ref('list')
const tabs = computed(() => [{ id: 'list', label: t('budget.living.tabList'), icon: 'list' }, { id: 'history', label: t('budget.tabHistory'), icon: 'chart' }])
const plans = computed(() => monthPlans(store, 'living', now))
</script>

<template>
  <BudgetPage
    :title="t('budget.living.title')" :desc="t('budget.living.desc')" :add-label="t('budget.living.addLabel')"
    :cells="cells" :split-label="t('budget.split')" :kpis="kpis" :list-title="t('budget.living.listTitle')"
    :sum-line="t('budget.sumItems', { n: rows.length, amount: fmtMoney(lv.sum) })"
    :cols="{ name: t('budget.living.colName'), amount: t('budget.colAmount'), meta: t('budget.living.colMeta'), prog: t('budget.living.colProg') }"
    :rows="rows" :bar="bar" :gap="0"
    :total="{ amount: fmtMoney(lv.sum), msg: target ? t('budget.status.living') : t('budget.status.livingNoTarget'), tone: target ? 'muted' : 'warn' }"
    :note="t('budget.living.note')"
    v-model:tab="tab" :tabs="tabs"
    @add="editing = null" @edit="openEdit"
  >
    <template #split>
      <b class="split-v">{{ t('budget.itemsTotal') }}</b>
      <span class="hint">{{ t('budget.living.splitHint') }}</span>
    </template>
    <template #tab>
      <BudgetHistory
        :title="t('budget.history.titleLiving')" :rows="plans" :now="now"
        :cols="[t('budget.history.colMonth'), t('budget.history.colBudget'), t('budget.history.colSpent'), t('budget.history.colDiff')]"
        :note="target ? '' : t('budget.history.noTarget', { cat: t('budget.living.cat') })"
      />
    </template>
    <LivingItemEditor v-if="editing !== undefined" :initial="editing" @close="editing = undefined" />
  </BudgetPage>
</template>

<style scoped>
.split-v{font-size:15px}
</style>
