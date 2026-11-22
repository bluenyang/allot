<script setup lang="ts">
// 생활비 항목 추가·수정 (spec 013 S-2, S-4; canvas AppLiving): two steps. Step 1: 분류 (chips 식비·교통·용돈·
// 생필품·기타; 기타 → free text; a stored value that is no chip stays as typed), 이름, 주로 쓰는 결제 수단 (chips,
// optional, pressing the chosen one clears it; a stored value that is no chip is kept as an extra chip).
// Step 2: 매달 금액, 언제부터 (this or next month, or the stored month as it is — null stays null), 구간별 금액
// (optional, one field per phase; empty = the monthly amount), 메모. Delete asks first with the canvas copy.
// Every change goes to the API (useEditor); the three moved items (code food/transit/allowance) are ordinary
// items here and keep their code.
import { computed, ref, watch } from 'vue'
import { t, type MessageKey } from '../i18n'
import EditSheet from './EditSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Tip from './Tip.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { addYm, livingAt, phaseAt, phaseNumbers, today, ymOf } from '../lib/calc'
import { baseAmount, chipOf, chipValue, fromChoice, fromOf, type Chip, type ChipPick, type FromChoice } from '../lib/budget-page'
import { wonText } from '../lib/format'
import type { LivingItem } from '../data/types'

const props = defineProps<{ initial: LivingItem | null }>()
const emit = defineEmits<{ close: [] }>()

const now = ymOf(today())
const KIND_IDS = ['food', 'transit', 'allowance', 'goods', 'other'] as const
const METHOD_IDS = ['debit', 'credit', 'cash', 'transfer'] as const
// The chip labels are the words stored in the free-text field, in the screen language when the editor opens.
const kinds: Chip[] = KIND_IDS.map((id) => ({ id, label: t(`budget.kinds.living.${id}` as MessageKey) }))
const otherLabel = kinds.find((k) => k.id === 'other')!.label
const methods: Chip[] = METHOD_IDS.map((id) => ({ id, label: t(`budget.methods.${id}` as MessageKey) }))

const blank = (): LivingItem => ({
  id: '', name: '', kind: '', payMethod: '', amount: '' as unknown as number, from: addYm(now, 1), code: null, note: '', amounts: {},
})
const step = ref(0)
function validate(x: LivingItem) {
  if (!x.name.trim()) { step.value = 0; return t('budget.editor.needName') }
  if (typeof x.amount !== 'number') { step.value = 1; return t('budget.editor.needAmount') }
  return null
}
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('livingItems', blank, validate)
open(props.initial ?? undefined)
if (edit.value) {
  edit.value.note ??= ''
  edit.value.amounts ??= {}
}
watch(edit, (v) => { if (!v) emit('close') })
const isNew = !props.initial
const title = props.initial ? t('budget.editor.editLiving', { name: props.initial.name }) : t('budget.editor.addLiving')
const steps = computed(() => [t('budget.editor.stepBasic'), t('budget.editor.stepAmount')])

// ---------- step 1 ----------
const kindPick = ref<ChipPick>(isNew ? { id: kinds[0]!.id, text: '' } : chipOf(props.initial!.kind, kinds, 'other'))
// the typed text is kept while another chip is chosen, so going back to 기타 finds it again
// pressing the chosen chip again chooses none: the kind may be empty, as the API takes (review 1 F-14)
const pickKind = (id: string) => { kindPick.value = { id: kindPick.value.id === id ? null : id, text: kindPick.value.text } }
/** A stored pay method that is none of the chips: shown as one more chip so it is kept. */
const extraMethod = props.initial?.payMethod && !methods.some((m) => m.label === props.initial!.payMethod) ? props.initial.payMethod : ''
const methodChips = computed(() => [...methods.map((m) => m.label), ...(extraMethod ? [extraMethod] : [])])
const pickMethod = (label: string) => { edit.value!.payMethod = edit.value!.payMethod === label ? '' : label }

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
const others = computed(() => livingAt(store.livingItems.filter((x) => x.id !== edit.value?.id), store.phases, now).sum)
const keptFrom = props.initial ? props.initial.from : null
const fromSel = ref<FromChoice>(props.initial ? fromChoice(props.initial.from, now) : 'next')
const fromOpts = computed(() => [
  ...(props.initial && fromChoice(keptFrom, now) === 'kept' ? [{ id: 'kept', label: keptFrom ? t('budget.editor.fromKept', { ym: keptFrom }) : t('budget.editor.fromStart') }] : []),
  { id: 'now', label: t('budget.editor.fromNow') },
  { id: 'next', label: t('budget.editor.fromNext') },
])

const numbers = computed(() => phaseNumbers(store.phases))
const phaseList = computed(() => [...store.phases].sort((a, b) => (numbers.value[a.id] ?? 0) - (numbers.value[b.id] ?? 0)))
const phasesOpen = ref(Object.keys(props.initial?.amounts ?? {}).length > 0)
const phaseValue = (id: string) => edit.value!.amounts[id] ?? null
function setPhase(id: string, v: number | '' | null) {
  if (v === null || v === '') delete edit.value!.amounts[id]
  else edit.value!.amounts[id] = v
}
const memoOpen = ref(!!edit.value?.note)

