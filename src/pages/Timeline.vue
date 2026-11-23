<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { saveItem, store } from '../lib/store'
import { fmtMoney } from '../lib/display'
import { debtMethodLabel, eventKindLabel, rateText } from '../lib/labels'
import { t, lang } from '../i18n'
import { monthShort } from '../lib/format'
import type { Debt, EventState, PlanEvent } from '../data/types'
import Select from '../components/Select.vue'
import { whenShort, whenYears } from '../lib/event-when'

// 일정 (spec 010 S-9): three views in one page — the calendar with the month's agenda, the month plan
// (timeline) and the debts. The calendar and the two editors load when they are needed (spec 007 S-11,
// user: "달력은 필요할 때 불려오게"): the first screen stays small.
const ScheduleCalendar = defineAsyncComponent(() => import('../components/ScheduleCalendar.vue'))
const EventEditor = defineAsyncComponent(() => import('../components/EventEditor.vue'))
const DebtEditor = defineAsyncComponent(() => import('../components/DebtEditor.vue'))

const tab = ref('cal')
const tabs = computed(() => [
  { id: 'cal', label: t('timeline.tabCal') },
  { id: 'timeline', label: t('timeline.tabTimeline'), count: store.events.length || undefined },
  { id: 'debt', label: t('timeline.tabDebt'), count: store.debts.length || undefined },
])

/** A month cell: 03 → 3월 / Mar; a range 03~05 → 03~05월 / Mar~May; a range into a later year → 26.11~27.02 (spec 013 S-18). */
const crossYear = (when: string) => /^\d{4}-\d{2}~\d{4}-\d{2}$/.test(when)
const whenMonth = (when: string) => {
  if (crossYear(when)) return whenShort(when)
  const m = when.slice(5).split('~')
  return t('timeline.monthOf', { m: (lang.value === 'en' ? m.map((x) => monthShort(Number(x))) : m).join('~') })
}
const kinds = computed(() => [...new Set(store.events.map((e) => e.kind))])
const kind = ref('')
const hideDone = ref(false)
const filtered = computed(() => store.events.filter((e) => (!kind.value || e.kind === kind.value) && (!hideDone.value || e.state !== 'done')))
const years = computed(() => {
  const map = new Map<string, PlanEvent[]>()
  // an event shows under every year its range covers (spec 013 S-18), in the order the years first appear
  for (const e of filtered.value) for (const y of whenYears(e.when)) map.set(y, [...(map.get(y) ?? []), e])
  return [...map.entries()]
})
const isFiltered = computed(() => !!kind.value || hideDone.value)
const NEXT: Record<EventState, EventState> = { todo: 'doing', doing: 'done', done: 'todo' }
const CLS: Record<EventState, string> = { todo: 'mute', doing: 'acc', done: 'ok' }
const stateLabel = (s: EventState) => t(`timeline.state.${s}`)
const stateAria = (s: EventState) => t('timeline.stateAria', { state: stateLabel(s), next: stateLabel(NEXT[s]) })

// ---------- editors ----------
const evEd = ref<{ item: PlanEvent | null } | null>(null)
const debtEd = ref<{ item: Debt | null } | null>(null)
const firstLine = (s: string) => s.split('\n')[0] ?? ''
</script>

