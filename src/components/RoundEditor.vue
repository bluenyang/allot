<script setup lang="ts">
// 회차 수정 (spec 011 S-4, S-6): one round of an installment or split spending: billing date, amount, state.
// A round is part of its spending, so saving it is saving the whole spending (the rounds travel in the body).
// A changed date or amount marks the round `edited` (it is never worked out again, S-4); the state alone does not
// (냄 is the user's own mark). Whatever the server refuses (a sum over the limit, ...) is shown under the form.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import { useEditor } from '../lib/useEditor'
import { monthLong } from '../lib/format'
import type { RoundState, Spending, SpendingRound } from '../data/types'
import DateInput from './DateInput.vue'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Tip from './Tip.vue'

const props = defineProps<{ spending: Spending; no: number }>()
const emit = defineEmits<{ close: [] }>()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const before = props.spending.rounds.find((r) => r.no === props.no)
const date = ref(before?.date ?? '')
const amount = ref<number | ''>(before?.amount ?? '')
const state = ref<RoundState>(before?.state === 'paid' ? 'paid' : 'left')
const round = (x: Spending) => x.rounds.find((r) => r.no === props.no) as SpendingRound

const { item: edit, error, busy, open, close, save: saveDraft } = useEditor('spendings', () => props.spending, (x) => {
  if (!DATE.test(date.value)) return t('spending.inst.round.needDate')
  if (typeof amount.value !== 'number' || !Number.isInteger(amount.value) || amount.value < 0) return t('spending.inst.round.needAmount')
  const r = round(x)
  r.edited = !!before?.edited || before?.date !== date.value || before?.amount !== amount.value
  r.date = date.value
  r.amount = amount.value
  r.state = state.value
  return null
})
open(props.spending)
watch(edit, (v) => { if (!v) emit('close') })

const label = props.no <= props.spending.count ? t('spending.inst.roundOfLong', { no: props.no, n: props.spending.count }) : t('spending.inst.payoffRound')
const title = t('spending.inst.round.title', { name: props.spending.name, label })
const opts = computed(() => [{ id: 'left', label: t('spending.inst.round.left') }, { id: 'paid', label: t('spending.inst.round.paid') }])
// where the round is counted, by its date (the same rule as the table: card and salary off the remainder, the subscription account onto the transfer)
const where = computed(() => {
  if (!DATE.test(date.value)) return t('spending.inst.round.whereNone')
  const month = monthLong(Number(date.value.slice(5, 7)))
  const year = date.value.slice(0, 4)
  if (props.spending.cancelled && state.value === 'left') return t('spending.inst.round.whereNone')
  return t(props.spending.payBy === 'subs' ? 'spending.inst.round.whereSubs' : 'spending.inst.round.whereRem', { year, month })
})
</script>

<template>
  <EditSheet v-if="edit" :title="title" :error="error" :busy="busy" :hint="t('spending.inst.round.hint')" @save="saveDraft" @cancel="close">
    <div class="field">
      <label for="rd-date">{{ t('spending.inst.round.date') }}</label>
      <DateInput id="rd-date" v-model="date" :aria-label="t('spending.inst.round.date')" />
    </div>
    <div class="field">
      <div class="lrow"><label for="rd-amt">{{ t('spending.inst.round.amount') }}</label><Tip :text="t('spending.inst.round.amountTip')" /></div>
      <MoneyInput id="rd-amt" v-model="amount" prefix="" />
    </div>
    <div class="field">
      <div class="lrow"><span id="rd-st" class="flabel">{{ t('spending.inst.round.state') }}</span><Tip :text="t('spending.inst.round.stateTip')" /></div>
      <Seg v-model="state" :options="opts" labelledby="rd-st" />
    </div>
    <div class="where" role="group" :aria-label="t('spending.inst.round.where')"><span>{{ t('spending.inst.round.where') }}</span><b>{{ where }}</b></div>
  </EditSheet>
</template>

<style scoped>
.lrow{display:flex;align-items:center;gap:6px}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.where{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border);font-size:13px;color:var(--text-2)}
.where b{color:var(--primary-text);text-align:right;overflow-wrap:anywhere}
</style>
