<script setup lang="ts">
// 부채 추가·수정 (spec 010 S-9, EV-33..36, D-7): two steps, 기본 정보 and 상환. The 금리 is any text (a plain number
// is shown as a percentage, other text as typed; empty is allowed); the 원금 takes everything a number field took
// (0, pasted digits, decimals; S-10); 상환 방식 is one of three or any text under 기타; 계획 is a two-line text.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import { useEditor } from '../lib/useEditor'
import { DEBT_METHODS, debtMethodLabel, isDebtMethod } from '../lib/labels'
import type { Debt } from '../data/types'

const props = defineProps<{ initial: Debt | null }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): Debt => ({ id: '', name: '', principal: 0, rate: '', method: '', plan: '' })
function validate(d: Debt) {
  if (!d.name.trim()) { step.value = 0; return t('timeline.needItemName') }
  if (typeof d.principal !== 'number' || !(d.principal >= 0)) { step.value = 0; return t('timeline.needPrincipal') }
  return null
}
const { item: edit, error, busy, open, close, save, remove } = useEditor('debts', blank, validate)
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('timeline.editDebt') : t('timeline.addDebt')

const step = ref(0)
const steps = computed(() => [t('timeline.stepBasic'), t('timeline.stepRepay')])
function canAdvance(from: number) {
  if (from === 0) {
    const problem = validate(edit.value!)
    if (problem) { error.value = problem; return false }
  }
  error.value = ''
  return true
}

const principal = computed({
  get: () => edit.value!.principal as number | '',
  set: (v) => { edit.value!.principal = v as number },
})

// 상환 방식: a stored value that is none of the three is the text of 기타; an empty one selects nothing.
const OTHER = 'other'
const otherOpen = ref(!!props.initial?.method && !isDebtMethod(props.initial.method))
const other = ref(otherOpen.value ? props.initial!.method : '')
const methodOpts = computed(() => [...DEBT_METHODS.map((m) => ({ id: m as string, label: debtMethodLabel(m) })), { id: OTHER, label: t('timeline.methodOther') }])
const methodSel = computed(() => (otherOpen.value ? OTHER : edit.value && isDebtMethod(edit.value.method) ? edit.value.method : ''))
function pickMethod(id: string) {
  if (id === OTHER) {
    otherOpen.value = true
    edit.value!.method = other.value
  } else {
    otherOpen.value = false
    edit.value!.method = edit.value!.method === id ? '' : id // pressing the chosen one again clears it
  }
}
watch(other, (v) => { if (otherOpen.value && edit.value) edit.value.method = v })
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :steps="steps" :error="error" :busy="busy" :hint="t('timeline.saveHint')"
    :can-advance="canAdvance" :can-delete="!!edit.id" @save="save" @cancel="close" @delete="remove"
  >
    <template #default="{ step: s }">
      <template v-if="s === 0">
        <div class="field">
          <label for="db-name" class="req">{{ t('timeline.item') }}</label>
          <input id="db-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('timeline.itemPh')">
        </div>
        <div class="field">
          <label for="db-pr" class="req">{{ t('timeline.principal') }}</label>
          <MoneyInput id="db-pr" v-model="principal" />
          <span class="hint">{{ t('timeline.principalHint') }}</span>
        </div>
      </template>
      <template v-else>
        <div class="field">
          <label for="db-rate">{{ t('timeline.rate') }}</label>
          <input id="db-rate" v-model="edit.rate" class="in" autocomplete="off" :placeholder="t('timeline.ratePh')">
          <span class="hint">{{ t('timeline.rateHint') }}</span>
        </div>
        <div class="field">
          <span id="db-m-l" class="flabel">{{ t('timeline.method') }}</span>
          <Seg :model-value="methodSel" :options="methodOpts" labelledby="db-m-l" @update:model-value="pickMethod" />
          <input v-if="otherOpen" v-model="other" class="in" autocomplete="off" :aria-label="t('timeline.methodOtherLabel')" :placeholder="t('timeline.methodOtherPh')">
        </div>
        <div class="field">
          <label for="db-plan">{{ t('timeline.plan') }}</label>
          <textarea id="db-plan" v-model="edit.plan" class="in" rows="2" :placeholder="t('timeline.planPh')"></textarea>
          <span class="hint">{{ t('timeline.planHint') }}</span>
        </div>
      </template>
    </template>
  </EditSheet>
</template>

<style scoped>
.req::after{content:" *";color:var(--accent-text)}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.seg{justify-self:start}
</style>
