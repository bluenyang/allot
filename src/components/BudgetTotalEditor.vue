<script setup lang="ts">
// 총액 수정 (spec 013 S-3; canvas AppSave · AppInvest, ratio split only): the menu's total is the amount of the
// current phase for its target — the same place as a fixed target's amount in the pay split. Saving writes
// that phase ("구간 끝까지"; the canvas "이번 달만" is rc.2), with every other field of the phase as it was. The
// preview shows the month's remainder before → after (`monthMoney` on the changed phases) and each item's new
// amount. Without a phase this month it says so and links to the pay split.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { t, type MessageKey } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import { saveItem, store } from '../lib/store'
import { phaseAt, phaseNumbers, today, ymOf } from '../lib/calc'
import { pctOf, totalPreview, withTotal } from '../lib/budget-page'
import { wonText } from '../lib/format'
import type { AllocationTarget, BudgetGroup } from '../data/types'

const props = defineProps<{ group: BudgetGroup; target: AllocationTarget }>()
const emit = defineEmits<{ close: [] }>()

const now = ymOf(today())
const cat = t(`budget.${props.group}.cat` as MessageKey)
const phase = phaseAt(store.phases, now)
const n = phase ? phaseNumbers(store.phases)[phase.id] ?? 0 : 0
const current = phase ? (phase.amounts[props.target.id] ?? 0) : 0
const draft = ref<number | ''>(current)
/** An emptied field means 0, as the phase editor's amount fields do. */
const value = computed(() => (typeof draft.value === 'number' ? draft.value : 0))
const preview = computed(() => totalPreview(store, props.group, now, value.value))
const restName = computed(() => {
  const r = store.targets.find((x) => x.kind === 'remainder')
  return r ? t('budget.total.restOf', { name: r.name }) : t('budget.total.rest')
})
const signed = (x: number) => (x < 0 ? `−${wonText(-x)}` : wonText(x))
const error = ref('')
const busy = ref(false)

async function save() {
  if (!phase) return emit('close')
  busy.value = true
  error.value = ''
  try {
    const next = withTotal(store.phases, phase.id, props.target.id, value.value).find((p) => p.id === phase.id)!
    await saveItem('phases', next)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <EditSheet
    :title="t('budget.total.title', { cat })" :desc="t('budget.total.desc', { cat })" :error="error" :busy="busy"
    :hint="phase ? t('budget.editor.saveHint') : undefined" :hide-save="!phase" :cancel-label="phase ? undefined : t('common.close')"
    @save="save" @cancel="emit('close')"
  >
    <template v-if="phase">
      <div class="field">
        <span class="flabel">{{ t('budget.total.now') }}</span>
        <div class="now-v"><span>{{ t('budget.total.nowLine', { n, phase: phase.name }) }}</span><b class="num">{{ wonText(current) }}</b></div>
      </div>
      <div class="field">
        <label for="bt-amount">{{ t('budget.total.value') }}<span class="star" aria-hidden="true">*</span></label>
        <MoneyInput id="bt-amount" v-model="draft" />
      </div>
      <div class="field">
        <span class="flabel">{{ t('budget.total.scope') }}</span>
        <b>{{ t('budget.total.scopePhase', { n }) }}</b>
        <span class="hint">{{ phase.to ? t('budget.total.scopeHint', { to: phase.to }) : t('budget.total.scopeHintOpen') }}</span>
      </div>
      <div v-if="preview" class="pvw" data-testid="total-preview">
        <div class="pl"><span>{{ restName }}</span><span><s>{{ signed(preview.before) }}</s><b>{{ signed(preview.after) }}</b></span></div>
        <div v-if="preview.rows.length" class="sub">
          <b>{{ t('budget.total.redo') }}</b>
          <div v-for="r in preview.rows" :key="r.account.id" class="pl"><span>{{ r.account.name }} · {{ pctOf(r.account.ratio ?? 0) }}%</span><b>{{ wonText(r.after) }}</b></div>
        </div>
        <span v-if="preview.after < 0" class="bad">{{ t('budget.total.short') }}</span>
      </div>
    </template>
    <template v-else>
      <p class="callout warn">{{ t('budget.total.noPhase') }}</p>
      <RouterLink class="btn" to="/pay" @click="emit('close')">{{ t('budget.total.goPay') }}</RouterLink>
    </template>
  </EditSheet>
</template>

<style scoped src="./budget-editor.css"></style>
