<script setup lang="ts">
import { t, type MessageKey } from '../i18n'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import PageHeader from '../components/PageHeader.vue'
import TransferChart from '../components/TransferChart.vue'
import Seg from '../components/Seg.vue'
import Soon from '../components/Soon.vue'
import Icon from '../components/Icon.vue'
import { store } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import { monthShort, wonText } from '../lib/format'
import { CATEGORY_IDS, catLabel, cycleLabel, pathLabel, statusLabel } from '../lib/labels'
import { addYm, changesIn, monthlyKrw, monthMoney, nextPayment, num, planAt, today, usd, ymOf, ymRange } from '../lib/calc'
import type { Plan, PlanChange, Subscription } from '../data/types'
import Select from '../components/Select.vue'
import MonthInput from '../components/MonthInput.vue'

// The editors load when one is opened: the first screen stays small.
const SubEditor = defineAsyncComponent(() => import('../components/SubEditor.vue'))
const PlanChangeEditor = defineAsyncComponent(() => import('../components/PlanChangeEditor.vue'))

// 구독 (spec 010 S-7): four summary cards, four views in one card, a two-step editor for a subscription
// and one for a plan change. Not drawn yet: the CSV export (준비 중).
const tab = ref('list')
const now = today()
const ym = ref(ymOf(now))
const PATH_IDS = ['direct', 'google', 'apple', 'telecom'] as const

const tabs = computed(() => [
  { id: 'list', label: t('subscriptions.tabList'), count: store.subscriptions.length || undefined },
  { id: 'preview', label: t('subscriptions.tabPreview') },
  { id: 'changes', label: t('subscriptions.tabChanges'), count: store.planChanges.length || undefined },
  { id: 'calc', label: t('subscriptions.tabCalc') },
])

const firstLine = (s: string) => s.split('\n')[0] ?? ''
const charge = (p: Plan) => p.currency === 'USD' ? `USD ${p.amount.toFixed(2)}${p.vat ? ` +${p.vat}%` : ''}` : `KRW ${num(p.amount)}`
const monthly = (p: Plan) => (p.status === 'active' ? monthlyKrw(p, store.settings) : 0)

// ---------- list ----------
/** The next charge by the schedule the calendar and MCP use (no horizon: a first charge any distance away shows). */
const upcoming = (base: Subscription) => nextPayment(base, store.planChanges, now)
const rows = computed(() =>
  store.subscriptions.map((base) => {
    const p = planAt(base, store.planChanges, ym.value)
    const pending = store.planChanges.some((c) => c.subId === base.id && (!c.effective || c.effective.slice(0, 7) > ym.value))
    return { base, p, monthly: monthly(p), next: p.status === 'active' ? upcoming(base) : null, pending }
  }),
)
// The month's transfer with its subscription-account one-offs (spec 011 S-5).
const xfer = computed(() => monthMoney(store, ym.value).transfer)
const xferNext = computed(() => monthMoney(store, addYm(ym.value, 1)).transfer)
const spendSubs = (m: string) => monthMoney(store, m).spend.subs
const monthlyTotal = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
const nextTotal = computed(() => xferNext.value.monthlySum + xferNext.value.yearlyMonthly)
const nextDiff = computed(() => Math.round(nextTotal.value) - Math.round(monthlyTotal.value))
const active = computed(() => rows.value.filter((r) => r.p.status === 'active'))
const unverified = computed(() => active.value.filter((r) => !r.p.verified))
const yearlyCount = computed(() => active.value.filter((r) => r.p.cycle === 'yearly').length)
const usdCount = computed(() => active.value.filter((r) => r.p.currency === 'USD').length)

