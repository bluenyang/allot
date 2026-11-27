<script setup lang="ts">
// 수입 (spec 014 S-2–S-4; canvas NextIncome): what comes in in the month the header shows (view.ym, the same month switch
// as the overview). A summary strip (expected, received, the difference that goes to the month's 여유), the month's table
// from incomeAt — the salary (settings.netPay on payDay), that month's regular incomes, then the money that came in once —
// the regular incomes (salary first) and the difference of the last six months. The salary's editor writes netPay and
// payDay through the settings save; 월급 분배's 월 실수령 field stays. Receipts: several per row and month add up; a row
// with some opens the list of that month's receipts.
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { t, lang } from '../i18n'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import EditSheet from '../components/EditSheet.vue'
import IncomeEditor from '../components/IncomeEditor.vue'
import SalaryEditor from '../components/SalaryEditor.vue'
import ReceiptEditor from '../components/ReceiptEditor.vue'
import ExtraIncomeEditor from '../components/ExtraIncomeEditor.vue'
import { store } from '../lib/store'
import { view } from '../lib/view'
import { phaseTag } from '../lib/labels'
import { fmtDate, fmtMoney, fmtMoneyClass } from '../lib/display'
import { monthLong, moneyShort, weekdayShort } from '../lib/format'
import { addYm, incomeAt, monthMoney, parseDate, ymd, ymRange, type IncomeLine } from '../lib/calc'
import { dayOfYm, monthDatesOf, periodLabel, periodOfYm, thisYm } from '../lib/month'
import { localToday } from '../lib/now'
import type { IncomeExtra, IncomeItem, IncomeReceipt } from '../data/types'

const ym = computed(() => view.ym)
const year = computed(() => Number(view.ym.slice(0, 4)))
const month = computed(() => Number(view.ym.slice(5, 7)))
const monthName = computed(() => monthLong(month.value))
const ymText = (x: string) => t('income.ym', { year: Number(x.slice(0, 4)), month: monthLong(Number(x.slice(5, 7))) })
const monthTitle = computed(() => ymText(ym.value))

const money = computed(() => monthMoney(store, ym.value))
const income = computed(() => money.value.income)
const left = computed(() => money.value.dist.remainder)
const phase = computed(() => money.value.dist.phase)

