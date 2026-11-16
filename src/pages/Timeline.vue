<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import { saveItem, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { fmtMoney } from '../lib/display'
import { DEFAULT_EVENT_KIND, EVENT_KINDS, eventKindLabel } from '../lib/labels'
import { t, lang } from '../i18n'
import { monthShort } from '../lib/format'
import { today, ymOf } from '../lib/calc'
import type { EventState } from '../data/types'

// The calendar is fetched only when its tab opens (spec 007 S-11, user: "달력은 필요할 때 불려오게").
const CalendarView = defineAsyncComponent(() => import('../components/CalendarView.vue'))

const tab = ref('cal')
const tabs = computed(() => [
  { id: 'cal', label: t('timeline.tabCal'), icon: 'events' },
  { id: 'timeline', label: t('timeline.tabTimeline'), icon: 'list' },
  { id: 'debt', label: t('timeline.tabDebt'), icon: 'money' },
])
const now = ymOf(today())
/** A month cell: 03 → 3월 / Mar; a range 03~05 → 03~05월 / Mar~May. */
const whenMonth = (when: string) => {
  const m = when.slice(5).split('~')
  return t('timeline.monthOf', { m: (lang.value === 'en' ? m.map((x) => monthShort(Number(x))) : m).join('~') })
}
const kinds = computed(() => [...new Set(store.events.map((e) => e.kind))])
const kind = ref('')
const hideDone = ref(false)

const years = computed(() => {
  const list = store.events.filter((e) => (!kind.value || e.kind === kind.value) && (!hideDone.value || e.state !== 'done'))
  const map = new Map<string, typeof list>()
  for (const e of list) {
    const y = e.when.slice(0, 4)
    map.set(y, [...(map.get(y) ?? []), e])
  }
  return [...map.entries()]
})
const NEXT: Record<EventState, EventState> = { todo: 'doing', doing: 'done', done: 'todo' }
const STATE_IDS: EventState[] = ['todo', 'doing', 'done']
const stateLabel = (s: EventState) => t(`timeline.state.${s}`)
const CLS: Record<EventState, string> = { todo: 'mute', doing: 'acc', done: 'ok' }
const KINDS = EVENT_KINDS

const evEd = useEditor('events', () => ({ id: '', when: now, kind: DEFAULT_EVENT_KIND, title: '', state: 'todo' }),
  (e) => (!e.title.trim() ? t('timeline.needDetails')
    : !/^\d{4}-\d{2}(~\d{2})?$/.test(e.when) ? t('timeline.needWhen') : null))
const debtEd = useEditor('debts', () => ({ id: '', name: '', principal: 0, rate: '', method: '', plan: '' }),
  (d) => (!d.name.trim() ? t('timeline.needItemName') : !(d.principal >= 0) ? t('timeline.needPrincipal') : null))
</script>

<template>
  <section>
    <PageHeader :title="t('timeline.title')" :desc="t('timeline.desc')" />
    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'cal'">
      <CalendarView source="schedule" :label="t('timeline.calendarLabel')" />
      <p class="small muted note">{{ t('timeline.calNote') }}</p>
    </div>

    <div v-else-if="tab === 'timeline'">
      <p class="lede">{{ t('timeline.lede') }}</p>
      <div class="btns" style="margin:0 0 14px">
        <select id="ev-kind" v-model="kind" class="in" style="width:auto" :aria-label="t('timeline.category')">
          <option value="">{{ t('timeline.allCategories') }}</option>
          <option v-for="k in kinds" :key="k" :value="k">{{ eventKindLabel(k) }}</option>
        </select>
        <label class="small"><input id="ev-hide" v-model="hideDone" type="checkbox" style="accent-color:var(--primary)"> {{ t('timeline.hideDone') }}</label>
        <button class="btn pri" type="button" style="margin-left:auto" @click="evEd.open()">{{ t('timeline.addEventBtn') }}</button>
      </div>
      <EditSheet v-if="evEd.item.value" :key="evEd.item.value.id || 'new'" :title="evEd.item.value.id ? t('timeline.editEvent') : t('timeline.addEvent')" :error="evEd.error.value" :busy="evEd.busy.value"
        :can-delete="!!evEd.item.value.id" @save="evEd.save" @cancel="evEd.close" @delete="evEd.remove">
        <div class="field"><label for="ev-when">{{ t('timeline.when') }}</label><input id="ev-when" v-model="evEd.item.value.when" class="in" placeholder="2027-03"></div>
        <div class="field"><label for="ev-k">{{ t('timeline.category') }}</label>
          <select id="ev-k" v-model="evEd.item.value.kind" class="in"><option v-for="k in KINDS" :key="k" :value="k">{{ eventKindLabel(k) }}</option></select></div>
        <div class="field"><label for="ev-st">{{ t('timeline.status') }}</label>
          <select id="ev-st" v-model="evEd.item.value.state" class="in"><option v-for="k in STATE_IDS" :key="k" :value="k">{{ stateLabel(k) }}</option></select></div>
        <div class="field" style="grid-column:1/-1"><label for="ev-title">{{ t('timeline.details') }}</label><input id="ev-title" v-model="evEd.item.value.title" class="in"></div>
      </EditSheet>
      <div v-for="[y, list] in years" :key="y" class="panel">
        <h3 style="margin-top:0" class="mono">{{ y }}</h3>
        <ul class="list">
          <li v-for="e in list" :key="e.id" :style="{ opacity: e.state === 'done' ? 0.6 : 1 }">
            <span class="when" :style="{ color: e.when.slice(0, 7) === now ? 'var(--primary-text)' : '' }">{{ whenMonth(e.when) }}</span>
            <button type="button" class="ev-t" :aria-label="t('common.editLabel', { name: e.title })" @click="evEd.open(e)"><span class="pill mute">{{ eventKindLabel(e.kind) }}</span> {{ e.title }}</button>
            <button type="button" class="pill" :class="CLS[e.state]" style="border:0;cursor:pointer;font-family:inherit" @click="saveItem('events', { ...e, state: NEXT[e.state] }).catch(() => {})">{{ stateLabel(e.state) }}</button>
          </li>
        </ul>
      </div>
      <p v-if="!years.length" class="empty">{{ t('timeline.noMatch') }}</p>
    </div>

    <div v-else>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="debtEd.open()">{{ t('timeline.addDebtBtn') }}</button></div>
      <EditSheet v-if="debtEd.item.value" :key="debtEd.item.value.id || 'new'" :title="debtEd.item.value.id ? t('timeline.editDebt') : t('timeline.addDebt')" :error="debtEd.error.value" :busy="debtEd.busy.value"
        :can-delete="!!debtEd.item.value.id" @save="debtEd.save" @cancel="debtEd.close" @delete="debtEd.remove">
        <div class="field"><label for="db-name">{{ t('timeline.item') }}</label><input id="db-name" v-model="debtEd.item.value.name" class="in"></div>
        <div class="field"><label for="db-pr">{{ t('timeline.principal') }}</label><input id="db-pr" v-model.number="debtEd.item.value.principal" class="in" type="number" step="10000" min="0"></div>
        <div class="field"><label for="db-rate">{{ t('timeline.rate') }}</label><input id="db-rate" v-model="debtEd.item.value.rate" class="in"></div>
        <div class="field"><label for="db-m">{{ t('timeline.method') }}</label><input id="db-m" v-model="debtEd.item.value.method" class="in"></div>
        <div class="field" style="grid-column:1/-1"><label for="db-plan">{{ t('timeline.plan') }}</label><input id="db-plan" v-model="debtEd.item.value.plan" class="in"></div>
      </EditSheet>
      <div class="tbl">
        <table>
          <thead><tr><th>{{ t('timeline.item') }}</th><th class="n">{{ t('timeline.principal') }}</th><th>{{ t('timeline.rate') }}</th><th>{{ t('timeline.method') }}</th><th>{{ t('timeline.plan') }}</th></tr></thead>
          <tbody>
            <tr v-for="d in store.debts" :key="d.id" class="click" tabindex="0" @click="debtEd.open(d)" @keydown.enter="debtEd.open(d)">
              <td>{{ d.name }}</td><td class="n">{{ fmtMoney(d.principal) }}</td><td class="mono">{{ d.rate }}</td><td>{{ d.method }}</td><td>{{ d.plan }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.note{margin:10px 0 0}
</style>
