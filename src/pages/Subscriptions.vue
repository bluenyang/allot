<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import MonthPicker from '../components/MonthPicker.vue'
import TransferChart from '../components/TransferChart.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { removeChange, removeSub, saveSettings, store, subName, upsertChange, upsertSub } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import { wonText } from '../lib/format'
import { cycleLabel, pathLabel, statusLabel } from '../lib/labels'
import { notReady } from '../lib/view'
import {
  addYm, chargeKrw, changesIn, monthlyKrw, nextOccurrence, num, planAt, today, transferAt, usd, ymd, ymLabel, ymOf, ymRange,
} from '../lib/calc'
import type { PlanChange, Subscription } from '../data/types'
import { CAT_COLORS } from '../lib/colors'
import { CATEGORY_IDS, catLabel } from '../lib/labels'

// 구독 (spec 007 S-4): KPI strip, status/category/path filters, a table, the add/edit modal.
// Not drawn (S-3): CSV export, AI analysis, "명세서에서 채우기".
const tab = ref('list')
const tabs = computed(() => [
  { id: 'list', label: t('subscriptions.tabList'), icon: 'list' },
  { id: 'preview', label: t('subscriptions.tabPreview'), icon: 'chart' },
  { id: 'changes', label: t('subscriptions.tabChanges'), icon: 'events' },
  { id: 'calc', label: t('subscriptions.tabCalc'), icon: 'money' },
])
const now = today()
const ym = ref(ymOf(now))

const PATH_IDS = ['direct', 'google', 'apple', 'telecom'] as const
const STATUS_IDS = ['active', 'cancelled', 'company'] as const

// ---------- list ----------
const rows = computed(() =>
  store.subscriptions
    .map((base) => {
      const p = planAt(base, store.planChanges, ym.value)
      const pending = store.planChanges.filter((c) => c.subId === base.id && (!c.effective || c.effective.slice(0, 7) > ym.value))
      return { base, p, monthly: p.status === 'active' ? monthlyKrw(p, store.settings) : 0, next: nextOccurrence(p, now), pending }
    })
    .sort((a, b) => (a.p.status === 'active' ? 0 : 1) - (b.p.status === 'active' ? 0 : 1) || b.monthly - a.monthly),
)
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ym.value))
const monthlyTotal = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
const unverified = computed(() => rows.value.filter((r) => r.p.status === 'active' && !r.p.verified).length)

// Filters: status (as a segmented control, so the page keeps one row of tabs), category, payment path.
const status = ref<'all' | 'active' | 'company' | 'cancelled'>('all')
const cat = ref('')
const path = ref('')
const q = ref('')
const STATUS_TABS = computed(() => (['all', 'active', 'company', 'cancelled'] as const).map((id) => ({
  id, label: t(`subscriptions.filter.${id}`),
  count: id === 'all' ? rows.value.length : rows.value.filter((r) => r.p.status === id).length,
})))
const shown = computed(() => rows.value
  .filter((r) => (status.value === 'all' || r.p.status === status.value) && (!cat.value || r.p.category === cat.value) && (!path.value || r.p.path === path.value)
    && (!q.value.trim() || r.p.name.toLowerCase().includes(q.value.trim().toLowerCase())))
  .sort((a, b) => (a.next && a.p.status === 'active' ? a.next.getTime() : Infinity) - (b.next && b.p.status === 'active' ? b.next.getTime() : Infinity)))
const charge = (p: Subscription) => p.currency === 'USD' ? `USD ${p.amount.toFixed(2)}${p.vat ? ` +${p.vat}%` : ''}` : `KRW ${num(p.amount)}`
const subsName = computed(() => store.targets.find((t) => t.kind === 'subscriptions')?.name ?? t('subscriptions.transferName'))

