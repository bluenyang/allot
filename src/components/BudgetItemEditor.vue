<script setup lang="ts">
// 저축 상품 · 투자 계좌 추가·수정 (spec 013 S-3, S-4, S-5; canvas AppSave · AppInvest): an item of the Savings or
// Investment menu is a bank account row with `group` set, so this editor writes the whole account row —
// the fields it does not show (role, inflow, outflow, buffer, goal ack, stop month, …) go back as stored;
// a new item gets role '', inflow '' and outflow ''. Step 1: 종류 (chips; 기타 → free text; ISA / 연금저축 /
// IRP fill an empty annual limit), 이름, 은행, 계좌 끝 4자리 (4 digits or empty: the API says why it refuses
// other text). Step 2: amount split → 매달 보낼 금액 and 구간별 금액 (optional); ratio split → the share of the
// total in % (stored as percent / 100, 2 decimals of the percent); Savings: 금리, 기간, 목표 금액; Investment:
// 연 납입 한도; both: 언제부터, 메모. Delete asks first (the API deletes the account's balance records and phase
// amounts too, and the store reloads).
import { computed, ref, watch } from 'vue'
import { t, type MessageKey } from '../i18n'
import EditSheet from './EditSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Tip from './Tip.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { addYm, groupAt, phaseNumbers, today, ymOf } from '../lib/calc'
import { chipOf, chipValue, fromChoice, fromOf, percentOfRatio, ratioAmount, ratioOfPercent, type Chip, type ChipPick, type FromChoice } from '../lib/budget-page'
import { wonText } from '../lib/format'
import type { Account, BudgetGroup, SplitMode } from '../data/types'

const props = defineProps<{ group: BudgetGroup; initial: Account | null; mode: SplitMode; /** this month's total of the menu (ratio split) */ total: number }>()
const emit = defineEmits<{ close: [] }>()

const now = ymOf(today())
const saving = props.group === 'saving'
const KIND_IDS = saving ? ['fixed', 'free', 'parking', 'deposit', 'other'] : ['isa', 'pension', 'irp', 'cma', 'stock', 'other']
/** The annual limits a kind chip fills in when the field is empty (S-5; the user can change them). */
const LIMITS: Record<string, number> = { isa: 20_000_000, pension: 6_000_000, irp: 9_000_000 }
const kinds: Chip[] = KIND_IDS.map((id) => ({ id, label: t(`budget.kinds.${props.group}.${id}` as MessageKey) }))
const otherKind = kinds.find((k) => k.id === 'other')!.label
const TERM_IDS = ['m6', 'm12', 'm24', 'none', 'other'] as const
const terms: Chip[] = TERM_IDS.map((id) => ({ id, label: t(`budget.terms.${id}` as MessageKey) }))
const cat = t(`budget.${props.group}.cat` as MessageKey)

const blank = (): Account => ({
  id: '', name: '', role: '', inflow: '', outflow: '', bank: '', last4: '', kind: '', rate: '', term: '', buffer: 0, goal: null, annualLimit: null,
  group: props.group, amount: (props.mode === 'amount' ? '' : 0) as number, ratio: null, from: addYm(now, 1), stopFrom: null, goalAck: null, note: '', amounts: {},
})
const step = ref(0)
function validate(x: Account) {
  if (!x.name.trim()) { step.value = 0; return t('budget.editor.needName') }
  if (props.mode === 'amount' && typeof x.amount !== 'number') { step.value = 1; return t('budget.editor.needAmount') }
  return null
}
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('accounts', blank, validate)
open(props.initial ?? undefined)
if (edit.value) {
  edit.value.note ??= ''
  edit.value.amounts ??= {}
  edit.value.group = props.group
}
watch(edit, (v) => { if (!v) emit('close') })
const isNew = !props.initial
const title = props.initial
  ? t(saving ? 'budget.editor.editSaving' : 'budget.editor.editInvest', { name: props.initial.name })
  : t(saving ? 'budget.editor.addSaving' : 'budget.editor.addInvest')
const steps = computed(() => [t(saving ? 'budget.editor.stepProduct' : 'budget.editor.stepAccount'), t('budget.editor.stepPay')])

