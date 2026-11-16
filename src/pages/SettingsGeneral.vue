<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import { applyPreference, lang, t, type Lang, type MessageKey } from '../i18n'
import { saveItem, savePreferences, saveSettings, status, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { notReady } from '../lib/view'
import { dateText, money, moneyClass } from '../lib/format'
import { holidayList } from '../lib/holidays-lazy'
import { BUILTIN_SETS } from '../data/holidays-kr'
import { holidayName, setName } from '../lib/holiday-names'
import { addYm, monthDates, today, upcomingPayments, ymOf } from '../lib/calc'
import type { HolidaySet, Preferences, Settings } from '../data/types'
import { emptyRow, toRows, toRules, type RuleRow } from '../lib/holiday-rows'

// 설정 › 일반 (spec 007 S-8, S-9, S-10): display, exchange rate, monthly dates and their
// weekend/holiday shift, holiday sets. Edited as a copy; 저장 sends display settings and the
// money settings (two requests, each its own change set), 취소 drops the copy.
const CalendarView = defineAsyncComponent(() => import('../components/CalendarView.vue'))

type Draft = Pick<Preferences, 'dateFormat' | 'amountUnit' | 'negative'> & Pick<Settings, 'fxRate' | 'fxBuffer' | 'payDay' | 'transferDay' | 'billingDay' | 'dayShift'>
const fromStore = (): Draft => {
  const { dateFormat, amountUnit, negative } = store.preferences
  const { fxRate, fxBuffer, payDay, transferDay, billingDay, dayShift } = store.settings
  return { dateFormat, amountUnit, negative, fxRate, fxBuffer, payDay, transferDay, billingDay, dayShift }
}
// The theme applies and saves the moment it is picked, like the header's switch (spec 007 S-16).
const themeMsg = ref('')
async function pickTheme(mode: Preferences['themeMode']) {
  themeMsg.value = ''
  try {
    await savePreferences({ ...store.preferences, themeMode: mode })
    themeMsg.value = t('settings.general.themeApplied')
  } catch (e) {
    themeMsg.value = (e as Error).message
  }
}
// The language applies and saves the moment it is picked too; null follows the browser (spec 008 S-9).
const langMsg = ref('')
const langChoice = computed(() => store.preferences.language ?? 'browser')
async function pickLang(v: string) {
  langMsg.value = ''
  const next = v === 'ko' || v === 'en' ? (v as Lang) : null
  try {
    await savePreferences({ ...store.preferences, language: next })
    applyPreference(next)
    langMsg.value = t('settings.general.languageSaved')
  } catch (e) {
    langMsg.value = (e as Error).message
  }
}
const d = ref<Draft>(fromStore())
/** The saved values the draft started from: an edit is a difference from these, not from the store (review 1 R6). */
const base = ref<Draft>(fromStore())
const msg = ref('')
const busy = ref(false)
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(base.value))
// The saved values changed elsewhere (a revert in 변경 내역, another tab): follow them unless the user
// has edited the draft.
watch(() => JSON.stringify(fromStore()), () => {
  if (!dirty.value) d.value = fromStore()
  base.value = fromStore()
})

const problem = computed(() => {
  const days = [d.value.payDay, d.value.transferDay, d.value.billingDay]
  if (days.some((x) => !Number.isInteger(x) || x < 1 || x > 31)) return t('settings.general.badDays')
  if (!(d.value.fxRate > 0)) return t('settings.general.badFx')
  if (!(d.value.fxBuffer >= 0 && d.value.fxBuffer <= 100)) return t('settings.general.badBuffer')
  return ''
})

async function save() {
  if (problem.value) return (msg.value = problem.value)
  busy.value = true
  msg.value = ''
  const { dateFormat, amountUnit, negative, ...money } = d.value
  try {
    await savePreferences({ ...store.preferences, dateFormat, amountUnit, negative })
    await saveSettings(money)
    d.value = fromStore()
    base.value = fromStore()
    msg.value = t('settings.general.saved')
  } catch (e) {
    msg.value = (e as Error).message || status.error
  } finally {
    busy.value = false
  }
}
function cancel() {
  d.value = fromStore()
  base.value = fromStore()
  msg.value = ''
}