// the dates the month stands for, next to its name when the basis is not the calendar (spec 018 S-3)
const period = computed(() => periodLabel(ym.value))
const mdd = (s: string) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}(${weekdayShort(d)})` }
const signed = (n: number) => `${n > 0 ? '+' : ''}${fmtMoney(n)}`
const tone = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '')
const accountName = (id: string | null | undefined) => (id ? store.accounts.find((a) => a.id === id)?.name ?? '' : '')
const itemOf = (id: string) => store.incomes.find((x) => x.id === id) ?? null
const cycleText = (i: Pick<IncomeItem, 'cycle' | 'month' | 'day'>) => (i.cycle === 'yearly' && i.month
  ? t('income.yearly', { month: monthLong(i.month), day: i.day })
  : t('income.monthly', { day: i.day }))
const salaryName = computed(() => t('income.salary'))

// ---------- the month's table ----------
interface Row { key: string; itemId: string | null; name: string; yearly: boolean; line: IncomeLine; when: string; hint: string }
const rows = computed<Row[]>(() => income.value.rows.map((line) => {
  if (line.key === 'salary') {
    const when = t('income.monthly', { day: store.settings.payDay })
    // the salary's date after the weekend/holiday shift, as the overview shows it: the pay day inside the month's period
    const date = monthDatesOf(ym.value).pay.date
    return { key: 'salary', itemId: null, name: salaryName.value, yearly: false, line, when, hint: [when, mdd(date)].join(' · ') }
  }
  const it = itemOf(line.key)
  const when = it ? cycleText(it) : ''
  // a yearly income is a calendar date (the one that falls in this month's period); a monthly one is its day inside the period
  const date = line.date ?? dayOfYm(ym.value, line.day)
  return { key: line.key, itemId: line.key, name: line.name ?? '', yearly: it?.cycle === 'yearly', line, when, hint: [when, mdd(date), accountName(it?.accountId)].filter(Boolean).join(' · ') }
}))
const extras = computed(() => income.value.extras)
const regularCount = computed(() => income.value.rows.filter((r) => r.expected > 0).length)
const waiting = computed(() => income.value.rows.filter((r) => r.received === null && r.expected > 0).length)
const receivedNote = computed(() => {
  const ex = extras.value.length ? t('income.extrasN', { n: extras.value.length }) : ''
  const head = waiting.value ? t('income.waiting', { n: waiting.value }) : t('income.gotAll', { n: income.value.rows.filter((r) => r.received !== null).length })
  return [head, ex].filter(Boolean).join(' · ')
})

// ---------- regular incomes (salary first) ----------
const nextYm = (i: IncomeItem) => {
  const m = i.month ?? month.value
  return `${year.value + (m < month.value ? 1 : 0)}-${String(m).padStart(2, '0')}`
}
const regular = computed(() => store.incomes.map((i) => ({
  item: i,
  hint: [cycleText(i), accountName(i.accountId), i.cycle === 'yearly' ? t('income.next', { ym: ymText(nextYm(i)) }) : ''].filter(Boolean).join(' · '),
})))

// ---------- the last six months ----------
const hist = computed(() => {
  const list = ymRange(addYm(ym.value, -5), 6).map((m) => ({ ym: m, d: incomeAt(store, m).diff }))
  const max = Math.max(1, ...list.map((b) => Math.abs(b.d)))
  return list.map((b) => ({ ...b, label: monthLong(Number(b.ym.slice(5, 7))), text: b.d ? `${b.d > 0 ? '+' : ''}${moneyShort(b.d)}` : '0', h: `${Math.max(b.d ? 4 : 0, (Math.abs(b.d) / max) * 100)}%` }))
})
const histAria = computed(() => t('income.historyLabel', { list: hist.value.map((b) => `${b.label} ${b.text}`).join(', ') }))

// ---------- editors ----------
// undefined = closed, null = a new one
const incEdit = ref<IncomeItem | null | undefined>(undefined)
const salaryOpen = ref(false)
const extraEdit = ref<IncomeExtra | null | undefined>(undefined)
const newExtraDate = computed(() => {
  const today = localToday()
  // today in this month, else the first day of the month shown (of its period)
  return thisYm() === ym.value ? ymd(today) : periodOfYm(ym.value).start
})
const editRegular = (id: string | null) => {
  if (id === null) salaryOpen.value = true
  else incEdit.value = itemOf(id) ?? undefined
}

// Receipts: a row with none opens the editor; a row with some opens the list of that month's receipts for it.
interface RcRow { itemId: string | null; name: string; expected: number; when: string }
const rcList = ref<RcRow | null>(null)
const rcEdit = ref<{ row: RcRow; initial: IncomeReceipt | null; back: boolean } | null>(null)
const rcRow = (r: Row): RcRow => ({ itemId: r.itemId, name: r.name, expected: r.line.expected, when: r.when })
const receiptsOf = (row: RcRow) => store.incomeReceipts.filter((x) => x.itemId === row.itemId && x.ym === ym.value)
const listed = computed(() => (rcList.value ? receiptsOf(rcList.value) : []))
const listedSum = computed(() => listed.value.reduce((a, r) => a + r.amount, 0))
function openRow(r: Row) {
  const row = rcRow(r)
  if (receiptsOf(row).length) rcList.value = row
  else rcEdit.value = { row, initial: null, back: false }
}
function openReceipt(initial: IncomeReceipt | null) {
  const row = rcList.value!
  rcList.value = null
  rcEdit.value = { row, initial, back: true }
}
function receiptClosed() {
  const e = rcEdit.value
  rcEdit.value = null
  if (e?.back && receiptsOf(e.row).length) rcList.value = e.row
}
</script>

<template>
  <section class="page-gap">
    <!-- On a phone the header bar is hidden: the month switch and the phase sit here, as on the overview. -->
    <div class="mnav" role="group" :aria-label="t('income.monthNav')">
      <button class="btn icon ghost" type="button" :aria-label="t('shell.prevMonth')" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" /></button>
      <div class="mn-c"><b class="num">{{ monthTitle }}</b><small class="hint"><span v-if="period" class="num" data-testid="month-period-phone">{{ period }} · </span>{{ phase ? phaseTag(store.phases, phase) : t('shell.outOfPhase') }}</small></div>
      <button class="btn icon ghost" type="button" :aria-label="t('shell.nextMonth')" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" /></button>
    </div>
    <PageHeader :title="t('income.title')" :desc="t('income.desc')" class="inc-ph">
      <button class="btn" type="button" @click="extraEdit = null">+ {{ t('income.addExtra') }}</button>
      <button class="btn pri" type="button" @click="incEdit = null"><Icon name="plus" />{{ t('income.add') }}</button>
    </PageHeader>

    <section class="card sum" :aria-label="t('income.summaryLabel', { month: monthName })" data-testid="income-summary">
      <div class="sc">
        <span class="lab">{{ t('income.expected', { month: monthName }) }}</span>
        <span class="num big" data-testid="sum-expected">{{ fmtMoney(income.expected) }}</span>
        <span class="hint">{{ t('income.regularN', { n: regularCount }) }}</span>
      </div>
      <div class="sc">
        <span class="lab">{{ t('income.received') }}</span>
        <span class="num big" data-testid="sum-total">{{ fmtMoney(income.total) }}</span>
        <span class="hint">{{ receivedNote }}</span>
      </div>
      <div class="sc hl">
        <span class="lab">{{ t('income.diffToLeft') }}</span>
        <span class="num big" :class="[tone(income.diff), fmtMoneyClass(income.diff)]" data-testid="sum-diff">{{ signed(income.diff) }}</span>
        <RouterLink class="hint go" to="/">{{ t('income.seeLeft', { month: monthName, amount: fmtMoney(left) }) }}</RouterLink>
      </div>
    </section>

    <section class="card" :aria-label="t('income.monthLabel', { month: monthName })" data-testid="income-month">
      <div class="card-hd"><h2>{{ monthName }}</h2><span class="aux">{{ t('income.monthHint') }}</span></div>
      <div class="irow colh" aria-hidden="true">
        <span class="who">{{ t('income.colItem') }}</span>
        <span class="cols"><span>{{ t('income.colExpected') }}</span><span>{{ t('income.colReceived') }}</span><span>{{ t('income.colDiff') }}</span></span>
        <span class="act"></span>
      </div>
      <div v-for="r in rows" :key="r.key" class="irow" :data-testid="`inc-row-${r.key}`">
        <span class="who"><span><b>{{ r.name }}</b> <span v-if="r.yearly" class="pill info">{{ t('income.yearlyPill') }}</span></span><small class="hint">{{ r.hint }}</small></span>
        <span class="cols num">
          <span class="muted">{{ fmtMoney(r.line.expected) }}</span>
          <b data-testid="received">{{ r.line.received === null ? '—' : fmtMoney(r.line.received) }}</b>
          <span :class="[tone(r.line.diff), fmtMoneyClass(r.line.diff)]" data-testid="diff">{{ r.line.received === null ? '—' : signed(r.line.diff) }}</span>
        </span>
        <span class="act">
          <button v-if="r.line.received === null" class="btn sm pri" type="button" :aria-label="t('income.writeName', { name: r.name })" @click="openRow(r)">{{ t('income.write') }}</button>
          <button v-else class="btn sm" type="button" :aria-label="t('income.fixName', { name: r.name })" @click="openRow(r)">{{ t('income.fix') }}</button>
        </span>
      </div>
      <div v-for="x in extras" :key="x.id" class="irow" :data-testid="`inc-extra-${x.id}`">
        <span class="who"><span><b>{{ x.name }}</b> <span class="pill mute">{{ t('income.extraPill') }}</span></span><small class="hint">{{ mdd(x.date) }} · {{ t('income.once') }}</small></span>
        <span class="cols num"><span class="subtle">—</span><b>{{ fmtMoney(x.amount) }}</b><span :class="tone(x.amount)">{{ signed(x.amount) }}</span></span>
        <span class="act"><button class="btn sm" type="button" :aria-label="t('income.fixName', { name: x.name })" @click="extraEdit = x">{{ t('income.fix') }}</button></span>
      </div>
      <div class="irow tot" data-testid="inc-total">
        <b class="who">{{ t('income.total') }}</b>
        <span class="cols num"><span class="muted">{{ fmtMoney(income.expected) }}</span><b>{{ fmtMoney(income.total) }}</b><b :class="[tone(income.diff), fmtMoneyClass(income.diff)]">{{ signed(income.diff) }}</b></span>
        <span class="act"></span>
      </div>
      <div class="cfoot"><button class="btn sm ghost add-x" type="button" @click="extraEdit = null">+ {{ t('income.writeExtra') }}</button></div>
    </section>

    <div class="two">
      <section class="card" :aria-label="t('income.regularTitle')" data-testid="income-regular">
        <div class="card-hd"><h2>{{ t('income.regularTitle') }}</h2><button class="btn sm" type="button" @click="incEdit = null">+ {{ t('income.regularAdd') }}</button></div>
        <div class="lrow" data-testid="reg-salary">
          <span class="lw"><b>{{ salaryName }}</b><small class="hint">{{ t('income.monthly', { day: store.settings.payDay }) }}</small></span>
          <b class="num amt">{{ fmtMoney(store.settings.netPay) }}</b>
          <button class="btn sm ghost" type="button" :aria-label="t('income.fixName', { name: salaryName })" @click="editRegular(null)">{{ t('income.fix') }}</button>
        </div>
        <div v-for="r in regular" :key="r.item.id" class="lrow" :data-testid="`reg-${r.item.id}`">
          <span class="lw"><span><b>{{ r.item.name }}</b> <span v-if="r.item.cycle === 'yearly'" class="pill info">{{ t('income.yearlyPill') }}</span></span><small class="hint">{{ r.hint }}</small></span>
          <b class="num amt">{{ fmtMoney(r.item.amount) }}</b>
          <button class="btn sm ghost" type="button" :aria-label="t('income.fixName', { name: r.item.name })" @click="editRegular(r.item.id)">{{ t('income.fix') }}</button>
        </div>
      </section>

      <section class="card hist" :aria-label="t('income.historyTitle')">
        <div class="card-hd"><h2>{{ t('income.historyTitle') }}</h2><span class="aux">{{ t('income.historyHint') }}</span></div>
        <div class="bars" role="img" :aria-label="histAria">
          <div v-for="b in hist" :key="b.ym" class="bc" :class="{ now: b.ym === ym }">
            <div class="up"><template v-if="b.d > 0"><b class="num plus">{{ b.text }}</b><span class="bar pos" :style="{ height: b.h }"></span></template></div>
            <div class="dn"><template v-if="b.d < 0"><span class="bar neg" :style="{ height: b.h }"></span><b class="num minus">{{ b.text }}</b></template><b v-else-if="b.d === 0" class="num subtle">0</b></div>
            <span class="ml">{{ b.label }}</span>
          </div>
        </div>
        <p class="cfoot hint">{{ t('income.historyNote') }}</p>
      </section>
    </div>

    <IncomeEditor v-if="incEdit !== undefined" :initial="incEdit" :month="month" @close="incEdit = undefined" />
    <SalaryEditor v-if="salaryOpen" @close="salaryOpen = false" />
    <ExtraIncomeEditor v-if="extraEdit !== undefined" :initial="extraEdit" :date="newExtraDate" @close="extraEdit = undefined" />
    <ReceiptEditor
      v-if="rcEdit" :key="rcEdit.initial?.id ?? 'new'" :initial="rcEdit.initial" :item-id="rcEdit.row.itemId" :ym="ym" :name="rcEdit.row.name"
      :expected="rcEdit.row.expected" :when="rcEdit.row.when" :month-name="monthName" @close="receiptClosed"
    />
    <EditSheet
      v-if="rcList" :title="t('income.receipt.title', { name: rcList.name, month: monthName })" :desc="t('income.receipt.listDesc')"
      hide-save :cancel-label="t('common.close')" @cancel="rcList = null"
    >
      <ul class="rcl" data-testid="receipt-list">
        <li v-for="r in listed" :key="r.id">
          <span class="rw"><b class="num">{{ fmtMoney(r.amount) }}</b><small class="hint">{{ r.date ? fmtDate(r.date) : t('income.receipt.noDate') }}<template v-if="r.note"> · {{ r.note }}</template></small></span>
          <button class="btn sm" type="button" :aria-label="t('income.receipt.editName', { amount: fmtMoney(r.amount) })" @click="openReceipt(r)">{{ t('income.fix') }}</button>
        </li>
      </ul>
      <div class="rcf">
        <b class="num">{{ t('income.receipt.sum', { amount: fmtMoney(listedSum) }) }}</b>
        <button class="btn sm" type="button" @click="openReceipt(null)">+ {{ t('income.receipt.add') }}</button>
      </div>
    </EditSheet>
  </section>
</template>

<style scoped>
.mnav{display:none;align-items:center;gap:8px;padding:6px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pop)}
.mn-c{flex:1;text-align:center;line-height:1.3}
.mn-c b{display:block;font-size:17px}
.mnav .btn{width:44px;height:44px;flex:none;color:var(--muted)}
.mnav .btn svg{width:20px;height:20px}
.ph :deep(.sub){max-width:640px}
.plus{color:var(--primary-text)}
.minus{color:var(--neg-text)}
.subtle{color:var(--subtle)}
.big{font-size:22px;font-weight:700;letter-spacing:-.01em}
.lab{font-size:12px;font-weight:600;color:var(--text-2)}
/* summary strip */
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));overflow:hidden}
.sc{display:flex;flex-direction:column;gap:4px;padding:16px 18px;border-right:1px solid var(--border);min-width:0}
.sc:last-child{border-right:0}
.sc.hl{background:var(--primary-tint)}
.sc.hl .lab{color:var(--primary-text)}
.sc .go{color:var(--primary-text);font-weight:600;text-decoration:none}
.sc .go:hover{color:var(--primary-hover)}
/* the month's table */
.irow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 18px;border-bottom:1px solid var(--divider)}
.irow .who{flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:2px}
.irow .cols{display:grid;grid-template-columns:110px 130px 96px;gap:12px;text-align:right;align-items:center}
.irow .act{width:150px;display:flex;justify-content:flex-end}
.irow.colh{padding-top:8px;padding-bottom:8px;background:var(--surface-2);color:var(--subtle);font-size:12px}
.irow.tot{background:var(--surface-2);border-bottom:0}
.cfoot{margin:0;padding:10px 18px;border-top:1px solid var(--border)}
.add-x{color:var(--primary-text)}
/* regular incomes and the six months */
.two{display:flex;flex-wrap:wrap;gap:20px;align-items:stretch}
.two > .card{flex:1 1 420px;min-width:0}
.lrow{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--divider)}
.lrow:last-child{border-bottom:0}
.lw{flex:1;min-width:0;display:flex;flex-direction:column}
.amt{white-space:nowrap}
.hist{display:flex;flex-direction:column}
.bars{flex-grow:1;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;padding:16px 18px 8px;min-height:200px}
.bc{display:grid;grid-template-rows:1fr 1fr auto;text-align:center;font-size:12px;min-width:0}
.bc .up{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;border-bottom:1px solid var(--border-strong)}
.bc .dn{display:flex;flex-direction:column;justify-content:flex-start;align-items:center;gap:4px;padding-top:4px}
.bc .bar{width:60%;display:block}
.bc .bar.pos{background:var(--primary);border-radius:2px 2px 0 0}
.bc .bar.neg{background:var(--neg);border-radius:0 0 2px 2px}
.bc .ml{padding-top:6px;color:var(--muted)}
.bc.now .ml{color:var(--text);font-weight:600}
/* the receipts of a row */
.rcl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rcl li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--divider)}
.rw{flex:1;min-width:0;display:flex;flex-direction:column}
.rcf{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:4px}
@media (max-width:760px){
  .mnav{display:flex}
  .inc-ph :deep(h1){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .sc{border-right:0;border-bottom:1px solid var(--border)}
  .sc:last-child{border-bottom:0}
  .irow .cols{grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
  .irow .act{width:100%;justify-content:flex-start}
  .irow.colh{display:none}
  .bars{gap:6px;padding:12px 12px 8px}
}
</style>