// ---------- step 1 ----------
// a new Investment item starts with no chip and presses the first one below (which fills its limit); pressing a chosen chip clears it
const kindPick = ref<ChipPick>(isNew ? { id: saving ? kinds[0]!.id : null, text: '' } : chipOf(props.initial!.kind, kinds, 'other'))
const limitFilled = ref('')
function pickKind(id: string) {
  // the typed text is kept for a later 기타; pressing the chosen chip again chooses none (an empty kind, as the API takes; review 1 F-14)
  if (kindPick.value.id === id) { kindPick.value = { id: null, text: kindPick.value.text }; return }
  kindPick.value = { id, text: kindPick.value.text }
  const x = edit.value!
  if (!saving && LIMITS[id] !== undefined && (x.annualLimit === null || x.annualLimit === undefined)) {
    x.annualLimit = LIMITS[id]!
    limitFilled.value = kinds.find((k) => k.id === id)!.label
  }
}
// a new Investment item starts on its first chip: fill its limit as a press would
if (isNew && !saving) pickKind(kinds[0]!.id)
function canAdvance(from: number) {
  if (from === 0 && !edit.value!.name.trim()) {
    error.value = t('budget.editor.needName')
    return false
  }
  error.value = ''
  return true
}

// ---------- step 2 ----------
const amount = computed({
  get: () => edit.value!.amount as number | '',
  set: (v) => { edit.value!.amount = v as number },
})
const goal = computed({
  get: () => edit.value!.goal ?? null,
  set: (v: number | '' | null) => { edit.value!.goal = v === '' ? null : v },
})
const limit = computed({
  get: () => edit.value!.annualLimit ?? null,
  set: (v: number | '' | null) => { edit.value!.annualLimit = v === '' ? null : v; limitFilled.value = '' },
})
const pct = ref<number | '' | null>(percentOfRatio(props.initial?.ratio))
const monthlyOfPct = computed(() => ratioAmount(props.total, ratioOfPercent(pct.value)))
const month = computed(() => groupAt(props.group, store.accounts, store.phases, store.targets, store.settings, now))
const others = computed(() => month.value.rows.filter((r) => r.account.id !== edit.value?.id).reduce((a, r) => a + r.amount, 0))

const termPick = ref<ChipPick>(isNew ? { id: 'm12', text: '' } : chipOf(props.initial!.term, terms, 'other'))
const pickTerm = (id: string) => { termPick.value = { id, text: termPick.value.text } }

const keptFrom = props.initial ? (props.initial.from ?? null) : null
const fromSel = ref<FromChoice>(props.initial ? fromChoice(props.initial.from, now) : 'next')
const fromOpts = computed(() => [
  ...(props.initial && fromChoice(keptFrom, now) === 'kept' ? [{ id: 'kept', label: keptFrom ? t('budget.editor.fromKept', { ym: keptFrom }) : t('budget.editor.fromStart') }] : []),
  { id: 'now', label: t('budget.editor.fromNow') },
  { id: 'next', label: t('budget.editor.fromNext') },
])

const numbers = computed(() => phaseNumbers(store.phases))
const phaseList = computed(() => [...store.phases].sort((a, b) => (numbers.value[a.id] ?? 0) - (numbers.value[b.id] ?? 0)))
const phasesOpen = ref(Object.keys(props.initial?.amounts ?? {}).length > 0)
const phaseValue = (id: string) => edit.value!.amounts?.[id] ?? null
function setPhase(id: string, v: number | '' | null) {
  const a = (edit.value!.amounts ??= {})
  if (v === null || v === '') delete a[id]
  else a[id] = v
}
const memoOpen = ref(!!edit.value?.note)

function save() {
  const x = edit.value
  if (!x) return
  x.group = props.group
  x.kind = chipValue(kindPick.value, kinds, 'other', otherKind)
  if (saving) x.term = chipValue(termPick.value, terms, 'other', '')
  x.from = fromOf(fromSel.value, keptFrom, now)
  // the split decides which of the two the menu reads; the other is sent back as stored
  if (props.mode === 'ratio') x.ratio = ratioOfPercent(pct.value)
  void saveDraft()
}

