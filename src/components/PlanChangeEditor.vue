<script setup lang="ts">
// 플랜 전환 예약·수정 (spec 010 S-7): two steps, 대상 · 적용일 and 새 플랜 · 금액. Every field of the
// change stays optional as it is today (S-10): VAT, 상태 and "그대로" choices, and a cancelled
// subscription is still a target (re-subscribing is a plan change). 예약 취소 (edit mode) asks first.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import { useEditor } from '../lib/useEditor'
import { pricedSettings, store } from '../lib/store'
import { cycleLabel, statusLabel } from '../lib/labels'
import { fmtMoney } from '../lib/display'
import { addYm, monthlyKrw, monthMoney, num, planAt, today, ymOf } from '../lib/calc'
import type { Plan, PlanChange, Subscription } from '../data/types'
import Select from './Select.vue'
import DateInput from './DateInput.vue'

const props = defineProps<{ initial: PlanChange | null }>()
const emit = defineEmits<{ close: [] }>()

const now = today()
const DATE = /^\d{4}-\d{2}-\d{2}$/
const blank = (): PlanChange => ({ id: '', subId: store.subscriptions[0]?.id ?? '', effective: `${addYm(ymOf(now), 1)}-01`, to: {}, note: '' })
function validate(c: PlanChange) {
  if (!c.subId) { step.value = 0; return t('subscriptions.needSub') }
  if (!Object.keys(c.to).length) return t('subscriptions.needField')
  return null
}
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('planChanges', blank, validate)
open(props.initial ?? undefined)
const title = props.initial ? t('subscriptions.editChangeTitle', { name: store.subscriptions.find((s) => s.id === props.initial!.subId)?.name ?? '' }) : t('subscriptions.addChange')
watch(edit, (v) => { if (!v) emit('close') })

const step = ref(0)
const memoOpen = ref(!!edit.value?.note)
const askDel = ref(false)
const isNew = !props.initial
const steps = computed(() => [t('subscriptions.stepTarget'), t('subscriptions.stepNewPlan')])
const keep = () => ({ id: '', label: t('subscriptions.unchanged') })
const currencyOpts = computed(() => [keep(), { id: 'KRW', label: 'KRW' }, { id: 'USD', label: 'USD' }])
const cycleOpts = computed(() => [keep(), ...(['monthly', 'yearly'] as const).map((id) => ({ id, label: cycleLabel(id) }))])
const statusOpts = computed(() => [keep(), ...(['active', 'company', 'cancelled'] as const).map((id) => ({ id, label: statusLabel(id) }))])

// ---------- step 1 ----------
const subs = computed(() => store.subscriptions)
const sub = computed(() => subs.value.find((s) => s.id === edit.value?.subId))
const others = computed(() => store.planChanges.filter((c) => c.id !== edit.value?.id))
// No date is "날짜 미정" (`effective: null`).
const undated = computed(() => !DATE.test(edit.value?.effective ?? ''))
const effective = computed({
  get: () => edit.value!.effective ?? '',
  set: (v: string) => { edit.value!.effective = v === '' ? null : v },
})
function toggleUndated(on: boolean) {
  edit.value!.effective = on ? null : `${addYm(ymOf(now), 1)}-01`
}
const chargeText = (p: Plan) => (p.currency === 'USD' ? `USD ${p.amount.toFixed(2)}${p.vat ? ` +${p.vat}%` : ''}` : `KRW ${num(p.amount)}`)
const current = computed(() => {
  const s = sub.value
  if (!s) return ''
  const p = planAt(s, others.value, ymOf(now))
  return `${(p.plan || '—').split('\n')[0]} · ${chargeText(p)} / ${p.cycle === 'yearly' ? t('subscriptions.perYear') : t('subscriptions.perMonth')}${p.status === 'active' ? '' : ` · ${statusLabel(p.status)}`}`
})