function save() {
  const x = edit.value
  if (!x) return
  x.kind = chipValue(kindPick.value, kinds, 'other', otherLabel)
  x.from = fromOf(fromSel.value, keptFrom, now)
  void saveDraft()
}

// ---------- delete ----------
const askDel = ref(false)
const delAmount = computed(() => (props.initial ? baseAmount(props.initial, phaseAt(store.phases, now)).amount : 0))
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
          <span id="lv-kind-l" class="flabel">{{ t('budget.editor.kindLiving') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="lv-kind-l">
            <button v-for="k in kinds" :key="k.id" type="button" role="radio" class="chip" :class="{ on: kindPick.id === k.id }" :aria-checked="kindPick.id === k.id ? 'true' : 'false'" @click="pickKind(k.id)">{{ k.label }}</button>
          </div>
          <input v-if="kindPick.id === 'other'" v-model="kindPick.text" class="in" autocomplete="off" :aria-label="t('budget.editor.kindOther')" :placeholder="t('budget.editor.kindOther')">
        </div>
        <div class="field">
          <label for="lv-name">{{ t('budget.editor.name') }}<span class="star" aria-hidden="true">*</span></label>
          <input id="lv-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('budget.editor.namePhLiving')">
        </div>
        <div class="field">
          <span id="lv-pm-l" class="flabel">{{ t('budget.editor.payMethod') }} <span class="opt">{{ t('common.optional') }}</span></span>
          <div class="chips" role="group" aria-labelledby="lv-pm-l">
            <button v-for="m in methodChips" :key="m" type="button" class="chip" :class="{ on: edit.payMethod === m }" :aria-pressed="edit.payMethod === m ? 'true' : 'false'" @click="pickMethod(m)">{{ m }}</button>
          </div>
          <span class="hint">{{ t('budget.editor.payMethodHint') }}</span>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <div class="lrow"><label for="lv-amount">{{ t('budget.editor.amountLiving') }}<span class="star" aria-hidden="true">*</span></label><Tip :text="t('budget.editor.amountTipLiving', { others: wonText(others) })" /></div>
          <MoneyInput id="lv-amount" v-model="amount" />
        </div>
        <div class="field">
          <span id="lv-from-l" class="flabel">{{ t('budget.editor.from') }}</span>
          <Seg v-model="fromSel" :options="fromOpts" labelledby="lv-from-l" />
        </div>
        <div v-if="phaseList.length" class="field">
          <button class="fold-b" type="button" :aria-expanded="phasesOpen ? 'true' : 'false'" aria-controls="lv-phases" @click="phasesOpen = !phasesOpen">
            <span>{{ t('budget.editor.phases') }} <span class="opt">{{ t('common.optional') }}</span></span>
            <span class="chv" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
          </button>
          <div v-show="phasesOpen" id="lv-phases" class="phs">
            <span class="hint">{{ t('budget.editor.phasesHint') }}</span>
            <div v-for="p in phaseList" :key="p.id" class="field">
              <label :for="`lv-ph-${p.id}`">{{ t('budget.editor.phaseLabel', { n: numbers[p.id] ?? 0, name: p.name }) }}</label>
              <MoneyInput :id="`lv-ph-${p.id}`" :model-value="phaseValue(p.id)" empty="null" :placeholder="typeof amount === 'number' ? wonText(amount) : ''" :aria-describedby="`lv-ph-${p.id}-h`" @update:model-value="setPhase(p.id, $event)" />
              <span :id="`lv-ph-${p.id}-h`" class="hint">{{ p.to ? t('budget.editor.phaseRange', { from: p.from, to: p.to }) : t('budget.editor.phaseOpen', { from: p.from }) }}</span>
            </div>
          </div>
        </div>
        <div v-if="memoOpen" class="field">
          <label for="lv-note">{{ t('budget.editor.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="lv-note" v-model="edit.note" class="in" rows="2" :placeholder="t('budget.editor.notePh')"></textarea>
        </div>
        <div v-else class="field">
          <span class="flabel">{{ t('budget.editor.note') }} <span class="opt">{{ t('common.optional') }}</span></span>
          <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('budget.editor.addNote') }}</button>
        </div>
      </template>
    </template>
    <template v-if="!isNew" #after>
      <div class="danger">
        <span><b>{{ t('budget.editor.deleteLiving') }}</b>{{ t('budget.editor.deleteLivingText') }}</span>
        <button class="btn sm bad" type="button" @click="askDel = true">{{ t('common.delete') }}</button>
      </div>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit && props.initial" :title="t('budget.editor.deleteTitleLiving', { name: props.initial.name })" :confirm-label="t('common.delete')"
    :cancel-label="t('budget.editor.keep')" danger :busy="busy" @confirm="confirmDelete" @cancel="askDel = false"
  >
    <p>{{ t('budget.editor.deleteBodyLiving', { amount: wonText(delAmount) }) }}</p>
  </ConfirmDialog>
</template>

<style scoped src="./budget-editor.css"></style>