const g = (k: string) => t(`settings.general.${k}` as MessageKey)
const DATES: [Preferences['dateFormat'], string][] = [['iso', '2026-11-14'], ['dot', '2026. 11. 14.'], ['us', '11/14/2026']]
const UNIT_IDS: Preferences['amountUnit'][] = ['won', 'thousand', 'man']
const unitName = (id: string) => g(`units.${id}`)
const NEG_IDS: Preferences['negative'][] = ['minus', 'paren', 'red']
const negName = (id: string) => (id === 'minus' ? '−15,000' : id === 'paren' ? '(15,000)' : g('red'))
const SHIFT_IDS: Settings['dayShift'][] = ['before', 'after', 'none']
const themeName = (id: string) => g(id)
// The theme choices drawn as small screens, as in the design: light, dark, and half of each for system.
const LIGHT = { bg: '#F5F6F5', card: '#FFFFFF', line: '#E2E5E3', ink: '#16201B' }
const DARK = { bg: '#111315', card: '#1A1C1F', line: '#2F3337', ink: '#E6E8EA' }
const THEME_CARDS: { id: Preferences['themeMode']; sides: typeof LIGHT[] }[] = [
  { id: 'light', sides: [LIGHT] }, { id: 'dark', sides: [DARK] }, { id: 'system', sides: [LIGHT, DARK] },
]

// ── Preview: this month's upcoming payments in the chosen formats (the user's own data) ──
const now = today()
const preview = computed(() => upcomingPayments(store.subscriptions, store.planChanges, { ...store.settings, ...d.value }, now, 31).slice(0, 4))
const previewTotal = computed(() => preview.value.reduce((a, p) => a + p.krw, 0))
const fmt = computed(() => ({ amountUnit: d.value.amountUnit, negative: d.value.negative, dateFormat: d.value.dateFormat }))

// ── Monthly dates with the chosen shift (needs the holiday code once a shift is chosen) ──
const ym = ymOf(now)
const year = now.getFullYear()
const yearHolidays = computed(() => holidayList(store.holidaySets, `${year}-01-01`, `${year}-12-31`))
const aroundMonth = computed(() => holidayList(store.holidaySets, `${addYm(ym, -2)}-01`, `${addYm(ym, 3)}-01`))
const shifted = computed(() => {
  if (d.value.dayShift === 'none') return monthDates(ym, { ...store.settings, ...d.value }, new Set())
  // A shift can cross into the month before or after (review 1, R3).
  const list = aroundMonth.value
  return list ? monthDates(ym, { ...store.settings, ...d.value }, new Set(list.map((h) => h.date))) : null
})
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const md = (s: string) => { const x = new Date(`${s}T00:00:00`); return `${x.getMonth() + 1}/${x.getDate()}(${t(`common.weekday.${WD[x.getDay()]!}` as MessageKey)})` }
const monthName = computed(() => new Date(2000, Number(ym.slice(5)) - 1, 1).toLocaleString(lang.value === 'en' ? 'en-US' : 'ko-KR', { month: 'long' }))

// ── Holiday sets ──
const krRow = computed(() => store.holidaySets.find((s) => s.builtin === 'kr'))
const krOn = computed(() => krRow.value?.enabled ?? true)
const ownSets = computed(() => store.holidaySets.filter((s) => !s.builtin))
async function toggleKr() {
  const row = krRow.value
  await saveItem('holidaySets', row ? { ...row, enabled: !row.enabled } : { id: '', name: BUILTIN_SETS.kr!.name, enabled: false, builtin: 'kr', rules: [] }).catch(() => {})
}
const toggleOwn = (s: HolidaySet) => saveItem('holidaySets', { ...s, enabled: !s.enabled }).catch(() => {})
const showYear = ref(false)
const showCal = ref(false)

