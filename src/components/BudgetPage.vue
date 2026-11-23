<script setup lang="ts">
// The template of the Living, Savings and Investment pages (spec 013 S-1, canvas AppLiving · AppSave ·
// AppInvest): the header (title, description, "월급 분배 보기", add), the "들어오는 돈" strip (three cells
// and the split cell from the `split` slot; a `notice` slot above them), three KPI cards, the item list with
// a share bar, the total row with its status line, and the note under the list. A page with `tabs` (rc.2, S-15: the
// Savings 만기 일정, the Living and Investment 월별 기록) gets a tab row under the KPIs: the first tab is the list, any
// other draws the page's `tab` slot. Without `tabs` no tab row is drawn. It only draws: the pages compute every value.
import { RouterLink } from 'vue-router'
import { t } from '../i18n'
import Icon from './Icon.vue'
import PageHeader from './PageHeader.vue'
import SubTabs from './SubTabs.vue'
import type { BudgetCell, BudgetKpi, BudgetRow, Tone } from '../lib/budget-page'

defineProps<{
  title: string
  desc: string
  addLabel: string
  cells: BudgetCell[]
  splitLabel: string
  kpis: BudgetKpi[]
  listTitle: string
  sumLine: string
  cols: { name: string; amount: string; meta: string; prog: string }
  rows: BudgetRow[]
  /** the share bar: each row's width in percent; `gap` = the part of the total no item takes */
  bar: { id: string; name: string; w: number; color: string; share: string }[]
  gap: number
  total: { amount: string; msg: string; tone: Tone }
  note: string
  /** the tab row (the first tab is the list); v-model:tab */
  tabs?: { id: string; label: string; icon?: string }[]
  tab?: string
}>()
const emit = defineEmits<{ add: []; edit: [id: string]; action: [index: number]; 'update:tab': [id: string] }>()
const toneClass = (tone?: Tone) => (tone && tone !== 'muted' ? `t-${tone}` : '')
</script>

<template>
  <section class="page-gap bpage">
    <PageHeader :title="title" :desc="desc">
      <RouterLink class="btn" to="/pay">{{ t('budget.linkPay') }}</RouterLink>
      <button class="btn pri" type="button" @click="emit('add')"><Icon name="plus" :stroke="1.9" />{{ addLabel }}</button>
    </PageHeader>

    <section class="card bsrc" :aria-label="t('budget.srcAria')">
      <slot name="notice" />
      <div class="cells">
        <div v-for="(c, i) in cells" :key="i" class="cell">
          <span class="cl">{{ c.label }}</span>
          <span class="cv-row">
            <b class="cv num" :class="{ big: i === 0 }">{{ c.value }}</b>
            <button v-if="c.action" class="btn sm ghost act" type="button" :aria-label="c.action.aria" @click="emit('action', i)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>{{ c.action.label }}
            </button>
          </span>
          <span v-if="c.sub" class="hint">{{ c.sub }}</span>
        </div>
        <div class="cell">
          <span class="cl">{{ splitLabel }}</span>
          <slot name="split" />
        </div>
      </div>
    </section>

    <section class="kp" :aria-label="t('budget.kpiAria')">
      <div v-for="(k, i) in kpis" :key="i" class="card kcard">
        <span class="kl">{{ k.label }}</span>
        <div class="kv num" :class="toneClass(k.tone)">{{ k.value }}</div>
        <div class="hint">{{ k.sub }}</div>
        <div v-if="k.progs?.length" class="kvis">
          <div v-for="(g, j) in k.progs" :key="j">
            <div class="krow"><span>{{ g.label }}</span><b class="num">{{ g.value }}</b></div>
            <div class="prog"><i :class="toneClass(g.tone)" :style="{ width: `${g.w}%` }"></i></div>
          </div>
        </div>
      </div>
    </section>

    <SubTabs v-if="tabs?.length" :model-value="tab ?? tabs[0]!.id" :tabs="tabs" :label="title" @update:model-value="emit('update:tab', $event)" />
    <slot v-if="tabs?.length && (tab ?? tabs[0]!.id) !== tabs[0]!.id" name="tab" />

    <section v-else class="card blist">
      <div class="card-hd"><h2>{{ listTitle }}</h2><span class="aux num">{{ sumLine }}</span></div>
      <div v-if="rows.length" class="sbar-w">
        <div class="sbar" role="img" :aria-label="bar.map((b) => `${b.name} ${b.share}`).join(', ')">
          <span v-for="b in bar" :key="b.id" :style="{ width: `${b.w}%`, background: b.color }"></span>
          <span v-if="gap > 0" :style="{ width: `${gap}%`, background: 'var(--border)' }"></span>
        </div>
        <div class="slg">
          <span v-for="b in bar" :key="b.id"><i :style="{ background: b.color }" aria-hidden="true"></i>{{ b.name }} <b class="num">{{ b.share }}</b></span>
        </div>
      </div>
      <div class="irow hd" aria-hidden="true"><span>{{ cols.name }}</span><span class="r">{{ cols.amount }}</span><span>{{ cols.meta }}</span><span>{{ cols.prog }}</span><span></span></div>
      <ul class="ilist">
        <li v-for="r in rows" :key="r.id" class="irow" :data-testid="`item-${r.id}`">
          <div class="nm">
            <span class="dot" :style="{ background: r.color }" aria-hidden="true"></span>
            <div class="nm-t">
              <div class="nm-l"><b>{{ r.name }}</b><span v-if="r.tag" class="pill tag">{{ r.tag }}</span><span v-for="f in r.flags" :key="f" class="pill flag">{{ f }}</span></div>
              <div v-if="r.line" class="hint">{{ r.line }}</div>
            </div>
          </div>
          <div class="r"><b class="num am">{{ r.main }}</b><div class="hint num">{{ r.sub }}</div></div>
          <div class="full meta">{{ r.meta }}</div>
          <div class="full pr">
            <div v-if="r.prog.w !== null" class="prog"><i :class="toneClass(r.prog.tone)" :style="{ width: `${r.prog.w}%` }"></i></div>
            <span class="hint num" :class="toneClass(r.prog.tone)">{{ r.prog.text }}</span>
          </div>
          <button class="btn sm ghost icon ed" type="button" :aria-label="t('budget.editItem', { name: r.name })" :title="t('common.edit')" @click="emit('edit', r.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
        </li>
      </ul>
      <p v-if="!rows.length" class="empty-l hint">{{ t('budget.empty', { add: addLabel }) }}</p>
      <div class="tot">
        <b>{{ t('budget.sum') }}</b><b class="num">{{ total.amount }}</b>
        <span class="tmsg" :class="toneClass(total.tone)" data-testid="budget-status">{{ total.msg }}</span>
        <span class="sp"></span>
        <button class="btn sm" type="button" @click="emit('add')"><Icon name="plus" :stroke="1.9" />{{ addLabel }}</button>
      </div>
    </section>
    <p v-if="note && (!tabs?.length || (tab ?? tabs[0]!.id) === tabs[0]!.id)" class="bnote">{{ note }}</p>
    <!-- the page's editors (they open in their own dialog layer) -->
    <slot />
  </section>