const status = ref<'all' | 'active' | 'company' | 'cancelled'>('active')
const cat = ref('')
const path = ref('')
const q = ref('')
const statusOpts = computed(() => (['all', 'active', 'company', 'cancelled'] as const).map((id) => ({
  id, label: t(`subscriptions.filter.${id}`),
  count: id === 'all' ? rows.value.length : rows.value.filter((r) => r.p.status === id).length,
})))
const shown = computed(() => rows.value
  .filter((r) => (status.value === 'all' || r.p.status === status.value) && (!cat.value || r.p.category === cat.value) && (!path.value || r.p.path === path.value)
    && (!q.value.trim() || r.p.name.toLowerCase().includes(q.value.trim().toLowerCase())))
  .sort((a, b) => (a.next ? a.next.getTime() : Infinity) - (b.next ? b.next.getTime() : Infinity)))
const receipt = (r: (typeof rows.value)[number]) => r.p.status !== 'active'
  ? { cls: 'mute', text: statusLabel(r.p.status) }
  : r.p.verified ? { cls: 'ok', text: t('subscriptions.verified') } : { cls: 'warn', text: t('subscriptions.unverified') }
const chargeText = (r: (typeof rows.value)[number]) => (r.p.status === 'company' ? t('subscriptions.companyPays') : charge(r.p))
const pathText = (r: (typeof rows.value)[number]) => (r.p.status === 'company' ? t('subscriptions.company') : pathLabel(r.p.path))
const subsName = computed(() => store.targets.find((x) => x.kind === 'subscriptions')?.name ?? t('subscriptions.transferName'))
const remainderName = computed(() => store.targets.find((x) => x.kind === 'remainder')?.name ?? '')

// ---------- editors ----------
const subEd = ref<{ item: Subscription | null } | null>(null)
const chEd = ref<{ item: PlanChange | null } | null>(null)
function openSub(s?: Subscription) { tab.value = 'list'; subEd.value = { item: s ?? null } }
function editChange(c: PlanChange) { subEd.value = null; tab.value = 'changes'; chEd.value = { item: c } }

// The 지출 page (spec 011 S-1) owns the add button and the "#subs?add" / "#spend/subs?add" addresses; it asks
// for the add editor with `adding`, and this page says when it has opened it.
const props = defineProps<{ embedded?: boolean; adding?: boolean }>()
const emit = defineEmits<{ added: [] }>()
watch(() => props.adding, (on) => { if (on) { openSub(); emit('added') } }, { immediate: true })