// ---------- editor ----------
const blank = (): Subscription => ({
  id: '', name: '', category: 'tool', plan: '', amount: 0, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '', path: 'direct', verified: false,
})
const edit = ref<Subscription | null>(null)
const err = ref('')
function openEdit(s?: Subscription) {
  edit.value = s ? { ...s, note: s.note ?? '' } : { ...blank(), note: '' }
  err.value = ''
}
const PLAN_KEYS = ['plan', 'amount', 'currency', 'vat', 'cycle', 'status'] as const
const PLAN_LABEL = (): Record<(typeof PLAN_KEYS)[number], string> => ({ plan: t('subscriptions.plan'), amount: t('subscriptions.amount'), currency: t('subscriptions.currency'), vat: 'VAT', cycle: t('subscriptions.cycle'), status: t('subscriptions.status') })
/** For the open editor: fields where a plan change already in effect at the 기준 월 overrides the base value. */
const overridden = computed(() => {
  const e = edit.value
  if (!e?.id) return null
  const applied = store.planChanges.filter((c) => c.subId === e.id && c.effective && c.effective.slice(0, 7) <= ym.value)
  if (!applied.length) return null
  const eff = planAt(e, store.planChanges, ym.value)
  const fields = PLAN_KEYS.filter((k) => eff[k] !== e[k]).map((k) => ({ k, label: PLAN_LABEL()[k], base: show(k, e), now: show(k, eff) }))
  return fields.length ? { fields, changes: applied } : null
})
function show(k: (typeof PLAN_KEYS)[number], p: Subscription) {
  if (k === 'amount') return p.currency === 'USD' ? usd(p.amount) : wonText(p.amount)
  if (k === 'cycle') return cycleLabel(p.cycle)
  if (k === 'status') return statusLabel(p.status)
  if (k === 'vat') return `${p.vat}%`
  return String(p[k] || '—')
}
const preview = computed(() => (edit.value ? monthlyKrw({ ...edit.value, amount: Number(edit.value.amount) || 0 }, store.settings) : 0))
async function save() {
  const s = edit.value!
  if (!s.name.trim()) return (err.value = t('subscriptions.needName'))
  if (!(s.amount >= 0)) return (err.value = t('subscriptions.needAmount'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.nextDate)) return (err.value = t('subscriptions.needNext'))
  if (s.currency === 'KRW') s.vat = 0
  try {
    await upsertSub(s)
    edit.value = null
  } catch (e) {
    err.value = (e as Error).message
  }
}
async function del() {
  try {
    await removeSub(edit.value!.id)
    edit.value = null
  } catch (e) {
    err.value = (e as Error).message
  }
}

// ---------- preview ----------
const from = ref(ymOf(now))
const series = computed(() =>
  ymRange(from.value, 12).map((m) => ({
    ym: m,
    value: transferAt(store.subscriptions, store.planChanges, store.settings, m).needed,
    changed: changesIn(store.planChanges, m).length > 0,
  })),
)
const pick = ref(ymOf(now))
const pickPrev = computed(() => addYm(pick.value, -1))
const cmp = computed(() => {
  const a = transferAt(store.subscriptions, store.planChanges, store.settings, pickPrev.value)
  const b = transferAt(store.subscriptions, store.planChanges, store.settings, pick.value)
  const ids = new Set([...a.items, ...b.items].map((i) => i.sub.id))
  const list = [...ids].map((id) => {
    const x = a.items.find((i) => i.sub.id === id)
    const y = b.items.find((i) => i.sub.id === id)
    return { id, name: (y ?? x)!.sub.name, before: x, after: y, diff: (y?.monthly ?? 0) - (x?.monthly ?? 0) }
  }).filter((r) => Math.abs(r.diff) >= 1 || r.before?.sub.plan !== r.after?.sub.plan)
  return { a, b, list }
})

