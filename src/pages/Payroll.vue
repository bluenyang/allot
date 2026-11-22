<script setup lang="ts">
// 월급 분배 (spec 010 S-8, S-10): the split targets and phases, the month's simulation with the
// remainder split, and the accounts, living costs and pay settings. Every change goes to the API first
// (useEditor / the store writers). The phase number is automatic (phaseNumbers); the stored phase
// `label` is never shown or edited here and is sent back as it was. A remainder target is optional:
// without one, what is left of the pay stays in the pay account (`unallocated`).
// spec 013 (W-6): the Savings / Investment totals as target kinds, a linked account per target, phase amount
// fields for fixed targets and ratio-split Savings / Investment totals, and the living costs as a read-only
// list of the living items (they are edited in the Living menu).
// spec 013 (W-5): the accounts table (bank and last digits, this month's transfer in), the warning for targets
// with no account and its 통장 연결 sheet, the two-step account editor and the account detail sheet.
import { t, tl } from '../i18n'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MoneyInput from '../components/MoneyInput.vue'
import AccountEditor from '../components/AccountEditor.vue'
import AccountSheet from '../components/AccountSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { fmtMoney, fmtMoneyClass } from '../lib/display'
import { saveItem, saveSettings, sessionScope, store } from '../lib/store'
import { accountMonthIn, bankLine, unlinkedTargets } from '../lib/accounts'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import { kindDetail } from '../lib/labels'
import { addYm, groupAt, livingAt, monthMoney, phaseNumbers, splitOf, splitRemainder, today, ymLabel, ymOf, type AllocRow } from '../lib/calc'
import type { Account, AllocationKind, AllocationTarget, BudgetGroup, Settings } from '../data/types'
import Select from '../components/Select.vue'
import MonthInput from '../components/MonthInput.vue'

const tab = ref('phases')
const tabs = computed(() => [
  { id: 'phases', label: t('payroll.tabPhases'), icon: 'list' },
  { id: 'sim', label: t('payroll.tabSim'), icon: 'chart' },
  { id: 'accounts', label: t('payroll.tabAccounts'), icon: 'money' },
])
const now = ymOf(today())
// The month's distribution with its one-off spendings (spec 011 S-5); `pay` is a value tried on this screen.
const dist = (ym: string, pay = store.settings.netPay) => monthMoney(store, ym, { pay }).dist

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
/** The salary and card one-offs taken off this month's remainder (the basis line under the table). */
const simSpend = computed(() => { const s = monthMoney(store, ym.value).spend; return s.general + s.installment })
const remainderTarget = computed(() => store.targets.find((x) => x.kind === 'remainder') ?? null)
const split = computed(() => (sim.value.remainderTarget ? splitRemainder(sim.value.remainder, store.remainderSplit) : []))
const remainderName = computed(() => remainderTarget.value?.name ?? t('payroll.remainder'))
/** The menu a computed target is split in: its name and page (the "{menu}에서 나누기 →" links). */
const MENUS: Partial<Record<AllocationKind, { key: 'menuLiving' | 'menuSubs' | 'menuSaving' | 'menuInvest'; to: string }>> = {
  living: { key: 'menuLiving', to: '/living' },
  subscriptions: { key: 'menuSubs', to: '/spend/subs' },
  saving: { key: 'menuSaving', to: '/saving' },
  invest: { key: 'menuInvest', to: '/invest' },
}
const menuOf = (k: AllocationKind) => { const m = MENUS[k]; return m ? { label: t(`payroll.${m.key}`), to: m.to } : null }
const isGroup = (k: AllocationKind | 'leftover'): k is BudgetGroup => k === 'saving' || k === 'invest'
/** How a row's amount is worked out when the user left no note (label.allocDetail has the older kinds). */
const detailOf = (r: Pick<AllocRow, 'detail' | 'kind'>) =>
  r.detail || (r.kind === 'saving' ? t('payroll.detailSaving') : r.kind === 'invest' ? t('payroll.detailInvest') : kindDetail(r.kind))