// ---------- preview ----------
const from = ref(ymOf(now))
const nextDated = computed(() => store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) > ymOf(now)).map((c) => c.effective!.slice(0, 7)).sort()[0])
const to = ref(nextDated.value ?? addYm(ymOf(now), 1))
const cmp = computed(() => {
  // The comparison shows the plan and price items; each month carries its own one-offs as in the calc cards.
  const a = monthMoney(store, from.value).transfer
  const b = monthMoney(store, to.value).transfer
  const ids = new Set([...a.items, ...b.items].map((i) => i.sub.id))
  const all = [...ids].map((id) => {
    const x = a.items.find((i) => i.sub.id === id)
    const y = b.items.find((i) => i.sub.id === id)
    return { id, name: (y ?? x)!.sub.name, before: x, after: y, diff: (y?.monthly ?? 0) - (x?.monthly ?? 0) }
  })
  const changed = all.filter((r) => Math.abs(r.diff) >= 1 || r.before?.sub.plan !== r.after?.sub.plan)
  const sa = a.monthlySum + a.yearlyMonthly
  const sb = b.monthlySum + b.yearlyMonthly
  return { a, b, changed, rest: all.length - changed.length, sa, sb }
})
const planAmt = (i?: { sub: Subscription; monthly: number }) => (i ? `${firstLine(i.sub.plan) || '—'} · ${fmtMoney(i.monthly)}` : '—')
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtMoney(Math.abs(n))}`
const previewNote = computed(() => {
  const { a, b } = cmp.value
  const d = b.transfer - a.transfer
  const range = `${fmtMoney(a.transfer)} → ${fmtMoney(b.transfer)}`
  if (d === 0) return t('subscriptions.noteSame', { amount: fmtMoney(a.transfer) })
  const keys = remainderName.value ? (d > 0 ? 'noteUpTo' : 'noteDownTo') : (d > 0 ? 'noteUp' : 'noteDown')
  return t(`subscriptions.${keys}` as MessageKey, { range, rem: remainderName.value })
})

// ---------- changes ----------
const changeRows = computed(() =>
  [...store.planChanges]
    .sort((a, b) => (a.effective ?? '9999') < (b.effective ?? '9999') ? -1 : 1)
    .map((c) => {
      const base = store.subscriptions.find((s) => s.id === c.subId)
      let effect: number | null = null
      let title = base?.name ?? c.subId
      if (base && c.effective) {
        const m = c.effective.slice(0, 7)
        const others = store.planChanges.filter((x) => x.id !== c.id)
        const before = planAt(base, others, m)
        const after = planAt(base, store.planChanges, m)
        effect = monthly(after) - monthly(before)
        if (firstLine(before.plan) !== firstLine(after.plan)) title = `${base.name} · ${firstLine(before.plan) || '—'} → ${firstLine(after.plan) || '—'}`
      }
      return { c, title, detail: [describe(c), c.note].filter(Boolean).join(' · '), effect }
    }),
)
function describe(c: PlanChange) {
  const base = store.subscriptions.find((s) => s.id === c.subId)
  const to = c.to
  const parts: string[] = []
  if (to.plan) parts.push(firstLine(to.plan))
  if (to.amount != null) parts.push((to.currency ?? base?.currency) === 'USD' ? usd(to.amount) : wonText(to.amount))
  if (to.cycle) parts.push(cycleLabel(to.cycle))
  if (to.status) parts.push(statusLabel(to.status))
  return parts.join(' · ')
}

// ---------- calc: 12-month chart and per-subscription share ----------
const chartFrom = ref(ymOf(now))
const series = computed(() =>
  ymRange(chartFrom.value, 12).map((m) => ({
    ym: m,
    value: monthMoney(store, m).transfer.needed,
    changed: changesIn(store.planChanges, m).length > 0,
  })),
)
const pick = ref(ymOf(now))
const shares = computed(() => {
  const x = monthMoney(store, pick.value).transfer
  const total = x.monthlySum + x.yearlyMonthly
  return x.items.map((i) => ({ id: i.sub.id, name: i.sub.name, plan: i.sub.plan, monthly: i.monthly, pct: total ? Math.round((i.monthly / total) * 100) : 0 }))
})

// ---------- calc ----------
const calcs = computed(() => [ym.value, addYm(ym.value, 1)].map((m, i) => {
  const x = i === 0 ? xfer.value : xferNext.value
  return {
    m, title: `${t('subscriptions.ymTitle', { y: m.slice(0, 4), m: Number(m.slice(5, 7)) })}${changesIn(store.planChanges, m).length ? ` ${t('subscriptions.withChange')}` : ''}`,
    lines: [
      { k: t('subscriptions.monthlyTotal'), v: fmtMoney(x.monthlySum + x.yearlyMonthly) },
      { k: t('subscriptions.fxBuffer', { pct: store.settings.fxBuffer }), v: `+${fmtMoney(x.buffer)}` },
      ...(spendSubs(m) > 0 ? [{ k: t('subscriptions.spendLine'), v: `+${fmtMoney(spendSubs(m))}` }] : []),
      { k: t('subscriptions.neededTransfer'), v: fmtMoney(x.needed) },
      { k: t('subscriptions.roundTo', { unit: fmtMoney(store.settings.subRound), name: subsName.value }), v: fmtMoney(x.transfer), strong: true },
    ],
  }
}))
</script>

<template>
  <section class="page-gap">
    <PageHeader v-if="!embedded" :title="t('subscriptions.title')" :desc="t('subscriptions.desc')">
      <Soon class="soon-btn" :aria-label="`${t('shell.csvExport')} (${t('common.soon')})`"><Icon name="download" />{{ t('shell.csvExport') }}</Soon>
      <button class="btn pri" type="button" @click="openSub()"><Icon name="plus" />{{ t('subscriptions.addSub') }}</button>
    </PageHeader>

    <section class="kpis" :aria-label="t('subscriptions.summaryLabel')">
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('subscriptions.monthlyTotal') }}</span><span class="pill mute">{{ t('subscriptions.activeN', { n: active.length }) }}</span></div>
        <div class="k-v"><b class="num">{{ fmtMoney(monthlyTotal) }}</b><span class="num k-s" :class="nextDiff > 0 ? 'up' : nextDiff < 0 ? 'down' : ''">{{ monthShort(Number(addYm(ym, 1).slice(5, 7))) }} {{ fmtMoney(nextTotal) }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('subscriptions.yearlyTotal') }}</span><span class="hint">× 12</span></div>
        <div class="k-v"><b class="num">{{ fmtMoney(monthlyTotal * 12) }}</b><span class="hint num">{{ t('subscriptions.yearlyN', { n: yearlyCount }) }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('subscriptions.unverifiedCount') }}</span><span v-if="unverified.length" class="pill warn">{{ t('subscriptions.needCheck') }}</span></div>
        <div class="k-v"><b class="num" :class="{ sig: unverified.length }">{{ t('subscriptions.nItems', { n: unverified.length }) }}</b><span class="hint">{{ unverified[0] ? firstLine(unverified[0].p.name) + (unverified.length > 1 ? ` ${t('subscriptions.andMore', { n: unverified.length - 1 })}` : '') : '' }}</span></div>
      </div>
      <div class="card kpi">
        <div class="k-h"><span class="k-l">{{ t('subscriptions.appliedFx') }}</span><span class="hint">{{ t('subscriptions.usdN', { n: usdCount }) }}</span></div>
        <div class="k-v"><b class="num">₩{{ num(store.settings.fxRate) }}</b><span class="hint num">{{ t('subscriptions.buffer', { pct: store.settings.fxBuffer }) }}</span></div>
      </div>
    </section>

    <div class="views">
      <SubTabs v-model="tab" :tabs="tabs" />

      <section class="card pane">
        <!-- 목록 -->
        <template v-if="tab === 'list'">
          <div class="frow">
            <Seg v-model="status" :options="statusOpts" :label="t('subscriptions.byStatus')" />
            <span class="vr" aria-hidden="true"></span>
            <label class="fsearch"><Icon name="search" /><input v-model="q" type="search" :aria-label="t('subscriptions.searchLabel')" :placeholder="t('subscriptions.searchPh')"></label>
            <Select v-model="cat" class="fsel" :aria-label="t('subscriptions.category')" :options="[{ value: '', label: t('subscriptions.allCategories') }, ...CATEGORY_IDS.map((k) => ({ value: k, label: catLabel(k) }))]" />
            <Select v-model="path" class="fsel" :aria-label="t('subscriptions.path')" :options="[{ value: '', label: t('subscriptions.allPaths') }, ...PATH_IDS.map((k) => ({ value: k, label: pathLabel(k) }))]" />
            <label class="fmonth">{{ t('subscriptions.baseMonth') }}<MonthInput v-model="ym" /></label>
            <span class="hint count">{{ t('subscriptions.count', { n: shown.length }) }}</span>
          </div>

          <div class="tbl dtable">
            <table class="subs-t">
              <thead><tr>
                <th scope="col">{{ t('subscriptions.colService') }}</th>
                <th scope="col" class="c">{{ t('subscriptions.category') }}</th>
                <th scope="col" class="c">{{ t('subscriptions.colCycle') }}</th>
                <th scope="col" class="n">{{ t('subscriptions.colCharge') }}</th>
                <th scope="col" class="n">{{ t('subscriptions.colMonthly') }}</th>
                <th scope="col">{{ t('subscriptions.colNext') }}</th>
                <th scope="col" class="c">{{ t('subscriptions.path') }}</th>
                <th scope="col" class="c">{{ t('subscriptions.colReceipt') }}</th>
                <th scope="col" class="n"><span class="sr">{{ t('common.edit') }}</span></th>
              </tr></thead>
              <tbody>
                <tr v-for="r in shown" :key="r.base.id" :class="{ off: r.p.status === 'cancelled' }">
                  <td><b class="svc">{{ r.p.name }}</b><small class="hint">{{ firstLine(r.p.plan) || '—' }}<template v-if="r.pending"> · {{ t('subscriptions.pendingChange') }}</template></small></td>
                  <td class="c"><span class="pill tag">{{ catLabel(r.p.category) }}</span></td>
                  <td class="c cell2">{{ cycleLabel(r.p.cycle) }}</td>
                  <td class="n mono cell2">{{ chargeText(r) }}</td>
                  <td class="n amt">{{ r.p.status === 'active' ? fmtMoney(r.monthly) : '—' }}</td>
                  <td class="mono">{{ r.next ? fmtDate(r.next) : '—' }}</td>
                  <td class="c cell2">{{ pathText(r) }}</td>
                  <td class="c"><span class="pill" :class="receipt(r).cls">{{ receipt(r).text }}</span></td>
                  <td class="n"><button class="btn sm ghost" type="button" :aria-label="t('common.editLabel', { name: r.p.name })" @click="openSub(r.base)">{{ t('common.edit') }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul class="mlist">
            <li v-for="r in shown" :key="r.base.id" class="mcard" :class="{ off: r.p.status === 'cancelled' }">
              <div class="m1"><span class="m-name"><b>{{ r.p.name }}</b> <small class="hint">{{ firstLine(r.p.plan) || '—' }}</small></span><b class="num m-amt">{{ r.p.status === 'active' ? fmtMoney(r.monthly) : '—' }}</b></div>
              <div class="m2"><span>{{ catLabel(r.p.category) }} · {{ cycleLabel(r.p.cycle) }} · {{ pathText(r) }}</span><span class="pill" :class="receipt(r).cls">{{ receipt(r).text }}</span></div>
              <div class="m3"><span class="mono hint">{{ r.next ? fmtDate(r.next) : '—' }} · {{ chargeText(r) }}</span><button class="btn sm" type="button" :aria-label="t('common.editLabel', { name: r.p.name })" @click="openSub(r.base)">{{ t('common.edit') }}</button></div>
            </li>
          </ul>

          <div v-if="!shown.length" class="empty"><b>{{ t('subscriptions.emptyTitle') }}</b><span class="hint">{{ t('subscriptions.emptyHint') }}</span></div>
        </template>

        <!-- 전환 미리보기 -->
        <template v-else-if="tab === 'preview'">
          <div class="frow">
            <label class="fmonth">{{ t('subscriptions.compareMonth') }}<MonthInput v-model="from" /></label>
            <span aria-hidden="true">→</span>
            <MonthInput v-model="to" class="fm2" :aria-label="t('subscriptions.afterMonth')" />
          </div>
          <div class="tbl">
            <table>
              <thead><tr><th scope="col">{{ t('subscriptions.colService') }}</th><th scope="col">{{ from.slice(0, 4) }}.{{ from.slice(5, 7) }}</th><th scope="col">{{ to.slice(0, 4) }}.{{ to.slice(5, 7) }}</th><th scope="col" class="n">{{ t('subscriptions.monthlyDiff') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in cmp.changed" :key="r.id">
                  <td><b>{{ r.name }}</b></td>
                  <td>{{ planAmt(r.before) }}</td>
                  <td>{{ planAmt(r.after) }}</td>
                  <td class="n" :class="r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : ''">{{ signed(r.diff) }}</td>
                </tr>
                <tr v-if="cmp.rest > 0 || !cmp.changed.length">
                  <td>{{ cmp.changed.length ? t('subscriptions.restN', { n: cmp.rest }) : t('subscriptions.sameAsPrev') }}</td>
                  <td class="hint">{{ t('subscriptions.noChange') }}</td><td class="hint">{{ t('subscriptions.noChange') }}</td><td class="n hint">{{ fmtMoney(0) }}</td>
                </tr>
                <tr class="total"><td>{{ t('subscriptions.sum') }}</td><td class="num">{{ fmtMoney(cmp.sa) }}</td><td class="num">{{ fmtMoney(cmp.sb) }}</td><td class="n" :class="cmp.sb - cmp.sa > 0 ? 'up' : cmp.sb - cmp.sa < 0 ? 'down' : ''">{{ signed(Math.round(cmp.sb) - Math.round(cmp.sa)) }}</td></tr>
              </tbody>
            </table>
          </div>
          <p class="foot">{{ previewNote }}</p>
        </template>

        <!-- 변경 일정 -->
        <template v-else-if="tab === 'changes'">
          <div class="frow end"><button class="btn sm" type="button" @click="chEd = { item: null }">{{ t('subscriptions.addChangeBtn') }}</button></div>
          <ul class="clist">
            <li v-for="r in changeRows" :key="r.c.id" :class="{ undated: !r.c.effective }">
              <span class="c-date mono">{{ r.c.effective ? fmtDate(r.c.effective) : t('subscriptions.noDate') }}</span>
              <span class="c-main"><b>{{ r.title }}</b><small class="hint">{{ r.c.effective ? r.detail : [r.detail, t('subscriptions.undatedHint')].filter(Boolean).join(' · ') }}</small></span>
              <b v-if="r.effect !== null && Math.round(r.effect) !== 0" class="num" :class="r.effect > 0 ? 'up' : 'down'">{{ signed(Math.round(r.effect)) }}</b>
              <span v-else-if="!r.c.effective" class="pill mute">{{ t('subscriptions.notApplied') }}</span>
              <button class="btn sm ghost" type="button" :aria-label="t('subscriptions.editChangeLabel', { name: store.subscriptions.find((s) => s.id === r.c.subId)?.name ?? r.c.subId })" @click="chEd = { item: r.c }">{{ t('common.edit') }}</button>
            </li>
            <li v-if="!changeRows.length" class="empty"><b>{{ t('subscriptions.noChanges') }}</b><span class="hint">{{ t('subscriptions.noChangesHint') }}</span></li>
          </ul>
        </template>

        <!-- 이체액 계산 -->
        <template v-else>
          <div class="calcs">
            <div v-for="c in calcs" :key="c.m" class="calc">
              <b class="c-t">{{ c.title }}</b>
              <div v-for="l in c.lines" :key="l.k" class="c-l" :class="{ strong: l.strong }"><span>{{ l.k }}</span><span class="num">{{ l.v }}</span></div>
            </div>
          </div>
          <p class="foot">{{ t('subscriptions.calcFoot') }}</p>
          <div class="frow chartbar">
            <h2 class="sec">{{ t('subscriptions.needed12') }} <small class="hint">{{ t('subscriptions.clickBar') }}</small></h2>
            <label class="fmonth">{{ t('subscriptions.startMonth') }}<MonthInput v-model="chartFrom" /></label>
          </div>
          <div class="chartwrap"><TransferChart :points="series" :selected="pick" @pick="(m) => (pick = m)" /></div>
          <div class="tbl share">
            <table>
              <caption class="sr">{{ t('subscriptions.shareTitle', { ym: `${pick.slice(0, 4)}.${pick.slice(5, 7)}` }) }}</caption>
              <thead><tr><th scope="col">{{ t('subscriptions.colService') }}</th><th scope="col">{{ t('subscriptions.colPlan') }}</th><th scope="col" class="n">{{ t('subscriptions.colMonthly') }}</th><th scope="col" class="n">{{ t('subscriptions.colShare') }}</th></tr></thead>
              <tbody>
                <tr v-for="i in shares" :key="i.id"><td>{{ i.name }}</td><td class="hint">{{ i.plan }}</td><td class="n">{{ fmtMoney(i.monthly) }}</td><td class="n hint">{{ i.pct }}%</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </div>

    <SubEditor v-if="subEd" :initial="subEd.item" :ym="ym" @close="subEd = null" @edit-change="editChange" />
    <PlanChangeEditor v-if="chEd" :initial="chEd.item" @close="chEd = null" />
  </section>
</template>

<style scoped>
.soon-btn{white-space:nowrap;height:36px;padding:0 14px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface);color:var(--subtle)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.kpi{padding:14px 18px}
.k-h,.k-v{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.k-h{align-items:center}
.k-l{font-size:12px;font-weight:600;color:var(--muted)}
.k-v{margin-top:6px}
.k-v b{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.k-v b.sig{color:var(--accent-text)}
.k-s{font-size:12px;font-weight:600;color:var(--muted)}
.hint{font-size:12px;color:var(--subtle)}
.up{color:var(--neg-text)}
.down{color:var(--primary-text)}
.pane{overflow:hidden}
.frow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.frow.end{justify-content:flex-end}
.vr{width:1px;height:24px;background:var(--border)}
.fmonth{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.fmonth .dpi,.fm2{width:150px}
.fmonth :deep(.in),.fm2 :deep(.in){height:34px;font-size:13px}
.count{margin-left:auto}
.fsearch{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);flex:1 1 180px;max-width:260px;color:var(--subtle);background:var(--input)}
.fsearch:focus-within{border-color:var(--primary-text)}
.fsearch svg{width:16px;height:16px;flex:none}
.fsearch input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:13px}
.chartbar{border-top:1px solid var(--divider);justify-content:space-between}
.sec{margin:0;font-size:15px;font-weight:600}
.sec small{font-weight:400;margin-left:6px}
.chartwrap{padding:0 16px 12px;overflow-x:auto}
.share{border-top:1px solid var(--divider)}
.pane .tbl{border:0;border-radius:0}
.subs-t{min-width:1000px}
.subs-t th.c,.subs-t td.c{text-align:center}
.subs-t td b.svc{display:block;font-weight:600}
.subs-t td small{display:block}
.subs-t td.cell2{color:var(--muted)}
.subs-t td.n.mono{font-weight:400;font-size:12px}
.subs-t td.amt{font-weight:600}
.subs-t tr.off td{color:var(--subtle)}
.subs-t tr.off td .hint{color:var(--subtle)}
.pill.tag{font-weight:500}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.mlist{display:none;list-style:none;margin:0;padding:0}
.mcard{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid var(--divider)}
.mcard.off{color:var(--subtle)}
.m1,.m2,.m3{display:flex;justify-content:space-between;align-items:center;gap:8px}
.m1{align-items:baseline;gap:12px}
.m-name{min-width:0}
.m2{font-size:12px;color:var(--muted)}
.m3 .btn{height:36px;flex:none}
.empty{display:flex;flex-direction:column;align-items:center;gap:2px;padding:32px 18px;text-align:center;color:var(--muted)}
.empty b{color:var(--text)}
.foot{margin:0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2);border-top:1px solid var(--divider)}
.foot :deep(b){font-variant-numeric:tabular-nums;color:var(--text)}
.clist{list-style:none;margin:0;padding:0}
.clist li{display:flex;align-items:center;gap:16px;padding:14px 18px;border-bottom:1px solid var(--divider)}
.clist li:last-child{border-bottom:0}
.clist li.undated{color:var(--muted)}
.c-date{width:92px;flex:none;color:var(--muted);font-size:12px}
.c-main{flex:1;min-width:0;display:flex;flex-direction:column}
.c-main b{overflow-wrap:anywhere}
.clist li.undated .c-main b{color:var(--text)}
.calcs{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.calc{padding:16px 18px;border-right:1px solid var(--divider)}
.c-t{display:block;margin-bottom:8px}
.c-l{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed var(--border);font-size:13px;color:var(--text-2)}
.c-l.strong{color:var(--primary-text);font-weight:700}
@media (max-width:760px){
  .kpi{padding:12px 14px}
  .dtable,.vr{display:none}
  .mlist{display:block}
  .clist li{flex-wrap:wrap;gap:6px 12px;padding:12px 16px}
  .c-date{width:auto}
  .calc{border-right:0;border-bottom:1px solid var(--divider)}
  .tbl{overflow-x:auto}
  .frow .count{margin-left:0;flex-basis:100%}
}
</style>
