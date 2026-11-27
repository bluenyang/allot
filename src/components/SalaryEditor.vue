<script setup lang="ts">
// 월급 (spec 014 S-2): the salary is no income row; its expected amount is settings.netPay and its day settings.payDay.
// This editor writes both through the settings save, as 월급 분배's 월 실수령 field and 설정 › 기준 일정 do; those stay
// where they are. The values go as typed: the API decides what is valid (a whole amount of 0 or more, a day 1–31) and its
// message is shown.
// Under a pay basis the pay day is what a month is: a save that changes it is asked first with the same question as
// 설정 › 기준 일정 (spec 018 S-4, review 6 finding 1). Cancelled, nothing is saved and the form stays as typed.
import { computed, ref } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MonthChangeDialog from './MonthChangeDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Select from './Select.vue'
import { monthChange } from '../lib/month'
import { saveSettings, store } from '../lib/store'

const emit = defineEmits<{ close: [] }>()

const pay = ref<number | ''>(store.settings.netPay)
const day = ref<number>(store.settings.payDay)
const error = ref('')
const busy = ref(false)
const amount = computed({
  get: () => pay.value,
  set: (v: number | '' | null) => { pay.value = v ?? '' },
})
// the stored day is always an option (the Select shows a value outside its list too)
const dayOpts = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('income.editor.dayOf', { n: i + 1 }) }))

const ask = ref<{ before: string; after: string } | null>(null)
function save() {
  if (typeof pay.value !== 'number') return (error.value = t('income.needAmount'))
  const change = monthChange({ settings: { payDay: day.value } })
  if (change) return (ask.value = change)
  return write()
}
async function write() {
  if (typeof pay.value !== 'number') return
  ask.value = null
  busy.value = true
  error.value = ''
  try {
    await saveSettings({ netPay: pay.value, payDay: day.value })
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <EditSheet :title="t('income.salaryEditor.title')" :desc="t('income.salaryEditor.desc')" :error="error" :busy="busy" :hint="t('income.foot')" @save="save" @cancel="emit('close')">
    <div class="field">
      <label for="sal-amount">{{ t('income.salaryEditor.amount') }}<span class="star" aria-hidden="true">*</span></label>
      <MoneyInput id="sal-amount" v-model="amount" />
    </div>
    <div class="field">
      <label for="sal-day">{{ t('income.salaryEditor.day') }}</label>
      <Select id="sal-day" v-model="day" :options="dayOpts" />
      <span class="hint">{{ t('income.salaryEditor.dayHint') }}</span>
    </div>
  </EditSheet>
  <MonthChangeDialog v-if="ask" :before="ask.before" :after="ask.after" :busy="busy" @confirm="write" @cancel="ask = null" />
</template>
