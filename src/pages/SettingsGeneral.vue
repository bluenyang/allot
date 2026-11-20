<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import Seg from '../components/Seg.vue'
import Soon from '../components/Soon.vue'
import Switch from '../components/Switch.vue'
import { applyPreference, lang, t, type Lang, type MessageKey } from '../i18n'
import { saveItem, savePreferences, saveSettings, sessionScope, status, store } from '../lib/store'
import { runSteps } from '../lib/session-guard'
import { useEditor } from '../lib/useEditor'
import { dateText, money, moneyClass } from '../lib/format'
import { holidayList } from '../lib/holidays-lazy'
import { BUILTIN_SETS } from '../data/holidays-kr'
import { holidayName, setName } from '../lib/holiday-names'
import { addYm, monthDates, today, upcomingPayments, ymOf } from '../lib/calc'
import type { HolidaySet, Preferences, Settings } from '../data/types'
import { emptyRow, toRows, toRules, type RuleRow } from '../lib/holiday-rows'
import Select from '../components/Select.vue'

// 설정 › 일반 (spec 010 S-11, canvas "설정"): five titled sections. 화면 and 표시 형식 save the moment
// a choice is made (the session is noted when the save starts and checked before each later step,
// spec 010 A-20); 기준 일정 and the exchange-rate dialog are edited as a copy and saved with 저장.
const CalendarView = defineAsyncComponent(() => import('../components/CalendarView.vue'))
const g = (k: string) => t(`settings.general.${k}` as MessageKey)

// ── 화면: language and theme apply and save at once ──
const msg = ref('')
const langChoice = computed(() => store.preferences.language ?? 'browser')
/** The saves of this screen go one after the other: a pick made while one is on its way waits, then is merged onto what the server last answered (spec 010 A-21). */
let queue: Promise<unknown> = Promise.resolve()
/** Save a preference, then (in the same session only) show what it did. */
function saveNow(patch: Partial<Preferences>, after?: () => void, done = g('themeApplied')) {
  const scope = sessionScope()
  const run = async () => {
    msg.value = ''
    try {
      const ran = await runSteps(scope, [
        () => savePreferences({ ...store.preferences, ...patch }), // read now, after the earlier save has finished
        async () => { after?.() },
      ])
      if (ran) msg.value = done
    } catch (e) {
      if (scope.alive()) msg.value = (e as Error).message
    }
  }
  const next = queue.then(run)
  queue = next
  return next
}
const pickTheme = (mode: Preferences['themeMode']) => saveNow({ themeMode: mode })
function pickLang(v: string) {
  const next = v === 'ko' || v === 'en' ? (v as Lang) : null
  return saveNow({ language: next }, () => applyPreference(next), g('languageSaved'))
}
const LIGHT = '#F5F6F5'
const DARK = '#1A211E'
const THEME_CARDS: { id: Preferences['themeMode']; bg: string }[] = [
  { id: 'light', bg: LIGHT }, { id: 'dark', bg: DARK }, { id: 'system', bg: `linear-gradient(90deg, ${LIGHT} 50%, ${DARK} 50%)` },
]

// ── 표시 형식: a choice saves ──
const DATES = [{ id: 'iso', label: '2026-11-14' }, { id: 'dot', label: '2026. 11. 14.' }, { id: 'us', label: '11/14/2026' }]
const unitName = (id: string) => g(`units.${id}`)
const UNITS = computed(() => (['won', 'thousand', 'man'] as const).map((id) => ({ id, label: unitName(id) })))
const NEGS = computed(() => [{ id: 'minus', label: '−15,000' }, { id: 'paren', label: '(15,000)' }, { id: 'red', label: g('red') }])
const pickFormat = (patch: Partial<Preferences>) => saveNow(patch, undefined, g('formatSaved'))
const fmt = computed(() => ({ amountUnit: store.preferences.amountUnit, negative: store.preferences.negative, dateFormat: store.preferences.dateFormat }))