// ---------- step 2 ----------
type To = Partial<Plan>
function field<K extends keyof Plan>(key: K, parse: (v: unknown) => Plan[K]) {
  return computed({
    get: () => edit.value!.to[key] ?? '',
    set: (v: unknown) => {
      const to = edit.value!.to as To
      if (v === '' || v == null) delete to[key]
      else to[key] = parse(v)
    },
  })
}
const planText = field('plan', (v) => String(v))
const amount = field('amount', (v) => Number(v))
const vat = field('vat', (v) => Number(v))
const currency = field('currency', (v) => v as Plan['currency'])
const cycle = field('cycle', (v) => v as Plan['cycle'])
const status = field('status', (v) => v as Plan['status'])
const month = computed(() => (undated.value ? ymOf(now) : edit.value!.effective!.slice(0, 7)))
// VAT is always there (it was before the redesign); it only counts for USD, which the hint says.
const isUsd = computed(() => (edit.value?.to.currency ?? (sub.value ? planAt(sub.value, others.value, month.value).currency : undefined)) === 'USD')

const mo = (p: Subscription) => (p.status === 'active' ? monthlyKrw(p, pricedSettings()) : 0)
/** Monthly amount of this subscription and the subscription transfer, without and with the change, in the month it applies (an undated one: this month). */
const pv = computed(() => {
  const e = edit.value
  const s = sub.value
  if (!e || !s) return null
  const draft: PlanChange = { ...e, effective: `${month.value}-01`, to: { ...e.to } }
  const withDraft = [...others.value, draft]
  return {
    before: mo(planAt(s, others.value, month.value)),
    after: mo(planAt(s, withDraft, month.value)),
    // Both sides carry the month's one-off spendings, so the difference stays the plan change's own.
    xa: monthMoney({ ...store, planChanges: others.value }, month.value).transfer.transfer,
    xb: monthMoney({ ...store, planChanges: withDraft }, month.value).transfer.transfer,
  }
})
const delta = (n: number) => (Math.abs(n) < 1 ? '' : ` (${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))})`)

