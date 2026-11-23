<script setup lang="ts">
// 조정 (spec 013 S-14; canvas AppPay 월별 시뮬레이션 "이번 달만 조정", AppSave · AppInvest "총액 수정"): one target of the
// pay split (fixed, Savings total, Investment total) in one month. "이번 달만" writes a month adjustment of that month and
// target (one row, `month-adjusts`); "이 구간 끝까지" writes the amount of that month's phase with every other field of the
// phase as it was, as the phase editor does (not offered for a Savings / Investment total in the amount split: its value
// is the items' sum; nor without a phase that month). The phase scope also takes away the month's adjustment, which would
// hide the new amount. "조정 되돌리기" deletes the month's adjustment. The remainder before → after (and each item's
// new amount: by ratio, or spread by amount) is worked out on a copy of the state (`adjustPreview`). An emptied amount field means 0,
// as the phase editor's amount fields do; anything else goes to the API as typed and the API answers.
// `total` = the Savings / Investment page's "총액 수정" (spec 013 S-3): its own words, the phase scope first where it is
// offered (the rc.1 dialog wrote the phase only), no quick buttons.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { t, type MessageKey } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import { deleteItem, saveItem, sessionScope, store } from '../lib/store'
import { groupAt, phaseNumbers, ymLabel } from '../lib/calc'
import { adjustOf, adjustPreview, adjustStart, pctOf, phaseScope, withAdjust, withTotal, withoutAdjust, type AdjustScope } from '../lib/budget-page'
import { wonText } from '../lib/format'
import type { AllocationTarget } from '../data/types'