const accountName = (id: string | null | undefined) => (id ? store.accounts.find((a) => a.id === id)?.name ?? null : null)
/** The phase editor's amount fields: fixed targets, and a Savings / Investment total whose menu splits by ratio (S-3). */
const amountTargets = computed(() => store.targets.filter((x) => x.kind === 'fixed' || (isGroup(x.kind) && splitOf(x.kind, store.settings) === 'ratio')))
/** Savings / Investment totals in amount split: no field, their value is the items' sum. */
const itemSumTargets = computed(() => store.targets.filter((x) => isGroup(x.kind) && splitOf(x.kind, store.settings) === 'amount'))
const ratioSum = computed(() => Math.round(store.remainderSplit.reduce((a, x) => a + x.ratio, 0) * 100))
const simPhase = computed(() => {
  const p = sim.value.phase
  return p ? `${t('payroll.phaseNo', { n: numbers.value[p.id] ?? 0 })} ${p.name}` : t('payroll.noPhase')
})

interface SimRow { key: string; name: string; kind: AllocationKind | 'leftover'; amount: number; detail: string; color: string }
const simRows = computed<SimRow[]>(() => {
  const rows: SimRow[] = sim.value.rows.map((r: AllocRow) => ({ key: r.key, name: r.name, kind: r.kind, amount: r.amount, detail: detailOf(r), color: allocColor(r.key) }))
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
  const x = monthMoney(store, ym.value).transfer
  const others = pay.value - sim.value.remainder
  if (r.kind === 'living') {
    const items = livingAt(store.livingItems, store.phases, ym.value).rows
    const formula = items.length ? items.map((x) => `${x.item.name} ${fmtMoney(x.amount)}`).join(' + ') : t('payroll.fLivingNone')
    return { formula, where: t('payroll.whereLiving'), go: t('payroll.openLiving') }
  }
  if (isGroup(r.kind)) {
    const g = groupAt(r.kind, store.accounts, store.phases, store.targets, store.settings, ym.value)
    const menu = t(r.kind === 'saving' ? 'payroll.menuSaving' : 'payroll.menuInvest')
    return {
      formula: g.mode === 'ratio' ? t('payroll.fGroupRatio', { total: fmtMoney(g.total) }) : t('payroll.fGroupAmount', { menu, n: g.rows.length }),
      where: t('payroll.whereGroup', { menu }),
      go: t(r.kind === 'saving' ? 'payroll.openSaving' : 'payroll.openInvest'),
    }
  }
  if (r.kind === 'subscriptions') {
    const unit = store.settings.subRound
    return { formula: unit > 1 ? t('payroll.fSubs', { needed: fmtMoney(x.needed), unit: fmtMoney(unit) }) : t('payroll.fSubsOff', { needed: fmtMoney(x.needed) }), where: t('payroll.whereSubs'), go: t('payroll.openSubs') }
  }
  return { formula: t('payroll.fRest', { pay: fmtMoney(pay.value), others: fmtMoney(others) }), where: t('payroll.whereRest'), go: t('payroll.openPay') }
})
const router = useRouter()
function viewGo() {
  const k = view.value?.kind
  view.value = null
  if (k === 'living' || k === 'subscriptions' || k === 'saving' || k === 'invest') void router.push(MENUS[k]!.to)
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
// the month field gives '' for "no end"; the API wants null.
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
  // The same month's spendings as the real distribution: the preview differs only by the draft phase.
  const d = monthMoney(store, ymP, { phases: [{ ...draft, from: '0000-01', to: null }] }).dist
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

const KIND_IDS: AllocationKind[] = ['living', 'subscriptions', 'fixed', 'remainder', 'saving', 'invest']
const kindOf = (k: AllocationKind) => t(`payroll.kind.${k}`)
const targetEd = useEditor('targets', (): AllocationTarget => ({ id: '', name: '', kind: 'fixed', note: '', accountId: null }),
  (x) => (!x.name.trim() ? t('payroll.needName') : null))
// The linked account: '' in the select is "not linked" (null); a target opened without the key keeps it absent until a pick.
const targetAccount = computed({
  get: () => targetEd.item.value?.accountId ?? '',
  set: (v: string) => { if (targetEd.item.value) targetEd.item.value.accountId = v || null },
})
const accountOpts = computed(() => [{ value: '', label: t('payroll.accountNone') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
// A kind that only one target can have is marked when another target already has it. The option stays
// choosable: the server answers with the rule, as it always did.
const kindOption = (k: AllocationKind) =>
  k !== 'fixed' && store.targets.some((x) => x.kind === k && x.id !== targetEd.item.value?.id) ? t('payroll.kindExists', { kind: kindOf(k) }) : kindOf(k)

// ---------- accounts (S-5) ----------
/** The account editor: undefined = closed, null = a new account. */
const accEdit = ref<Account | null | undefined>(undefined)
/** The account whose detail sheet is open. */
const accView = ref<string | null>(null)
function editFromSheet() {
  const a = store.accounts.find((x) => x.id === accView.value) ?? null
  accView.value = null
  accEdit.value = a
}
// The role chips' words (both languages) and the 0.1.6 chip 저축·투자, each with its pill colour; anything else is plain.
const ROLE_CLS = { roleIn: 'ok', roleFixed: 'warn', roleLiving: 'info', roleSaving: 'ok', roleInvest: 'info', roleSave: 'ok', roleEtc: 'mute' } as const
/** Pill colour of a stored role: the known words (either language) get one, anything else is plain. */
function roleCls(role: string) {
  for (const [k, cls] of Object.entries(ROLE_CLS)) if (tl('ko', `payroll.${k}` as never) === role || tl('en', `payroll.${k}` as never) === role) return cls
  return 'mute'
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
/** This month's money into each account (the 이번 달 column). */
const accRows = computed(() => store.accounts.map((a) => ({ a, bank: bankLine(a), month: accountMonthIn(a, store, now, flow.value) })))
const unlinked = computed(() => unlinkedTargets(store.targets, store.accounts))

// 통장 연결: one select per target; saving writes the targets whose account changed.
const linkOpen = ref(false)
const linkDraft = ref<Record<string, string>>({})
const linkErr = ref('')
const linkBusy = ref(false)
const linkAmount = (id: string) => flow.value.rows.find((r) => r.key === id)?.amount ?? 0
const linkOpts = computed(() => [{ value: '', label: t('accounts.link.none') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
function openLink() {
  linkDraft.value = Object.fromEntries(store.targets.map((x) => [x.id, x.accountId ?? '']))
  linkErr.value = ''
  linkOpen.value = true
}
async function saveLink() {
  const scope = sessionScope()
  linkBusy.value = true
  linkErr.value = ''
  try {
    for (const tg of [...store.targets]) {
      if (!scope.alive()) return
      const next = linkDraft.value[tg.id] || null
      if (next !== (tg.accountId ?? null)) await saveItem('targets', { ...tg, accountId: next })
    }
    linkOpen.value = false
  } catch (e) {
    linkErr.value = (e as Error).message
  } finally {
    linkBusy.value = false
  }
}
function linkNewAccount() {
  linkOpen.value = false
  accEdit.value = null
}
const flowRows = computed(() => flow.value.rows.filter((r) => r.kind !== 'remainder' || r.amount !== 0).map((r) => {
  const tg = store.targets.find((x) => x.id === r.key)
  const acc = accountName(tg?.accountId)
  // where it goes: the linked account; else the remainder stays in the pay account, Savings / Investment go to their items
  const to = acc ?? (r.kind === 'remainder' ? t('payroll.leftoverName') : isGroup(r.kind) ? t('payroll.toItems') : null)
  return { ...r, detail: detailOf(r), to: to ?? t('payroll.unlinked'), linked: to !== null, menu: menuOf(r.kind) }
}))
const flowSent = computed(() => flow.value.rows.filter((r) => r.kind !== 'remainder').reduce((a, r) => a + r.amount, 0))
// 생활비 구성 (S-2): this month's living items, read-only; they are added and changed in the Living menu.
const livingNow = computed(() => livingAt(store.livingItems, store.phases, now))
const share = (v: number) => (livingNow.value.sum > 0 ? Math.round((v / livingNow.value.sum) * 100) : 0)
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
            <thead><tr><th scope="col">{{ t('payroll.name') }}</th><th scope="col">{{ t('payroll.kindLabel') }}</th><th scope="col">{{ t('payroll.colAccount') }}</th><th scope="col" class="c-memo">{{ t('payroll.note') }}</th></tr></thead>
            <tbody>
              <tr v-for="tg in store.targets" :key="tg.id" class="click" tabindex="0" @click="targetEd.open(tg)" @keydown.enter="targetEd.open(tg)">
                <td :data-label="t('payroll.name')"><span class="tname"><i :style="{ background: allocColor(tg.id) }"></i><b>{{ tg.name }}</b></span></td>
                <td :data-label="t('payroll.kindLabel')" class="nowrap">{{ kindOf(tg.kind) }}</td>
                <td :data-label="t('payroll.colAccount')" :class="accountName(tg.accountId) ? '' : 'hint'">{{ accountName(tg.accountId) ?? t('payroll.unlinked') }}</td>
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
        <p v-if="simSpend > 0" class="foot spend-line">{{ t('payroll.spendLine', { amount: fmtMoney(simSpend) }) }}</p>
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
                    <small>{{ r.detail }}</small>
                    <small class="fto" :class="{ off: !r.linked }">→ {{ r.to }}</small>
                    <RouterLink v-if="r.menu" class="fgo" :to="r.menu.to">{{ t('payroll.splitIn', { menu: r.menu.label }) }}</RouterLink>
                  </div>
                </div>
                <div class="fsum"><span>{{ t('payroll.flowSent', { sent: fmtMoney(flowSent) }) }} · {{ flow.remainderTarget ? t('payroll.flowRestOf', { name: flow.remainderTarget.name }) : t('payroll.leftoverName') }}</span><b class="num" :class="fmtMoneyClass(flow.remainder)">{{ fmtMoney(flow.remainder) }}</b></div>
                <div v-if="!flow.remainderTarget" class="fnote"><span>{{ t('payroll.flowNone') }}</span><button class="btn sm ghost link" type="button" @click="targetEd.open()">{{ t('payroll.addTargetBtn') }}</button></div>
              </div>
            </li>
          </ol>
        </section>

        <section class="card">
          <div class="card-hd"><h2>{{ t('payroll.accounts') }}</h2><button class="btn sm" type="button" @click="accEdit = null">{{ t('payroll.addAccountBtn') }}</button></div>
          <div v-if="store.accounts.length" class="tbl stack" data-testid="accounts-table">
            <table>
              <thead><tr>
                <th scope="col">{{ t('payroll.account') }}</th><th scope="col">{{ t('payroll.role') }}</th><th scope="col">{{ t('payroll.inflow') }}</th><th scope="col">{{ t('payroll.outflow') }}</th>
                <th scope="col" class="n">{{ t('accounts.colMonth') }}</th><th scope="col" class="n"><span class="sr">{{ t('accounts.colAction') }}</span></th>
              </tr></thead>
              <tbody>
                <tr v-for="x in accRows" :key="x.a.id" class="click" tabindex="0" @click="accView = x.a.id" @keydown.enter.self="accView = x.a.id">
                  <td :data-label="t('payroll.account')"><b>{{ x.a.name }}</b><span v-if="x.a.stopFrom" class="pill mute stp-p">{{ t('accounts.stopped') }}</span><small v-if="x.bank" class="bank num">{{ x.bank }}</small></td>
                  <td :data-label="t('payroll.role')"><span v-if="x.a.role" class="pill" :class="roleCls(x.a.role)">{{ x.a.role }}</span></td>
                  <td :data-label="t('payroll.inflow')">{{ x.a.inflow }}</td>
                  <td :data-label="t('payroll.outflow')">{{ x.a.outflow }}</td>
                  <td :data-label="t('accounts.colMonth')" class="n amt">{{ x.month ? fmtMoney(x.month) : '—' }}</td>
                  <td class="n act"><button class="btn sm ghost link" type="button" :aria-label="t('payroll.editAccount') + ' · ' + x.a.name" @click.stop="accEdit = x.a" @keydown.enter.stop>{{ t('common.edit') }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty hint">{{ t('payroll.noAccounts') }}</p>
          <div v-if="unlinked.length" class="lnk" data-testid="unlinked-targets">
            <span>{{ t('accounts.unlinked', { n: unlinked.length, names: unlinked.map((x) => x.name).join(', ') }) }}</span>
            <button class="btn sm" type="button" @click="openLink">{{ t('accounts.linkBtn') }}</button>
          </div>
        </section>
      </div>

      <div class="colB">
        <section class="card" data-testid="living-list">
          <div class="card-hd"><h2>{{ t('payroll.livingTitle') }}</h2><span class="lv-hd"><b class="num">{{ fmtMoney(livingNow.sum) }}</b><RouterLink class="btn sm" to="/living">{{ t('payroll.livingManage') }}</RouterLink></span></div>
          <div class="fs liv">
            <p v-if="!livingNow.rows.length" class="hint note">{{ t('payroll.livingEmpty') }}</p>
            <div v-for="l in livingNow.rows" :key="l.item.id" class="lv-row">
              <div class="lv-l"><span>{{ l.item.name }}</span><span class="num"><b>{{ fmtMoney(l.amount) }}</b> <small class="hint">{{ share(l.amount) }}%</small></span></div>
              <div class="shbar" aria-hidden="true"><div :style="{ width: `${share(l.amount)}%` }"></div></div>
            </div>
            <i18n-t keypath="payroll.livingFoot" tag="p" class="hint note lv-foot"><template #link><RouterLink to="/living">{{ t('payroll.livingLink') }}</RouterLink></template></i18n-t>
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
              <Select id="st-round" v-model="set.subRound" :options="roundOpts.map((o) => ({ value: o.v, label: o.label }))" />
              <span class="hint">{{ t('payroll.subRoundHint') }}</span>
            </div>
            <i18n-t keypath="payroll.settingsNote" tag="p" class="hint note"><template #link><RouterLink to="/settings/general">{{ t('payroll.settingsLink') }}</RouterLink></template></i18n-t>
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
      :can-delete="!!targetEd.item.value.id" :delete-name="targetEd.item.value.name" @save="targetEd.save" @cancel="targetEd.close" @delete="targetEd.remove">
      <div class="field"><label for="tg-name">{{ t('payroll.name') }} <span class="star" aria-hidden="true">*</span></label><input id="tg-name" v-model="targetEd.item.value.name" class="in" autocomplete="off"></div>
      <div class="field"><label for="tg-kind">{{ t('payroll.kindLabel') }}</label>
        <Select id="tg-kind" v-model="targetEd.item.value.kind" :options="KIND_IDS.map((k) => ({ value: k, label: kindOption(k) }))" />
        <span class="hint">{{ t(`payroll.kindHint.${targetEd.item.value.kind}`) }} {{ t('payroll.onePerKind') }}</span></div>
      <div class="field"><label for="tg-acc">{{ t('payroll.colAccount') }} <span class="opt">{{ t('common.optional') }}</span></label>
        <Select id="tg-acc" v-model="targetAccount" :options="accountOpts" />
        <span class="hint">{{ t('payroll.accountHint') }}</span></div>
      <div class="field"><label for="tg-note">{{ t('payroll.note') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="tg-note" v-model="targetEd.item.value.note" class="in" autocomplete="off"></div>
    </EditSheet>

    <EditSheet v-if="phaseEd.item.value" :key="phaseEd.item.value.id || 'new'" :title="phaseEd.item.value.id ? t('payroll.editPhase') : t('payroll.addPhase')" :error="phaseEd.error.value" :busy="phaseEd.busy.value" :width="560"
      :can-delete="!!phaseEd.item.value.id" :delete-name="phaseEd.item.value.name" @save="phaseEd.save" @cancel="phaseEd.close" @delete="phaseEd.remove">
      <div class="field"><label for="ph-name">{{ t('payroll.name') }} <span class="star" aria-hidden="true">*</span></label><input id="ph-name" v-model="phaseEd.item.value.name" class="in" autocomplete="off" :placeholder="t('payroll.phaseNamePh')"></div>
      <div class="field"><label for="ph-from">{{ t('payroll.startMonth') }}</label><MonthInput id="ph-from" v-model="phaseEd.item.value.from" clearable /></div>
      <div class="field"><label for="ph-to">{{ t('payroll.endMonth') }}</label><MonthInput id="ph-to" v-model="phaseTo" clearable /><span class="hint">{{ t('payroll.endHint') }}</span></div>
      <div v-for="tg in amountTargets" :key="tg.id" class="field"><label :for="`ph-amt-${tg.id}`">{{ tg.kind === 'fixed' ? tg.name : t('payroll.phaseTotal', { name: tg.name }) }}</label>
        <MoneyInput :id="`ph-amt-${tg.id}`" :model-value="phaseAmount(tg.id)" @update:model-value="setPhaseAmount(tg.id, $event)" /></div>
      <div v-for="tg in itemSumTargets" :key="tg.id" class="field"><span class="lbl2">{{ tg.name }}</span>
        <span class="hint">{{ t('payroll.phaseItemSum') }} · <RouterLink :to="menuOf(tg.kind)!.to">{{ t('payroll.splitIn', { menu: menuOf(tg.kind)!.label }) }}</RouterLink></span></div>
      <div v-if="phasePreview" class="field pv">
        <span class="lbl2">{{ t('payroll.phasePreview', { ym: ymLabel(phasePreview.ym) }) }}</span>
        <div class="abar" role="img" :aria-label="aria(phasePreview.segs)"><span v-for="g in phasePreview.segs" :key="g.key" :style="{ flexGrow: g.amount, background: g.color }"></span></div>
        <span class="hint">{{ phasePreview.note }}</span>
      </div>
      <div class="field"><label for="ph-note">{{ t('payroll.note') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="ph-note" v-model="phaseEd.item.value.note" class="in" autocomplete="off"></div>
    </EditSheet>

    <EditSheet v-if="splitEd.item.value" :key="splitEd.item.value.id || 'new'" :title="splitEd.item.value.id ? t('payroll.editSplit') : t('payroll.addSplit')" :error="splitEd.error.value" :busy="splitEd.busy.value"
      :can-delete="!!splitEd.item.value.id" :delete-name="splitEd.item.value.name" @save="saveSplit" @cancel="splitEd.close" @delete="splitEd.remove">
      <div class="field"><label for="rs-name">{{ t('payroll.item') }}</label><input id="rs-name" v-model="splitEd.item.value.name" class="in" autocomplete="off"></div>
      <div class="field"><label for="rs-code">{{ t('payroll.code') }}</label><input id="rs-code" v-model="splitEd.item.value.code" class="in" autocomplete="off"></div>
      <div class="field"><label for="rs-ratio">{{ t('payroll.ratioPct') }}</label><MoneyInput id="rs-ratio" v-model="splitPct" decimal prefix="" suffix="%" /></div>
    </EditSheet>

    <AccountEditor v-if="accEdit !== undefined" :key="accEdit?.id || 'new'" :initial="accEdit" @close="accEdit = undefined" />
    <AccountSheet v-if="accView" :account-id="accView" @close="accView = null" @edit="editFromSheet" />

    <EditSheet v-if="linkOpen" :title="t('accounts.link.title')" :desc="t('accounts.link.desc')" :hint="t('accounts.link.foot')" :error="linkErr" :busy="linkBusy" @save="saveLink" @cancel="linkOpen = false">
      <div v-for="tg in store.targets" :key="tg.id" class="field">
        <label :for="`lk-${tg.id}`"><i class="sw" :style="{ background: allocColor(tg.id) }"></i>{{ tg.name }} <span class="opt">· {{ fmtMoney(linkAmount(tg.id)) }}</span></label>
        <Select :id="`lk-${tg.id}`" v-model="linkDraft[tg.id]" :options="linkOpts" />
      </div>
      <button class="btn sm ghost link" type="button" style="justify-self:start" @click="linkNewAccount">{{ t('accounts.link.newAccount') }}</button>
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
.ph-h{display:flex;align-items:center;gap:10px}
.ph-h > :not(.ph-n){flex:none;white-space:nowrap}
.ph-n{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.lv-hd{display:flex;align-items:center;gap:12px}
.lv-row{display:flex;flex-direction:column;gap:6px}
.lv-l{display:flex;justify-content:space-between;gap:12px;font-size:13px}
.lv-foot{padding-top:10px;border-top:1px solid var(--divider)}
.fto{color:var(--text-2)}
.fto.off{color:var(--accent-text)}
.fgo{margin-top:4px;font-size:12px;font-weight:600;text-decoration:none}
.shbar{height:6px;border-radius:2px;background:var(--fill);overflow:hidden}
.shbar div{height:100%;background:var(--primary)}
.note{margin:0}
.bank{display:block;font-size:12px;color:var(--subtle)}
.stp-p{margin-left:8px}
.lnk{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 18px 18px;padding:12px 14px;border:1px dashed var(--border-strong);border-radius:var(--r-card);font-size:13px;color:var(--text-2)}
.lnk span{flex:1 1 260px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
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