function canAdvance(from: number) {
  if (from === 0 && !edit.value!.subId) {
    error.value = t('subscriptions.needSub')
    return false
  }
  error.value = ''
  return true
}
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :steps="steps" :error="error" :busy="busy" :hint="t('subscriptions.saveHint')"
    :can-advance="canAdvance" @save="saveDraft" @cancel="close"
  >
    <template #default="{ step: s }">
      <template v-if="s === 0">
        <div class="field">
          <label for="c-sub" class="req">{{ t('subscriptions.targetSub') }}</label>
          <Select id="c-sub" v-model="edit.subId" :options="subs.map((x) => ({ value: x.id, label: x.name }))" />
          <span v-if="current" class="hint">{{ t('subscriptions.currentPlan', { plan: current }) }}</span>
        </div>
        <div class="field">
          <label for="c-eff">{{ t('subscriptions.effective') }}</label>
          <DateInput id="c-eff" v-model="effective" :disabled="undated" :aria-label="t('subscriptions.effective')" />
          <label class="undated" for="c-undated"><input id="c-undated" type="checkbox" :checked="undated" @change="toggleUndated(($event.target as HTMLInputElement).checked)">{{ t('subscriptions.noDate') }}</label>
          <span class="hint">{{ undated ? t('subscriptions.dateHintUndated') : t('subscriptions.dateHintDated') }}</span>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label for="c-plan">{{ t('subscriptions.newPlan') }}</label>
          <textarea id="c-plan" v-model="planText" class="in" rows="2" :placeholder="t('subscriptions.newPlanPh')"></textarea>
          <span class="hint">{{ t('subscriptions.keepHint') }}</span>
        </div>
        <div class="field">
          <label for="c-amt">{{ t('subscriptions.newAmount') }}</label>
          <div class="amt-row">
            <Seg v-model="currency" class="cur" :options="currencyOpts" :label="t('subscriptions.currency')" />
            <MoneyInput id="c-amt" v-model="amount" decimal prefix="" />
          </div>
        </div>
        <div class="field">
          <label for="c-vat">VAT (%)</label>
          <MoneyInput id="c-vat" v-model="vat" decimal prefix="" />
          <span v-if="!isUsd" class="hint">{{ t('subscriptions.vatUsdOnly') }}</span>
        </div>
        <div class="field">
          <span id="c-cy-l" class="flabel">{{ t('subscriptions.billingCycle') }}</span>
          <Seg v-model="cycle" :options="cycleOpts" labelledby="c-cy-l" />
        </div>
        <div class="field">
          <span id="c-st-l" class="flabel">{{ t('subscriptions.status') }}</span>
          <Seg v-model="status" :options="statusOpts" labelledby="c-st-l" />
          <span class="hint">{{ t('subscriptions.cancelHint') }}</span>
        </div>
        <div v-if="memoOpen" class="field">
          <label for="c-note">{{ t('subscriptions.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="c-note" v-model="edit.note" class="in" rows="2" :placeholder="t('subscriptions.changeNotePh')"></textarea>
        </div>
        <button v-else class="btn sm ghost addnote" type="button" @click="memoOpen = true">+ {{ t('subscriptions.addNote') }}</button>

        <div v-if="pv" class="pvw" :aria-label="t('subscriptions.changePreview')" role="group">
          <div><span>{{ t('subscriptions.monthlyShort') }}</span><b class="pos">{{ fmtMoney(pv.before) }} → {{ fmtMoney(pv.after) }}{{ delta(pv.after - pv.before) }}</b></div>
          <div><span>{{ sub ? t('subscriptions.transferTo') : '' }}</span><b>{{ fmtMoney(pv.xa) }} → {{ fmtMoney(pv.xb) }}</b></div>
        </div>

        <div v-if="!isNew" class="danger">
          <div class="drow">
            <span><b class="bad">{{ t('subscriptions.cancelChange') }}</b>{{ t('subscriptions.cancelChangeText') }}</span>
            <button class="btn sm bad" type="button" @click="askDel = true">{{ t('subscriptions.cancelChange') }}</button>
          </div>
        </div>
      </template>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit" :title="t('subscriptions.cancelChangeTitle')" :confirm-label="t('subscriptions.cancelChange')" :cancel-label="t('subscriptions.keepChange')" danger :busy="busy"
    @confirm="remove" @cancel="askDel = false"
  >
    <p>{{ t('subscriptions.cancelChangeBody') }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </ConfirmDialog>
</template>

<style scoped>
.req::after{content:" *";color:var(--accent-text)}
.flabel{font-size:13px;color:var(--text-2);font-weight:600}
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.err{font-size:12px;color:var(--neg-text);margin:0}
.undated{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:14px;color:var(--text-2);font-weight:400;cursor:pointer}
.undated input{width:18px;height:18px;margin:0;accent-color:var(--primary)}
.amt-row{display:flex;gap:8px;align-items:center}
.amt-row :deep(.money){flex:1;min-width:0}
.amt-row .cur{flex:none;width:auto}
@media (max-width:760px){
  .dlg .amt-row .cur{display:inline-flex;width:auto}
  .amt-row .cur :deep(button){flex:none;padding:0 12px}
}
.addnote{align-self:flex-start;padding:0 4px}
.pvw{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:var(--r-card);background:var(--primary-tint);border:1px solid var(--primary-line);font-size:13px}
.pvw div{display:flex;justify-content:space-between;gap:12px}
.pvw span{color:var(--text-2)}
.pvw b{font-variant-numeric:tabular-nums;color:var(--text-2);text-align:right}
.pvw b.pos{color:var(--primary-text)}
.danger{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.drow{display:flex;align-items:center;gap:12px}
.drow span{flex:1;min-width:0;font-size:13px;color:var(--text-2)}
.drow span b{display:block;color:var(--neg-text)}
.drow .btn{flex:none}
</style>