// ---------- changes ----------
const sortedChanges = computed(() =>
  [...store.planChanges].sort((a, b) => (a.effective ?? '9999') < (b.effective ?? '9999') ? -1 : 1),
)
const chg = ref<PlanChange | null>(null)
const chgErr = ref('')
function openChange(c?: PlanChange) {
  chg.value = c ? JSON.parse(JSON.stringify(c)) : { id: '', subId: store.subscriptions[0]?.id ?? '', effective: '', to: {}, note: '' }
  chgErr.value = ''
}
function setTo(key: string, v: string) {
  const to = chg.value!.to as Record<string, unknown>
  if (v === '') delete to[key]
  else to[key] = key === 'amount' || key === 'vat' ? Number(v) : v
}
async function saveChange() {
  const c = chg.value!
  if (!c.subId) return (chgErr.value = t('subscriptions.needSub'))
  if (!Object.keys(c.to).length) return (chgErr.value = t('subscriptions.needField'))
  if (c.effective === '') c.effective = null
  try {
    await upsertChange(c)
    chg.value = null
  } catch (e) {
    chgErr.value = (e as Error).message
  }
}
async function delChange(id: string) {
  try {
    await removeChange(id)
    chg.value = null
  } catch (e) {
    chgErr.value = (e as Error).message
  }
}
function describe(c: PlanChange) {
  const base = store.subscriptions.find((s) => s.id === c.subId)
  const t = c.to
  const parts: string[] = []
  if (t.plan) parts.push(t.plan)
  if (t.amount != null) parts.push((t.currency ?? base?.currency) === 'USD' ? usd(t.amount) : wonText(t.amount))
  if (t.cycle) parts.push(cycleLabel(t.cycle))
  if (t.status) parts.push(statusLabel(t.status))
  return parts.join(' · ')
}
</script>

