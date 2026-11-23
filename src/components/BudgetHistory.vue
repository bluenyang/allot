<script setup lang="ts">
// 월별 기록 (spec 013 S-15; canvas AppLiving · AppInvest second tab): the last six months and this month, newest first —
// the planned amount (the menu target's value that month, `monthPlans`), and the spent / sent amount and the difference
// as "—": they come with statements and transactions (0.1.9). It only draws.
import { computed } from 'vue'
import { t } from '../i18n'
import { fmtMoney } from '../lib/display'
import { ymLabel } from '../lib/calc'
import type { MonthPlan } from '../lib/budget-page'

const props = defineProps<{
  title: string
  /** the column heads: month, planned, spent or sent, difference */
  cols: [string, string, string, string]
  rows: MonthPlan[]
  now: string
  /** a line when the menu has no target in the pay split ('' for none) */
  note?: string
}>()
const list = computed(() => props.rows.map((r) => ({ ...r, label: ymLabel(r.ym), current: r.ym === props.now })))
</script>

<template>
  <section class="card" data-testid="budget-history">
    <div class="card-hd"><h2>{{ props.title }}</h2><span class="aux">{{ t('budget.history.hint') }}</span></div>
    <p v-if="props.note" class="hnote">{{ props.note }}</p>
    <div class="tbl stack">
      <table>
        <thead><tr><th scope="col">{{ props.cols[0] }}</th><th scope="col" class="n">{{ props.cols[1] }}</th><th scope="col" class="n">{{ props.cols[2] }}</th><th scope="col" class="n">{{ props.cols[3] }}</th></tr></thead>
        <tbody>
          <tr v-for="r in list" :key="r.ym">
            <td :data-label="props.cols[0]"><span class="num">{{ r.label }}</span><span v-if="r.current" class="pill ok cur">{{ t('budget.history.thisMonth') }}</span></td>
            <td :data-label="props.cols[1]" class="n amt">{{ fmtMoney(r.planned) }}</td>
            <td :data-label="props.cols[2]" class="n hint">—</td>
            <td :data-label="props.cols[3]" class="n hint">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.card .tbl{border:0;border-radius:0}
.tbl .n{text-align:right}
td.amt{font-weight:600}
.hint{color:var(--subtle)}
.cur{margin-left:8px}
.hnote{margin:0;padding:10px 18px;font-size:13px;color:var(--accent-text);background:var(--accent-soft);border-bottom:1px solid var(--border)}
@media (max-width:760px){
  .stack table,.stack tbody,.stack tr,.stack td{display:block;width:auto}
  .stack thead{display:none}
  .stack tr{padding:10px 16px;border-bottom:1px solid var(--divider)}
  .stack td{padding:2px 0;border:0;text-align:left !important}
  .stack td[data-label]::before{content:attr(data-label);display:inline-block;min-width:84px;margin-right:8px;font-size:12px;color:var(--subtle);font-weight:500}
  .stack td:first-child::before{display:none}
}
</style>
