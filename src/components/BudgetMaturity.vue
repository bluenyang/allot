<script setup lang="ts">
// 만기 일정 (spec 013 S-15; canvas AppSave second tab): the Savings items whose term reads "N개월" or "YYYY-MM까지" and that
// have a `from` month (`maturityOf`), by maturity month: 받을 돈 (before tax, no interest) = the projected balance before
// the maturity month when the item has a balance record, else what the plan sends it until then (`maturityAmount`);
// 만기 후 = the account's `afterMaturity` (edited in the item editor's step 2: the "정해 두기" / edit button opens it).
// Items without a readable term are not listed; the hint names them.
import { computed } from 'vue'
import { t } from '../i18n'
import { fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { addYm, lastBalance, maturityAmount, maturityOf, needsHolidays, ymLabel } from '../lib/calc'
import { thisYm } from '../lib/month'
import { store } from '../lib/store'
import type { Account } from '../data/types'

const props = defineProps<{ items: Account[] }>()
const emit = defineEmits<{ edit: [id: string] }>()

const now = thisYm()
const read = computed(() => props.items.map((a) => ({ a, m: maturityOf(a) })))
const unread = computed(() => read.value.filter((x) => !x.m).map((x) => x.a.name))
/** Holidays from the earliest balance record of a listed item to the month after the last maturity (none without a shift). */
const off = computed<ReadonlySet<string>>(() => {
  const listed = read.value.filter((x) => x.m)
  if (!listed.length || !needsHolidays(store.settings, store.schedules)) return new Set()
  let first = `${now}-01`
  let last = now
  for (const { a, m } of listed) {
    const rec = lastBalance(store.balances, a.id)
    if (rec && rec.date < first) first = rec.date
    if (m!.ym > last) last = m!.ym
  }
  // a range of dates for the holidays, by calendar months (the months themselves are read with the store's own list)
  return offDays(store.holidaySets, `${addYm(first.slice(0, 7), -1)}-01`, `${addYm(last, 1)}-01`) ?? new Set()
})
const rows = computed(() => read.value.filter((x) => x.m).map(({ a, m }) => {
  const got = maturityAmount(a, store, off.value, m!)
  return {
    id: a.id, name: a.name, ym: m!.ym, months: m!.months, amount: got.amount, projected: got.projected,
    state: m!.ym < now ? 'past' : m!.ym === now ? 'now' : '', stopped: !!a.stopFrom, after: a.afterMaturity?.trim() ?? '',
  }
}).sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0)))
</script>

<template>
  <section class="card" data-testid="maturity-table">
    <div class="card-hd"><h2>{{ t('budget.maturity.title') }}</h2><span class="aux">{{ t('budget.maturity.hint') }}</span></div>
    <div v-if="rows.length" class="tbl stack">
      <table>
        <thead><tr>
          <th scope="col">{{ t('budget.maturity.colWhen') }}</th><th scope="col">{{ t('budget.maturity.colName') }}</th>
          <th scope="col" class="n">{{ t('budget.maturity.colAmount') }}</th><th scope="col">{{ t('budget.maturity.colAfter') }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" :data-testid="`maturity-${r.id}`">
            <td :data-label="t('budget.maturity.colWhen')" class="nowrap">
              <span class="num">{{ ymLabel(r.ym) }}</span>
              <span v-if="r.state === 'past'" class="pill mute st">{{ t('budget.maturity.past') }}</span>
              <span v-else-if="r.state === 'now'" class="pill warn st">{{ t('budget.maturity.thisMonth') }}</span>
            </td>
            <td :data-label="t('budget.maturity.colName')"><b>{{ r.name }}</b><span v-if="r.stopped" class="pill mute st">{{ t('budget.maturity.stopped') }}</span></td>
            <td :data-label="t('budget.maturity.colAmount')" class="n">
              <b class="num">{{ fmtMoney(r.amount) }}</b>
              <small class="hint sub">{{ r.projected ? t('budget.maturity.projected') : t('budget.maturity.planned', { n: r.months }) }}</small>
            </td>
            <td :data-label="t('budget.maturity.colAfter')">
              <span class="after">
                <span :class="{ none: !r.after }">{{ r.after || t('budget.maturity.afterNone') }}</span>
                <button class="btn sm ghost link" type="button" :aria-label="t('budget.maturity.afterEdit', { name: r.name })" @click="emit('edit', r.id)">{{ r.after ? t('common.edit') : t('budget.maturity.afterSet') }}</button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="empty hint">{{ t('budget.maturity.empty') }}</p>
    <p class="foot">{{ t('budget.maturity.rule') }}<template v-if="unread.length"> {{ t('budget.maturity.unread', { n: unread.length, names: unread.join(', ') }) }}</template></p>
  </section>
</template>

<style scoped>
.card .tbl{border:0;border-radius:0}
.tbl .n{text-align:right}
.nowrap{white-space:nowrap}
.hint{color:var(--subtle)}
.st{margin-left:8px}
.sub{display:block;font-size:12px}
.after{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.after .none{color:var(--accent-text)}
.link{color:var(--primary-text)}
.empty{margin:0;padding:24px 18px;text-align:center}
.foot{margin:0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2);border-top:1px solid var(--divider);border-radius:0 0 var(--r-card) var(--r-card)}
@media (max-width:760px){
  .stack table,.stack tbody,.stack tr,.stack td{display:block;width:auto}
  .stack thead{display:none}
  .stack tr{padding:10px 16px;border-bottom:1px solid var(--divider)}
  .stack td{padding:2px 0;border:0;text-align:left !important;white-space:normal}
  .stack td[data-label]::before{content:attr(data-label);display:inline-block;min-width:84px;margin-right:8px;font-size:12px;color:var(--subtle);font-weight:500}
  .stack td:first-child::before{display:none}
}
</style>