<template>
  <section class="page-gap">
    <PageHeader :title="t('subscriptions.title')" :desc="t('subscriptions.desc')">
      <button class="btn" type="button" @click="notReady('shell.csvExport')"><Icon name="download" />{{ t('shell.csvExport') }}</button>
      <button class="btn pri" type="button" @click="tab = 'list'; openEdit()"><Icon name="plus" />{{ t('subscriptions.addSub') }}</button>
    </PageHeader>

    <section class="strip slim" :aria-label="t('subscriptions.summaryLabel')">
      <div><span class="l">{{ t('subscriptions.monthlyTotal') }}</span><span class="v">{{ fmtMoney(monthlyTotal) }}</span></div>
      <div><span class="l">{{ t('subscriptions.yearlyTotal') }}</span><span class="v">{{ fmtMoney(monthlyTotal * 12) }}</span></div>
      <div><span class="l">{{ t('subscriptions.unverifiedCount') }}</span><span class="v" :class="{ sig: unverified > 0 }">{{ t('subscriptions.nItems', { n: unverified }) }}</span></div>
      <div><span class="l">{{ t('subscriptions.appliedFx') }}</span><span class="v">₩{{ num(store.settings.fxRate) }} <small class="unit">{{ t('subscriptions.buffer', { pct: store.settings.fxBuffer }) }}</small></span></div>
    </section>

    <div>
    <SubTabs v-model="tab" :tabs="tabs" />

    <!-- 목록 -->
    <div v-if="tab === 'list'">
      <section class="card">
        <div class="stabs" role="group" :aria-label="t('subscriptions.byStatus')">
          <button v-for="st in STATUS_TABS" :key="st.id" type="button" :aria-pressed="status === st.id" @click="status = st.id">{{ st.label }} <span class="cnt">{{ st.count }}</span></button>
        </div>
        <div class="frow">
          <label class="fsearch"><Icon name="search" /><input v-model="q" type="search" :aria-label="t('subscriptions.searchLabel')" :placeholder="t('subscriptions.searchPh')"></label>
          <select v-model="cat" class="in fsel" :aria-label="t('subscriptions.category')"><option value="">{{ t('subscriptions.allCategories') }}</option><option v-for="k in CATEGORY_IDS" :key="k" :value="k">{{ catLabel(k) }}</option></select>
          <select v-model="path" class="in fsel" :aria-label="t('subscriptions.path')"><option value="">{{ t('subscriptions.allPaths') }}</option><option v-for="k in PATH_IDS" :key="k" :value="k">{{ pathLabel(k) }}</option></select>
          <span class="sp"></span>
          <MonthPicker v-model="ym" :label="t('subscriptions.baseMonth')" />
          <span class="small subtle count">{{ t('subscriptions.count', { n: shown.length }) }}</span>
        </div>
      <EditSheet v-if="edit" :key="edit.id || 'new'" :title="edit.id ? t('subscriptions.editTitle') : t('subscriptions.addTitle')" :error="err" :can-delete="!!edit.id"
        :desc="t('subscriptions.saveDesc')" @save="save" @cancel="edit = null" @delete="del">
          <div class="field" style="grid-column:1/-1"><label for="e-name" class="req">{{ t('subscriptions.serviceName') }}</label><input id="e-name" v-model="edit.name" class="in" :placeholder="t('subscriptions.namePh')" required></div>
          <div class="field"><label for="e-cat">{{ t('subscriptions.category') }}</label>
            <select id="e-cat" v-model="edit.category" class="in"><option v-for="k in CATEGORY_IDS" :key="k" :value="k">{{ catLabel(k) }}</option></select></div>
          <div class="field"><label for="e-plan">{{ t('subscriptions.colPlan') }}</label><input id="e-plan" v-model="edit.plan" class="in"></div>
          <div class="field"><span class="flabel" id="e-cycle-l">{{ t('subscriptions.billingCycle') }}</span>
            <div class="seg" role="group" aria-labelledby="e-cycle-l">
              <button type="button" :aria-pressed="edit.cycle === 'monthly'" @click="edit.cycle = 'monthly'">{{ cycleLabel('monthly') }}</button>
              <button type="button" :aria-pressed="edit.cycle === 'yearly'" @click="edit.cycle = 'yearly'">{{ cycleLabel('yearly') }}</button>
            </div></div>
          <div class="field"><label for="e-amount" class="req">{{ t('subscriptions.amount') }}</label><input id="e-amount" v-model.number="edit.amount" class="in num" type="number" step="any" min="0" required></div>
          <div class="field"><label for="e-cur">{{ t('subscriptions.currency') }}</label>
            <select id="e-cur" v-model="edit.currency" class="in"><option value="KRW">{{ t('subscriptions.curKrw') }}</option><option value="USD">{{ t('subscriptions.curUsd') }}</option></select></div>
          <div v-if="edit.currency === 'USD'" class="field"><label for="e-vat">VAT (%)</label><input id="e-vat" v-model.number="edit.vat" class="in num" type="number" step="any" min="0"><span class="hint">{{ t('subscriptions.vatHint') }}</span></div>
          <div class="field"><label for="e-next">{{ t('subscriptions.nextDate') }}</label><input id="e-next" v-model="edit.nextDate" class="in" type="date"></div>
          <div class="field"><label for="e-path">{{ t('subscriptions.path') }}</label>
            <select id="e-path" v-model="edit.path" class="in"><option v-for="k in PATH_IDS" :key="k" :value="k">{{ pathLabel(k) }}</option></select></div>
          <div class="field"><label for="e-status">{{ t('subscriptions.status') }}</label>
            <select id="e-status" v-model="edit.status" class="in"><option v-for="k in STATUS_IDS" :key="k" :value="k">{{ statusLabel(k) }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="e-note">{{ t('subscriptions.note') }}</label><input id="e-note" v-model="edit.note" class="in"></div>
        <template #after>
          <label class="chk" style="border:0"><input id="e-ver" v-model="edit.verified" type="checkbox"><span>{{ t('subscriptions.verifiedLabel') }}</span></label>
          <div class="pvw"><span>{{ t('subscriptions.monthlyPreview') }}</span><b>{{ wonText(preview) }}</b></div>
          <div v-if="overridden" class="callout warn" data-testid="override-note">
            <span class="lbl">{{ t('subscriptions.overrideLabel') }}</span>
            <p><i18n-t keypath="subscriptions.overrideIntro" tag="span"><template #base><b>{{ t('subscriptions.base') }}</b></template><template #ym>{{ ymLabel(ym) }}</template></i18n-t>
              <template v-for="(f, i) in overridden.fields" :key="f.k">{{ i ? ', ' : ' ' }}{{ t('subscriptions.overrideField', { label: f.label, base: f.base }) }} <b>{{ f.now }}</b></template>.
              {{ t('subscriptions.overrideOutro') }}
              <button v-for="c in overridden.changes" :key="c.id" class="btn sm" type="button" @click="edit = null; tab = 'changes'; openChange(c)">{{ t('subscriptions.editChangeOf', { date: c.effective ?? '' }) }}</button>
            </p>
          </div>
        </template>
      </EditSheet>

      <div class="tbl">
        <table class="subs-t">
          <thead><tr><th scope="col">{{ t('subscriptions.colService') }}</th><th scope="col">{{ t('subscriptions.category') }}</th><th scope="col">{{ t('subscriptions.colCycle') }}</th><th scope="col" class="n">{{ t('subscriptions.colCharge') }}</th><th scope="col" class="n">{{ t('subscriptions.colMonthly') }}</th><th scope="col">{{ t('subscriptions.colNext') }}</th><th scope="col">{{ t('subscriptions.path') }}</th><th scope="col">{{ t('subscriptions.colReceipt') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.base.id" :class="{ dim: r.p.status !== 'active' }">
              <td><button type="button" class="svc" @click="openEdit(r.base)"><b>{{ r.p.name }}</b><span>{{ r.p.plan || '—' }}<template v-if="r.pending.length"> · {{ t('subscriptions.pendingChange') }}</template></span></button></td>
              <td><span class="pill tag">{{ catLabel(r.p.category) }}</span></td>
              <td>{{ cycleLabel(r.p.cycle) }}</td>
              <td class="n mono">{{ r.p.status === 'company' ? t('subscriptions.companyPays') : charge(r.p) }}</td>
              <td class="n">{{ r.p.status === 'active' ? fmtMoney(r.monthly) : fmtMoney(0) }}</td>
              <td class="mono">{{ r.next && r.p.status === 'active' ? fmtDate(r.next) : '—' }}</td>
              <td>{{ r.p.status === 'company' ? t('subscriptions.company') : pathLabel(r.p.path) }}</td>
              <td><span v-if="r.p.status !== 'active'" class="pill mute">{{ statusLabel(r.p.status) }}</span><span v-else-if="r.p.verified" class="pill ok">{{ t('subscriptions.verified') }}</span><span v-else class="pill warn">{{ t('subscriptions.unverified') }}</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="muted">{{ t('subscriptions.noMatch') }}</td></tr>
          </tbody>
        </table>
      </div>
      </section>
    </div>

    <!-- 전환 미리보기 -->
    <div v-else-if="tab === 'preview'">
      <MonthPicker v-model="from" :label="t('subscriptions.startMonth')" />
      <div class="panel">
        <h3 style="margin-top:0">{{ t('subscriptions.needed12') }} <span class="small muted">{{ t('subscriptions.clickBar') }}</span></h3>
        <TransferChart :points="series" :selected="pick" @pick="(m) => (pick = m)" />
      </div>
      <div class="strip">
        <div><div class="l">{{ ymLabel(pickPrev) }}</div><div class="v">{{ fmtMoney(cmp.a.needed) }}</div></div>
        <div><div class="l">{{ ymLabel(pick) }}</div><div class="v">{{ fmtMoney(cmp.b.needed) }}</div></div>
        <div><div class="l">{{ t('subscriptions.diff') }}</div><div class="v" :style="{ color: cmp.b.needed > cmp.a.needed ? 'var(--neg-text)' : cmp.b.needed < cmp.a.needed ? 'var(--primary-text)' : '' }">{{ cmp.b.needed - cmp.a.needed > 0 ? '+' : '' }}{{ fmtMoney(cmp.b.needed - cmp.a.needed) }}</div><div class="s">{{ subsName }} {{ fmtMoney(cmp.a.transfer) }} → {{ fmtMoney(cmp.b.transfer) }}</div></div>
      </div>
      <div class="panel"><div class="tbl">
        <table>
          <thead><tr><th>{{ t('subscriptions.colService') }}</th><th>{{ ymLabel(pickPrev) }}</th><th>{{ ymLabel(pick) }}</th><th class="n">{{ t('subscriptions.monthlyDiff') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in cmp.list" :key="r.id">
              <td>{{ r.name }}</td>
              <td class="small">{{ r.before ? `${r.before.sub.plan} · ${fmtMoney(r.before.monthly)}` : '—' }}</td>
              <td class="small">{{ r.after ? `${r.after.sub.plan} · ${fmtMoney(r.after.monthly)}` : '—' }}</td>
              <td class="n" :class="r.diff > 0 ? 'up' : 'down'">{{ r.diff > 0 ? '+' : '' }}{{ fmtMoney(r.diff) }}</td>
            </tr>
            <tr v-if="!cmp.list.length"><td colspan="4" class="muted">{{ t('subscriptions.sameAsPrev') }}</td></tr>
          </tbody>
        </table>
      </div></div>
      <div class="callout ok"><span class="lbl">{{ t('subscriptions.splitEffect') }}</span><p>{{ t('subscriptions.splitEffectText') }}</p></div>
    </div>

    <!-- 변경 일정 -->
    <div v-else-if="tab === 'changes'">
      <EditSheet v-if="chg" :key="chg.id || 'new'" :title="chg.id ? t('subscriptions.editChange') : t('subscriptions.addChange')" :error="chgErr" :can-delete="!!chg.id"
        @save="saveChange" @cancel="chg = null" @delete="delChange(chg.id)">
          <div class="field"><label for="c-sub">{{ t('subscriptions.subscription') }}</label>
            <select id="c-sub" v-model="chg.subId" class="in"><option v-for="s in store.subscriptions" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
          <div class="field"><label for="c-eff">{{ t('subscriptions.effective') }}</label><input id="c-eff" v-model="chg.effective" class="in" type="date"></div>
          <div class="field"><label for="c-plan">{{ t('subscriptions.newPlan') }}</label><input id="c-plan" :value="chg.to.plan ?? ''" class="in" @input="setTo('plan', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-amt">{{ t('subscriptions.newAmount') }}</label><input id="c-amt" :value="chg.to.amount ?? ''" class="in" type="number" step="any" @input="setTo('amount', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-cur">{{ t('subscriptions.currency') }}</label>
            <select id="c-cur" :value="chg.to.currency ?? ''" class="in" @change="setTo('currency', ($event.target as HTMLSelectElement).value)"><option value="">{{ t('subscriptions.unchanged') }}</option><option value="KRW">{{ t('subscriptions.krw') }}</option><option value="USD">{{ t('subscriptions.usd') }}</option></select></div>
          <div class="field"><label for="c-vat">VAT %</label><input id="c-vat" :value="chg.to.vat ?? ''" class="in" type="number" step="any" @input="setTo('vat', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-cyc">{{ t('subscriptions.colCycle') }}</label>
            <select id="c-cyc" :value="chg.to.cycle ?? ''" class="in" @change="setTo('cycle', ($event.target as HTMLSelectElement).value)"><option value="">{{ t('subscriptions.unchanged') }}</option><option value="monthly">{{ cycleLabel('monthly') }}</option><option value="yearly">{{ cycleLabel('yearly') }}</option></select></div>
          <div class="field"><label for="c-st">{{ t('subscriptions.status') }}</label>
            <select id="c-st" :value="chg.to.status ?? ''" class="in" @change="setTo('status', ($event.target as HTMLSelectElement).value)"><option value="">{{ t('subscriptions.unchanged') }}</option><option v-for="k in STATUS_IDS" :key="k" :value="k">{{ statusLabel(k) }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="c-note">{{ t('subscriptions.note') }}</label><input id="c-note" v-model="chg.note" class="in"></div>
      </EditSheet>
      <div class="panel">
      <div class="card-h"><h3>{{ t('subscriptions.scheduled') }}</h3><button class="btn sm" type="button" @click="openChange()">{{ t('subscriptions.addChangeBtn') }}</button></div>
      <p class="small muted" style="margin:-6px 0 8px">{{ t('subscriptions.cancelHint') }}</p>
      <div class="tbl">
        <table>
          <thead><tr><th>{{ t('subscriptions.colEffective') }}</th><th>{{ t('subscriptions.subscription') }}</th><th>{{ t('subscriptions.colWhat') }}</th><th>{{ t('subscriptions.note') }}</th></tr></thead>
          <tbody>
            <tr v-for="c in sortedChanges" :key="c.id" class="click" @click="openChange(c)">
              <td class="mono">{{ c.effective ? fmtDate(c.effective) : t('subscriptions.noDate') }}</td>
              <td>{{ subName(c.subId) }}</td>
              <td>{{ describe(c) }}</td>
              <td class="small muted">{{ c.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>
    </div>

    <!-- 계산 -->
    <div v-else>
      <MonthPicker v-model="ym" :label="t('subscriptions.baseMonth')" />
      <div class="cols">
        <div class="panel">
          <h3 style="margin-top:0">{{ t('subscriptions.baseValues') }}</h3>
          <div class="form">
            <div class="field"><label for="s-fx">{{ t('subscriptions.fxLabel') }}</label><input id="s-fx" v-model.number="store.settings.fxRate" class="in" type="number" step="any" @change="saveSettings()"></div>
            <div class="field"><label for="s-buf">{{ t('subscriptions.fxBufferLabel') }}</label><input id="s-buf" v-model.number="store.settings.fxBuffer" class="in" type="number" step="any" @change="saveSettings()"></div>
          </div>
          <pre style="margin:14px 0 0"><code>{{ t('subscriptions.f1') }}
{{ t('subscriptions.f2') }}
{{ t('subscriptions.f3', { pct: store.settings.fxBuffer }) }}
{{ t('subscriptions.f4') }}
{{ t('subscriptions.f5', { unit: wonText(store.settings.subRound) }) }}</code></pre>
        </div>
        <div class="panel">
          <h3 style="margin-top:0">{{ t('subscriptions.composition', { ym: ymLabel(ym) }) }}</h3>
          <div class="tbl">
            <table>
              <tbody>
                <tr><td>{{ t('subscriptions.monthlySubs') }}</td><td class="n">{{ fmtMoney(xfer.monthlySum) }}</td></tr>
                <tr><td>{{ t('subscriptions.yearlySubs') }}</td><td class="n">{{ fmtMoney(xfer.yearlyMonthly) }}</td></tr>
                <tr><td>{{ t('subscriptions.fxBuffer', { pct: store.settings.fxBuffer }) }}</td><td class="n">{{ fmtMoney(xfer.buffer) }}</td></tr>
                <tr class="total"><td>{{ t('subscriptions.neededTransfer') }}</td><td class="n">{{ fmtMoney(xfer.needed) }}</td></tr>
                <tr><td>{{ subsName }}</td><td class="n">{{ fmtMoney(xfer.transfer) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="tbl">
        <table>
          <thead><tr><th>{{ t('subscriptions.colService') }}</th><th>{{ t('subscriptions.colPlan') }}</th><th class="n">{{ t('subscriptions.colMonthly') }}</th><th class="n">{{ t('subscriptions.colShare') }}</th></tr></thead>
          <tbody>
            <tr v-for="i in xfer.items" :key="i.sub.id">
              <td>{{ i.sub.name }}</td><td class="small">{{ i.sub.plan }}</td>
              <td class="n">{{ fmtMoney(i.monthly) }}</td>
              <td class="n small">{{ Math.round((i.monthly / (xfer.monthlySum + xfer.yearlyMonthly)) * 100) }}%</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
    </div>
  </section>
</template>

<style scoped>
.unit{font-size:14px;font-weight:500;color:var(--muted)}
.strip.slim > div{padding:14px 20px;gap:2px}
.strip.slim .v{font-size:22px}
.stabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--border);overflow-x:auto}
.stabs button{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 14px;border:0;border-radius:var(--r-ctl) var(--r-ctl) 0 0;background:transparent;color:var(--muted);font-weight:600;cursor:pointer;white-space:nowrap}
.stabs button[aria-pressed="true"]{background:var(--primary-soft);color:var(--primary-text);box-shadow:inset 0 -2px 0 var(--primary-text)}
.stabs .cnt{font-size:11px;padding:0 6px;border-radius:var(--r-badge);background:var(--fill);color:var(--muted);font-variant-numeric:tabular-nums}
.stabs button[aria-pressed="true"] .cnt{background:var(--primary);color:var(--primary-ink)}
.frow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)}
.frow .ymbar{margin:0}
.fsearch{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);flex:1 1 220px;max-width:320px;color:var(--subtle)}
.fsearch:focus-within{border-color:var(--primary-text);box-shadow:0 0 0 3px var(--primary-soft)}
.fsearch svg{width:16px;height:16px;flex:none}
.fsearch input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:13px}
.fsel{width:auto;height:34px;font-size:13px}
.sp{flex:1}
.count{align-self:center}
.subs-t{min-width:920px}
/* Phone: each subscription becomes two lines — name and monthly amount, then category, cycle, next date,
   receipt. Billed amount and path stay in the edit sheet (spec 007 V-9 b). */
@media (max-width:760px){
  .subs-t{min-width:0}
  .subs-t thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .subs-t tbody tr{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:10px 16px;border-bottom:1px solid var(--divider)}
  .subs-t tbody td,.card .subs-t tbody td:first-child{display:block;padding:0;border:0}
  .subs-t tbody td:nth-child(1){order:1;flex:1 0 calc(100% - 130px);min-width:0}
  .subs-t tbody td:nth-child(5){order:2;flex:0 0 120px;text-align:right;font-weight:600}
  .subs-t tbody td:nth-child(2),.subs-t tbody td:nth-child(3),.subs-t tbody td:nth-child(6),.subs-t tbody td:nth-child(8){order:3;font-size:12px;color:var(--muted)}
  .subs-t tbody td:nth-child(4),.subs-t tbody td:nth-child(7){display:none}
}
.subs-t td.n.mono{font-weight:400;color:var(--muted)}
.svc{all:unset;cursor:pointer;display:flex;flex-direction:column;min-width:0}
.svc b{font-weight:600}
.svc span{font-size:12px;color:var(--muted)}
.svc:hover b{text-decoration:underline}
.svc:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px;border-radius:var(--r-ctl)}
.req::after{content:" *";color:var(--neg-text)}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.hint{font-size:12px;color:var(--subtle)}
.pvw{display:flex;justify-content:space-between;align-items:center;margin:12px 0;padding:12px 14px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border)}
.pvw span{font-size:13px;color:var(--muted)}
.pvw b{font-size:18px;font-variant-numeric:tabular-nums}
</style>
