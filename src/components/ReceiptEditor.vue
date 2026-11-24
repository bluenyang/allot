<script setup lang="ts">
// 받은 금액 적기 (spec 014 S-3; canvas NextIncome "받은 금액 적기"): one amount received for an income (or the salary,
// itemId null) in the month shown — amount, the day it came in (optional) and a memo (optional, folded). A month may
// hold several; their sum is the month's received amount, and the box below shows the difference from the expected
// amount with this one in it. EditSheet + useEditor; the API decides what is valid. Delete asks first (EditSheet).
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import DateInput from './DateInput.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { fmtMoney, fmtMoneyClass } from '../lib/display'
import type { IncomeReceipt } from '../data/types'

const props = defineProps<{
  initial: IncomeReceipt | null
  itemId: string | null
  ym: string
  /** the row's name, expected amount this month, its day as a line ("매달 25일"), the month's name ("11월") */
  name: string
  expected: number
  when: string
  monthName: string
}>()
const emit = defineEmits<{ close: [] }>()

const blank = (): IncomeReceipt => ({ id: '', itemId: props.itemId, ym: props.ym, amount: '' as unknown as number, date: null, note: '' })
const { item: edit, error, busy, open, close, save, remove } = useEditor('incomeReceipts', blank, (x) => (typeof x.amount !== 'number' ? t('income.needAmount') : null))
open(props.initial ?? undefined)
if (edit.value) edit.value.note ??= ''
watch(edit, (v) => { if (!v) emit('close') })

const title = t('income.receipt.title', { name: props.name, month: props.monthName })
const desc = props.expected ? t('income.receipt.desc', { amount: fmtMoney(props.expected), when: props.when }) : t('income.receipt.descNone')
const amount = computed({
  get: () => edit.value!.amount as number | '',
  set: (v) => { edit.value!.amount = v as number },
})
// '' from the field is "no date" (null), as the API takes it
const date = computed({
  get: () => edit.value?.date ?? '',
  set: (v: string) => { edit.value!.date = v || null },
})
/** The other amounts written for this row this month: the difference counts them with this one. */
const others = computed(() => store.incomeReceipts
  .filter((r) => r.itemId === props.itemId && r.ym === props.ym && r.id !== edit.value?.id)
  .reduce((a, r) => a + r.amount, 0))
const diff = computed(() => others.value + (typeof amount.value === 'number' ? amount.value : 0) - props.expected)
const signed = (n: number) => `${n > 0 ? '+' : ''}${fmtMoney(n)}`
const memoOpen = ref(!!edit.value?.note)
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="desc" :error="error" :busy="busy" :hint="t('income.foot')"
    :can-delete="!!edit.id" :delete-name="edit.id ? fmtMoney(edit.amount) : ''" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="rc-amount">{{ t('income.receipt.amount') }}<span class="star" aria-hidden="true">*</span></label>
      <MoneyInput id="rc-amount" v-model="amount" />
    </div>
    <div class="field">
      <label for="rc-date">{{ t('income.receipt.date') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <DateInput id="rc-date" v-model="date" clearable :aria-label="t('income.receipt.date')" />
    </div>
    <div class="dbox" data-testid="receipt-diff">
      <span class="dl"><b>{{ t('income.receipt.diff') }}</b><small class="hint">{{ t('income.receipt.diffHint', { month: monthName }) }}</small></span>
      <b class="num dv" :class="[diff > 0 ? 'plus' : diff < 0 ? 'minus' : '', fmtMoneyClass(diff)]">{{ signed(diff) }}</b>
    </div>
    <div v-if="memoOpen" class="field">
      <label for="rc-note">{{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <textarea id="rc-note" v-model="edit.note" class="in" rows="2" :placeholder="t('income.notePh')"></textarea>
    </div>
    <div v-else class="field">
      <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('income.note') }} <span class="opt">{{ t('common.optional') }}</span></button>
    </div>
  </EditSheet>
</template>

<style scoped src="./budget-editor.css"></style>
<style scoped>
.dbox{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:var(--r-card);background:var(--primary-tint);border:1px solid var(--primary-line)}
.dl{display:flex;flex-direction:column;gap:2px;min-width:0}
.dl b{font-size:12px;font-weight:600;color:var(--text-2)}
.dv{font-size:18px}
.plus{color:var(--primary-text)}
.minus{color:var(--neg-text)}
</style>