</template>

<style scoped>
.bpage :deep(.ph-a){display:flex;gap:8px;flex-wrap:wrap}
.bpage :deep(.ph-a) .btn svg{width:16px;height:16px}
.bsrc{overflow:hidden}
.cells{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.cell{padding:14px 18px;border-left:1px solid var(--divider);display:flex;flex-direction:column;gap:4px;min-width:0}
.cell:first-child{border-left:0}
.cl{font-size:12px;font-weight:600;color:var(--subtle)}
.cv-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cv{font-size:15px;overflow-wrap:anywhere}
.cv.big{font-size:20px}
.act{color:var(--primary-text);padding:0 6px}
.act svg{width:15px;height:15px}
.kp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kcard{padding:14px 18px;display:flex;flex-direction:column;gap:2px;min-height:136px}
.kl{font-size:12px;font-weight:600;color:var(--muted)}
.kv{margin-top:4px;font-size:20px;font-weight:700}
.kvis{margin-top:auto;padding-top:12px;display:flex;flex-direction:column;gap:6px}
.krow{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin-bottom:4px}
.krow b{color:var(--text);font-weight:600}
.prog{height:6px;border-radius:3px;background:var(--fill);overflow:hidden}
.prog i{display:block;height:100%;background:var(--primary)}
.prog i.t-warn{background:var(--accent)}
.prog i.t-bad{background:var(--neg)}
.t-ok{color:var(--primary-text)}
.t-warn{color:var(--accent-text)}
.t-bad{color:var(--neg-text)}
.sbar-w{padding:14px 18px 4px}
.sbar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--fill)}
.slg{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px;color:var(--muted)}
.slg span{display:inline-flex;align-items:center;gap:6px}
.slg i{width:8px;height:8px;border-radius:2px}
.slg b{color:var(--text)}
.ilist{list-style:none;margin:0;padding:0}
.irow{display:grid;grid-template-columns:minmax(0,1.5fr) 150px minmax(0,1.3fr) minmax(0,1.3fr) 36px;gap:16px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--divider)}
.irow.hd{margin-top:10px;padding:8px 18px;font-size:12px;font-weight:600;color:var(--subtle);background:var(--surface-2)}
.irow .r{text-align:right}
.irow .am{font-size:15px}
.nm{display:flex;align-items:flex-start;gap:10px;min-width:0}
.dot{flex:none;width:10px;height:10px;border-radius:3px;margin-top:5px}
.nm-t{min-width:0}
.nm-l{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.nm-l b{overflow-wrap:anywhere}
.pill.tag{background:var(--fill);color:var(--muted)}
.pill.flag{background:var(--accent-soft);color:var(--accent-text)}
.meta{font-size:12px;color:var(--text-2);line-height:1.5;overflow-wrap:anywhere}
.pr{display:flex;flex-direction:column;gap:5px;min-width:0}
.ed{width:32px;padding:0}
.ed svg{width:15px;height:15px}
.empty-l{margin:0;padding:16px 18px;border-bottom:1px solid var(--divider)}
.tot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 18px;background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card)}
.tmsg{font-size:13px;font-weight:600;color:var(--muted)}
.tot .sp{flex:1}
.tot .btn svg{width:16px;height:16px}
.bnote{margin:0;padding:12px 16px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);font-size:13px;color:var(--muted);line-height:1.6}
@media (max-width:760px){
  .cells{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cell:nth-child(3){border-left:0}
  .cell:nth-child(n+3){border-top:1px solid var(--divider)}
  .kp{grid-template-columns:minmax(0,1fr)}
  .kcard{min-height:0}
  .irow{grid-template-columns:minmax(0,1fr) auto 32px;gap:6px 10px;padding:12px 16px}
  .irow.hd{display:none}
  .irow .full{grid-column:1 / -1}
  .irow .ed{grid-column:3;grid-row:1}
}
</style>
