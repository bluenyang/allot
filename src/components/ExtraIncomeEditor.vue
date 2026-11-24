<script setup lang="ts">
// 기타 수입 (spec 014 S-4): money that came in once — the day it came in, a name, the amount and a memo (optional,
// folded). It counts in the month of its day. EditSheet + useEditor; the API decides what is valid. Delete asks first.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import DateInput from './DateInput.vue'
import { useEditor } from '../lib/useEditor'
import type { IncomeExtra } from '../data/types'

const props = defineProps<{ initial: IncomeExtra | null; /** the day a new one starts on */ date: string }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): IncomeExtra => ({ id: '', date: props.date, name: '', amount: '' as unknown as number, note: '' })
function validate(x: IncomeExtra) {
  if (!x.date) return t('income.extra.needDate')
  if (!x.name.trim()) return t('income.needName')
  if (typeof x.amount !== 'number') return t('income.needAmount')
  return null
}
const { item: edit, error, busy, open, close, save, remove } = useEditor('incomeExtras', blank, validate)
open(props.initial ?? undefined)
if (edit.value) edit.value.note ??= ''
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('income.extra.editTitle') : t('income.extra.addTitle')
const amount = computed({
  get: () => edit.value!.amount as number | '',
  set: (v) => { edit.value!.amount = v as number },
})
const memoOpen = ref(!!edit.value?.note)
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="t('income.extra.desc')" :error="error" :busy="busy" :hint="t('income.foot')"
    :can-delete="!!edit.id" :delete-name="props.initial?.name" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="ex-date">{{ t('income.extra.date') }}<span class="star" aria-hidden="true">*</span></label>
      <DateInput id="ex-date" v-model="edit.date" :aria-label="t('income.extra.date')" />
    </div>
    <div class="field">
      <label for="ex-name">{{ t('income.extra.name') }}<span class="star" aria-hidden="true">*</span></label>
      <input id="ex-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('income.extra.namePh')">
    </div>
    <div class="field">
      <label for="ex-amount">{{ t('income.extra.amount') }}<span class="star" aria-hidden="true">*</span></label>
      <MoneyInput id="ex-amount" v-model="amount" />
    </div>
    <div v-if="memoOpen" class="field">
      <label for="ex-note">{{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <textarea id="ex-note" v-model="edit.note" class="in" rows="2"></textarea>
    </div>
    <div v-else class="field">
      <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></button>
    </div>
  </EditSheet>
</template>

<style scoped src="./budget-editor.css"></style>
