<script setup lang="ts">
// 통장 추가·수정 (spec 013 S-5, S-7, S-11): two steps on EditSheet + useEditor. Step 1 기본 정보 (name, bank,
// last 4 digits, role, money in / out as free text), step 2 돈 (buffer, goal, yearly limit, note). The old
// fields (name, role, inflow, outflow) are taken and stored as before; the role chips only fill the free
// text, and any text already stored stays as it is. The whole stored row goes back, so the fields this
// editor does not show (group, amount, ratio, from, kind, rate, term, goalAck, amounts) keep their values.
// A stopped account (stopFrom) can be sent to again here. The API decides what is valid (the last 4
// digits, amounts) and its message is shown; delete is refused while a buffer use needs this account.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Pill from './Pill.vue'
import Tip from './Tip.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { targetsOf } from '../lib/accounts'
import { ymLabel } from '../lib/calc'
import type { Account } from '../data/types'

const props = defineProps<{ initial: Account | null }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): Account => ({ id: '', name: '', role: '', inflow: '', outflow: '', bank: '', last4: '', buffer: 0, goal: null, annualLimit: null, note: '' })
const step = ref(0)
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('accounts', blank, (a) => {
  if (!a.name.trim()) { step.value = 0; return t('payroll.needAccountName') }
  return null
})
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('accounts.editor.editTitle') : t('accounts.editor.addTitle')
const steps = computed(() => [t('accounts.editor.stepBasic'), t('accounts.editor.stepMoney')])

/** The role chips (S-5): they fill the free-text role; the stored words of 0.1.6 (저축·투자) are kept as typed. */
type RoleKey = 'roleIn' | 'roleFixed' | 'roleLiving' | 'roleSaving' | 'roleInvest' | 'roleEtc'
const ROLE_KEYS: RoleKey[] = ['roleIn', 'roleFixed', 'roleLiving', 'roleSaving', 'roleInvest', 'roleEtc']
const roleChips = computed(() => ROLE_KEYS.map((k) => t(`payroll.${k}`)))

const receives = computed(() => (edit.value?.id ? targetsOf(store.targets, edit.value.id) : []))

// Amount fields: a number, or '' while empty. An emptied buffer is 0 (its default); an emptied goal or limit is none (null).
const buffer = computed({
  get: () => (edit.value?.buffer ?? 0) as number | '',
  set: (v) => { edit.value!.buffer = v as number },
})
const goal = computed({
  get: () => edit.value?.goal ?? null,
  set: (v: number | '' | null) => { edit.value!.goal = v === '' ? null : v },
})
const annualLimit = computed({
  get: () => edit.value?.annualLimit ?? null,
  set: (v: number | '' | null) => { edit.value!.annualLimit = v === '' ? null : v },
})

function canAdvance(from: number) {
  if (from === 0 && !edit.value!.name.trim()) {
    error.value = t('payroll.needAccountName')
    return false
  }
  error.value = ''
  return true
}
function save() {
  const a = edit.value
  if (!a) return
  if ((a.buffer as unknown) === '' || a.buffer === undefined) a.buffer = 0
  void saveDraft()
}
/** 다시 보내기 (S-7): clear the stop month and save. */
function resume() {
  if (!edit.value) return
  edit.value.stopFrom = null
  save()
}
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :desc="t('accounts.editor.desc')" :steps="steps" :error="error" :busy="busy"
    :can-advance="canAdvance" :can-delete="!!edit.id" :delete-name="edit.name" @save="save" @cancel="close" @delete="remove"
  >
    <template #default="{ step: s }">
      <div v-if="edit.stopFrom" class="callout warn stop" data-testid="account-stopped">
        <p>{{ t('accounts.editor.stoppedText', { ym: ymLabel(edit.stopFrom) }) }}</p>
        <button class="btn sm" type="button" :disabled="busy" @click="resume">{{ t('accounts.editor.resume') }}</button>
      </div>

      <template v-if="s === 0">
        <div class="field">
          <label for="ac-name">{{ t('payroll.account') }} <span class="star" aria-hidden="true">*</span></label>
          <input id="ac-name" v-model="edit.name" class="in" autocomplete="off">
        </div>
        <div class="field">
          <label for="ac-bank">{{ t('accounts.editor.bank') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <input id="ac-bank" v-model="edit.bank" class="in" autocomplete="off">
          <span class="hint">{{ t('accounts.editor.bankHint') }}</span>
        </div>
        <div class="field">
          <label for="ac-last4">{{ t('accounts.editor.last4') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <input id="ac-last4" v-model="edit.last4" class="in" inputmode="numeric" autocomplete="off" :placeholder="t('accounts.editor.last4Ph')">
        </div>
        <div class="field">
          <label for="ac-role">{{ t('payroll.role') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <div class="chips" role="group" :aria-label="t('payroll.roleQuick')"><Pill v-for="r in roleChips" :key="r" :selected="edit.role === r" @click="edit.role = r">{{ r }}</Pill></div>
          <input id="ac-role" v-model="edit.role" class="in" autocomplete="off">
          <span class="hint">{{ t('payroll.roleHint') }}</span>
        </div>
        <div class="field"><label for="ac-in">{{ t('payroll.inflow') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ac-in" v-model="edit.inflow" class="in" autocomplete="off"></div>
        <div class="field"><label for="ac-out">{{ t('payroll.outflow') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ac-out" v-model="edit.outflow" class="in" autocomplete="off"></div>
        <div v-if="edit.id" class="field">
          <span class="lbl2">{{ t('accounts.editor.receives') }}</span>
          <span class="ro-t">{{ receives.length ? receives.map((x) => x.name).join(', ') : t('accounts.editor.receivesNone') }}</span>
          <span class="hint">{{ t('accounts.editor.receivesHint') }}</span>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <div class="lrow"><label for="ac-buffer">{{ t('accounts.editor.buffer') }}</label><Tip :text="t('accounts.editor.bufferTip')" /></div>
          <MoneyInput id="ac-buffer" v-model="buffer" />
          <span class="hint">{{ t('accounts.editor.bufferHint') }}</span>
        </div>
        <div class="field">
          <label for="ac-goal">{{ t('accounts.editor.goal') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <MoneyInput id="ac-goal" v-model="goal" empty="null" />
          <span class="hint">{{ t('accounts.editor.goalHint') }}</span>
        </div>
        <div class="field">
          <label for="ac-limit">{{ t('accounts.editor.annualLimit') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <MoneyInput id="ac-limit" v-model="annualLimit" empty="null" />
          <span class="hint">{{ t('accounts.editor.limitHint') }}</span>
        </div>
        <div class="field">
          <label for="ac-note">{{ t('accounts.editor.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="ac-note" v-model="edit.note" class="in" rows="2"></textarea>
        </div>
      </template>
    </template>
  </EditSheet>
</template>

<style scoped>
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.lbl2{font-size:12px;font-weight:600;color:var(--text-2)}
.lrow{display:flex;align-items:center;gap:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.ro-t{font-size:14px;color:var(--text)}
.stop{display:flex;align-items:center;gap:12px;margin:0}
.stop p{flex:1;margin:0;font-size:13px}
</style>