// Set editor: rules as rows (src/lib/holiday-rows.ts keeps what the rows do not show).
const rows = ref<RuleRow[]>([])
const setEd = useEditor('holidaySets', () => ({ id: '', name: '', enabled: true, builtin: null, rules: [] }),
  (s) => (!s.name.trim() ? g('needSetName') : !s.rules.length ? g('needRule') : s.rules.some((r) => !r.name) ? g('needRuleName') : null))
function openSet(s?: HolidaySet) {
  setEd.open(s)
  rows.value = s ? toRows(s.rules) : [emptyRow()]
}
function saveSet() {
  if (setEd.item.value) setEd.item.value.rules = toRules(rows.value)
  return setEd.save()
}
const addRow = () => rows.value.push(emptyRow())
</script>

<template>
  <div class="gen">
    <div class="col-form">
    <form class="stack" :aria-label="g('form')" novalidate @submit.prevent="save">
      <section class="card">
        <div class="card-hd"><h2>{{ g('display') }}</h2></div>
        <div class="srow">
          <div class="lt"><label for="g-lang">{{ g('language') }}</label><p>{{ g('languageDesc') }}</p></div>
          <div class="rt">
            <select id="g-lang" class="in w240" :value="langChoice" @change="pickLang(($event.target as HTMLSelectElement).value)">
              <option value="browser">{{ g('languageBrowser') }}</option><option value="ko">{{ g('langKo') }}</option><option value="en">{{ g('langEn') }}</option>
            </select>
            <span v-if="langMsg" class="small muted" role="status">{{ langMsg }}</span>
          </div>
        </div>
        <div class="srow">
          <div class="lt"><span id="g-theme-l" class="lab">{{ g('theme') }}</span><p>{{ g('themeDesc') }}</p></div>
          <div class="rt tcards" role="group" aria-labelledby="g-theme-l">
            <button v-for="th in THEME_CARDS" :key="th.id" type="button" :aria-pressed="store.preferences.themeMode === th.id" :aria-label="themeName(th.id)" @click="pickTheme(th.id)">
              <span class="mini" aria-hidden="true">
                <span v-for="(side, i) in th.sides" :key="i" class="half" :style="{ background: side.bg }"><i :style="{ background: side.ink }"></i><em :style="{ background: side.card, borderColor: side.line }"></em><i class="p"></i></span>
              </span>
              <span class="tl"><span class="ring"><span class="dotr"></span></span>{{ themeName(th.id) }}</span>
            </button>
            <span v-if="themeMsg" class="small muted tmsg" role="status">{{ themeMsg }}</span>
          </div>
        </div>
        <div class="srow">
          <div class="lt"><span class="lab">{{ g('dateFormat') }}</span><p>{{ g('dateFormatDesc') }}</p></div>
          <div class="rt"><div class="seg mono-seg" role="group" :aria-label="g('dateFormat')"><button v-for="[id, label] in DATES" :key="id" type="button" :aria-pressed="d.dateFormat === id" @click="d.dateFormat = id">{{ label }}</button></div></div>
        </div>
        <div class="srow last">
          <div class="lt"><label for="g-tz">{{ g('timezone') }}</label><p>{{ g('timezoneDesc') }}</p></div>
          <div class="rt"><select id="g-tz" class="in w240" disabled :title="g('soon')"><option>Asia/Seoul (UTC+09:00)</option></select><span class="soon">{{ g('soon') }}</span></div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd"><h2>{{ g('currencyUnits') }}</h2></div>
        <div class="srow">
          <div class="lt"><label for="g-cur">{{ g('baseCurrency') }}</label><p>{{ g('baseCurrencyDesc') }}</p></div>
          <div class="rt col">
            <span class="rowx"><select id="g-cur" class="in w240" disabled :title="g('soon')"><option>{{ g('krw') }}</option></select><span class="soon">{{ g('soon') }}</span></span>
            <span class="sub-l">{{ g('otherCurrencies') }}</span>
            <span class="chips"><span class="chip on"><b>USD</b> {{ g('usd') }}</span><span class="soon">{{ g('otherSoon') }}</span></span>
          </div>
        </div>
        <div class="srow">
          <div class="lt"><span class="lab">{{ g('fx') }}</span><p>{{ g('fxDesc') }}</p></div>
          <div class="rt col">
            <div class="seg" role="group" :aria-label="g('fxMode')"><button type="button" aria-pressed="false" @click="notReady('shell.fxAuto')">{{ g('fxAuto') }}</button><button type="button" aria-pressed="true">{{ g('fxManual') }}</button></div>
            <span class="rowx end">
              <span class="fld"><label for="g-fx">USD → KRW</label><input id="g-fx" v-model.number="d.fxRate" class="in num w140" type="number" step="any" min="0"></span>
              <span class="fld"><label for="g-buf">{{ g('buffer') }}</label><input id="g-buf" v-model.number="d.fxBuffer" class="in num w80" type="number" step="any" min="0" max="100"></span>
              <span class="small subtle note">{{ g('fxNote') }}</span>
            </span>
          </div>
        </div>
        <div class="srow">
          <div class="lt"><span class="lab">{{ g('amountUnit') }}</span><p>{{ g('amountUnitDesc') }}</p></div>
          <div class="rt"><div class="seg wide" role="group" :aria-label="g('amountUnit')"><button v-for="id in UNIT_IDS" :key="id" type="button" :aria-pressed="d.amountUnit === id" @click="d.amountUnit = id">{{ unitName(id) }}</button></div></div>
        </div>
        <div class="srow last">
          <div class="lt"><span class="lab">{{ g('negative') }}</span><p>{{ g('negativeDesc') }}</p></div>
          <div class="rt"><div class="seg wide" role="group" :aria-label="g('negative')"><button v-for="id in NEG_IDS" :key="id" type="button" :aria-pressed="d.negative === id" :class="{ red: id === 'red' }" @click="d.negative = id">{{ negName(id) }}</button></div></div>
        </div>
      </section>

      <section class="card">
        <div class="card-hd"><h2>{{ g('schedule') }}</h2></div>
        <div class="srow last">
          <div class="lt"><span class="lab">{{ g('monthly') }}</span><p>{{ g('monthlyDesc') }}</p></div>
          <div class="rt col">
            <span class="rowx end">
              <span class="fld"><label for="g-pay">{{ g('payDay') }}</label><span class="dayin"><input id="g-pay" v-model.number="d.payDay" type="number" min="1" max="31"><span>{{ g('dayUnit') }}</span></span></span>
              <span class="fld"><label for="g-xfer">{{ g('transferDay') }}</label><span class="dayin"><input id="g-xfer" v-model.number="d.transferDay" type="number" min="1" max="31"><span>{{ g('dayUnit') }}</span></span></span>
              <span class="fld"><label for="g-bill">{{ g('billingDay') }}</label><span class="dayin"><input id="g-bill" v-model.number="d.billingDay" type="number" min="1" max="31"><span>{{ g('dayUnit') }}</span></span></span>
              <span class="fld"><label for="g-shift">{{ g('shiftLabel') }}</label><select id="g-shift" v-model="d.dayShift" class="in" :aria-label="g('shiftLabel')"><option v-for="id in SHIFT_IDS" :key="id" :value="id">{{ g(`shifts.${id}`) }}</option></select></span>
            </span>
            <span class="small subtle" role="status">{{ g('thisMonth') }}
              <template v-if="shifted">{{ t('settings.general.payOn', { date: md(shifted.pay.date) }) }}{{ shifted.pay.unresolved ? ` ${g('noBizDay')}` : '' }} · {{ t('settings.general.transferOn', { date: md(shifted.transfer.date) }) }}{{ shifted.transfer.unresolved ? ` ${g('noBizDay')}` : '' }} · {{ t('settings.general.billingOn', { date: md(shifted.billing.date) }) }}{{ shifted.billing.unresolved ? ` ${g('noBizDay')}` : '' }}</template>
              <template v-else>{{ g('loadingHolidays') }}</template>
            </span>
          </div>
        </div>
        <div class="savebar">
          <span class="grow small subtle">{{ g('logged') }}</span>
          <span class="small" :class="msg === g('saved') ? 'subtle' : 'err'" role="status">{{ msg }}</span>
          <button class="btn" type="button" :disabled="!dirty" @click="cancel">{{ t('common.cancel') }}</button>
          <button class="btn pri" type="submit" :disabled="busy || !dirty">{{ t('common.save') }}</button>
        </div>
      </section>
    </form>

      <section class="card" aria-labelledby="g-hol">
        <div class="card-hd"><h2 id="g-hol">{{ g('holidaySets') }}</h2><button class="btn sm" type="button" @click="openSet()">{{ g('addSet') }}</button></div>
        <div class="card-bd">
        <p class="small subtle lead">{{ g('holidayIntro') }}</p>
        <ul class="sets">
          <li>
            <span class="sn"><b>{{ setName({ name: BUILTIN_SETS.kr!.name, builtin: 'kr' }) }}</b><span class="pill tag">{{ g('builtin') }}</span><span class="small muted">{{ t('settings.general.builtinRules', { n: BUILTIN_SETS.kr!.rules.length }) }}</span></span>
            <button class="btn sm" type="button" :aria-pressed="krOn" :aria-label="t('settings.general.toggleLabel', { name: setName({ name: BUILTIN_SETS.kr!.name, builtin: 'kr' }), state: krOn ? g('turnOff') : g('turnOn') })" @click="toggleKr">{{ krOn ? t('common.on') : t('common.off') }}</button>
          </li>
          <li v-for="s in ownSets" :key="s.id">
            <span class="sn"><b>{{ s.name }}</b><span class="small muted">{{ t('settings.general.rules', { n: s.rules.length }) }}</span></span>
            <button class="btn sm" type="button" :aria-label="t('settings.general.editLabel', { name: s.name })" @click="openSet(s)">{{ g('edit') }}</button>
            <button class="btn sm" type="button" :aria-pressed="s.enabled" :aria-label="t('settings.general.toggleLabel', { name: s.name, state: s.enabled ? g('turnOff') : g('turnOn') })" @click="toggleOwn(s)">{{ s.enabled ? t('common.on') : t('common.off') }}</button>
          </li>
        </ul>
        <p class="small muted">{{ g('holidayNote') }}</p>
        <div class="btns">
          <button class="btn" type="button" :aria-expanded="showYear" @click="showYear = !showYear">{{ showYear ? g('closeList') : t('settings.general.yearList', { year }) }}</button>
          <button class="btn" type="button" :aria-expanded="showCal" @click="showCal = !showCal">{{ showCal ? g('closeCalendar') : g('calendar') }}</button>
        </div>
        <ul v-if="showYear" class="hlist">
          <li v-if="!yearHolidays" class="muted">{{ t('common.loading') }}</li>
          <li v-for="h in yearHolidays ?? []" :key="h.date + h.name"><span class="mono">{{ dateText(h.date, fmt) }}</span> {{ holidayName(h.name) }}</li>
        </ul>
        <CalendarView v-if="showCal" class="pcal" source="holidays" :sets="store.holidaySets" :label="g('calendarLabel')" />
        </div>
      </section>

      <EditSheet v-if="setEd.item.value" :key="setEd.item.value.id || 'new'" :title="setEd.item.value.id ? g('setEditTitle') : g('setAddTitle')" :error="setEd.error.value" :busy="setEd.busy.value"
        :can-delete="!!setEd.item.value.id" :desc="g('setDesc')" @save="saveSet" @cancel="setEd.close" @delete="setEd.remove">
        <div class="field" style="grid-column:1/-1"><label for="hs-name">{{ g('setName') }}</label><input id="hs-name" v-model="setEd.item.value.name" class="in"></div>
        <template #after>
          <div v-for="(r, i) in rows" :key="i" class="rule">
            <div class="field"><label :for="`hr-n-${i}`">{{ g('ruleName') }}</label><input :id="`hr-n-${i}`" v-model="r.name" class="in" :placeholder="g('ruleNamePh')"></div>
            <div class="field"><label :for="`hr-k-${i}`">{{ g('ruleKind') }}</label>
              <select :id="`hr-k-${i}`" v-model="r.kind" class="in"><option value="dates">{{ g('kindDates') }}</option><option value="rrule">{{ g('kindRrule') }}</option></select></div>
            <div v-if="r.kind === 'dates'" class="field wide"><label :for="`hr-d-${i}`">{{ g('datesLabel') }}</label><input :id="`hr-d-${i}`" v-model="r.dates" class="in" placeholder="2027-06-03"></div>
            <div v-else class="field wide"><label :for="`hr-r-${i}`">RRULE</label><input :id="`hr-r-${i}`" v-model="r.rrule" class="in mono" placeholder="FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17"></div>
            <div class="field"><label :for="`hr-s-${i}`">{{ g('substitute') }}</label>
              <select :id="`hr-s-${i}`" v-model="r.sub" class="in"><option value="">{{ t('common.none') }}</option><option value="SU">{{ g('subSU') }}</option><option value="SA">{{ g('subSA') }}</option><option value="SA,SU">{{ g('subBoth') }}</option></select></div>
            <button class="btn sm rm" type="button" :aria-label="t('settings.general.removeRule', { n: i + 1 })" @click="rows.splice(i, 1)">{{ g('remove') }}</button>
          </div>
          <button class="btn sm" type="button" @click="addRow">{{ g('addRule') }}</button>
          <p class="small muted">{{ g('exampleLunar') }} <code>RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1</code>, {{ g('exampleNth') }} <code>FREQ=YEARLY;BYMONTH=5;BYDAY=2MO</code></p>
        </template>
      </EditSheet>
    </div>

    <aside class="pv" :aria-label="g('preview')">
      <span class="pvl">{{ g('preview') }}</span>
      <div class="card">
        <div class="pvh"><b>{{ t('settings.general.previewTitle', { month: monthName }) }}</b><span class="small subtle">{{ t('settings.general.previewUnit', { unit: unitName(d.amountUnit) }) }}</span></div>
        <table>
          <thead><tr><th>{{ g('colDate') }}</th><th>{{ g('colWhat') }}</th><th class="n">{{ g('colAmount') }}</th></tr></thead>
          <tbody>
            <tr v-for="p in preview" :key="p.sub.id + p.date.getTime()"><td class="mono">{{ dateText(p.date, fmt) }}</td><td>{{ p.sub.name }}<div class="mono tiny">{{ p.sub.plan }}</div></td>
              <td class="n" :class="moneyClass(-p.krw, fmt)">{{ money(-p.krw, fmt) }}</td></tr>
            <tr v-if="!preview.length"><td colspan="3" class="muted">{{ g('noPayments') }}</td></tr>
            <tr class="sum"><td colspan="2">{{ g('total') }}</td><td class="n" :class="moneyClass(-previewTotal, fmt)">{{ money(-previewTotal, fmt) }}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="small subtle">{{ t('settings.general.previewFoot', { theme: themeName(store.preferences.themeMode) }) }}</p>
    </aside>
  </div>