// ---------- delete ----------
const askDel = ref(false)
const delAmount = computed(() => month.value.rows.find((r) => r.account.id === props.initial?.id)?.amount ?? 0)
async function confirmDelete() {
  askDel.value = false
  await remove()
}
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :steps="steps" :error="error" :busy="busy" :hint="t('budget.editor.saveHint')"
    :can-advance="canAdvance" @save="save" @cancel="close"
  >
    <template #default="{ step: s }">
      <template v-if="s === 0">
        <div class="field">
          <span id="bi-kind-l" class="flabel">{{ t(saving ? 'budget.editor.kindSaving' : 'budget.editor.kindInvest') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="bi-kind-l">
            <button v-for="k in kinds" :key="k.id" type="button" role="radio" class="chip" :class="{ on: kindPick.id === k.id }" :aria-checked="kindPick.id === k.id ? 'true' : 'false'" @click="pickKind(k.id)">{{ k.label }}</button>
          </div>
          <input v-if="kindPick.id === 'other'" v-model="kindPick.text" class="in" autocomplete="off" :aria-label="t('budget.editor.kindOther')" :placeholder="t('budget.editor.kindOther')">
          <span v-if="limitFilled" class="hint">{{ t('budget.editor.limitFilled', { kind: limitFilled }) }}</span>
        </div>
        <div class="field">
          <label for="bi-name">{{ t('budget.editor.name') }}<span class="star" aria-hidden="true">*</span></label>
          <input id="bi-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t(saving ? 'budget.editor.namePhSaving' : 'budget.editor.namePhInvest')">
        </div>
        <div class="field">
          <label for="bi-bank">{{ t(saving ? 'budget.editor.bank' : 'budget.editor.bankInvest') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <input id="bi-bank" v-model="edit.bank" class="in" autocomplete="off" :placeholder="t(saving ? 'budget.editor.bankPh' : 'budget.editor.bankPhInvest')">
        </div>
        <div class="field">
          <label for="bi-last4">{{ t('budget.editor.last4') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <input id="bi-last4" v-model="edit.last4" class="in num" inputmode="numeric" autocomplete="off" :placeholder="t('budget.editor.last4Ph')" aria-describedby="bi-last4-h">
          <span id="bi-last4-h" class="hint">{{ t('budget.editor.last4Hint') }}</span>
        </div>
      </template>

      <template v-else>
        <div v-if="edit.stopFrom" class="callout warn"><p>{{ t('budget.editor.stoppedNote', { ym: edit.stopFrom }) }}</p></div>
        <div v-if="props.mode === 'amount'" class="field">
          <div class="lrow"><label for="bi-amount">{{ t('budget.editor.amountGroup') }}<span class="star" aria-hidden="true">*</span></label><Tip :text="t('budget.editor.amountTipGroup', { others: wonText(others), cat })" /></div>
          <MoneyInput id="bi-amount" v-model="amount" />
        </div>
        <div v-else class="field">
          <div class="lrow"><label for="bi-pct">{{ t('budget.editor.ratio', { cat }) }}<span class="star" aria-hidden="true">*</span></label><Tip :text="t('budget.editor.ratioTip', { cat, total: wonText(props.total) })" /></div>
          <MoneyInput id="bi-pct" v-model="pct" decimal prefix="" suffix="%" empty="null" aria-describedby="bi-pct-h" />
          <span id="bi-pct-h" class="hint num">{{ t('budget.editor.ratioMonthly', { amount: wonText(monthlyOfPct) }) }}</span>
        </div>
        <div v-if="props.mode === 'amount' && phaseList.length" class="field">
          <button class="fold-b" type="button" :aria-expanded="phasesOpen ? 'true' : 'false'" aria-controls="bi-phases" @click="phasesOpen = !phasesOpen">
            <span>{{ t('budget.editor.phases') }} <span class="opt">{{ t('common.optional') }}</span></span>
            <span class="chv" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
          </button>
          <div v-show="phasesOpen" id="bi-phases" class="phs">
            <span class="hint">{{ t('budget.editor.phasesHint') }}</span>
            <div v-for="p in phaseList" :key="p.id" class="field">
              <label :for="`bi-ph-${p.id}`">{{ t('budget.editor.phaseLabel', { n: numbers[p.id] ?? 0, name: p.name }) }}</label>
              <MoneyInput :id="`bi-ph-${p.id}`" :model-value="phaseValue(p.id)" empty="null" :placeholder="typeof amount === 'number' ? wonText(amount) : ''" :aria-describedby="`bi-ph-${p.id}-h`" @update:model-value="setPhase(p.id, $event)" />
              <span :id="`bi-ph-${p.id}-h`" class="hint">{{ p.to ? t('budget.editor.phaseRange', { from: p.from, to: p.to }) : t('budget.editor.phaseOpen', { from: p.from }) }}</span>
            </div>
          </div>
        </div>
        <template v-if="saving">
          <div class="field">
            <div class="lrow"><label for="bi-rate">{{ t('budget.editor.rate') }} <span class="opt">{{ t('common.optional') }}</span></label><Tip :text="t('budget.editor.rateTip')" /></div>
            <input id="bi-rate" v-model="edit.rate" class="in" autocomplete="off" :placeholder="t('budget.editor.ratePh')">
          </div>
          <div class="field">
            <span id="bi-term-l" class="flabel">{{ t('budget.editor.term') }} <span class="opt">{{ t('common.optional') }}</span></span>
            <div class="chips" role="radiogroup" aria-labelledby="bi-term-l">
              <button v-for="k in terms" :key="k.id" type="button" role="radio" class="chip" :class="{ on: termPick.id === k.id }" :aria-checked="termPick.id === k.id ? 'true' : 'false'" @click="pickTerm(k.id)">{{ k.label }}</button>
            </div>
            <input v-if="termPick.id === 'other'" v-model="termPick.text" class="in" autocomplete="off" :aria-label="t('budget.editor.termOther')" :placeholder="t('budget.editor.termPh')">
          </div>
          <div class="field">
            <div class="lrow"><label for="bi-goal">{{ t('budget.editor.goal') }} <span class="opt">{{ t('common.optional') }}</span></label><Tip :text="t('budget.editor.goalTip')" /></div>
            <MoneyInput id="bi-goal" v-model="goal" empty="null" :placeholder="t('budget.editor.goalPh')" />
          </div>
        </template>
        <div v-else class="field">
          <div class="lrow"><label for="bi-limit">{{ t('budget.editor.limit') }} <span class="opt">{{ t('common.optional') }}</span></label><Tip :text="t('budget.editor.limitTip')" /></div>
          <MoneyInput id="bi-limit" v-model="limit" empty="null" />
          <span v-if="limitFilled" class="hint">{{ t('budget.editor.limitFilled', { kind: limitFilled }) }}</span>
        </div>
        <div class="field">
          <span id="bi-from-l" class="flabel">{{ t('budget.editor.from') }}</span>
          <Seg v-model="fromSel" :options="fromOpts" labelledby="bi-from-l" />
        </div>
        <div v-if="memoOpen" class="field">
          <label for="bi-note">{{ t('budget.editor.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="bi-note" v-model="edit.note" class="in" rows="2" :placeholder="t('budget.editor.notePh')"></textarea>
        </div>
        <div v-else class="field">
          <span class="flabel">{{ t('budget.editor.note') }} <span class="opt">{{ t('common.optional') }}</span></span>
          <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('budget.editor.addNote') }}</button>
        </div>
      </template>
    </template>
    <template v-if="!isNew" #after>
      <div class="danger">
        <span><b>{{ t(saving ? 'budget.editor.deleteSaving' : 'budget.editor.deleteInvest') }}</b>{{ t('budget.editor.deleteGroupText') }}</span>
        <button class="btn sm bad" type="button" @click="askDel = true">{{ t('common.delete') }}</button>
      </div>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit && props.initial" :title="t(saving ? 'budget.editor.deleteTitleSaving' : 'budget.editor.deleteTitleInvest', { name: props.initial.name })"
    :confirm-label="t('common.delete')" :cancel-label="t('budget.editor.keep')" danger :busy="busy" @confirm="confirmDelete" @cancel="askDel = false"
  >
    <p>{{ props.mode === 'ratio' ? t('budget.editor.deleteBodyRatio', { amount: wonText(delAmount) }) : t('budget.editor.deleteBodyAmount', { amount: wonText(delAmount), cat }) }}</p>
    <p>{{ t('budget.editor.deleteBodyRecords') }}</p>
  </ConfirmDialog>
</template>

<style scoped src="./budget-editor.css"></style>
