<script setup lang="ts">
// 구독 추가·수정 (spec 010 S-7): two steps, 기본 정보 and 결제. Edit mode ends step 2 with a box for
// "해지로 바꾸기" and 구독 삭제 (asks first). Every change goes through the API (useEditor); the page
// closes the editor when `close` is emitted. The amount takes everything a number field took (S-10).
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Soon from './Soon.vue'
import Tip from './Tip.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { CATEGORY_IDS, catLabel, cycleLabel, pathLabel, statusLabel } from '../lib/labels'
import { chargeKrw, monthlyKrw, num, planAt, usd, ymLabel } from '../lib/calc'
import { wonText } from '../lib/format'
import type { PlanChange, Subscription } from '../data/types'
import Select from './Select.vue'

const props = defineProps<{ initial: Subscription | null; /** The page's 기준 월, for the "전환 적용 중" note. */ ym: string }>()
const emit = defineEmits<{ close: []; editChange: [c: PlanChange] }>()

const PATH_IDS = ['direct', 'google', 'apple', 'telecom'] as const
const STATUS_IDS = ['active', 'company', 'cancelled'] as const

const blank = (): Subscription => ({
  id: '', name: '', category: 'tool', plan: '', amount: 0, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '', path: 'direct', verified: false, note: '',
})
function validate(s: Subscription) {
  if (!s.name.trim()) { step.value = 0; return t('subscriptions.needName') }
  if (typeof s.amount !== 'number' || !(s.amount >= 0)) return t('subscriptions.needAmount')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.nextDate)) return t('subscriptions.needNext')
  return null
}
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('subscriptions', blank, validate)
open(props.initial ?? undefined)
if (edit.value) edit.value.note ??= ''
// The title keeps the name the editor was opened with, not what is being typed.
const title = props.initial ? t('subscriptions.editTitle', { name: props.initial.name }) : t('subscriptions.addTitle')
watch(edit, (v) => { if (!v) emit('close') })

const step = ref(0)
const memoOpen = ref(!!edit.value?.note)
const askDel = ref(false)
const steps = computed(() => [t('subscriptions.stepBasic'), t('subscriptions.stepPay')])
const statusOpts = computed(() => STATUS_IDS.map((id) => ({ id, label: statusLabel(id) })))
const cycleOpts = computed(() => (['monthly', 'yearly'] as const).map((id) => ({ id, label: cycleLabel(id) })))
const currencyOpts = [{ id: 'KRW', label: 'KRW' }, { id: 'USD', label: 'USD' }]
const isNew = !props.initial

// The model of an amount field is a number, or '' while it is empty.
const amount = computed({
  get: () => edit.value!.amount as number | '',
  set: (v) => { edit.value!.amount = v as number },
})
const vat = computed({
  get: () => edit.value!.vat as number | '',
  set: (v) => { edit.value!.vat = v as number },
})

function canAdvance(from: number) {
  if (from === 0 && !edit.value!.name.trim()) {
    error.value = t('subscriptions.needName')
    return false
  }
  error.value = ''
  return true
}
function save() {
  const s = edit.value
  if (!s) return
  if (s.currency === 'KRW') s.vat = 0
  else if ((s.vat as unknown) === '') s.vat = 0
  void saveDraft()
}

// ---------- step 2 ----------
const PLAN_KEYS = ['plan', 'amount', 'currency', 'vat', 'cycle', 'status'] as const
const planLabel = (): Record<(typeof PLAN_KEYS)[number], string> => ({ plan: t('subscriptions.plan'), amount: t('subscriptions.amount'), currency: t('subscriptions.currency'), vat: 'VAT', cycle: t('subscriptions.cycle'), status: t('subscriptions.status') })
function show(k: (typeof PLAN_KEYS)[number], p: Subscription) {
  if (k === 'amount') return p.currency === 'USD' ? usd(p.amount) : wonText(p.amount)
  if (k === 'cycle') return cycleLabel(p.cycle)
  if (k === 'status') return statusLabel(p.status)
  if (k === 'vat') return `${p.vat}%`
  return String(p[k] || '—')
}
/** Fields where a plan change already in effect at the 기준 월 overrides the base value being edited. */
const overridden = computed(() => {
  const e = edit.value
  if (!e?.id) return null
  const applied = store.planChanges.filter((c) => c.subId === e.id && c.effective && c.effective.slice(0, 7) <= props.ym)
  if (!applied.length) return null
  const eff = planAt(e, store.planChanges, props.ym)
  const fields = PLAN_KEYS.filter((k) => eff[k] !== e[k]).map((k) => ({ k, label: planLabel()[k], base: show(k, e), now: show(k, eff) }))
  return fields.length ? { fields, changes: applied } : null
})
const draft = computed(() => ({ ...edit.value!, amount: Number(edit.value!.amount) || 0, vat: Number(edit.value!.vat) || 0 }))
const monthly = computed(() => wonText(monthlyKrw(draft.value, store.settings)) + (draft.value.cycle === 'yearly' ? ` ${t('subscriptions.yearOf', { amount: wonText(chargeKrw(draft.value, store.settings)) })}` : ''))
const fx = computed(() => `₩${num(store.settings.fxRate)}`)