// Preview: this month's upcoming payments in the chosen formats (the user's own data)
const now = today()
const preview = computed(() => upcomingPayments(store.subscriptions, store.planChanges, store.settings, now, 31).slice(0, 4))
const previewTotal = computed(() => preview.value.reduce((a, p) => a + p.krw, 0))
const monthName = computed(() => new Date(2000, Number(ymOf(now).slice(5)) - 1, 1).toLocaleString(lang.value === 'en' ? 'en-US' : 'ko-KR', { month: 'long' }))

// ── 통화: the exchange rate (USD) is edited in a dialog ──
const usdUses = computed(() => store.subscriptions.filter((s) => s.currency === 'USD').length)
interface FxDraft { fxRate: number; fxBuffer: number }
const fxEdit = ref<FxDraft | null>(null)
const fxError = ref('')
const fxBusy = ref(false)
const openFx = () => { fxEdit.value = { fxRate: store.settings.fxRate, fxBuffer: store.settings.fxBuffer }; fxError.value = '' }
async function saveFx() {
  const f = fxEdit.value
  if (!f) return
  if (!(f.fxRate > 0)) return (fxError.value = g('badFx'))
  if (!(f.fxBuffer >= 0 && f.fxBuffer <= 100)) return (fxError.value = g('badBuffer'))
  fxBusy.value = true
  fxError.value = ''
  try {
    await saveSettings({ fxRate: f.fxRate, fxBuffer: f.fxBuffer })
    fxEdit.value = null
  } catch (e) {
    fxError.value = (e as Error).message || status.error
  } finally {
    fxBusy.value = false
  }
}
const fxFoot = computed(() => (fxEdit.value && fxEdit.value.fxRate > 0 ? t('settings.general.fxFoot', { rate: money(fxEdit.value.fxRate * (1 + (fxEdit.value.fxBuffer || 0) / 100), { ...fmt.value, amountUnit: 'won' }) }) : ''))

// ── 기준 일정: edited as a copy ──
type Sched = Pick<Settings, 'payDay' | 'transferDay' | 'billingDay' | 'dayShift'>
const fromStore = (): Sched => {
  const { payDay, transferDay, billingDay, dayShift } = store.settings
  return { payDay, transferDay, billingDay, dayShift }
}
const d = ref<Sched>(fromStore())
/** The saved values the draft started from: an edit is a difference from these, not from the store (review 1 R6). */
const base = ref<Sched>(fromStore())
const smsg = ref('')
const busy = ref(false)
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(base.value))
// The saved values changed elsewhere (a revert in 변경 내역, another tab): follow them unless the user has edited the draft.
watch(() => JSON.stringify(fromStore()), () => {
  if (!dirty.value) d.value = fromStore()
  base.value = fromStore()
})
const problem = computed(() => {
  const days = [d.value.payDay, d.value.transferDay, d.value.billingDay]
  return days.some((x) => !Number.isInteger(x) || x < 1 || x > 31) ? g('badDays') : ''
})
async function save() {
  if (problem.value) return (smsg.value = problem.value)
  busy.value = true
  smsg.value = ''
  try {
    await saveSettings({ ...d.value })
    d.value = fromStore()
    base.value = fromStore()
    smsg.value = g('saved')
  } catch (e) {
    smsg.value = (e as Error).message || status.error
  } finally {
    busy.value = false
  }
}
function cancel() {
  d.value = fromStore()
  base.value = fromStore()
  smsg.value = ''
}
const SHIFTS = computed(() => (['before', 'none', 'after'] as const).map((id) => ({ id, label: g(`shiftShort.${id}`) })))
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
const SCHEDS = [
  { id: 'payDay', slot: 'pay', name: 'payDay', use: 'payUse', ids: 'g-pay' },
  { id: 'transferDay', slot: 'transfer', name: 'transferDay', use: 'transferUse', ids: 'g-xfer' },
  { id: 'billingDay', slot: 'billing', name: 'billingDay', use: 'billingUse', ids: 'g-bill' },
] as const

// ── 공휴일 ──
const krRow = computed(() => store.holidaySets.find((s) => s.builtin === 'kr'))
const krOn = computed(() => krRow.value?.enabled ?? true)
const ownSets = computed(() => store.holidaySets.filter((s) => !s.builtin))
const holErr = ref('')
async function toggleKr(on: boolean) {
  holErr.value = ''
  const row = krRow.value
  await saveItem('holidaySets', row ? { ...row, enabled: on } : { id: '', name: BUILTIN_SETS.kr!.name, enabled: on, builtin: 'kr', rules: [] }).catch((e: Error) => { holErr.value = e.message })
}
const toggleOwn = (s: HolidaySet, on: boolean) => saveItem('holidaySets', { ...s, enabled: on }).catch((e: Error) => { holErr.value = e.message })
const showYear = ref(false)
const showCal = ref(false)