const props = defineProps<{
  target: AllocationTarget
  ym: string
  /** the take-home the simulation shows (the saved one when absent) */
  pay?: number
  /** the Savings / Investment page's 총액 수정 */
  total?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const existing = adjustOf(store.monthAdjusts, props.ym, props.target.id)
const ps = phaseScope(props.target, store, props.ym)
const phase = 'phase' in ps ? ps.phase : null
const n = phase ? phaseNumbers(store.phases)[phase.id] ?? 0 : 0
const group = props.target.kind === 'saving' || props.target.kind === 'invest' ? props.target.kind : null
const cat = group ? t(`budget.${group}.cat` as MessageKey) : ''

// What the dialog shows, pre-fills and steps from: in the ratio split the month's total, which the items share; else the
// target's value (review rc2-1 F-1).
const start = adjustStart(store, props.ym, props.target, props.pay)
const scope = ref<AdjustScope>(props.total && phase && !existing ? 'phase' : 'month')
const draft = ref<number | ''>(scope.value === 'phase' && phase ? (phase.amounts[props.target.id] ?? 0) : start.current)
const reason = ref(existing?.reason ?? '')
const reasonOpen = ref(!!existing?.reason)
const value = computed(() => (typeof draft.value === 'number' ? draft.value : 0))
const preview = computed(() => adjustPreview(store, props.ym, props.target.id, value.value, scope.value, props.pay))

const QUICK = [-100_000, -50_000, 50_000, 100_000]
const quickLabel = (d: number) => t(d < 0 ? 'budget.adjust.minus' : 'budget.adjust.plus', { n: Math.abs(d) / 10_000 })
const bump = (d: number) => { draft.value = Math.max(0, value.value + d) }

const scopes = computed(() => [
  { id: 'month', label: t('budget.adjust.scopeMonth') },
  ...(phase ? [{ id: 'phase', label: props.total ? t('budget.total.scopePhase', { n }) : t('budget.adjust.scopePhase') }] : []),
])
const scopeHint = computed(() => {
  if (scope.value === 'phase' && phase) {
    if (props.total) return phase.to ? t('budget.total.scopeHint', { to: phase.to }) : t('budget.total.scopeHintOpen')
    const range = phase.to ? `${phase.from} ~ ${phase.to}` : `${phase.from} ~`
    return t(group ? 'budget.adjust.hintPhaseRatio' : 'budget.adjust.hintPhase', { n, range })
  }
  return t('budget.adjust.hintMonth', { ym: ymLabel(props.ym) })
})
const onlyMonth = 'reason' in ps ? ps.reason : null
const kindLabel = computed(() => t(`payroll.kind.${props.target.kind}` as MessageKey))
const amountSplit = onlyMonth === 'amountSplit'
/**
 * What each item gets after the change: the ratio split shares the total by ratio; the amount split spreads the month's
 * value over the items in proportion to their amounts (review rc2-1 F-2) — unless no item sends that month, when the
 * target gets the value itself.
 */
const itemRows = computed(() => {
  if (!group || (amountSplit && start.base <= 0)) return []
  const v = value.value
  const adjusts = scope.value === 'month' ? withAdjust(store.monthAdjusts, props.ym, props.target.id, v) : withoutAdjust(store.monthAdjusts, props.ym, props.target.id)
  const phases = scope.value === 'phase' && phase ? withTotal(store.phases, phase.id, props.target.id, v) : store.phases
  return groupAt(group, store.accounts, phases, store.targets, store.settings, props.ym, adjusts).rows
})
/** What the items get in all: what the target gets that month (a ratio sum under 100% leaves the rest in the remainder). */
const itemSum = computed(() => itemRows.value.reduce((a, r) => a + r.amount, 0))
const restName = computed(() => {
  const r = store.targets.find((x) => x.kind === 'remainder')
  return r ? t('budget.total.restOf', { name: r.name }) : t('budget.total.rest')
})
const signed = (x: number) => (x < 0 ? `−${wonText(-x)}` : wonText(x))
const title = props.total ? t('budget.total.title', { cat }) : t('budget.adjust.title', { name: props.target.name })
const desc = props.total ? t('budget.total.desc', { cat }) : t('budget.adjust.desc', { ym: ymLabel(props.ym), kind: kindLabel.value })
const baseLine = computed(() => (props.total && phase && !amountSplit ? t('budget.total.nowLine', { n, phase: phase.name }) : kindLabel.value))

const error = ref('')
const busy = ref(false)
async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function save() {
  const amount = value.value
  void run(async () => {
    if (scope.value === 'month') {
      await saveItem('monthAdjusts', { id: existing?.id ?? '', ym: props.ym, targetId: props.target.id, amount, reason: reason.value })
      return
    }
    if (!phase) return
    const s = sessionScope()
    const next = withTotal(store.phases, phase.id, props.target.id, amount).find((p) => p.id === phase.id)!
    await saveItem('phases', next)
    if (existing && s.alive()) await deleteItem('monthAdjusts', existing.id)
  })
}
function revert() {
  if (existing) void run(() => deleteItem('monthAdjusts', existing.id))
}
</script>

<template>
  <EditSheet :title="title" :desc="desc" :error="error" :busy="busy" :hint="t('budget.editor.saveHint')" :save-label="props.total ? undefined : t('budget.adjust.apply')" @save="save" @cancel="emit('close')">
    <div class="field">
      <span class="flabel">{{ props.total ? t('budget.total.now') : start.total ? t('budget.adjust.baseTotal', { cat }) : t('budget.adjust.base') }}</span>
      <div class="now-v"><span>{{ baseLine }}</span><b class="num">{{ wonText(start.base) }}</b></div>
      <span v-if="existing" class="hint">{{ t('budget.adjust.nowAdjusted', { ym: ymLabel(props.ym), amount: wonText(existing.amount) }) }}</span>
    </div>
    <div class="field">
      <label for="ad-amount">{{ props.total ? t('budget.total.value') : start.total ? t('budget.adjust.amountTotal', { cat }) : t('budget.adjust.amount') }}<span class="star" aria-hidden="true">*</span></label>
      <MoneyInput id="ad-amount" v-model="draft" />
      <span v-if="start.total" class="hint">{{ t('budget.adjust.totalHint', { cat }) }}</span>
      <div v-if="!props.total" class="chips">
        <button v-for="d in QUICK" :key="d" type="button" class="chip" @click="bump(d)">{{ quickLabel(d) }}</button>
      </div>
    </div>
    <div class="field">
      <span id="ad-scope-l" class="flabel">{{ props.total ? t('budget.total.scope') : t('budget.adjust.scope') }}</span>
      <Seg v-model="scope" :options="scopes" labelledby="ad-scope-l" />
      <span class="hint">{{ scopeHint }}</span>
      <span v-if="onlyMonth" class="hint">{{ t(onlyMonth === 'amountSplit' ? 'budget.adjust.onlyMonthAmount' : 'budget.adjust.onlyMonthNoPhase') }}
        <RouterLink v-if="onlyMonth === 'noPhase' && props.total" to="/pay" @click="emit('close')">{{ t('budget.total.goPay') }}</RouterLink></span>
    </div>
    <div v-if="scope === 'month' && reasonOpen" class="field">
      <label for="ad-reason">{{ t('budget.adjust.reason') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="ad-reason" v-model="reason" class="in" autocomplete="off" :placeholder="t('budget.adjust.reasonPh')">
    </div>
    <div v-else-if="scope === 'month'" class="field">
      <button class="memo-add" type="button" @click="reasonOpen = true">+ {{ t('budget.adjust.addReason') }}</button>
    </div>
    <div class="pvw" data-testid="adjust-preview">
      <div class="pl"><span>{{ restName }}</span><span><s>{{ signed(preview.before) }}</s><b>{{ signed(preview.after) }}</b></span></div>
      <div v-if="itemRows.length" class="sub">
        <b>{{ t(amountSplit ? 'budget.total.amountSpread' : 'budget.total.redo') }}</b>
        <div v-for="r in itemRows" :key="r.account.id" class="pl"><span>{{ r.account.name }}<template v-if="!amountSplit"> · {{ pctOf(r.account.ratio ?? 0) }}%</template></span><b>{{ wonText(r.amount) }}</b></div>
        <div class="pl"><span>{{ t('budget.adjust.itemsSum', { cat }) }}</span><b>{{ wonText(itemSum) }}</b></div>
      </div>
      <span v-else-if="group && amountSplit" class="sub">{{ t('budget.total.amountKeep', { cat }) }}</span>
      <span v-if="preview.after < 0" class="bad">{{ t('budget.total.short') }}</span>
    </div>
    <template v-if="existing" #after>
      <div class="danger">
        <span><b>{{ t('budget.adjust.revert') }}</b>{{ t('budget.adjust.revertText', { amount: wonText(start.base) }) }}</span>
        <button class="btn sm bad" type="button" :disabled="busy" @click="revert">{{ t('budget.adjust.revert') }}</button>
      </div>
    </template>
  </EditSheet>
</template>

<style scoped src="./budget-editor.css"></style>
