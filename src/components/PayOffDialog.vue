<script setup lang="ts">
// 중도 완납 (spec 011 S-6): pick the payoff date (today) and the amount (the sum of the rounds left, which can be
// lowered when the rest of the fee is waived). Every round left is merged into one new round (`payOffEarly`);
// the merged ones stay in the list. Saved as the whole spending.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import { useEditor } from '../lib/useEditor'
import { fmtMoney } from '../lib/display'
import { payOffEarly, ymd } from '../lib/calc'
import type { Spending } from '../data/types'
import DateInput from './DateInput.vue'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Tip from './Tip.vue'
import { localToday } from '../lib/now'

const props = defineProps<{ spending: Spending }>()
const emit = defineEmits<{ close: [] }>()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const left = props.spending.rounds.filter((r) => r.state === 'left')
const sum = left.reduce((a, r) => a + r.amount, 0)
const date = ref(ymd(localToday()))
const amount = ref<number | ''>(sum)

const { item: edit, error, busy, open, close, save } = useEditor('spendings', () => props.spending, (x) => {
  if (!DATE.test(date.value)) return t('spending.inst.pay2.needDate')
  if (typeof amount.value !== 'number' || !Number.isInteger(amount.value) || amount.value < 0) return t('spending.inst.pay2.needAmount')
  x.rounds = payOffEarly(props.spending.rounds, date.value, amount.value) // from the saved rounds, so a retry after a refusal does not merge twice
  return null
})
open(props.spending)
watch(edit, (v) => { if (!v) emit('close') })
const title = t('spending.inst.pay2.title', { name: props.spending.name })
const tip = computed(() => t('spending.inst.pay2.amountTip', { n: left.length, sum: fmtMoney(sum) }))
</script>

<template>
  <EditSheet v-if="edit" :title="title" :width="440" :error="error" :busy="busy" :hint="t('spending.inst.pay2.hint')" :save-label="t('spending.inst.pay2.save')" @save="save" @cancel="close">
    <p class="note">{{ t('spending.inst.pay2.note', { n: left.length }) }}</p>
    <div class="field">
      <label for="po-date">{{ t('spending.inst.pay2.date') }}</label>
      <DateInput id="po-date" v-model="date" :aria-label="t('spending.inst.pay2.date')" />
    </div>
    <div class="field">
      <div class="lrow"><label for="po-amt">{{ t('spending.inst.pay2.amount') }}</label><Tip :text="tip" /></div>
      <MoneyInput id="po-amt" v-model="amount" prefix="" />
    </div>
  </EditSheet>
</template>

<style scoped>
.lrow{display:flex;align-items:center;gap:6px}
.note{margin:0;font-size:13px;color:var(--text-2)}
</style>
