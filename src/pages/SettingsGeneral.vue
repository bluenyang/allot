<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import { saveItem, savePreferences, saveSettings, status, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { dateText, money, moneyClass } from '../lib/format'
import { holidayList } from '../lib/holidays-lazy'
import { BUILTIN_SETS, KR_NAME } from '../data/holidays-kr'
import { addYm, monthDates, today, upcomingPayments, ymOf } from '../lib/calc'
import type { HolidaySet, Preferences, Settings } from '../data/types'
import { emptyRow, toRows, toRules, type RuleRow } from '../lib/holiday-rows'

// 설정 › 일반 (spec 007 S-8, S-9, S-10): display, exchange rate, monthly dates and their
// weekend/holiday shift, holiday sets. Edited as a copy; 저장 sends display settings and the
// money settings (two requests, each its own change set), 취소 drops the copy.
const CalendarView = defineAsyncComponent(() => import('../components/CalendarView.vue'))

type Draft = Pick<Preferences, 'themeMode' | 'dateFormat' | 'amountUnit' | 'negative'> & Pick<Settings, 'fxRate' | 'fxBuffer' | 'payDay' | 'transferDay' | 'billingDay' | 'dayShift'>
const fromStore = (): Draft => {
  const { themeMode, dateFormat, amountUnit, negative } = store.preferences
  const { fxRate, fxBuffer, payDay, transferDay, billingDay, dayShift } = store.settings
  return { themeMode, dateFormat, amountUnit, negative, fxRate, fxBuffer, payDay, transferDay, billingDay, dayShift }
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
  if (days.some((x) => !Number.isInteger(x) || x < 1 || x > 31)) return '날짜는 1~31 사이 정수로 입력해 주세요.'
  if (!(d.value.fxRate > 0)) return '환율은 0보다 커야 해요.'
  if (!(d.value.fxBuffer >= 0 && d.value.fxBuffer <= 100)) return '버퍼는 0~100% 사이로 입력해 주세요.'
  return ''
})