</template>

<style scoped>
.gen{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.col-form{flex:3 1 560px;min-width:0;display:flex;flex-direction:column;gap:20px}
.stack{display:flex;flex-direction:column;gap:20px}
.srow{display:flex;flex-wrap:wrap;gap:12px 32px;padding:18px 20px;border-bottom:1px solid var(--divider)}
.srow.last{border-bottom:0}
.lt{flex:1 1 180px;display:flex;flex-direction:column;gap:2px}
.lt label,.lt .lab{font-size:14px;font-weight:600}
.lt p{margin:0;font-size:12px;color:var(--subtle)}
.rt{flex:2 1 320px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;min-width:0}
.rt.col{flex-direction:column;align-items:flex-start}
.rowx{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.rowx.end{align-items:flex-end}
.w240{width:240px;max-width:100%}
.w140{width:140px;text-align:right}
.w80{width:80px;text-align:right}
.soon{font-size:12px;color:var(--subtle)}
.sub-l{font-size:12px;font-weight:600;color:var(--text-2)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:var(--r-badge);border:1px solid var(--border-strong);font-size:13px}
.chip.on{border-color:var(--primary-text);background:var(--primary-soft);color:var(--primary-text)}
.chip b{font:500 13px var(--f-mono)}
.fld{display:flex;flex-direction:column;gap:6px}
.fld label{font-size:12px;font-weight:600;color:var(--text-2)}
.note{padding-bottom:8px}
.dayin{display:flex;align-items:center;height:36px;width:96px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);padding-right:10px;background:var(--surface)}
.dayin input{flex:1;min-width:0;border:0;outline:0;padding:0 6px 0 10px;text-align:right;color:var(--text);background:transparent;font-variant-numeric:tabular-nums}
.dayin span{font-size:13px;color:var(--subtle)}
.dayin:focus-within{border-color:var(--primary-text);box-shadow:0 0 0 3px var(--primary-soft)}
.seg button{height:36px;font-weight:600;font-size:13px}
.seg.wide button{min-width:76px;padding:0 14px}
.mono-seg button{font:500 12px var(--f-mono)}
.seg .red{color:var(--neg-text)}
.tcards{gap:10px}
.tcards button{width:118px;padding:8px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);cursor:pointer;display:flex;flex-direction:column;gap:8px;text-align:left;color:var(--text)}
.tcards button[aria-pressed="true"]{border:2px solid var(--primary-text);padding:7px}
.mini{height:64px;border-radius:var(--r-badge);border:1px solid var(--border);overflow:hidden;display:flex}
.half{flex:1;padding:6px;display:flex;flex-direction:column;gap:4px}
.half i{display:block;height:6px;width:60%;border-radius:1px}
.half em{flex:1;border-radius:2px;border:1px solid}
.half i.p{width:40%;background:var(--primary)}
.tl{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}
.ring{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--border-strong);display:flex;align-items:center;justify-content:center}
.dotr{width:6px;height:6px;border-radius:50%}
.tcards button[aria-pressed="true"] .tl{color:var(--primary-text)}
.tcards button[aria-pressed="true"] .ring{border-color:var(--primary-text)}
.tcards button[aria-pressed="true"] .dotr{background:var(--primary-text)}
.tmsg{flex-basis:100%}
.savebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card)}
.grow{flex-grow:1}
.err{color:var(--neg-text)}
.lead{margin:0 0 12px}
.sets{list-style:none;margin:0 0 10px;padding:0}
.sets li{display:flex;align-items:center;gap:8px;padding:var(--row-pad) 0;border-bottom:1px solid var(--divider)}
.sets .sn{flex:1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0}
.sets [aria-pressed="true"]{color:var(--primary-text);border-color:var(--primary-text);background:var(--primary-soft)}
.hlist{list-style:none;margin:12px 0 0;padding:0;columns:2 220px;font-size:13px}
.hlist li{padding:3px 0;break-inside:avoid}
.pcal{margin-top:12px}
.rule{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;align-items:end;padding:12px 0;border-top:1px solid var(--divider)}
.rule .wide{grid-column:span 2}
.rule .rm{align-self:end}
.pv{flex:2 1 340px;min-width:0;display:flex;flex-direction:column;gap:8px}
.pvl{font-size:12px;font-weight:600;color:var(--muted)}
.pvh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.pv table{font-size:13px}
.pv th{border-top:0}
.pv td.mono{font-size:12px;color:var(--muted);white-space:nowrap}
.pv td.n{font-weight:600;white-space:nowrap}
.pv .tiny{font-size:11px;color:var(--subtle)}
.pv tr.sum td{font-weight:600;border-bottom:0}
.pv tr.sum td.n{font-weight:700}
@media (min-width:1180px){.pv{position:sticky;top:80px}}
</style>
