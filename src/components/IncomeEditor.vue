<script setup lang="ts">
// 정기 수입 추가·수정 (spec 014 S-2; canvas NextIncome "수입 추가"): name, cycle 매달/해마다, the day (1–31) and for a
// yearly income its month (1–12), the expected amount, the account it goes to (optional) and a memo (optional, folded).
// EditSheet + useEditor; the API decides what is valid and its message is shown. Delete asks first and says that the
// amounts received for the income go with it (the server deletes them and an undo brings them back).
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Select from './Select.vue'
import Tip from './Tip.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import type { IncomeItem } from '../data/types'

const props = defineProps<{ initial: IncomeItem | null; /** the month a new yearly income starts on (the month shown) */ month: number }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): IncomeItem => ({ id: '', name: '', cycle: 'monthly', month: null, day: 25, amount: '' as unknown as number, accountId: null, note: '' })
function validate(x: IncomeItem) {
  if (!x.name.trim()) return t('income.needName')
  if (typeof x.amount !== 'number') return t('income.needAmount')
  return null
}
const { item: edit, error, busy, open, close, save, remove } = useEditor('incomes', blank, validate)
open(props.initial ?? undefined)
if (edit.value) edit.value.note ??= ''
watch(edit, (v) => { if (!v) emit('close') })
const isNew = !props.initial
const title = props.initial ? t('income.editor.editTitle', { name: props.initial.name }) : t('income.editor.addTitle')

const CYCLES = computed(() => [{ id: 'monthly', label: t('income.editor.monthly') }, { id: 'yearly', label: t('income.editor.yearly') }])
/** A monthly income has no month; a yearly one keeps the month it had, else the month shown. */
function setCycle(c: 'monthly' | 'yearly') {
  const x = edit.value!
  x.cycle = c
  x.month = c === 'yearly' ? (x.month ?? props.initial?.month ?? props.month) : null
}
const amount = computed({
  get: () => edit.value!.amount as number | '',
  set: (v) => { edit.value!.amount = v as number },
})
const dayOpts = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('income.editor.dayOf', { n: i + 1 }) }))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: t('income.editor.monthOf', { n: i + 1 }) }))
// '' in the select is "none" (null)
const account = computed({
  get: () => edit.value?.accountId ?? '',
  set: (v: string) => { edit.value!.accountId = v || null },
})
const accountOpts = computed(() => [{ value: '', label: t('income.editor.accountNone') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
const memoOpen = ref(!!edit.value?.note)

// ---------- delete ----------
const askDel = ref(false)
const receipts = computed(() => (props.initial ? store.incomeReceipts.filter((r) => r.itemId === props.initial!.id).length : 0))
async function confirmDelete() {
  askDel.value = false
  await remove()
}
</script>

<template>
  <EditSheet v-if="edit" :title="title" :desc="isNew ? t('income.editor.addDesc') : undefined" :error="error" :busy="busy" :hint="t('income.foot')" @save="save" @cancel="close">
    <div class="field">
      <label for="inc-name">{{ t('income.editor.name') }}<span class="star" aria-hidden="true">*</span></label>
      <input id="inc-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('income.editor.namePh')">
    </div>
    <div class="field">
      <div class="lrow"><span id="inc-cycle-l" class="flabel">{{ t('income.editor.cycle') }}</span><Tip :text="t('income.editor.cycleTip')" /></div>
      <Seg :options="CYCLES" :model-value="edit.cycle" labelledby="inc-cycle-l" @update:model-value="setCycle($event)" />
    </div>
    <div v-if="edit.cycle === 'yearly'" class="field">
      <label for="inc-month">{{ t('income.editor.month') }}</label>
      <Select id="inc-month" v-model="edit.month" :options="monthOpts" />
    </div>
    <div class="field">
      <label for="inc-day">{{ t('income.editor.day') }}</label>
      <Select id="inc-day" v-model="edit.day" :options="dayOpts" />
      <span class="hint">{{ t('income.editor.dayHint') }}</span>
    </div>
    <div class="field">
      <label for="inc-amount">{{ t('income.editor.amount') }}<span class="star" aria-hidden="true">*</span></label>
      <MoneyInput id="inc-amount" v-model="amount" />
    </div>
    <div class="field">
      <label for="inc-acc">{{ t('income.editor.account') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="inc-acc" v-model="account" :options="accountOpts" />
    </div>
    <div v-if="memoOpen" class="field">
      <label for="inc-note">{{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <textarea id="inc-note" v-model="edit.note" class="in" rows="2"></textarea>
    </div>
    <div v-else class="field">
      <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></button>
    </div>
    <template v-if="!isNew" #after>
      <div class="danger">
        <span><b>{{ t('income.editor.deleteHead') }}</b>{{ t('income.editor.deleteText') }}</span>
        <button class="btn sm bad" type="button" @click="askDel = true">{{ t('common.delete') }}</button>
      </div>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit && props.initial" :title="t('income.editor.deleteTitle', { name: props.initial.name })" :confirm-label="t('common.delete')"
    :cancel-label="t('income.editor.keep')" danger :busy="busy" @confirm="confirmDelete" @cancel="askDel = false"
  >
    <p>{{ receipts ? t('income.editor.deleteBody', { n: receipts }) : t('income.editor.deleteBodyNone') }}</p>
  </ConfirmDialog>
</template>

<style scoped src="./budget-editor.css"></style>
