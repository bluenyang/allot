<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import MonthPicker from '../components/MonthPicker.vue'
import StackBar from '../components/StackBar.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import { fmtMoney, fmtMoneyClass } from '../lib/display'
import { saveLiving, saveSettings, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import { kindDetail } from '../lib/labels'
import { distributionAt, splitRemainder, today, ymLabel, ymOf } from '../lib/calc'
import type { AllocationKind, Settings } from '../data/types'

const tab = ref('phases')
const tabs = computed(() => [
  { id: 'phases', label: t('payroll.tabPhases'), icon: 'list' },
  { id: 'sim', label: t('payroll.tabSim'), icon: 'chart' },
  { id: 'accounts', label: t('payroll.tabAccounts'), icon: 'money' },
])
const now = ymOf(today())
const dist = (ym: string, pay = store.settings.netPay) =>
  distributionAt(ym, pay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings)

const phaseRows = computed(() =>
  store.phases.map((p) => {
    const start = p.from < now && (p.to === null || now <= p.to) ? now : p.from
    return { p, start, d: dist(start), current: p.from <= now && (p.to === null || now <= p.to) }
  }),
)

const ym = ref(now)
const pay = ref(store.settings.netPay)
const sim = computed(() => dist(ym.value, pay.value))
// Without a remainder target there is nothing to split (spec 003 S-1: exactly one remainder).
const split = computed(() => (sim.value.remainderTarget ? splitRemainder(sim.value.remainder, store.remainderSplit) : []))
const livingSum = computed(() => store.living.food + store.living.transit + store.living.allowance)
const livingName = computed(() => store.targets.find((t) => t.kind === 'living')?.name ?? t('payroll.living'))
const remainderName = computed(() => store.targets.find((t) => t.kind === 'remainder')?.name ?? t('payroll.remainder'))
const fixedTargets = computed(() => store.targets.filter((t) => t.kind === 'fixed'))

// ---------- editors ----------
const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const phaseEd = useEditor(
  'phases',
  () => ({ id: '', label: '', name: '', from: now, to: null, amounts: {}, note: '' }),
  (p) => (!p.name.trim() ? t('payroll.needPhaseName')
    : !YM.test(p.from) ? t('payroll.needStart')
    : p.to !== null && (!YM.test(p.to) || p.to < p.from) ? t('payroll.endAfterStart')
    : null),
)
// <input type="month"> gives '' for "no end"; the API wants null.
const phaseTo = computed({
  get: () => phaseEd.item.value?.to ?? '',
  set: (v: string) => { if (phaseEd.item.value) phaseEd.item.value.to = v || null },
})

const splitEd = useEditor('remainderSplit', () => ({ id: '', name: '', code: '', ratio: 0 }),
  (x) => (!x.name.trim() ? t('payroll.needItemName') : x.ratio < 0 || x.ratio > 1 ? t('payroll.ratioRange') : null))
const splitPct = computed({
  get: () => Math.round((splitEd.item.value?.ratio ?? 0) * 10_000) / 100,
  set: (v: number) => { if (splitEd.item.value) splitEd.item.value.ratio = (Number(v) || 0) / 100 },
})
const ratioSum = computed(() => Math.round(store.remainderSplit.reduce((a, x) => a + x.ratio, 0) * 100))

const KIND_IDS: AllocationKind[] = ['living', 'subscriptions', 'fixed', 'remainder']
const kindOf = (k: AllocationKind) => t(`payroll.kind.${k}`)
const targetEd = useEditor('targets', () => ({ id: '', name: '', kind: 'fixed', note: '' }),
  (x) => (!x.name.trim() ? t('payroll.needName') : null))

const accEd = useEditor('accounts', () => ({ id: '', name: '', role: '', inflow: '', outflow: '' }),
  (a) => (!a.name.trim() ? t('payroll.needAccountName') : null))

// Settings: edited as a copy and saved with a button, like the list editors.
const set = ref<Settings>({ ...store.settings })
const setMsg = ref('')
function resetSettings() {
  set.value = { ...store.settings }
  setMsg.value = ''
}
async function submitSettings() {
  try {
    await saveSettings(set.value)
    set.value = { ...store.settings }
    setMsg.value = t('settings.general.saved')
  } catch (e) {
    setMsg.value = (e as Error).message
  }
}
</script>

<template>
  <section>
    <PageHeader :title="t('payroll.title')" :desc="t('payroll.desc', { pay: store.settings.payDay, transfer: store.settings.transferDay, name: remainderName })" />

    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'phases'">
      <div class="panel">
        <div class="card-h"><h3>{{ t('payroll.targets') }}</h3><button class="btn sm" type="button" @click="targetEd.open()">{{ t('payroll.addTargetBtn') }}</button></div>
        <EditSheet v-if="targetEd.item.value" :key="targetEd.item.value.id || 'new'" :title="targetEd.item.value.id ? t('payroll.editTarget') : t('payroll.addTarget')" :error="targetEd.error.value" :busy="targetEd.busy.value"
          :can-delete="!!targetEd.item.value.id" @save="targetEd.save" @cancel="targetEd.close" @delete="targetEd.remove">
          <div class="field"><label for="tg-name">{{ t('payroll.name') }}</label><input id="tg-name" v-model="targetEd.item.value.name" class="in"></div>
          <div class="field"><label for="tg-kind">{{ t('payroll.kindLabel') }}</label>
            <select id="tg-kind" v-model="targetEd.item.value.kind" class="in"><option v-for="k in KIND_IDS" :key="k" :value="k">{{ kindOf(k) }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="tg-note">{{ t('payroll.note') }}</label><input id="tg-note" v-model="targetEd.item.value.note" class="in"></div>
        </EditSheet>
        <div class="tbl">
          <table>
            <thead><tr><th>{{ t('payroll.name') }}</th><th>{{ t('payroll.kindLabel') }}</th><th class="c-memo">{{ t('payroll.note') }}</th></tr></thead>
            <tbody>
              <tr v-for="tg in store.targets" :key="tg.id" class="click" tabindex="0" @click="targetEd.open(tg)" @keydown.enter="targetEd.open(tg)">
                <td><i class="dot" :style="{ background: allocColor(tg.id) }"></i>{{ tg.name }}<span v-if="tg.note" class="memo-sm">{{ tg.note }}</span></td><td class="nowrap">{{ kindOf(tg.kind) }}</td><td class="small muted c-memo">{{ tg.note }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin:0">{{ t('payroll.targetsNote') }}</p>
      </div>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="phaseEd.open()">{{ t('payroll.addPhaseBtn') }}</button></div>
      <EditSheet v-if="phaseEd.item.value" :key="phaseEd.item.value.id || 'new'" :title="phaseEd.item.value.id ? t('payroll.editPhase') : t('payroll.addPhase')" :error="phaseEd.error.value" :busy="phaseEd.busy.value"
        :can-delete="!!phaseEd.item.value.id" @save="phaseEd.save" @cancel="phaseEd.close" @delete="phaseEd.remove">
        <div class="field"><label for="ph-label">{{ t('payroll.symbol') }}</label><input id="ph-label" v-model="phaseEd.item.value.label" class="in" placeholder="①"></div>
        <div class="field"><label for="ph-name">{{ t('payroll.name') }}</label><input id="ph-name" v-model="phaseEd.item.value.name" class="in"></div>
        <div class="field"><label for="ph-from">{{ t('payroll.startMonth') }}</label><input id="ph-from" v-model="phaseEd.item.value.from" class="in" type="month"></div>
        <div class="field"><label for="ph-to">{{ t('payroll.endMonth') }}</label><input id="ph-to" v-model="phaseTo" class="in" type="month"></div>
        <div v-for="tg in fixedTargets" :key="tg.id" class="field"><label :for="`ph-amt-${tg.id}`">{{ tg.name }}</label>
          <input :id="`ph-amt-${tg.id}`" :value="phaseEd.item.value.amounts[tg.id] ?? 0" class="in" type="number" step="10000" min="0"
            @input="phaseEd.item.value!.amounts[tg.id] = Number(($event.target as HTMLInputElement).value) || 0"></div>
        <div class="field" style="grid-column:1/-1"><label for="ph-note">{{ t('payroll.note') }}</label><input id="ph-note" v-model="phaseEd.item.value.note" class="in"></div>
      </EditSheet>
      <div v-for="r in phaseRows" :key="r.p.id" class="panel">
        <div class="btns" style="margin:0 0 10px;justify-content:space-between">
          <h3 style="margin:0">{{ r.p.label }} {{ r.p.name }} <span v-if="r.current" class="pill acc">{{ t('payroll.now') }}</span></h3>
          <span class="mono small muted">{{ ymLabel(r.p.from) }} ~ {{ r.p.to ? ymLabel(r.p.to) : '' }}
            <button class="btn sm" type="button" :aria-label="t('payroll.editPhaseOf', { name: r.p.name })" @click="phaseEd.open(r.p)">{{ t('common.edit') }}</button></span>
        </div>
        <StackBar :rows="r.d.rows" />
        <p class="small muted" style="margin:8px 0 0">
          {{ t('payroll.asOf', { ym: ymLabel(r.start) }) }}<template v-if="r.d.remainderTarget"> · {{ remainderName }} {{ fmtMoney(r.d.remainder) }}</template><template v-if="r.p.note"> · {{ r.p.note }}</template>
        </p>
      </div>
    </div>

    <div v-else-if="tab === 'sim'">
      <MonthPicker v-model="ym" :label="t('payroll.transferMonth')" />
      <div class="cols">
        <div class="panel">
          <div class="field" style="margin-bottom:14px"><label for="sim-pay">{{ t('payroll.simPay') }}</label>
            <input id="sim-pay" v-model.number="pay" class="in" type="number" step="10000"></div>
          <p class="small" style="margin:0 0 10px">
            <span class="pill acc" v-if="sim.phase">{{ sim.phase.label }} {{ sim.phase.name }}</span>
            <span class="pill bad" v-else>{{ t('payroll.noPhase') }}</span>
          </p>
          <StackBar :rows="sim.rows" />
          <div class="tbl" style="margin-top:14px">
            <table>
              <thead><tr><th>{{ t('payroll.colDest') }}</th><th class="n">{{ t('payroll.colAmount') }}</th><th>{{ t('payroll.note') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in sim.rows" :key="r.key"><td>{{ r.name }}</td><td class="n" :class="fmtMoneyClass(r.amount)">{{ fmtMoney(r.amount) }}</td><td class="small muted">{{ r.detail || kindDetail(r.kind) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <h3 style="margin-top:0">{{ t('payroll.splitOf', { name: remainderName }) }}</h3>
          <div v-if="!sim.remainderTarget" class="callout warn"><span class="lbl">{{ t('payroll.noRemainder') }}</span><p>{{ t('payroll.noRemainderText') }}</p></div>
          <div v-else-if="sim.remainder < 0" class="callout warn"><span class="lbl">{{ t('payroll.shortLabel') }}</span><p>{{ t('payroll.shortText', { amount: fmtMoney(-sim.remainder) }) }}</p></div>
          <EditSheet v-if="splitEd.item.value" :key="splitEd.item.value.id || 'new'" :title="splitEd.item.value.id ? t('payroll.editSplit') : t('payroll.addSplit')" :error="splitEd.error.value" :busy="splitEd.busy.value"
            :can-delete="!!splitEd.item.value.id" @save="splitEd.save" @cancel="splitEd.close" @delete="splitEd.remove">
            <div class="field"><label for="rs-name">{{ t('payroll.item') }}</label><input id="rs-name" v-model="splitEd.item.value.name" class="in"></div>
            <div class="field"><label for="rs-code">{{ t('payroll.code') }}</label><input id="rs-code" v-model="splitEd.item.value.code" class="in"></div>
            <div class="field"><label for="rs-ratio">{{ t('payroll.ratioPct') }}</label><input id="rs-ratio" v-model.number="splitPct" class="in" type="number" step="1" min="0" max="100"></div>
          </EditSheet>
          <div class="tbl">
            <table>
              <thead><tr><th>{{ t('payroll.item') }}</th><th>{{ t('payroll.code') }}</th><th class="n">{{ t('payroll.ratio') }}</th><th class="n">{{ t('payroll.colAmount') }}</th></tr></thead>
              <tbody>
                <tr v-for="s in split" :key="s.id" class="click" tabindex="0" @click="splitEd.open(store.remainderSplit.find((x) => x.id === s.id))" @keydown.enter="splitEd.open(store.remainderSplit.find((x) => x.id === s.id))">
                  <td>{{ s.name }}</td><td class="mono small">{{ s.code }}</td><td class="n">{{ Math.round(s.ratio * 100) }}%</td><td class="n">{{ fmtMoney(s.amount) }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="btns" style="margin:0 0 10px">
            <button class="btn sm" type="button" @click="splitEd.open()">{{ t('payroll.addSplitBtn') }}</button>
            <span v-if="split.length && ratioSum !== 100" class="small" style="color:var(--accent-text)">{{ t('payroll.ratioSum', { n: ratioSum }) }}</span>
          </div>
          <p class="small muted" style="margin:0">{{ t('payroll.splitNote') }}</p>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="accEd.open()">{{ t('payroll.addAccountBtn') }}</button></div>
      <EditSheet v-if="accEd.item.value" :key="accEd.item.value.id || 'new'" :title="accEd.item.value.id ? t('payroll.editAccount') : t('payroll.addAccount')" :error="accEd.error.value" :busy="accEd.busy.value"
        :can-delete="!!accEd.item.value.id" @save="accEd.save" @cancel="accEd.close" @delete="accEd.remove">
        <div class="field"><label for="ac-name">{{ t('payroll.account') }}</label><input id="ac-name" v-model="accEd.item.value.name" class="in"></div>
        <div class="field"><label for="ac-role">{{ t('payroll.role') }}</label><input id="ac-role" v-model="accEd.item.value.role" class="in"></div>
        <div class="field"><label for="ac-in">{{ t('payroll.inflow') }}</label><input id="ac-in" v-model="accEd.item.value.inflow" class="in"></div>
        <div class="field"><label for="ac-out">{{ t('payroll.outflow') }}</label><input id="ac-out" v-model="accEd.item.value.outflow" class="in"></div>
      </EditSheet>
      <div class="tbl">
        <table>
          <thead><tr><th>{{ t('payroll.account') }}</th><th>{{ t('payroll.role') }}</th><th>{{ t('payroll.inflow') }}</th><th>{{ t('payroll.outflow') }}</th></tr></thead>
          <tbody>
            <tr v-for="a in store.accounts" :key="a.id" class="click" tabindex="0" @click="accEd.open(a)" @keydown.enter="accEd.open(a)">
              <td>{{ a.name }}</td><td>{{ a.role }}</td><td class="small">{{ a.inflow }}</td><td class="small">{{ a.outflow }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel" style="max-width:520px">
        <h3 style="margin-top:0">{{ livingName }} <span class="muted small num">{{ fmtMoney(livingSum) }}</span></h3>
        <div class="form">
          <div class="field"><label for="l-food">{{ t('payroll.food') }}</label><input id="l-food" v-model.number="store.living.food" class="in" type="number" step="10000" @change="saveLiving()"></div>
          <div class="field"><label for="l-tr">{{ t('payroll.transit') }}</label><input id="l-tr" v-model.number="store.living.transit" class="in" type="number" step="10000" @change="saveLiving()"></div>
          <div class="field"><label for="l-al">{{ t('payroll.allowance') }}</label><input id="l-al" v-model.number="store.living.allowance" class="in" type="number" step="10000" @change="saveLiving()"></div>
        </div>
      </div>
      <form class="panel" style="max-width:720px" :aria-label="t('payroll.settings')" novalidate @submit.prevent="submitSettings">
        <h3 style="margin-top:0">{{ t('payroll.settings') }}</h3>
        <i18n-t keypath="payroll.settingsNote" tag="p" class="small muted"><template #link><a href="#settings/general">{{ t('payroll.settingsLink') }}</a></template></i18n-t>
        <div class="form">
          <div class="field"><label for="st-pay">{{ t('payroll.netPay') }}</label><input id="st-pay" v-model.number="set.netPay" class="in" type="number" step="10000" min="0"></div>
          <div class="field"><label for="st-round">{{ t('payroll.subRound') }}</label><input id="st-round" v-model.number="set.subRound" class="in" type="number" step="1000" min="1"></div>
        </div>
        <div class="btns">
          <button class="btn pri" type="submit">{{ t('payroll.saveSettings') }}</button>
          <button class="btn" type="button" @click="resetSettings">{{ t('payroll.resetSettings') }}</button>
          <span class="small muted" role="status">{{ setMsg }}</span>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
/* Phone: the memo moves under the name (spec 007 V-9 b) */
.memo-sm{display:none}
.nowrap{white-space:nowrap}
@media (max-width:760px){.c-memo{display:none}.memo-sm{display:block;margin:2px 0 0 16px;font-size:12px;color:var(--subtle)}}
</style>
