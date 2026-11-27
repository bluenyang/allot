<script setup lang="ts">
// 통장 상세 (spec 013 S-5, S-6, S-7, S-8): opened from a row of the accounts table. The balance records
// (date, amount, note; added, changed and deleted through the API), the next 12 months forecast from the
// last record (no interest: transfers and refills in, buffer card bills out), the goal month, the year's
// contributions against the limit, and the buffer gauge. The balance editor takes the sheet's place while
// it is open (no dialog on a dialog). Editing the account itself is the page's AccountEditor (`edit`).
import { computed, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import DateInput from './DateInput.vue'
import { store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { offDays } from '../lib/holidays-lazy'
import { bankLine, targetsOf } from '../lib/accounts'
import { addYm, bufferGauge, goalMonth, needsHolidays, projectAccount, yearContribution, ymLabel, ymd } from '../lib/calc'
import { hasPeriod, periodLabel, thisYm } from '../lib/month'
import { fmtMoney } from '../lib/display'
import type { Balance } from '../data/types'
import { localToday } from '../lib/now'

const props = defineProps<{ accountId: string }>()
const emit = defineEmits<{ close: []; edit: [] }>()

const acc = computed(() => store.accounts.find((a) => a.id === props.accountId) ?? null)
// The account went away (deleted elsewhere, or a reload without it): nothing to show.
watch(acc, (a) => { if (!a) emit('close') })

const todayStr = ymd(localToday())
const now = thisYm()
const balances = computed(() => store.balances.filter((b) => b.accountId === props.accountId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)))

// Holidays for the day shift, from the month before the last record to after the forecast (a range of dates, by
// calendar months; the months themselves are read with the store's own list).
const off = computed<ReadonlySet<string>>(() => {
  if (!needsHolidays(store.settings, store.schedules)) return new Set()
  const first = balances.value[0]?.date.slice(0, 7) ?? now
  const from = first < now ? first : now
  return offDays(store.holidaySets, `${addYm(from, -2)}-01`, `${addYm(now, 14)}-01`) ?? new Set()
})
const rows = computed(() => (acc.value ? projectAccount(acc.value, store, off.value, now, 12) : null))
const goalYm = computed(() => (acc.value && acc.value.goal !== null && acc.value.goal !== undefined ? goalMonth(acc.value, store, off.value) : null))
// the yearly limit counts a calendar year on every month basis (spec 018 S-3)
const year = Number(todayStr.slice(0, 4))
const limit = computed(() => {
  const a = acc.value
  if (!a || a.annualLimit === null || a.annualLimit === undefined) return null
  const sum = yearContribution(a, store, off.value, year)
  const state = sum > a.annualLimit ? 'over' : sum >= a.annualLimit * 0.9 ? 'near' : null
  return { sum, limit: a.annualLimit, state }
})
const gauge = computed(() => (acc.value ? bufferGauge(acc.value, store, todayStr) : null))
const receives = computed(() => targetsOf(store.targets, props.accountId).map((x) => x.name).join(', '))
const sub = computed(() => (acc.value ? [bankLine(acc.value), acc.value.role].filter(Boolean).join(' · ') : ''))

// ---------- balance records ----------
const bal = useEditor('balances', (): Balance => ({ id: '', accountId: props.accountId, date: todayStr, amount: '' as unknown as number, note: '' }), (b) =>
  !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ? t('accounts.balance.needDate')
  : typeof b.amount !== 'number' || !(b.amount >= 0) ? t('accounts.balance.needAmount')
  : null)
const balAmount = computed({
  get: () => bal.item.value!.amount as number | '',
  set: (v) => { bal.item.value!.amount = v as number },
})
// money put in at once that day (review 1 F-12): empty = none; the yearly contribution counts it
const balDeposit = computed({
  get: () => (bal.item.value!.deposit ?? '') as number | '',
  set: (v) => { bal.item.value!.deposit = typeof v === 'number' ? v : null },
})
</script>

<template>
  <EditSheet
    v-if="bal.item.value" :key="bal.item.value.id || 'new'" :title="bal.item.value.id ? t('accounts.balance.editTitle') : t('accounts.balance.addTitle')" :desc="t('accounts.balance.desc')"
    :error="bal.error.value" :busy="bal.busy.value" :can-delete="!!bal.item.value.id" @save="bal.save" @cancel="bal.close" @delete="bal.remove"
  >
    <div class="field"><label for="bl-date">{{ t('accounts.balance.date') }}</label><DateInput id="bl-date" v-model="bal.item.value.date" :aria-label="t('accounts.balance.date')" /></div>
    <div class="field"><label for="bl-amount">{{ t('accounts.balance.amount') }}</label><MoneyInput id="bl-amount" v-model="balAmount" /></div>
    <div class="field"><label for="bl-deposit">{{ t('accounts.balance.deposit') }} <span class="opt">{{ t('common.optional') }}</span></label><MoneyInput id="bl-deposit" v-model="balDeposit" /><span class="hint">{{ t('accounts.balance.depositHint') }}</span></div>
    <div class="field"><label for="bl-note">{{ t('accounts.balance.note') }} <span class="opt">{{ t('common.optional') }}</span></label><input id="bl-note" v-model="bal.item.value.note" class="in" autocomplete="off"></div>
  </EditSheet>

  <EditSheet v-else-if="acc" :title="acc.name" :desc="sub || undefined" :width="640" hide-save :cancel-label="t('common.close')" @cancel="emit('close')" @save="emit('close')">
    <template #head><button class="btn sm" type="button" @click="emit('edit')">{{ t('accounts.detail.edit') }}</button></template>

    <p v-if="receives" class="hint">{{ t('accounts.editor.receives') }} · {{ receives }}</p>
    <div v-if="acc.stopFrom" class="callout warn"><p>{{ t('accounts.editor.stoppedText', { ym: ymLabel(acc.stopFrom) }) }}</p></div>

    <section v-if="gauge && (gauge.buffer > 0 || gauge.used > 0)" class="blk" data-testid="buffer-gauge">
      <span class="lbl2">{{ t('accounts.detail.gauge') }}</span>
      <div class="gbar" aria-hidden="true"><div :class="{ bad: gauge.left < 0 }" :style="{ width: `${gauge.buffer > 0 ? Math.min(100, Math.round((gauge.used / gauge.buffer) * 100)) : 100}%` }"></div></div>
      <span class="hint num" :class="{ badt: gauge.left < 0 }">{{ t('accounts.detail.gaugeText', { buffer: fmtMoney(gauge.buffer), used: fmtMoney(gauge.used), left: fmtMoney(gauge.left) }) }}</span>
    </section>

    <section class="blk">
      <div class="bh"><h3>{{ t('accounts.detail.balances') }}</h3><button class="btn sm" type="button" @click="bal.open()">{{ t('accounts.detail.addBalance') }}</button></div>
      <div v-if="balances.length" class="tbl">
        <table>
          <thead><tr><th scope="col">{{ t('accounts.detail.colDate') }}</th><th scope="col" class="n">{{ t('accounts.detail.colAmount') }}</th><th scope="col" class="n">{{ t('accounts.balance.deposit') }}</th><th scope="col">{{ t('accounts.detail.colMemo') }}</th></tr></thead>
          <tbody>
            <tr v-for="b in balances" :key="b.id" class="click" tabindex="0" @click="bal.open(b)" @keydown.enter="bal.open(b)">
              <td class="num">{{ b.date }}</td><td class="n num amt">{{ fmtMoney(b.amount) }}</td><td class="n num">{{ b.deposit ? fmtMoney(b.deposit) : '—' }}</td><td class="hint">{{ b.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="blk" data-testid="account-forecast">
      <h3>{{ t('accounts.detail.projTitle') }}</h3>
      <p v-if="!rows" class="hint">{{ t('accounts.detail.noBalance') }}</p>
      <template v-else>
        <p v-if="acc.goal !== null && acc.goal !== undefined" class="hint">{{ goalYm ? t('accounts.detail.goalLine', { goal: fmtMoney(acc.goal), ym: ymLabel(goalYm) }) : t('accounts.detail.goalNone', { goal: fmtMoney(acc.goal) }) }}</p>
        <p v-if="limit" class="hint" :class="{ warnt: limit.state === 'near', badt: limit.state === 'over' }">
          {{ t('accounts.detail.limitLine', { year, sum: fmtMoney(limit.sum), limit: fmtMoney(limit.limit) }) }}<template v-if="limit.state"> · {{ limit.state === 'over' ? t('accounts.detail.limitOver') : t('accounts.detail.limitNear') }}</template>
        </p>
        <div class="tbl">
          <table>
            <thead><tr><th scope="col">{{ t('accounts.detail.colYm') }}</th><th scope="col" class="n">{{ t('accounts.detail.colIn') }}</th><th scope="col" class="n">{{ t('accounts.detail.colOut') }}</th><th scope="col" class="n">{{ t('accounts.detail.colEnd') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.ym" :class="{ goal: goalYm === r.ym }">
                <td class="num">{{ ymLabel(r.ym) }}<span v-if="goalYm === r.ym" class="pill ok gm">{{ t('accounts.detail.goalMark') }}</span><span v-if="hasPeriod" class="per" data-testid="forecast-period">{{ periodLabel(r.ym) }}</span></td>
                <td class="n num">{{ r.inflow ? fmtMoney(r.inflow) : '—' }}</td>
                <td class="n num">{{ r.outflow ? fmtMoney(r.outflow) : '—' }}</td>
                <td class="n num amt">{{ fmtMoney(r.end) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">{{ t('accounts.detail.projNote') }}</p>
      </template>
    </section>
  </EditSheet>
</template>

<style scoped>
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.lbl2{font-size:12px;font-weight:600;color:var(--text-2)}
.blk{display:flex;flex-direction:column;gap:8px}
.blk h3{margin:0;font-size:14px;font-weight:600}
.bh{display:flex;align-items:center;justify-content:space-between;gap:12px}
.tbl .n{text-align:right}
.tbl table{width:100%}
td.amt{font-weight:600}
tr.click{cursor:pointer}
tr.goal td{background:var(--primary-tint)}
.gm{margin-left:8px}
/* a month's dates under its name when a month is not the calendar month (spec 018 S-3) */
.per{display:block;font-size:11px;font-weight:400;color:var(--muted);white-space:nowrap}
.gbar{height:8px;border-radius:2px;background:var(--fill);overflow:hidden}
.gbar div{height:100%;background:var(--primary)}
.gbar div.bad{background:var(--neg)}
.warnt{color:var(--accent-text)}
.badt{color:var(--neg-text)}
.callout{margin:0}
.callout p{margin:0;font-size:13px}
</style>