// Set editor: two steps (set, rules); rules are rows (src/lib/holiday-rows.ts keeps what the rows do not show).
const rows = ref<RuleRow[]>([])
const step = ref(0)
const setEd = useEditor('holidaySets', () => ({ id: '', name: '', enabled: true, builtin: null, rules: [] }),
  (s) => (!s.name.trim() ? g('needSetName') : !s.rules.length ? g('needRule') : s.rules.some((r) => !r.name) ? g('needRuleName') : null))
function openSet(s?: HolidaySet) {
  setEd.open(s)
  rows.value = s ? toRows(s.rules) : [emptyRow()]
  step.value = 0
}
function saveSet() {
  if (setEd.item.value) setEd.item.value.rules = toRules(rows.value)
  return setEd.save()
}
function canAdvance() {
  if (!setEd.item.value?.name.trim()) { setEd.error.value = g('needSetName'); return false }
  setEd.error.value = ''
  return true
}
const addRow = () => rows.value.push(emptyRow())
const setFoot = computed(() => (step.value === 0 ? g('setFoot1') : t('settings.general.setFoot2', { n: rows.value.length })))
</script>

<template>
  <div class="sets">
    <div class="set">
      <div class="set-h"><h2>{{ g('sectionDisplay') }}</h2><p>{{ g('sectionDisplayDesc') }}</p></div>
      <section class="card"><div class="fs">
        <div class="field"><label for="g-lang">{{ g('language') }}</label>
          <Select id="g-lang" :model-value="langChoice" :options="[{ value: 'browser', label: g('languageBrowser') }, { value: 'ko', label: g('langKo') }, { value: 'en', label: g('langEn') }]" @update:model-value="pickLang" />
          <span class="hint">{{ g('languageDesc') }}</span></div>
        <div class="field"><span id="g-theme" class="lbl">{{ g('theme') }}</span>
          <div class="tcards" role="radiogroup" aria-labelledby="g-theme">
            <button v-for="th in THEME_CARDS" :key="th.id" type="button" role="radio" class="choice" :class="{ on: store.preferences.themeMode === th.id }" :aria-checked="store.preferences.themeMode === th.id" @click="pickTheme(th.id)">
              <span class="sw" aria-hidden="true" :style="{ background: th.bg }"></span><b>{{ g(th.id) }}</b>
            </button>
          </div>
          <span class="hint">{{ g('themeDesc') }}</span></div>
        <div class="field"><label for="g-tz">{{ g('timezone') }}</label>
          <Soon tag="div" class="soon-fld"><Select id="g-tz" disabled model-value="tz" :options="[{ value: 'tz', label: 'Asia/Seoul (UTC+09:00)' }]" /></Soon>
          <span class="hint">{{ g('timezoneDesc') }}</span></div>
        <p v-if="msg" class="small subtle" role="status">{{ msg }}</p>
      </div></section>
    </div>

    <div class="set">
      <div class="set-h"><h2>{{ g('sectionFormat') }}</h2><p>{{ g('sectionFormatDesc') }}</p></div>
      <section class="card fmtgrid">
        <div class="fs">
          <div class="field"><span id="g-date" class="lbl">{{ g('dateFormat') }}</span>
            <Seg class="mono-seg" :options="DATES" :model-value="store.preferences.dateFormat" labelledby="g-date" @update:model-value="pickFormat({ dateFormat: $event })" />
            <span class="hint">{{ g('dateFormatDesc') }}</span></div>
          <div class="field"><span id="g-unit" class="lbl">{{ g('amountUnit') }}</span>
            <Seg :options="UNITS" :model-value="store.preferences.amountUnit" labelledby="g-unit" @update:model-value="pickFormat({ amountUnit: $event })" />
            <span class="hint">{{ g('amountUnitDesc') }}</span></div>
          <div class="field"><span id="g-neg" class="lbl">{{ g('negative') }}</span>
            <Seg class="neg-seg" :options="NEGS" :model-value="store.preferences.negative" labelledby="g-neg" @update:model-value="pickFormat({ negative: $event })" />
            <span class="hint">{{ g('negativeDesc') }}</span></div>
        </div>
        <div class="pv" role="group" :aria-label="g('preview')">
          <div class="pvh"><b>{{ g('previewTitle2') }}</b><span class="hint">{{ t('settings.general.previewUnit2', { month: monthName, unit: unitName(store.preferences.amountUnit) }) }}</span></div>
          <table>
            <thead><tr><th scope="col">{{ g('colDate') }}</th><th scope="col">{{ g('colWhat') }}</th><th scope="col" class="n">{{ g('colAmount') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in preview" :key="p.sub.id + p.date.getTime()"><td class="mono">{{ dateText(p.date, fmt) }}</td><td><b>{{ p.sub.name }}</b> <small class="hint">{{ p.sub.plan }}</small></td>
                <td class="n" :class="moneyClass(-p.krw, fmt)">{{ money(-p.krw, fmt) }}</td></tr>
              <tr v-if="!preview.length"><td colspan="3" class="muted">{{ g('noPayments') }}</td></tr>
              <tr class="sum"><td colspan="2">{{ g('total') }}</td><td class="n" :class="moneyClass(-previewTotal, fmt)">{{ money(-previewTotal, fmt) }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="set">
      <div class="set-h"><h2>{{ g('sectionCurrency') }}</h2><p>{{ g('sectionCurrencyDesc') }}</p></div>
      <section class="card"><div class="fs">
        <div class="field"><label for="g-cur">{{ g('baseCurrency') }}</label>
          <Soon tag="div" class="soon-fld"><Select id="g-cur" disabled model-value="krw" :options="[{ value: 'krw', label: g('krw') }]" /></Soon>
          <span class="hint">{{ g('baseCurrencyDesc') }}</span></div>
        <div class="field">
          <div class="lrow"><span class="lbl">{{ g('otherCurrencies') }}</span><Soon class="btn sm">{{ g('addFx') }}</Soon></div>
          <ul class="fxlist" :aria-label="g('otherCurrencies')">
            <li>
              <span class="code">USD</span>
              <span class="fxn"><b>{{ g('usd') }}</b><small class="hint">{{ usdUses ? t('settings.general.fxUses', { n: usdUses }) : g('fxNoUses') }} · {{ t('settings.general.fxBuffer', { n: store.settings.fxBuffer }) }}</small></span>
              <span class="fxr"><b class="num">{{ t('settings.general.fxRate', { rate: store.settings.fxRate }) }}</b><small class="hint">{{ g('fxManual') }}</small></span>
              <button class="btn sm ghost" type="button" :aria-label="t('settings.general.fxEditLabel', { code: 'USD' })" @click="openFx">{{ g('edit') }}</button>
            </li>
          </ul>
          <span class="hint">{{ g('fxHint') }}</span>
        </div>
      </div></section>
    </div>

    <div class="set">
      <div class="set-h"><h2>{{ g('schedule') }}</h2><p>{{ g('scheduleDesc') }}</p><Soon class="btn sm">{{ g('addSchedule') }}</Soon></div>
      <form class="card" :aria-label="g('scheduleForm')" novalidate @submit.prevent="save">
        <ul class="sched">
          <li v-for="s in SCHEDS" :key="s.id">
            <div class="s1"><b>{{ g(s.name) }}</b><small class="hint grow">{{ g(s.use) }}</small>
              <span v-if="shifted" class="thism">{{ g('thisMonth') }} <b class="num" :class="{ moved: shifted[s.slot].shifted }">{{ md(shifted[s.slot].date) }}</b><template v-if="shifted[s.slot].unresolved"> {{ g('noBizDay') }}</template><template v-else-if="shifted[s.slot].shifted"> · {{ g(shifted[s.slot].shifted === 'before' ? 'moveBefore' : 'moveAfter') }}</template></span>
              <span v-else class="thism">{{ g('loadingHolidays') }}</span>
            </div>
            <div class="s2">
              <span>{{ g('monthly') }}</span>
              <span class="dayin"><input :id="s.ids" v-model.number="d[s.id]" type="number" min="1" max="31" :aria-label="g(s.name)"><span>{{ g('dayUnit') }}</span></span>
            </div>
          </li>
          <li>
            <div class="s2"><span id="g-shift-l">{{ g('shiftLabel') }}</span>
              <Seg :options="SHIFTS" :model-value="d.dayShift" labelledby="g-shift-l" @update:model-value="d.dayShift = $event" /></div>
            <small class="hint">{{ g('shiftAll') }}</small>
          </li>
        </ul>
        <div class="cf"><span class="hint grow">{{ g('logged') }}</span><span v-if="smsg" class="small" :class="smsg === g('saved') ? 'subtle' : 'err'" role="status">{{ smsg }}</span>
          <button class="btn sm" type="button" :disabled="!dirty" @click="cancel">{{ t('common.cancel') }}</button>
          <button class="btn sm pri" type="submit" :disabled="busy || !dirty">{{ t('common.save') }}</button></div>
      </form>
    </div>

    <div class="set">
      <div class="set-h"><h2 id="g-hol">{{ g('holidaySets') }}</h2><p>{{ g('holidayIntro') }}</p><button class="btn sm" type="button" @click="openSet()">{{ g('addSet') }}</button></div>
      <section class="card" aria-labelledby="g-hol">
        <div class="fs hol">
          <p v-if="holErr" class="save-err" role="alert">{{ holErr }} <button type="button" @click="holErr = ''">{{ t('common.close') }}</button></p>
          <div class="setrow">
            <span class="sn"><b>{{ setName({ name: BUILTIN_SETS.kr!.name, builtin: 'kr' }) }} <span class="pill tag">{{ g('builtin') }}</span></b><small class="hint">{{ t('settings.general.builtinRules', { n: BUILTIN_SETS.kr!.rules.length }) }}</small></span>
            <Switch :model-value="krOn" :label="t('settings.general.setOn', { name: setName({ name: BUILTIN_SETS.kr!.name, builtin: 'kr' }) })" @update:model-value="toggleKr" />
          </div>
          <div v-for="s in ownSets" :key="s.id" class="setrow">
            <span class="sn"><b>{{ s.name }}</b><small class="hint">{{ t('settings.general.rules', { n: s.rules.length }) }}</small></span>
            <button class="btn sm ghost" type="button" :aria-label="t('settings.general.editLabel', { name: s.name })" @click="openSet(s)">{{ g('edit') }}</button>
            <Switch :model-value="s.enabled" :label="t('settings.general.setOn', { name: s.name })" @update:model-value="toggleOwn(s, $event)" />
          </div>
          <p class="hint">{{ g('holidayNote') }}</p>
          <div class="btns">
            <button class="btn sm" type="button" :aria-expanded="showYear" @click="showYear = !showYear">{{ showYear ? g('closeList') : t('settings.general.yearList', { year }) }}</button>
            <button class="btn sm ghost" type="button" :aria-expanded="showCal" @click="showCal = !showCal">{{ showCal ? g('closeCalendar') : g('calendar') }}</button>
          </div>
          <ul v-if="showYear" class="hlist">
            <li v-if="!yearHolidays" class="muted">{{ t('common.loading') }}</li>
            <li v-for="h in yearHolidays ?? []" :key="h.date + h.name"><span class="mono">{{ dateText(h.date, fmt) }}</span> {{ holidayName(h.name) }}</li>
          </ul>
          <CalendarView v-if="showCal" class="pcal" source="holidays" :sets="store.holidaySets" :label="g('calendarLabel')" />
        </div>
      </section>
    </div>

    <EditSheet v-if="fxEdit" :title="t('settings.general.fxEditTitle', { code: 'USD' })" :desc="g('fxEditDesc')" :error="fxError" :busy="fxBusy" :hint="fxFoot" @save="saveFx" @cancel="fxEdit = null">
      <div class="field"><span id="fx-mode" class="lbl">{{ g('fxMode') }}</span>
        <div class="seg fxseg" role="group" aria-labelledby="fx-mode"><Soon tag="span" class="segsoon">{{ g('fxAuto') }}</Soon><button type="button" aria-pressed="true">{{ g('fxManual') }}</button></div>
        <span class="hint">{{ g('fxManualHint') }}</span></div>
      <div class="field"><label for="g-fx">USD → KRW</label><input id="g-fx" v-model.number="fxEdit.fxRate" class="in num" type="number" step="any" min="0"></div>
      <div class="field"><label for="g-buf">{{ g('buffer') }}</label><input id="g-buf" v-model.number="fxEdit.fxBuffer" class="in num" type="number" step="any" min="0" max="100"><span class="hint">{{ g('fxNote') }}</span></div>
    </EditSheet>

    <EditSheet v-if="setEd.item.value" :key="setEd.item.value.id || 'new'" v-model:step="step" :title="setEd.item.value.id ? g('setEditTitle') : g('setAddTitle')" :error="setEd.error.value" :busy="setEd.busy.value"
      :steps="[g('stepSet'), g('stepRules')]" :can-advance="canAdvance" :hint="setFoot" :can-delete="!!setEd.item.value.id" :delete-name="setEd.item.value.name" :desc="g('setDesc')" @save="saveSet" @cancel="setEd.close" @delete="setEd.remove">
      <template v-if="step === 0">
        <div class="field"><label for="hs-name">{{ g('setName') }} <span class="req">*</span></label><input id="hs-name" v-model="setEd.item.value.name" class="in" :placeholder="g('setNamePh')"><span class="hint">{{ g('setNameHint') }}</span></div>
      </template>
      <template v-else>
        <fieldset v-for="(r, i) in rows" :key="i" class="rule">
          <legend>{{ t('settings.general.ruleNo', { n: i + 1 }) }}</legend>
          <div class="field"><label :for="`hr-n-${i}`">{{ g('ruleName') }}</label><input :id="`hr-n-${i}`" v-model="r.name" class="in" :placeholder="g('ruleNamePh')"></div>
          <div class="field"><label :for="`hr-k-${i}`">{{ g('ruleKind') }}</label>
            <Select :id="`hr-k-${i}`" v-model="r.kind" :options="[{ value: 'dates', label: g('kindDates') }, { value: 'rrule', label: g('kindRrule') }]" /></div>
          <div v-if="r.kind === 'dates'" class="field"><label :for="`hr-d-${i}`">{{ g('datesLabel') }}</label><input :id="`hr-d-${i}`" v-model="r.dates" class="in" placeholder="2027-06-03"></div>
          <div v-else class="field"><label :for="`hr-r-${i}`">RRULE</label><input :id="`hr-r-${i}`" v-model="r.rrule" class="in mono" placeholder="FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17"></div>
          <div class="field"><label :for="`hr-s-${i}`">{{ g('substitute') }}</label>
            <Select :id="`hr-s-${i}`" v-model="r.sub" :options="[{ value: '', label: t('common.none') }, { value: 'SU', label: g('subSU') }, { value: 'SA', label: g('subSA') }, { value: 'SA,SU', label: g('subBoth') }]" /></div>
          <button class="btn sm bad rm" type="button" :aria-label="t('settings.general.removeRule', { n: i + 1 })" @click="rows.splice(i, 1)">{{ t('settings.general.removeRule', { n: i + 1 }) }}</button>
        </fieldset>
        <button class="btn sm addrule" type="button" @click="addRow">{{ g('addRule') }}</button>
        <p class="small muted">{{ g('exampleLunar') }} <code>RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1</code>, {{ g('exampleNth') }} <code>FREQ=YEARLY;BYMONTH=5;BYDAY=2MO</code></p>
      </template>
    </EditSheet>
  </div>
</template>

<style scoped>
.sets{display:flex;flex-direction:column;max-width:1100px}
.set{display:grid;grid-template-columns:240px minmax(0,1fr);gap:28px;align-items:start;padding:24px 0;border-top:1px solid var(--border)}
.set:first-child{border-top:0;padding-top:4px}
.set-h h2{margin:0;font-size:15px;font-weight:600}
.set-h p{margin:6px 0 12px;font-size:13px;line-height:1.55;color:var(--muted)}
.fs .field{display:block}
.fs .lbl,.fs .field > label,.lrow .lbl{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.fs .hint{display:block;margin-top:4px}
.in{height:40px}
.tcards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.choice{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer;font:inherit}
.choice:hover{border-color:var(--border-strong)}
.choice.on{border:2px solid var(--primary-text);padding:11px;background:var(--primary-tint)}
.choice .sw{display:block;height:40px;border-radius:var(--r-ctl);border:1px solid var(--border)}
.choice b{font-size:13px}
.soon-fld{display:block;width:100%}
.soon-fld :deep(.soon-in){display:block;width:100%}
.mono-seg :deep(button){font:500 12px var(--f-mono)}
.neg-seg :deep(button:last-child){color:var(--neg-text)}
.fmtgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);overflow:hidden}
.fmtgrid .pv{border-left:1px solid var(--border);background:var(--surface-2);min-width:0}
.pvh{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:14px 18px 10px}
.pvh b{font-size:13px}
.pv table{font-size:13px;width:100%}
.pv th{background:var(--fill);border-top:0}
.pv td.mono{font-size:12px;color:var(--muted);white-space:nowrap}
.pv td.n{font-weight:600;white-space:nowrap}
.pv tr.sum td{font-weight:600;border-bottom:0}
.pv tr.sum td.n{font-weight:700}
.lrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.lrow .lbl{margin:0}
.fxlist{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:var(--r-card);overflow:hidden}
.fxlist li{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:10px 12px;border-bottom:1px solid var(--divider)}
.fxlist li:last-child{border-bottom:0}
.code{display:inline-flex;justify-content:center;min-width:44px;padding:2px 7px;border-radius:var(--r-badge);background:var(--primary-soft);color:var(--primary-text);font:600 12px var(--f-mono)}
.fxn{flex:1 1 140px;min-width:0}
.fxn b,.fxr b{display:block;font-size:13px}
.fxn .hint,.fxr .hint{display:block;margin:0}
.fxr{text-align:right}
.sched{list-style:none;margin:0;padding:0}
.sched li{display:flex;flex-direction:column;gap:10px;padding:14px 18px;border-bottom:1px solid var(--divider)}
.s1{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}
.s1 b{font-size:14px}
.grow{flex-grow:1;min-width:0}
.thism{font-size:12px;color:var(--subtle)}
.thism b{font-size:13px;color:var(--text)}
.thism b.moved{color:var(--accent-text)}
.s2{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;color:var(--text-2)}
.dayin{display:flex;align-items:center;height:40px;width:96px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);padding-right:10px;background:var(--input)}
.dayin input{flex:1;min-width:0;height:100%;border:0;outline:0;padding:0 6px 0 10px;text-align:right;color:var(--text);background:transparent;font-variant-numeric:tabular-nums}
.dayin span{font-size:13px;color:var(--subtle)}
.dayin:focus-within{border-color:var(--primary-text);box-shadow:0 0 0 3px var(--primary-soft)}
.cf{flex-wrap:wrap}
.err{color:var(--neg-text)}
.hol{gap:12px}
.hol .btns{margin-top:0}
.hol > .hint{margin:0}
.setrow{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-card)}
.sn{flex:1;min-width:0;display:flex;flex-direction:column}
.sn b{display:block}
.hlist{list-style:none;margin:0;padding:0;columns:2 220px;font-size:13px}
.hlist li{padding:3px 0;break-inside:avoid}
.pcal{margin-top:4px}
.rule{margin:0;padding:14px;border:1px solid var(--border);border-radius:var(--r-card);display:flex;flex-direction:column;gap:14px;min-width:0}
.rule legend{padding:0 6px;font-size:12px;font-weight:600;color:var(--subtle)}
.rule .rm{align-self:flex-start}
.addrule{align-self:flex-start;border-style:dashed}
.fxseg :deep(.segsoon){display:inline-flex}
@media (max-width:760px){
  .set{grid-template-columns:1fr;gap:12px;padding:18px 0}
  .cf{flex-wrap:nowrap}
  .fmtgrid{grid-template-columns:1fr}
  .fmtgrid .pv{border-left:0;border-top:1px solid var(--border)}
}
</style>