async function save() {
  if (problem.value) return (msg.value = problem.value)
  busy.value = true
  msg.value = ''
  const { themeMode, dateFormat, amountUnit, negative, ...money } = d.value
  try {
    await savePreferences({ ...store.preferences, themeMode, dateFormat, amountUnit, negative })
    await saveSettings(money)
    d.value = fromStore()
    base.value = fromStore()
    msg.value = '저장했어요.'
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

const seg = <T extends string>(list: [T, string][]) => list
const THEMES = seg([['light', '라이트'], ['dark', '다크'], ['system', '시스템']])
const DATES = seg([['iso', '2026-11-14'], ['dot', '2026. 11. 14.'], ['us', '11/14/2026']])
const UNITS = seg([['won', '원'], ['thousand', '천원'], ['man', '만원']])
const NEGS = seg([['minus', '−12,000'], ['paren', '(12,000)'], ['red', '빨간색']])
const SHIFTS = seg([['before', '앞 영업일로 당김'], ['after', '다음 영업일로 미룸'], ['none', '그대로']])

// ── Preview: this month's upcoming payments in the chosen formats (the user's own data) ──
const now = today()
const preview = computed(() => upcomingPayments(store.subscriptions, store.planChanges, { ...store.settings, ...d.value }, now, 31).slice(0, 4))
const previewTotal = computed(() => preview.value.reduce((a, p) => a + p.krw, 0))
const fmt = computed(() => ({ amountUnit: d.value.amountUnit, negative: d.value.negative, dateFormat: d.value.dateFormat }))

// ── Monthly dates with the chosen shift (needs the holiday code once a shift is chosen) ──
const ym = ymOf(now)
const year = now.getFullYear()
const yearHolidays = computed(() => holidayList(store.holidaySets, `${year}-01-01`, `${year}-12-31`))
const aroundMonth = computed(() => holidayList(store.holidaySets, `${addYm(ym, -1)}-01`, `${addYm(ym, 2)}-01`))
const shifted = computed(() => {
  if (d.value.dayShift === 'none') return monthDates(ym, { ...store.settings, ...d.value }, new Set())
  // A shift can cross into the month before or after (review 1, R3).
  const list = aroundMonth.value
  return list ? monthDates(ym, { ...store.settings, ...d.value }, new Set(list.map((h) => h.date))) : null
})
const WD = ['일', '월', '화', '수', '목', '금', '토']
const md = (s: string) => { const x = new Date(`${s}T00:00:00`); return `${x.getMonth() + 1}/${x.getDate()}(${WD[x.getDay()]})` }

// ── Holiday sets ──
const krRow = computed(() => store.holidaySets.find((s) => s.builtin === 'kr'))
const krOn = computed(() => krRow.value?.enabled ?? true)
const ownSets = computed(() => store.holidaySets.filter((s) => !s.builtin))
async function toggleKr() {
  const row = krRow.value
  await saveItem('holidaySets', row ? { ...row, enabled: !row.enabled } : { id: '', name: KR_NAME, enabled: false, builtin: 'kr', rules: [] }).catch(() => {})
}
const toggleOwn = (s: HolidaySet) => saveItem('holidaySets', { ...s, enabled: !s.enabled }).catch(() => {})
const showYear = ref(false)
const showCal = ref(false)

// Set editor: rules as rows (src/lib/holiday-rows.ts keeps what the rows do not show).
const rows = ref<RuleRow[]>([])
const setEd = useEditor('holidaySets', () => ({ id: '', name: '', enabled: true, builtin: null, rules: [] }),
  (s) => (!s.name.trim() ? '세트 이름을 입력해 주세요.' : !s.rules.length ? '규칙을 하나 이상 넣어 주세요.' : s.rules.some((r) => !r.name) ? '규칙마다 이름을 넣어 주세요.' : null))
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
    <form aria-label="일반 설정" novalidate @submit.prevent="save">
      <section class="panel">
        <h2>표시</h2>
        <div class="line">
          <div class="lt"><b id="g-theme">선호 테마</b><span>색상과 모서리는 테마 탭에서 정해요</span></div>
          <div class="seg" role="group" aria-labelledby="g-theme"><button v-for="[id, label] in THEMES" :key="id" type="button" :aria-pressed="d.themeMode === id" @click="d.themeMode = id">{{ label }}</button></div>
        </div>
        <div class="line">
          <div class="lt"><b id="g-date">날짜 형식</b><span>표, 일정, 목록</span></div>
          <div class="seg" role="group" aria-labelledby="g-date"><button v-for="[id, label] in DATES" :key="id" type="button" :aria-pressed="d.dateFormat === id" @click="d.dateFormat = id">{{ label }}</button></div>
        </div>
        <div class="line">
          <div class="lt"><b id="g-unit">금액 단위</b><span>요약 카드와 표. 입력칸과 편집 창은 항상 원 단위</span></div>
          <div class="seg" role="group" aria-labelledby="g-unit"><button v-for="[id, label] in UNITS" :key="id" type="button" :aria-pressed="d.amountUnit === id" @click="d.amountUnit = id">{{ label }}</button></div>
        </div>
        <div class="line">
          <div class="lt"><b id="g-neg">음수 표기</b><span>지출과 차감 금액. 빨간색도 − 기호는 남겨요</span></div>
          <div class="seg" role="group" aria-labelledby="g-neg"><button v-for="[id, label] in NEGS" :key="id" type="button" :aria-pressed="d.negative === id" :class="{ red: id === 'red' }" @click="d.negative = id">{{ label }}</button></div>
        </div>
      </section>

      <section class="panel">
        <h2>환율</h2>
        <p class="small muted lead">USD 결제를 원화로 환산할 때 써요. 버퍼만큼 넉넉하게 잡아요.</p>
        <div class="form">
          <div class="field"><label for="g-fx">USD → KRW</label><input id="g-fx" v-model.number="d.fxRate" class="in" type="number" step="any" min="0"></div>
          <div class="field"><label for="g-buf">버퍼 (%)</label><input id="g-buf" v-model.number="d.fxBuffer" class="in" type="number" step="any" min="0" max="100"></div>
        </div>
      </section>

      <section class="panel">
        <h2>기준 일정</h2>
        <p class="small muted lead">매달 반복되는 날. 현황과 일정 달력에 써요.</p>
        <div class="form">
          <div class="field"><label for="g-pay">월급일</label><input id="g-pay" v-model.number="d.payDay" class="in" type="number" min="1" max="31"></div>
          <div class="field"><label for="g-xfer">분배일</label><input id="g-xfer" v-model.number="d.transferDay" class="in" type="number" min="1" max="31"></div>
          <div class="field"><label for="g-bill">카드 결제일</label><input id="g-bill" v-model.number="d.billingDay" class="in" type="number" min="1" max="31"></div>
        </div>
        <div class="line top">
          <div class="lt"><b id="g-shift">주말·공휴일이면</b><span>켜 둔 공휴일 세트를 써요</span></div>
          <div class="seg" role="group" aria-labelledby="g-shift"><button v-for="[id, label] in SHIFTS" :key="id" type="button" :aria-pressed="d.dayShift === id" @click="d.dayShift = id">{{ label }}</button></div>
        </div>
        <p class="small muted" role="status">
          이번 달:
          <template v-if="shifted">월급 {{ md(shifted.pay.date) }} · 분배 {{ md(shifted.transfer.date) }} · 카드 결제 {{ md(shifted.billing.date) }}</template>
          <template v-else>공휴일을 불러오는 중…</template>
        </p>
      </section>

      <div class="savebar">
        <span class="small muted">바꾼 설정은 변경 내역에 남고, 되돌릴 수 있어요.</span>
        <span class="sp"></span>
        <span class="small" :class="msg === '저장했어요.' ? 'muted' : 'err'" role="status">{{ msg }}</span>
        <button class="btn" type="button" :disabled="!dirty" @click="cancel">취소</button>
        <button class="btn pri" type="submit" :disabled="busy || !dirty">저장</button>
      </div>
    </form>

      <section class="panel" aria-labelledby="g-hol">
        <div class="card-h"><h2 id="g-hol">공휴일 세트</h2><button class="btn sm" type="button" @click="openSet()">+ 세트 추가</button></div>
        <p class="small muted lead">반복 규칙(RRULE)으로 정의해요. 음력은 RSCALE=DANGI. 바꾸면 바로 저장돼요.</p>
        <ul class="sets">
          <li>
            <span class="sn"><b>{{ KR_NAME }}</b><span class="pill tag">기본</span><span class="small muted">{{ BUILTIN_SETS.kr!.rules.length }}개 규칙 · 대체공휴일 포함</span></span>
            <button class="btn sm" type="button" :aria-pressed="krOn" :aria-label="`${KR_NAME} ${krOn ? '끄기' : '켜기'}`" @click="toggleKr">{{ krOn ? '켜짐' : '꺼짐' }}</button>
          </li>
          <li v-for="s in ownSets" :key="s.id">
            <span class="sn"><b>{{ s.name }}</b><span class="small muted">{{ s.rules.length }}개 규칙</span></span>
            <button class="btn sm" type="button" :aria-label="`${s.name} 수정`" @click="openSet(s)">수정</button>
            <button class="btn sm" type="button" :aria-pressed="s.enabled" :aria-label="`${s.name} ${s.enabled ? '끄기' : '켜기'}`" @click="toggleOwn(s)">{{ s.enabled ? '켜짐' : '꺼짐' }}</button>
          </li>
        </ul>
        <p class="small muted">선거일·임시공휴일은 규칙이 없어요. 내 세트에 날짜로 더해 주세요. 음력 날짜는 2050년까지 천문연구원 자료와 대조했어요.</p>
        <div class="btns">
          <button class="btn" type="button" :aria-expanded="showYear" @click="showYear = !showYear">{{ showYear ? '목록 닫기' : `${year}년 공휴일 목록` }}</button>
          <button class="btn" type="button" :aria-expanded="showCal" @click="showCal = !showCal">{{ showCal ? '달력 닫기' : '달력으로 보기' }}</button>
        </div>
        <ul v-if="showYear" class="hlist">
          <li v-if="!yearHolidays" class="muted">불러오는 중…</li>
          <li v-for="h in yearHolidays ?? []" :key="h.date + h.name"><span class="mono">{{ dateText(h.date, fmt) }}</span> {{ h.name }}</li>
        </ul>
        <CalendarView v-if="showCal" class="pcal" source="holidays" :sets="store.holidaySets" label="공휴일 미리보기 달력" />
      </section>

      <EditSheet v-if="setEd.item.value" :key="setEd.item.value.id || 'new'" :title="setEd.item.value.id ? '공휴일 세트 수정' : '공휴일 세트 추가'" :error="setEd.error.value" :busy="setEd.busy.value"
        :can-delete="!!setEd.item.value.id" desc="규칙마다 반복(RRULE) 또는 날짜 목록을 넣어요." @save="saveSet" @cancel="setEd.close" @delete="setEd.remove">
        <div class="field" style="grid-column:1/-1"><label for="hs-name">세트 이름</label><input id="hs-name" v-model="setEd.item.value.name" class="in"></div>
        <template #after>
          <div v-for="(r, i) in rows" :key="i" class="rule">
            <div class="field"><label :for="`hr-n-${i}`">이름</label><input :id="`hr-n-${i}`" v-model="r.name" class="in" placeholder="창립기념일"></div>
            <div class="field"><label :for="`hr-k-${i}`">방식</label>
              <select :id="`hr-k-${i}`" v-model="r.kind" class="in"><option value="dates">날짜</option><option value="rrule">반복 규칙</option></select></div>
            <div v-if="r.kind === 'dates'" class="field wide"><label :for="`hr-d-${i}`">날짜 (YYYY-MM-DD, 쉼표로)</label><input :id="`hr-d-${i}`" v-model="r.dates" class="in" placeholder="2027-06-03"></div>
            <div v-else class="field wide"><label :for="`hr-r-${i}`">RRULE</label><input :id="`hr-r-${i}`" v-model="r.rrule" class="in mono" placeholder="FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17"></div>
            <div class="field"><label :for="`hr-s-${i}`">대체 휴일</label>
              <select :id="`hr-s-${i}`" v-model="r.sub" class="in"><option value="">없음</option><option value="SU">일요일이면</option><option value="SA">토요일이면</option><option value="SA,SU">토·일요일이면</option></select></div>
            <button class="btn sm rm" type="button" :aria-label="`규칙 ${i + 1} 빼기`" @click="rows.splice(i, 1)">빼기</button>
          </div>
          <button class="btn sm" type="button" @click="addRow">+ 규칙</button>
          <p class="small muted">예: 음력 1월 1일 <code>RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1</code>, 5월 둘째 월요일 <code>FREQ=YEARLY;BYMONTH=5;BYDAY=2MO</code></p>
        </template>
      </EditSheet>
    </div>

    <aside class="panel pv" aria-label="표시 미리보기">
      <div class="card-h"><h2>표시 미리보기</h2><span class="small muted">단위: {{ UNITS.find((u) => u[0] === d.amountUnit)![1] }}</span></div>
      <table>
        <thead><tr><th>일자</th><th>내용</th><th class="n">금액</th></tr></thead>
        <tbody>
          <tr v-for="p in preview" :key="p.sub.id + p.date.getTime()"><td class="mono">{{ dateText(p.date, fmt) }}</td><td>{{ p.sub.name }}</td>
            <td class="n" :class="moneyClass(-p.krw, fmt)">{{ money(-p.krw, fmt) }}</td></tr>
          <tr v-if="!preview.length"><td colspan="3" class="muted">31일 안에 결제할 구독이 없어요.</td></tr>
        </tbody>
        <tfoot><tr class="total"><td colspan="2">합계</td><td class="n" :class="moneyClass(-previewTotal, fmt)">{{ money(-previewTotal, fmt) }}</td></tr></tfoot>
      </table>
      <p class="small muted">테마: {{ THEMES.find((t) => t[0] === d.themeMode)![1] }} · 저장 전 미리보기예요.</p>
    </aside>
  </div>
</template>

<style scoped>
.gen{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
@media (min-width:1180px){.gen{grid-template-columns:minmax(0,1fr) 360px}.pv{position:sticky;top:20px}}
.col-form{min-width:0}
h2{margin:0 0 12px}
.lead{margin:-6px 0 12px}
.line{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--divider)}
.line:first-of-type{border-top:0;padding-top:0}
.line.top{margin-top:14px}
.lt{display:flex;flex-direction:column;gap:2px;min-width:0}
.lt b{font-weight:600}
.lt span{font-size:12px;color:var(--subtle)}
.seg .red{color:var(--neg-text)}
.savebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card)}
.sp{flex:1}
.err{color:var(--neg-text)}
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
.pv table{font-size:13px}
.pv td,.pv th{padding-left:6px;padding-right:6px}
</style>