<template>
  <section>
    <PageHeader :title="t('timeline.title')" :desc="t('timeline.desc')">
      <button class="btn" type="button" @click="debtEd = { item: null }"><Icon name="plus" :stroke="2.2" class="plus" />{{ t('timeline.addDebt') }}</button>
      <button class="btn pri" type="button" @click="evEd = { item: null }"><Icon name="plus" :stroke="2.2" class="plus" />{{ t('timeline.addEvent') }}</button>
    </PageHeader>
    <SubTabs v-model="tab" :tabs="tabs" :label="t('timeline.tabsLabel')" />

    <EventEditor v-if="evEd" :key="evEd.item?.id || 'new'" :initial="evEd.item" @close="evEd = null" />
    <DebtEditor v-if="debtEd" :key="debtEd.item?.id || 'new'" :initial="debtEd.item" @close="debtEd = null" />

    <ScheduleCalendar v-if="tab === 'cal'" />

    <section v-else-if="tab === 'timeline'" class="card tl">
      <div class="fbar">
        <Select id="ev-kind" v-model="kind" class="fsel" :aria-label="t('timeline.category')" :options="[{ value: '', label: t('timeline.allCategories') }, ...kinds.map((k) => ({ value: k, label: eventKindLabel(k) }))]" />
        <label class="chkl"><input id="ev-hide" v-model="hideDone" type="checkbox"> {{ t('timeline.hideDone') }}</label>
        <span class="hint cn">{{ t('timeline.count', { n: filtered.length }) }}</span>
      </div>
      <div v-for="[y, list] in years" :key="y">
        <h3 class="yr mono">{{ y }}</h3>
        <ul class="evl">
          <li v-for="e in list" :key="e.id">
            <span class="when mono" :class="{ wide: crossYear(e.when) }">{{ whenMonth(e.when) }}</span>
            <button type="button" class="evt" :aria-label="t('common.editLabel', { name: e.title })" @click="evEd = { item: e }"><span class="pill tag">{{ eventKindLabel(e.kind) }}</span>{{ e.title }}</button>
            <button type="button" class="pill st" :class="CLS[e.state]" :aria-label="stateAria(e.state)" @click="saveItem('events', { ...e, state: NEXT[e.state] }).catch(() => {})">{{ stateLabel(e.state) }}</button>
          </li>
        </ul>
      </div>
      <div v-if="!years.length" class="none">
        <b>{{ isFiltered ? t('timeline.emptyFiltered') : t('timeline.empty') }}</b>
        <span v-if="isFiltered" class="hint">{{ t('timeline.emptyFilteredHint') }}</span>
      </div>
      <p class="foot">{{ t('timeline.lede') }}</p>
    </section>

    <section v-else class="card">
      <div class="card-hd">
        <h2>{{ t('timeline.tabDebt') }}</h2>
        <button class="btn sm" type="button" @click="debtEd = { item: null }">{{ t('timeline.addDebtBtn') }}</button>
      </div>
      <div class="tbl dtable">
        <table>
          <thead><tr><th>{{ t('timeline.item') }}</th><th class="n">{{ t('timeline.principal') }}</th><th class="n">{{ t('timeline.rate') }}</th><th class="c">{{ t('timeline.method') }}</th><th>{{ t('timeline.plan') }}</th></tr></thead>
          <tbody>
            <tr v-for="d in store.debts" :key="d.id" class="click" tabindex="0" @click="debtEd = { item: d }" @keydown.enter="debtEd = { item: d }">
              <td><b>{{ d.name }}</b></td>
              <td class="n"><b>{{ fmtMoney(d.principal) }}</b></td>
              <td class="n">{{ rateText(d.rate) }}</td>
              <td class="c"><span v-if="d.method" class="pill tag">{{ debtMethodLabel(d.method) }}</span></td>
              <td class="plan">{{ firstLine(d.plan) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="mlist">
        <li v-for="d in store.debts" :key="d.id">
          <button type="button" :aria-label="t('common.editLabel', { name: d.name })" @click="debtEd = { item: d }">
            <span class="top"><b>{{ d.name }}</b><b class="num">{{ fmtMoney(d.principal) }}</b></span>
            <span v-if="[rateText(d.rate), d.method && debtMethodLabel(d.method), firstLine(d.plan)].some(Boolean)" class="dsub">{{ [rateText(d.rate), d.method && debtMethodLabel(d.method), firstLine(d.plan)].filter(Boolean).join(' · ') }}</span>
          </button>
        </li>
      </ul>
      <p v-if="!store.debts.length" class="none">{{ t('timeline.noDebts') }}</p>
    </section>
  </section>
</template>

<style scoped>
.plus{width:16px;height:16px;margin-right:6px}
.tl{margin-top:20px;overflow:hidden}
.fbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.fbar .in{width:auto;height:34px;font-size:13px}
.chkl{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2)}
.chkl input{width:16px;height:16px;margin:0;accent-color:var(--primary)}
.cn{margin-left:auto}
.yr{margin:0;padding:10px 18px;font-size:13px;font-weight:600;color:var(--subtle);background:var(--surface-2);border-bottom:1px solid var(--divider)}
.evl{list-style:none;margin:0;padding:0}
.evl li{display:flex;align-items:center;gap:16px;padding:12px 18px;border-bottom:1px solid var(--divider)}
.evl li:hover{background:var(--surface-2)}
.when{width:72px;flex:none;font-size:13px;color:var(--muted)}
.when.wide{width:auto;min-width:72px;white-space:nowrap}
.evt{all:unset;box-sizing:border-box;flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:36px;font-size:14px;cursor:pointer;overflow-wrap:anywhere}
.evt:hover{text-decoration:underline}
.evt:focus-visible,.st:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px;border-radius:var(--r-ctl)}
.evt .pill{font-weight:500;flex:none}
.st{min-height:32px;padding:0 12px;border:0;cursor:pointer;font-family:inherit;flex:none}
.none{padding:32px 18px;text-align:center;color:var(--muted);display:flex;flex-direction:column;gap:2px;margin:0}
.none b{color:var(--text)}
.foot{margin:0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2)}
.card .tbl td.plan{color:var(--muted)}
.card .tbl th.c,.card .tbl td.c{text-align:center}
.mlist{display:none;list-style:none;margin:0;padding:0}
.mlist li{border-bottom:1px solid var(--divider)}
.mlist button{all:unset;box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:6px;padding:12px 16px;cursor:pointer}
.mlist .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.mlist .dsub{font-size:12px;color:var(--muted)}
@media (max-width:760px){
  .dtable{display:none}
  .mlist{display:block}
  .evl li{padding:12px 16px;gap:12px}
  .when{width:56px}
  .when.wide{width:auto;min-width:56px}
}
</style>
