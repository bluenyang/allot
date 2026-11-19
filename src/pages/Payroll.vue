<script setup lang="ts">
// 월급 분배 (spec 010 S-8, S-10): the split targets and phases, the month's simulation with the
// remainder split, and the accounts, living costs and pay settings. Every change goes to the API first
// (useEditor / the store writers). The phase number is automatic (phaseNumbers); the stored phase
// `label` is never shown or edited here and is sent back as it was. A remainder target is optional:
// without one, what is left of the pay stays in the pay account (`unallocated`).
import { t, tl } from '../i18n'
import { computed, ref, watch } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MoneyInput from '../components/MoneyInput.vue'
import Pill from '../components/Pill.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { fmtMoney, fmtMoneyClass } from '../lib/display'
import { saveLiving, saveSettings, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import { kindDetail } from '../lib/labels'
import { addYm, distributionAt, phaseNumbers, splitRemainder, today, transferAt, ymLabel, ymOf, type AllocRow } from '../lib/calc'
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

const LEFT_COLOR = 'var(--c7)'
const numbers = computed(() => phaseNumbers(store.phases))

/** The bar and the note of a distribution: its rows, plus the leftover when no target takes it. */
function segsOf(d: ReturnType<typeof dist>) {
  const segs = d.rows.filter((r) => r.amount > 0).map((r) => ({ key: r.key, name: r.name, amount: r.amount, color: allocColor(r.key) }))
  if (!d.remainderTarget && d.remainder > 0) segs.push({ key: '__left', name: t('payroll.leftoverName'), amount: d.remainder, color: LEFT_COLOR })
  return segs
}
const aria = (segs: { name: string; amount: number }[]) => segs.map((s) => `${s.name} ${fmtMoney(s.amount)}`).join(', ')
/** "나머지 ₩… " or "급여 통장에 남음 ₩…" (short: 모자람) for a distribution's note. */
function restNote(d: ReturnType<typeof dist>) {
  if (d.remainderTarget) return `${d.remainderTarget.name} ${fmtMoney(d.remainder)}`
  return `${d.remainder < 0 ? t('payroll.leftoverShort') : t('payroll.leftoverName')} ${fmtMoney(Math.abs(d.remainder))}`
}

const phaseRows = computed(() =>
  store.phases.map((p) => {
    const start = p.from < now && (p.to === null || now <= p.to) ? now : p.from
    const d = dist(start)
    return { p, no: numbers.value[p.id] ?? 0, start, d, segs: segsOf(d), current: p.from <= now && (p.to === null || now <= p.to) }
  }),
)

// ---------- simulation ----------
const ym = ref(now)
/** A take-home value tried on this screen only (never saved); null = the saved one. */
const payTry = ref<number | null>(null)
const pay = computed(() => payTry.value ?? store.settings.netPay)
const sim = computed(() => dist(ym.value, pay.value))
const remainderTarget = computed(() => store.targets.find((x) => x.kind === 'remainder') ?? null)
const split = computed(() => (sim.value.remainderTarget ? splitRemainder(sim.value.remainder, store.remainderSplit) : []))
const livingSum = computed(() => store.living.food + store.living.transit + store.living.allowance)
const remainderName = computed(() => remainderTarget.value?.name ?? t('payroll.remainder'))
const livingName = computed(() => store.targets.find((x) => x.kind === 'living')?.name ?? t('payroll.living'))
const fixedTargets = computed(() => store.targets.filter((x) => x.kind === 'fixed'))
const ratioSum = computed(() => Math.round(store.remainderSplit.reduce((a, x) => a + x.ratio, 0) * 100))
const simPhase = computed(() => {
  const p = sim.value.phase
  return p ? `${t('payroll.phaseNo', { n: numbers.value[p.id] ?? 0 })} ${p.name}` : t('payroll.noPhase')
})

interface SimRow { key: string; name: string; kind: AllocationKind | 'leftover'; amount: number; detail: string; color: string }
const simRows = computed<SimRow[]>(() => {
  const rows: SimRow[] = sim.value.rows.map((r: AllocRow) => ({ key: r.key, name: r.name, kind: r.kind, amount: r.amount, detail: r.detail || kindDetail(r.kind), color: allocColor(r.key) }))
  if (!sim.value.remainderTarget) rows.push({ key: '__left', name: t('payroll.leftoverName'), kind: 'leftover', amount: sim.value.remainder, detail: t('payroll.leftoverCalc'), color: LEFT_COLOR })
  return rows
})
const simTotal = computed(() => simRows.value.reduce((a, r) => a + r.amount, 0))
const simShort = computed(() => sim.value.remainder < 0)

// The pay dialog and the "how it is worked out" dialog.
const payDlg = ref(false)
const payDraft = ref<number | ''>('')
function openPay() {
  payDraft.value = pay.value
  payDlg.value = true
}
function applyPay() {
  payTry.value = Number(payDraft.value) || 0
  if (payTry.value === store.settings.netPay) payTry.value = null
  payDlg.value = false
}
const view = ref<SimRow | null>(null)
const viewBody = computed(() => {
  const r = view.value
  if (!r) return null
  const x = transferAt(store.subscriptions, store.planChanges, store.settings, ym.value)
  const others = pay.value - sim.value.remainder
  if (r.kind === 'living') return { formula: t('payroll.fLiving', { food: fmtMoney(store.living.food), transit: fmtMoney(store.living.transit), allowance: fmtMoney(store.living.allowance) }), where: t('payroll.whereLiving'), go: t('payroll.openLiving') }
  if (r.kind === 'subscriptions') {
    const unit = store.settings.subRound
    return { formula: unit > 1 ? t('payroll.fSubs', { needed: fmtMoney(x.needed), unit: fmtMoney(unit) }) : t('payroll.fSubsOff', { needed: fmtMoney(x.needed) }), where: t('payroll.whereSubs'), go: t('payroll.openSubs') }
  }
  return { formula: t('payroll.fRest', { pay: fmtMoney(pay.value), others: fmtMoney(others) }), where: t('payroll.whereRest'), go: t('payroll.openPay') }
})
function viewGo() {
  const k = view.value?.kind
  view.value = null
  if (k === 'living') tab.value = 'accounts'
  else if (k === 'subscriptions') location.hash = '#subs'
  else openPay()
}

// ---------- editors ----------
const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const phaseEd = useEditor(
  'phases',
  () => ({ id: '', label: '', name: '', from: now, to: null, amounts: {}, note: '' }),
  (p) => {
    // An emptied amount field means 0, as the number field did.
    for (const k of Object.keys(p.amounts)) if (typeof p.amounts[k] !== 'number') p.amounts[k] = 0
    return !p.name.trim() ? t('payroll.needPhaseName')
      : !YM.test(p.from) ? t('payroll.needStart')
      : p.to !== null && (!YM.test(p.to) || p.to < p.from) ? t('payroll.endAfterStart')
      : null
  },
)
// <input type="month"> gives '' for "no end"; the API wants null.
const phaseTo = computed({
  get: () => phaseEd.item.value?.to ?? '',
  set: (v: string) => { if (phaseEd.item.value) phaseEd.item.value.to = v || null },
})
const phaseAmount = (id: string) => (phaseEd.item.value!.amounts[id] ?? 0) as number | ''
const setPhaseAmount = (id: string, v: number | '' | null) => { phaseEd.item.value!.amounts[id] = (v ?? '') as number }
const phasePreview = computed(() => {
  const p = phaseEd.item.value
  if (!p) return null
  const ymP = YM.test(p.from) ? p.from : now
  const draft = { ...p, to: p.to, amounts: Object.fromEntries(Object.entries(p.amounts).map(([k, v]) => [k, Number(v) || 0])) }
  const d = distributionAt(ymP, store.settings.netPay, [{ ...draft, from: '0000-01', to: null }], store.targets, store.living, store.subscriptions, store.planChanges, store.settings)
  return { ym: ymP, segs: segsOf(d), note: restNote(d) }
})

const splitEd = useEditor('remainderSplit', () => ({ id: '', name: '', code: '', ratio: 0 }),
  (x) => (!x.name.trim() ? t('payroll.needItemName') : x.ratio < 0 || x.ratio > 1 ? t('payroll.ratioRange') : null))
/** The ratio field in percent; kept apart so a half-typed value is not rewritten while typing. */
const splitPct = ref<number | ''>(0)
/** The percent the field showed when it opened: the stored ratio stays as it is unless this text is edited. */
let splitPctShown: number | '' = 0
function openSplit(x?: (typeof store.remainderSplit)[number]) {
  splitEd.open(x)
  splitPct.value = splitPctShown = Math.round((splitEd.item.value?.ratio ?? 0) * 10_000) / 100
}
async function saveSplit() {
  if (splitEd.item.value && splitPct.value !== splitPctShown) splitEd.item.value.ratio = (Number(splitPct.value) || 0) / 100
  await splitEd.save()
}

const KIND_IDS: AllocationKind[] = ['living', 'subscriptions', 'fixed', 'remainder']
const kindOf = (k: AllocationKind) => t(`payroll.kind.${k}`)
const targetEd = useEditor('targets', () => ({ id: '', name: '', kind: 'fixed', note: '' }),
  (x) => (!x.name.trim() ? t('payroll.needName') : null))
// A kind that only one target can have is marked when another target already has it. The option stays
// choosable: the server answers with the rule, as it always did.
const kindOption = (k: AllocationKind) =>
  k !== 'fixed' && store.targets.some((x) => x.kind === k && x.id !== targetEd.item.value?.id) ? t('payroll.kindExists', { kind: kindOf(k) }) : kindOf(k)

const accEd = useEditor('accounts', () => ({ id: '', name: '', role: '', inflow: '', outflow: '' }),
  (a) => (!a.name.trim() ? t('payroll.needAccountName') : null))
const ROLE_KEYS = ['roleIn', 'roleFixed', 'roleLiving', 'roleSave', 'roleEtc'] as const
const roleChips = computed(() => ROLE_KEYS.map((k) => t(`payroll.${k}`)))
/** Pill colour of a stored role: the known words (either language) get one, anything else is plain. */
function roleCls(role: string) {
  const at = (l: 'ko' | 'en') => ROLE_KEYS.map((k) => tl(l, `payroll.${k}` as never))
  const i = at('ko').indexOf(role) >= 0 ? at('ko').indexOf(role) : at('en').indexOf(role)
  return ['ok', 'warn', 'info', 'ok', 'mute'][i] ?? 'mute'
}

// ---------- pay settings ----------
// Edited as a copy and saved with a button, like the list editors.
const set = ref<Settings>({ ...store.settings })
const setMsg = ref('')
watch(() => store.settings, (s) => { set.value = { ...s } })
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
const netPayModel = computed({
  get: () => set.value.netPay as number | '',
  set: (v) => { set.value.netPay = v as number },
})
const ROUND_STD = [10_000, 50_000, 100_000]
// The stored unit is always an option, also when it is not one of the usual ones (20,000 or 1,000, say).
const roundOpts = computed(() => {
  const cur = store.settings.subRound
  const vals = [...ROUND_STD]
  if (cur !== 1 && !vals.includes(cur)) vals.push(cur)
  vals.sort((a, b) => a - b)
  return [...vals.map((v) => ({ v, label: fmtMoney(v) })), { v: 1, label: t('payroll.roundOff') }]
})

// ---------- accounts tab ----------
const flow = computed(() => dist(now))
const flowRows = computed(() => flow.value.rows.filter((r) => r.kind !== 'remainder' || r.amount !== 0))
const flowSent = computed(() => flow.value.rows.filter((r) => r.kind !== 'remainder').reduce((a, r) => a + r.amount, 0))
const share = (v: number) => (livingSum.value > 0 ? Math.round((v / livingSum.value) * 100) : 0)
const livingModel = (k: 'food' | 'transit' | 'allowance') => computed({
  get: () => store.living[k] as number | '',
  set: (v) => { store.living[k] = v as number },
})
const food = livingModel('food')
const transit = livingModel('transit')
const allowance = livingModel('allowance')
const livingRows = computed(() => [
  { id: 'l-food', label: t('payroll.food'), model: food, v: store.living.food },
  { id: 'l-tr', label: t('payroll.transit'), model: transit, v: store.living.transit },
  { id: 'l-al', label: t('payroll.allowance'), model: allowance, v: store.living.allowance },
])
</script>

<template>
  <section class="page-gap">
    <PageHeader :title="t('payroll.title')" :desc="remainderTarget ? t('payroll.desc', { pay: store.settings.payDay, transfer: store.settings.transferDay, name: remainderName }) : t('payroll.descNone', { pay: store.settings.payDay, transfer: store.settings.transferDay })" />

    <SubTabs v-model="tab" :tabs="tabs" />

    <!-- 구간 -->
    <div v-if="tab === 'phases'" class="two">
      <section class="card c-targets">
        <div class="card-hd"><h2>{{ t('payroll.targets') }}</h2><button class="btn sm" type="button" @click="targetEd.open()">{{ t('payroll.addTargetBtn') }}</button></div>
        <div class="tbl stack">
          <table>
            <thead><tr><th scope="col">{{ t('payroll.name') }}</th><th scope="col">{{ t('payroll.kindLabel') }}</th><th scope="col" class="c-memo">{{ t('payroll.note') }}</th></tr></thead>
            <tbody>
              <tr v-for="tg in store.targets" :key="tg.id" class="click" tabindex="0" @click="targetEd.open(tg)" @keydown.enter="targetEd.open(tg)">
                <td :data-label="t('payroll.name')"><span class="tname"><i :style="{ background: allocColor(tg.id) }"></i><b>{{ tg.name }}</b></span></td>
                <td :data-label="t('payroll.kindLabel')" class="nowrap">{{ kindOf(tg.kind) }}</td>
                <td :data-label="t('payroll.note')" class="hint c-memo">{{ tg.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="c-phases">
        <div class="ph-bar"><b>{{ t('payroll.phases') }}</b><button class="btn sm pri" type="button" @click="phaseEd.open()">{{ t('payroll.addPhaseBtn') }}</button></div>
        <section v-for="r in phaseRows" :key="r.p.id" class="card phase-card">
          <div class="ph-h">
            <span class="pill mute">{{ t('payroll.phaseNo', { n: r.no }) }}</span>
            <b class="ph-n">{{ r.p.name }}</b>
            <span v-if="r.current" class="pill ok">{{ t('payroll.now') }}</span>
            <span class="num hint">{{ ymLabel(r.p.from) }} ~ {{ r.p.to ? ymLabel(r.p.to) : '' }}</span>
            <button class="btn sm ghost" type="button" :aria-label="t('payroll.editPhaseOf', { name: r.p.name })" @click="phaseEd.open(r.p)">{{ t('common.edit') }}</button>
          </div>
          <div class="abar" role="img" :aria-label="aria(r.segs)"><span v-for="g in r.segs" :key="g.key" :style="{ flexGrow: g.amount, background: g.color }"></span></div>
          <div class="legend"><span v-for="g in r.segs" :key="g.key"><i :style="{ background: g.color }"></i>{{ g.name }} <b class="num">{{ fmtMoney(g.amount) }}</b></span></div>
          <span class="hint">{{ t('payroll.asOf', { ym: ymLabel(r.start) }) }} · {{ restNote(r.d) }}<template v-if="r.p.note"> · {{ r.p.note }}</template></span>
        </section>
      </div>
    </div>

    <!-- 월별 시뮬레이션 -->
    <template v-else-if="tab === 'sim'">
      <section class="card">
        <div class="card-hd wrap">
          <div role="group" class="mnav" :aria-label="t('payroll.monthPick')">
            <button class="btn sm ghost sq" type="button" :aria-label="t('shell.prevMonth')" @click="ym = addYm(ym, -1)"><Icon name="prev" /></button>
            <h2 class="num">{{ t('payroll.monthTitle', { ym: ymLabel(ym) }) }}</h2>
            <button class="btn sm ghost sq" type="button" :aria-label="t('shell.nextMonth')" @click="ym = addYm(ym, 1)"><Icon name="next" /></button>
          </div>
          <span class="sum">
            <span class="hint">{{ t('payroll.netSummary', { pay: fmtMoney(pay), phase: simPhase }) }}</span>
            <span v-if="payTry !== null" class="pill warn">{{ t('payroll.payTemp') }}</span>
            <button class="btn sm ghost link" type="button" @click="openPay">{{ t('payroll.editPay') }}</button>
          </span>
        </div>
        <div class="tbl stack">
          <table>
            <thead><tr>
              <th scope="col">{{ t('payroll.colDest') }}</th><th scope="col" class="n">{{ t('payroll.colAmount') }}</th><th scope="col">{{ t('payroll.colCalc') }}</th>
              <th scope="col" class="n"><span class="sr">{{ t('payroll.colAction') }}</span></th>
            </tr></thead>
            <tbody>
              <tr v-for="r in simRows" :key="r.key">
                <td :data-label="t('payroll.colDest')"><span class="tname"><i :style="{ background: r.color }"></i><b>{{ r.name }}</b></span></td>
                <td :data-label="t('payroll.colAmount')" class="n amt" :class="fmtMoneyClass(r.amount)">{{ r.kind === 'leftover' && r.amount < 0 ? `${t('payroll.leftoverShort')} ` : '' }}{{ fmtMoney(r.kind === 'leftover' && r.amount < 0 ? -r.amount : r.amount) }}</td>
                <td :data-label="t('payroll.colCalc')" class="hint">{{ r.detail }}</td>
                <td class="n act"><button v-if="r.kind !== 'fixed'" class="btn sm ghost link" type="button" :aria-label="t('payroll.viewOf', { name: r.name })" @click="view = r">{{ t('payroll.view') }}</button></td>
              </tr>
              <tr class="total">
                <td>{{ t('payroll.total') }}</td><td :data-label="t('payroll.colAmount')" class="n amt">{{ fmtMoney(simTotal) }}</td><td :data-label="t('payroll.colCalc')" class="hint">{{ t('payroll.totalEq') }}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="simShort" class="callout warn short"><span class="lbl">{{ t('payroll.shortLabel') }}</span><p>{{ t('payroll.shortText', { amount: fmtMoney(-sim.remainder) }) }}</p></div>
        <p class="foot">{{ t('payroll.simFoot') }}</p>
      </section>

      <section class="card">
        <div class="card-hd"><h2>{{ remainderTarget ? t('payroll.splitOf', { name: remainderName }) : t('payroll.splitFallback') }}</h2><button class="btn sm" type="button" @click="openSplit()">{{ t('payroll.addSplitBtn') }}</button></div>
        <div v-if="!remainderTarget" class="callout warn short"><span class="lbl">{{ t('payroll.leftoverName') }}</span><p>{{ t('payroll.splitNoTarget') }}</p></div>
        <div v-if="store.remainderSplit.length" class="tbl stack">
          <table>
            <thead><tr><th scope="col">{{ t('payroll.item') }}</th><th scope="col">{{ t('payroll.code') }}</th><th scope="col" class="n">{{ t('payroll.ratio') }}</th><th scope="col" class="n">{{ t('payroll.colAmount') }}</th></tr></thead>
            <tbody>
              <tr v-for="s in store.remainderSplit" :key="s.id" class="click" tabindex="0" @click="openSplit(s)" @keydown.enter="openSplit(s)">
                <td :data-label="t('payroll.item')"><b>{{ s.name }}</b></td>
                <td :data-label="t('payroll.code')" class="mono hint">{{ s.code }}</td>
                <td :data-label="t('payroll.ratio')" class="n">{{ Math.round(s.ratio * 100) }}%</td>
                <td :data-label="t('payroll.colAmount')" class="n amt">{{ remainderTarget ? fmtMoney(split.find((x) => x.id === s.id)?.amount ?? 0) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty hint">{{ t('payroll.splitEmpty') }}</p>
        <div class="foot2">
          <span v-if="store.remainderSplit.length && ratioSum !== 100" class="warnt">{{ t('payroll.ratioSum', { n: ratioSum }) }}</span>
          <span class="hint">{{ t('payroll.splitNote') }}</span>
        </div>
      </section>
    </template>

    <!-- 통장·생활비·설정 -->
    <div v-else class="two acc">
      <div class="colA">
        <section class="card">
          <div class="card-hd"><h2>{{ t('payroll.flowTitle') }}</h2><span class="hint">{{ t('payroll.flowHint') }}</span></div>
          <ol class="flow">
            <li>
              <div class="fl-m" aria-hidden="true"><span class="no">1</span><span class="ln"></span></div>
              <div class="fl-b">
                <b>{{ t('payroll.flowIn', { day: store.settings.payDay }) }}</b>
                <div class="box"><span>{{ t('payroll.flowPay') }}</span><b class="num">{{ fmtMoney(store.settings.netPay) }}</b></div>
              </div>
            </li>
            <li>
              <div class="fl-m" aria-hidden="true"><span class="no">2</span></div>
              <div class="fl-b">
                <b>{{ t('payroll.flowOut', { day: store.settings.transferDay, n: flowRows.length }) }}</b>
                <span class="hint">{{ t('payroll.flowOutHint') }}</span>
                <div class="fcards">
                  <div v-for="r in flowRows" :key="r.key" class="fcard" :style="{ borderTopColor: allocColor(r.key) }">
                    <b>{{ r.name }}</b>
                    <b class="num fa" :class="fmtMoneyClass(r.amount)">{{ fmtMoney(r.amount) }}</b>
                    <small>{{ r.detail || kindDetail(r.kind) }}</small>
                  </div>
                </div>
                <div class="fsum"><span>{{ t('payroll.flowSent', { sent: fmtMoney(flowSent) }) }} · {{ flow.remainderTarget ? t('payroll.flowRestOf', { name: flow.remainderTarget.name }) : t('payroll.leftoverName') }}</span><b class="num" :class="fmtMoneyClass(flow.remainder)">{{ fmtMoney(flow.remainder) }}</b></div>
                <div v-if="!flow.remainderTarget" class="fnote"><span>{{ t('payroll.flowNone') }}</span><button class="btn sm ghost link" type="button" @click="targetEd.open()">{{ t('payroll.addTargetBtn') }}</button></div>
              </div>
            </li>
          </ol>
        </section>

        <section class="card">
          <div class="card-hd"><h2>{{ t('payroll.accounts') }}</h2><button class="btn sm" type="button" @click="accEd.open()">{{ t('payroll.addAccountBtn') }}</button></div>
          <div v-if="store.accounts.length" class="tbl stack">
            <table>
              <thead><tr><th scope="col">{{ t('payroll.account') }}</th><th scope="col">{{ t('payroll.role') }}</th><th scope="col">{{ t('payroll.inflow') }}</th><th scope="col">{{ t('payroll.outflow') }}</th></tr></thead>
              <tbody>
                <tr v-for="a in store.accounts" :key="a.id" class="click" tabindex="0" @click="accEd.open(a)" @keydown.enter="accEd.open(a)">
                  <td :data-label="t('payroll.account')"><b>{{ a.name }}</b></td>
                  <td :data-label="t('payroll.role')"><span v-if="a.role" class="pill" :class="roleCls(a.role)">{{ a.role }}</span></td>
                  <td :data-label="t('payroll.inflow')">{{ a.inflow }}</td>
                  <td :data-label="t('payroll.outflow')">{{ a.outflow }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty hint">{{ t('payroll.noAccounts') }}</p>
        </section>
      </div>

      <div class="colB">
        <section class="card">
          <div class="card-hd"><h2>{{ livingName }}</h2><b class="num">{{ fmtMoney(livingSum) }}</b></div>
          <div class="fs liv">
            <div v-for="l in livingRows" :key="l.id" class="field">
              <label :for="l.id">{{ l.label }}</label>
              <MoneyInput :id="l.id" v-model="l.model.value" @change="saveLiving()" />
              <div class="shbar" aria-hidden="true"><div :style="{ width: `${share(Number(l.v) || 0)}%` }"></div></div>
              <span class="hint num">{{ share(Number(l.v) || 0) }}%</span>
            </div>
            <p class="hint note">{{ t('payroll.livingNote') }}</p>
          </div>
        </section>

        <form class="card" :aria-label="t('payroll.settings')" novalidate @submit.prevent="submitSettings">
          <div class="card-hd"><h2>{{ t('payroll.settings') }}</h2></div>
          <div class="fs">
            <div class="field">
              <label for="st-pay">{{ t('payroll.netPay') }}</label>
              <MoneyInput id="st-pay" v-model="netPayModel" />
              <span class="hint">{{ t('payroll.netPayHint') }}</span>
            </div>
            <div class="field">
              <label for="st-round">{{ t('payroll.subRound') }}</label>
              <select id="st-round" v-model.number="set.subRound" class="in"><option v-for="o in roundOpts" :key="o.v" :value="o.v">{{ o.label }}</option></select>
              <span class="hint">{{ t('payroll.subRoundHint') }}</span>
            </div>
            <i18n-t keypath="payroll.settingsNote" tag="p" class="hint note"><template #link><a href="#settings/general">{{ t('payroll.settingsLink') }}</a></template></i18n-t>
          </div>
          <div class="cf">
            <span class="small muted" role="status">{{ setMsg }}</span>
            <span class="sp"></span>
            <button class="btn sm" type="button" @click="resetSettings">{{ t('payroll.resetSettings') }}</button>
            <button class="btn sm pri" type="submit">{{ t('payroll.saveSettings') }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- editors -->
    <EditSheet v-if="targetEd.item.value" :key="targetEd.item.value.id || 'new'" :title="targetEd.item.value.id ? t('payroll.editTarget') : t('payroll.addTarget')" :desc="t('payroll.targetDesc')" :error="targetEd.error.value" :busy="targetEd.busy.value"
      :can-delete="!!targetEd.item.value.id" @save="targetEd.save" @cancel="targetEd.close" @delete="targetEd.remove">
      <div class="field"><label for="tg-name">{{ t('payroll.name') }} <span class="star" aria-hidden="true">*</span></label><input id="tg-name" v-model="targetEd.item.value.name" class="in" autocomplete="off"></div>
      <div class="field"><label for="tg-kind">{{ t('payroll.kindLabel') }}</label>
        <select id="tg-kind" v-model="targetEd.item.value.kind" class="in"><option v-for="k in KIND_IDS" :key="k" :value="k">{{ kindOption(k) }}</option></select>
        <span class="hint">{{ t(`payroll.kindHint.${targetEd.item.value.kind}`) }} {{ t('payroll.onePerKind') }}</span></div>
      <div class="field"><label for="tg-note">{{ t('payroll.note') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="tg-note" v-model="targetEd.item.value.note" class="in" autocomplete="off"></div>
    </EditSheet>

    <EditSheet v-if="phaseEd.item.value" :key="phaseEd.item.value.id || 'new'" :title="phaseEd.item.value.id ? t('payroll.editPhase') : t('payroll.addPhase')" :error="phaseEd.error.value" :busy="phaseEd.busy.value" :width="560"
      :can-delete="!!phaseEd.item.value.id" @save="phaseEd.save" @cancel="phaseEd.close" @delete="phaseEd.remove">
      <div class="field"><label for="ph-name">{{ t('payroll.name') }} <span class="star" aria-hidden="true">*</span></label><input id="ph-name" v-model="phaseEd.item.value.name" class="in" autocomplete="off" :placeholder="t('payroll.phaseNamePh')"></div>
      <div class="field"><label for="ph-from">{{ t('payroll.startMonth') }}</label><input id="ph-from" v-model="phaseEd.item.value.from" class="in" type="month"></div>
      <div class="field"><label for="ph-to">{{ t('payroll.endMonth') }}</label><input id="ph-to" v-model="phaseTo" class="in" type="month"><span class="hint">{{ t('payroll.endHint') }}</span></div>
      <template v-if="fixedTargets.length">
        <div v-for="tg in fixedTargets" :key="tg.id" class="field"><label :for="`ph-amt-${tg.id}`">{{ tg.name }}</label>
          <MoneyInput :id="`ph-amt-${tg.id}`" :model-value="phaseAmount(tg.id)" @update:model-value="setPhaseAmount(tg.id, $event)" /></div>
      </template>
      <div v-if="phasePreview" class="field pv">
        <span class="lbl2">{{ t('payroll.phasePreview', { ym: ymLabel(phasePreview.ym) }) }}</span>
        <div class="abar" role="img" :aria-label="aria(phasePreview.segs)"><span v-for="g in phasePreview.segs" :key="g.key" :style="{ flexGrow: g.amount, background: g.color }"></span></div>
        <span class="hint">{{ phasePreview.note }}</span>
      </div>
      <div class="field"><label for="ph-note">{{ t('payroll.note') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ph-note" v-model="phaseEd.item.value.note" class="in" autocomplete="off"></div>
    </EditSheet>

    <EditSheet v-if="splitEd.item.value" :key="splitEd.item.value.id || 'new'" :title="splitEd.item.value.id ? t('payroll.editSplit') : t('payroll.addSplit')" :error="splitEd.error.value" :busy="splitEd.busy.value"
      :can-delete="!!splitEd.item.value.id" @save="saveSplit" @cancel="splitEd.close" @delete="splitEd.remove">
      <div class="field"><label for="rs-name">{{ t('payroll.item') }}</label><input id="rs-name" v-model="splitEd.item.value.name" class="in" autocomplete="off"></div>
      <div class="field"><label for="rs-code">{{ t('payroll.code') }}</label><input id="rs-code" v-model="splitEd.item.value.code" class="in" autocomplete="off"></div>
      <div class="field"><label for="rs-ratio">{{ t('payroll.ratioPct') }}</label><MoneyInput id="rs-ratio" v-model="splitPct" decimal prefix="" suffix="%" /></div>
    </EditSheet>

    <EditSheet v-if="accEd.item.value" :key="accEd.item.value.id || 'new'" :title="accEd.item.value.id ? t('payroll.editAccount') : t('payroll.addAccount')" :error="accEd.error.value" :busy="accEd.busy.value"
      :can-delete="!!accEd.item.value.id" @save="accEd.save" @cancel="accEd.close" @delete="accEd.remove">
      <div class="field"><label for="ac-name">{{ t('payroll.account') }} <span class="star" aria-hidden="true">*</span></label><input id="ac-name" v-model="accEd.item.value.name" class="in" autocomplete="off"></div>
      <div class="field">
        <label for="ac-role">{{ t('payroll.role') }} <span class="opt">{{ t('common.optional') }}</span></label>
        <div class="chips" role="group" :aria-label="t('payroll.roleQuick')"><Pill v-for="r in roleChips" :key="r" :selected="accEd.item.value.role === r" @click="accEd.item.value!.role = r">{{ r }}</Pill></div>
        <input id="ac-role" v-model="accEd.item.value.role" class="in" autocomplete="off">
        <span class="hint">{{ t('payroll.roleHint') }}</span>
      </div>
      <div class="field"><label for="ac-in">{{ t('payroll.inflow') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ac-in" v-model="accEd.item.value.inflow" class="in" autocomplete="off"></div>
      <div class="field"><label for="ac-out">{{ t('payroll.outflow') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ac-out" v-model="accEd.item.value.outflow" class="in" autocomplete="off"></div>
    </EditSheet>

    <EditSheet v-if="payDlg" :title="t('payroll.payTitle')" :desc="t('payroll.payDesc')" :save-label="t('payroll.apply')" @save="applyPay" @cancel="payDlg = false">
      <div class="field"><span class="lbl2">{{ t('payroll.paySaved') }}</span><div class="ro"><span>{{ t('payroll.netPay') }}</span><b class="num">{{ fmtMoney(store.settings.netPay) }}</b></div></div>
      <div class="field"><label for="pay-try">{{ t('payroll.payTry') }}</label><MoneyInput id="pay-try" v-model="payDraft" /></div>
      <button class="btn sm ghost link" type="button" style="justify-self:start" @click="payDraft = store.settings.netPay">{{ t('payroll.payReset') }}</button>
    </EditSheet>

    <ConfirmDialog v-if="view && viewBody" :title="t('payroll.calcTitle', { name: view.name })" :confirm-label="viewBody.go" :cancel-label="t('common.close')" @cancel="view = null" @confirm="viewGo">
      <span class="lbl2">{{ t('payroll.calcLead') }}</span>
      <div class="formula"><b class="num">{{ fmtMoney(view.amount) }}</b>{{ viewBody.formula }}</div>
      <p class="hint">{{ viewBody.where }}</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.two{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.c-targets{flex:2 1 420px;min-width:0}
.c-phases{flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:12px}
.acc{align-items:stretch}
.colA{flex:3 1 560px;min-width:0;display:flex;flex-direction:column;gap:20px}
.colB{flex:2 1 340px;min-width:0;display:flex;flex-direction:column;gap:20px}
.ph-bar{display:flex;justify-content:space-between;align-items:center}
.ph-bar b{font-size:15px}
.card-hd.wrap{flex-wrap:wrap}
.nowrap{white-space:nowrap}
.hint{font-size:12px;color:var(--subtle)}
.tname{display:inline-flex;align-items:center;gap:8px}
.tname i{width:10px;height:10px;border-radius:2px;flex:none}
.tname b{font-weight:600}
.card .tbl{border:0;border-radius:0}
.tbl .n{text-align:right}
td.amt{font-weight:600;font-variant-numeric:tabular-nums}
tr.total td{border-top:1px solid var(--border);font-weight:600}
tr.click{cursor:pointer}
.phase-card{padding:14px 18px;display:flex;flex-direction:column;gap:10px}
.ph-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ph-n{flex-grow:1;min-width:0;overflow-wrap:anywhere}
.abar{display:flex;gap:2px;height:22px;border-radius:3px;overflow:hidden;background:var(--fill)}
.abar span{min-width:2px}
.phase-card .legend{margin-top:0}
.mnav{display:flex;align-items:center;gap:6px}
.mnav h2{margin:0;font-size:15px;font-weight:600;min-width:92px;text-align:center}
.sq{width:36px;height:36px;padding:0}
.sq :deep(svg){width:18px;height:18px}
.sum{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.link{color:var(--primary-text)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.act{width:1%;white-space:nowrap}
.short{margin:12px 18px}
.foot{margin:0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2);border-top:1px solid var(--divider);border-radius:0 0 var(--r-card) var(--r-card)}
.foot2{display:flex;flex-direction:column;gap:6px;padding:12px 18px;border-top:1px solid var(--divider)}
.warnt{font-size:12px;color:var(--accent-text)}
.empty{margin:0;padding:24px 18px;text-align:center}
.flow{list-style:none;margin:0;padding:18px;display:flex;flex-direction:column}
.flow li{display:flex;gap:12px}
.fl-m{display:flex;flex-direction:column;align-items:center;flex:0 0 24px}
.no{width:24px;height:24px;border-radius:12px;background:var(--primary);color:var(--primary-ink);font-size:12px;font-weight:700;display:grid;place-items:center}
.ln{flex-grow:1;width:2px;background:var(--border-strong);margin:4px 0}
.fl-b{flex-grow:1;min-width:0;padding-bottom:16px;display:flex;flex-direction:column}
.flow li:last-child .fl-b{padding-bottom:0}
.fl-b > b{font-size:13px}
.box{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-top:8px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:var(--r-card);background:var(--surface-2)}
.box span{font-size:13px;color:var(--text-2)}
.box b{font-size:18px}
.fcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}
.fcard{padding:10px 12px;border:1px solid var(--border);border-top:3px solid var(--border);border-radius:var(--r-ctl);display:flex;flex-direction:column;gap:2px;min-width:0}
.fcard b{overflow-wrap:anywhere}
.fcard .fa{font-size:15px}
.fcard small{font-size:12px;color:var(--text-2)}
.fsum{display:flex;justify-content:space-between;gap:12px;margin-top:10px;padding:8px 12px;border-radius:var(--r-card);background:var(--primary-tint);border:1px solid var(--primary-line);font-size:13px}
.fnote{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--text-2)}
.fnote span{flex:1 1 260px}
.liv .field{gap:6px}
.shbar{height:6px;border-radius:2px;background:var(--fill);overflow:hidden}
.shbar div{height:100%;background:var(--primary)}
.note{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.lbl2{font-size:12px;font-weight:600;color:var(--text-2)}
.ro{display:flex;justify-content:space-between;align-items:center;height:44px;padding:0 12px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface-2);font-size:14px}
.ro span{color:var(--text-2)}
.pv{gap:8px}
.formula{margin:6px 0 8px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface-2);font-size:13px;line-height:1.6;color:var(--text-2)}
.formula b{display:block;font-size:15px;color:var(--text)}
@media (max-width:760px){
  .stack table,.stack tbody,.stack tr,.stack td{display:block;width:auto}
  .stack thead{display:none}
  .stack tr{padding:10px 16px;border-bottom:1px solid var(--divider)}
  .stack td{padding:2px 0;border:0;text-align:left !important;white-space:normal}
  .stack td[data-label]::before{content:attr(data-label);display:inline-block;min-width:84px;margin-right:8px;font-size:12px;color:var(--subtle);font-weight:500}
  .stack td:first-child::before{display:none}
  .stack td.act{width:auto}
  .stack td:empty{display:none}
  .stack tr.total td:first-child{font-weight:600}
}
</style>