function toCancelled() { edit.value!.status = 'cancelled' }
async function confirmDelete() { await remove() }
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :steps="steps" :error="error" :busy="busy" :hint="t('subscriptions.saveHint')"
    :can-advance="canAdvance" @save="save" @cancel="close"
  >
    <template #default="{ step: s }">
      <template v-if="s === 0">
        <div class="field">
          <label for="e-name" class="req">{{ t('subscriptions.serviceName') }}</label>
          <input id="e-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('subscriptions.namePh')">
        </div>
        <div class="field">
          <span id="e-cat-l" class="flabel">{{ t('subscriptions.category') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="e-cat-l">
            <button v-for="k in CATEGORY_IDS" :key="k" type="button" role="radio" class="chip" :class="{ on: edit.category === k }" :aria-checked="edit.category === k ? 'true' : 'false'" @click="edit.category = k">{{ catLabel(k) }}</button>
            <Soon class="chip off" :aria-label="`${t('subscriptions.catOther')} (${t('common.soon')})`">{{ t('subscriptions.catOther') }}</Soon>
          </div>
        </div>
        <div class="field">
          <label for="e-plan">{{ t('subscriptions.colPlan') }}</label>
          <textarea id="e-plan" v-model="edit.plan" class="in" rows="2" :placeholder="t('subscriptions.planPh')"></textarea>
          <span class="hint">{{ t('subscriptions.planHint') }}</span>
        </div>
        <div class="field">
          <span id="e-st-l" class="flabel">{{ t('subscriptions.status') }}</span>
          <Seg v-model="edit.status" :options="statusOpts" labelledby="e-st-l" />
        </div>
      </template>

      <template v-else>
        <div class="amt" :class="{ two: edit.currency === 'USD' }">
          <div class="field">
            <label for="e-amount" class="req">{{ t('subscriptions.amount') }}</label>
            <div class="amt-row">
              <Seg v-model="edit.currency" class="cur" :options="currencyOpts" :label="t('subscriptions.currency')" />
              <MoneyInput id="e-amount" v-model="amount" decimal prefix="" />
            </div>
          </div>
          <div v-if="edit.currency === 'USD'" class="field">
            <div class="lrow"><label for="e-vat">VAT (%)</label><Tip :text="t('subscriptions.vatTip', { rate: fx })" /></div>
            <MoneyInput id="e-vat" v-model="vat" decimal prefix="" />
          </div>
        </div>
        <div class="two">
          <div class="field">
            <span id="e-cy-l" class="flabel">{{ t('subscriptions.billingCycle') }}</span>
            <Seg v-model="edit.cycle" :options="cycleOpts" labelledby="e-cy-l" />
          </div>
          <div class="field">
            <label for="e-next">{{ t('subscriptions.nextDate') }}</label>
            <input id="e-next" v-model="edit.nextDate" class="in" type="date">
          </div>
        </div>
        <div class="two">
          <div class="field">
            <div class="lrow"><label for="e-path">{{ t('subscriptions.path') }}</label><Tip :text="t('subscriptions.pathTip')" /></div>
            <Select id="e-path" v-model="edit.path" :options="PATH_IDS.map((k) => ({ value: k, label: pathLabel(k) }))" />
          </div>
          <div class="field">
            <div class="lrow"><span class="flabel">{{ t('subscriptions.colReceipt') }}</span><Tip :text="t('subscriptions.receiptTip')" /></div>
            <label class="vchk" for="e-ver"><input id="e-ver" v-model="edit.verified" type="checkbox"><span>{{ t('subscriptions.verifiedLabel') }}</span></label>
          </div>
        </div>
        <div v-if="memoOpen" class="field">
          <label for="e-note">{{ t('subscriptions.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="e-note" v-model="edit.note" class="in" rows="2" :placeholder="t('subscriptions.notePh')"></textarea>
        </div>
        <div v-else class="field">
          <span class="flabel">{{ t('subscriptions.note') }} <span class="opt">{{ t('common.optional') }}</span></span>
          <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('subscriptions.addNote') }}</button>
        </div>

        <div v-if="overridden" class="callout warn" data-testid="override-note">
          <span class="lbl">{{ t('subscriptions.overrideLabel') }}</span>
          <p><i18n-t keypath="subscriptions.overrideIntro" tag="span"><template #base><b>{{ t('subscriptions.base') }}</b></template><template #ym>{{ ymLabel(props.ym) }}</template></i18n-t>
            <template v-for="(f, i) in overridden.fields" :key="f.k">{{ i ? ', ' : ' ' }}{{ t('subscriptions.overrideField', { label: f.label, base: f.base }) }} <b>{{ f.now }}</b></template>.
            {{ t('subscriptions.overrideOutro') }}
            <button v-for="c in overridden.changes" :key="c.id" class="btn sm" type="button" @click="emit('editChange', c)">{{ t('subscriptions.editChangeOf', { date: c.effective ?? '' }) }}</button>
          </p>
        </div>

        <div class="pvw"><span>{{ t('subscriptions.monthlyPreview') }}</span><b>{{ monthly }}</b></div>

        <div v-if="!isNew" class="danger">
          <div class="drow">
            <span><b>{{ t('subscriptions.toCancelTitle') }}</b>{{ t('subscriptions.toCancelText') }}</span>
            <button class="btn sm" type="button" :disabled="edit.status === 'cancelled'" @click="toCancelled">{{ statusLabel('cancelled') }}</button>
          </div>
          <div class="drow">
            <span><b class="bad">{{ t('subscriptions.deleteSub') }}</b>{{ t('subscriptions.deleteSubText') }}</span>
            <button class="btn sm bad" type="button" @click="askDel = true">{{ t('common.delete') }}</button>
          </div>
        </div>
      </template>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit" :title="t('subscriptions.deleteTitle', { name: props.initial?.name ?? '' })" :confirm-label="t('common.delete')" danger :busy="busy"
    @confirm="confirmDelete" @cancel="askDel = false"
  >
    <p>{{ t('subscriptions.deleteBody') }}</p>
    <p class="hint">{{ t('subscriptions.deleteHint') }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </ConfirmDialog>
</template>

<style scoped>
.req::after{content:" *";color:var(--accent-text)}
.flabel{font-size:13px;color:var(--text-2);font-weight:600}
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.err{font-size:12px;color:var(--neg-text);margin:0}
.lrow{display:flex;align-items:center;gap:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips .chip.off{border:1px dashed var(--border-strong);border-radius:16px;padding:0 12px;height:36px;background:transparent}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 14px;align-items:start}
.amt{display:grid;grid-template-columns:minmax(0,1fr);gap:16px 14px;align-items:start}
.amt.two{grid-template-columns:minmax(0,1fr) 140px}
.amt-row{display:flex;gap:8px;align-items:center}
.amt-row :deep(.money){flex:1;min-width:0}
.amt-row .cur{flex:none;width:auto}
@media (max-width:760px){
  .two,.amt.two{grid-template-columns:minmax(0,1fr)}
  dialog .amt-row .cur{display:inline-flex;width:auto}
  .amt-row .cur :deep(button){flex:none;padding:0 12px}
}
.vchk{display:flex;align-items:center;gap:10px;height:44px;padding:0 12px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--input);font-size:14px;color:var(--text-2);cursor:pointer}
.vchk input{width:16px;height:16px;margin:0;accent-color:var(--primary)}
.memo-add{display:flex;align-items:center;gap:8px;width:100%;height:44px;padding:0 12px;border:1px dashed var(--border-strong);border-radius:var(--r-ctl);background:var(--input);color:var(--muted);font:inherit;font-size:14px;cursor:pointer;text-align:left}
.memo-add:hover{border-color:var(--primary-text);color:var(--primary-text)}
.pvw{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--r-card);background:var(--primary-tint);border:1px solid var(--primary-line);font-size:13px}
.pvw span{color:var(--text-2)}
.pvw b{font-variant-numeric:tabular-nums;color:var(--primary-text);text-align:right}
.callout{margin:0}
.danger{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.drow{display:flex;align-items:center;gap:12px}
.drow + .drow{padding-top:10px;border-top:1px solid var(--neg-line)}
.drow span{flex:1;min-width:0;font-size:13px;color:var(--text-2)}
.drow span b{display:block;color:var(--text)}
.drow span b.bad{color:var(--neg-text)}
.drow .btn{flex:none}
</style>
