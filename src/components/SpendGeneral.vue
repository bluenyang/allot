<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { store } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import { monthShort } from '../lib/format'
import { num, spendState, spendingIn, today, ymOf, ymd, type SpendStateName } from '../lib/calc'
import type { PayBy, Spending } from '../data/types'
import Seg from './Seg.vue'
import Select from './Select.vue'
import SpendEditor from './SpendEditor.vue'

// 일반 tab (spec 011 S-6, S-7): the lump-sum spendings as a table (a card list on the phone), three summary
// cards, filters. Everything shown is worked out here from the store through calc.ts: the state by `spendState`,
// the month sums by `spendingIn`. The edit button opens SpendEditor (W-7).
const now = today()
const nowYmd = ymd(now)
const ym = ymOf(now)
const OFF = new Set<string>() // `spendState` reads the holiday set only when a spending has no live round; a lump always has one

const editing = ref<Spending | null>(null)
const general = computed(() => store.spendings.filter((s) => s.how === 'lump'))
const round = (s: Spending) => s.rounds.find((r) => r.state !== 'merged') ?? s.rounds[0]
const krw = (s: Spending) => s.rounds.filter((r) => r.state !== 'merged').reduce((a, r) => a + r.amount, 0)
const mon = (d: string) => monthShort(Number(d.slice(5, 7)))
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const orig = (s: Spending) => (s.currency === 'USD' ? `USD ${s.amount.toFixed(2)}` : `KRW ${num(s.amount)}`)
const payName = (p: PayBy) => t(`spending.gen.pay.${p}` as 'spending.gen.pay.card')
/** A card lump sum names its card when it has one (spec 013 S-13). */
const cardLump = (s: Spending) => {
  const c = s.cardId ? store.cards.find((x) => x.id === s.cardId) : undefined
  return c ? t('spending.gen.cardLumpNamed', { card: c.name + (c.last4 ? ` ${c.last4}` : '') }) : t('spending.gen.pay.cardLump')
}

const rows = computed(() =>
  general.value.map((s) => {
    const r = round(s)
    const st = spendState(s, nowYmd, store.settings, OFF)
    // a cancelled spending keeps only its paid rounds in the month sums (S-5): a left round of it counts nowhere
    const counted = !!r && !(s.cancelled && r.state === 'left')
    const where = !counted ? t('spending.gen.where.none')
      : s.payBy === 'card' ? t('spending.gen.where.card', { date: md(r!.date) })
      : s.payBy === 'subs' ? t('spending.gen.where.subs') : t('spending.gen.where.salary')
    return {
      s, st, krw: krw(s), orig: orig(s), where, month: counted ? mon(r!.date) : '—', rym: r?.date.slice(0, 7) ?? '',
      pay: s.payBy === 'card' ? cardLump(s) : payName(s.payBy),
    }
  }).sort((a, b) => (a.s.bought < b.s.bought ? -1 : a.s.bought > b.s.bought ? 1 : a.s.name.localeCompare(b.s.name))),
)
type Row = (typeof rows.value)[number]
const PILL: Record<SpendStateName, string> = { paid: 'ok', billing: 'warn', planned: 'mute', cancelled: 'mute' }

// ---------- filters ----------
const status = ref<'all' | 'plan' | 'paid' | 'cancelled'>('all')
const pay = ref<'' | PayBy>('')
const cat = ref('')
const inStatus = (r: Row, id: string) => id === 'all' || (id === 'plan' ? r.st === 'planned' || r.st === 'billing' : r.st === id)
const statusOpts = computed(() => (['all', 'plan', 'paid', 'cancelled'] as const).map((id) => ({
  id, label: t(`spending.gen.filter.${id}` as 'spending.gen.filter.all'), count: rows.value.filter((r) => inStatus(r, id)).length,
})))
const cats = computed(() => [...new Set(general.value.map((s) => s.category))].sort((a, b) => a.localeCompare(b)))
const catSel = computed(() => (cats.value.includes(cat.value) ? cat.value : '')) // a category that no spending has any more is no filter
const shown = computed(() => rows.value.filter((r) => inStatus(r, status.value) && (!pay.value || r.s.payBy === pay.value) && (!catSel.value || r.s.category === catSel.value)))
const payOpts = computed(() => [{ value: '', label: t('spending.gen.payAll') }, ...(['card', 'salary', 'subs'] as const).map((p) => ({ value: p, label: payName(p) }))])
const catOpts = computed(() => [{ value: '', label: t('spending.gen.catAll') }, ...cats.value.map((c) => ({ value: c, label: c }))])

// ---------- the three cards (real values, S-7) ----------
const names = (list: Spending[]) => { const u = [...new Set(list.map((s) => s.name))]; return u.slice(0, 2).join(' · ') + (u.length > 2 ? ` +${u.length - 2}` : '') }
const live = computed(() => general.value.filter((s) => !s.cancelled))

// 1) this month: what the general spendings put on the month (spendingIn): off the remainder and onto the subscription transfer
const k1 = computed(() => {
  const m = spendingIn(general.value, ym)
  const total = m.remainder + m.subs
  const list = [...new Map(m.items.map((i) => [i.spending.id, i.spending])).values()]
  return { total, rem: m.remainder, subs: m.subs, n: list.length, names: names(list) }
})

// 2) upcoming: not cancelled, not paid, counted in a month after this one; sums by month
const k2 = computed(() => {
  const by = new Map<string, { sum: number; list: Spending[] }>()
  for (const r of rows.value) {
    if ((r.st !== 'planned' && r.st !== 'billing') || r.rym <= ym) continue
    const g = by.get(r.rym) ?? { sum: 0, list: [] }
    g.sum += r.krw
    g.list.push(r.s)
    by.set(r.rym, g)
  }
  const months = [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([m, g]) => ({ m, ...g }))
  const total = months.reduce((a, g) => a + g.sum, 0)
  const n = months.reduce((a, g) => a + g.list.length, 0)
  const max = Math.max(0, ...months.map((g) => g.sum))
  const colors = ['var(--primary)', 'var(--accent)', 'var(--primary-mid)', 'var(--subtle)']
  const head = months.length > 4 ? months.slice(0, 3) : months
  const tail = months.length > 4 ? months.slice(3) : []
  const progs = head.map((g, i) => ({ label: `${mon(`${g.m}-01`)} · ${g.list.map((s) => s.name).join(', ')}`, v: g.sum, w: max ? (g.sum / max) * 100 : 0, c: colors[i % colors.length]! }))
  if (tail.length) {
    const sum = tail.reduce((a, g) => a + g.sum, 0)
    progs.push({ label: t('spending.gen.later', { n: tail.length }), v: sum, w: max ? (sum / max) * 100 : 0, c: colors[3]! })
  }
  const first = months[0], last = months[months.length - 1]
  const range = !first || !last ? '' : first.m === last.m ? mon(`${first.m}-01`) : `${mon(`${first.m}-01`)} ~ ${mon(`${last.m}-01`)}`
  return { total, n, range, progs }
})

// 3) by payment method: every spending that is not cancelled
const k3 = computed(() => {
  const sum = (p: PayBy) => live.value.filter((s) => s.payBy === p).reduce((a, s) => a + krw(s), 0)
  const parts = [
    { id: 'card', label: payName('card'), v: sum('card'), c: 'var(--primary)' },
    { id: 'salary', label: payName('salary'), v: sum('salary'), c: 'var(--accent)' },
    { id: 'subs', label: payName('subs'), v: sum('subs'), c: 'var(--primary-mid)' },
  ]
  const total = parts.reduce((a, p) => a + p.v, 0)
  return { parts, total, n: live.value.length }
})
const share = (v: number, total: number) => (total ? (v / total) * 100 : 0)
</script>

<template>
  <section class="page-gap gen">
    <section class="kp" :aria-label="t('spending.gen.summaryLabel')">
      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.gen.k1', { month: monthShort(Number(ym.slice(5, 7))) }) }}</span><span class="hint">{{ t('spending.gen.count', { n: k1.n }) }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k1.total) }}</b></div>
        <div class="hint">{{ k1.n ? k1.names : t('spending.gen.k1Empty') }}</div>
        <div class="kvis">
          <div class="kstack" role="img" :aria-label="t('spending.gen.k1Aria', { rem: fmtMoney(k1.rem), subs: fmtMoney(k1.subs) })">
            <template v-if="k1.total"><span v-if="k1.rem" :style="{ width: `${share(k1.rem, k1.total)}%`, background: 'var(--primary)' }"></span><span v-if="k1.subs" :style="{ width: `${share(k1.subs, k1.total)}%`, background: 'var(--primary-mid)' }"></span></template>
            <span v-else class="none"></span>
          </div>
          <div class="klg"><span><i style="background:var(--primary)"></i>{{ t('spending.gen.fromRem') }} <b class="num">{{ fmtMoney(k1.rem) }}</b></span><span><i style="background:var(--primary-mid)"></i>{{ t('spending.gen.toSubs') }} <b class="num">{{ fmtMoney(k1.subs) }}</b></span></div>
        </div>
      </div>

      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.gen.k2') }}</span><span class="hint">{{ t('spending.gen.count', { n: k2.n }) }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k2.total) }}</b><span class="num">{{ k2.range }}</span></div>
        <div class="hint">{{ t('spending.gen.k2Sub') }}</div>
        <div class="kvis kprogs">
          <div v-for="g in k2.progs" :key="g.label">
            <div class="krow"><span class="kl">{{ g.label }}</span><b class="num">{{ fmtMoney(g.v) }}</b></div>
            <div class="prog"><i :style="{ width: `${g.w}%`, background: g.c }"></i></div>
          </div>
          <template v-if="!k2.progs.length"><div class="krow"><span class="kl">{{ t('spending.gen.k2Empty') }}</span></div><div class="prog"></div></template>
        </div>
      </div>

      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.gen.k3') }}</span><span class="hint">{{ t('spending.gen.k3Badge', { n: k3.n }) }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k3.total) }}</b></div>
        <div class="hint">{{ t('spending.gen.k3Sub') }}</div>
        <div class="kvis">
          <div class="kstack" role="img" :aria-label="k3.parts.map((p) => `${p.label} ${fmtMoney(p.v)}`).join(', ')">
            <template v-if="k3.total"><template v-for="p in k3.parts" :key="p.id"><span v-if="p.v" :style="{ width: `${share(p.v, k3.total)}%`, background: p.c }"></span></template></template>
            <span v-else class="none"></span>
          </div>
          <div class="klg"><span v-for="p in k3.parts" :key="p.id"><i :style="{ background: p.c }"></i>{{ p.label }} <b class="num">{{ fmtMoney(p.v) }}</b></span></div>
        </div>
      </div>
    </section>

    <section class="card pane">
      <div class="frow">
        <Seg v-model="status" :options="statusOpts" :label="t('spending.gen.byStatus')" />
        <span class="vr" aria-hidden="true"></span>
        <Select v-model="pay" class="fsel" :aria-label="t('spending.gen.payLabel')" :options="payOpts" />
        <Select :model-value="catSel" class="fsel" :aria-label="t('spending.gen.catLabel')" :options="catOpts" @update:model-value="(v: string) => (cat = v)" />
        <span class="hint count">{{ t('spending.gen.countLine', { n: shown.length }) }}</span>
      </div>

      <div class="tbl dtable">
        <table class="gen-t">
          <thead><tr>
            <th scope="col">{{ t('spending.gen.col.content') }}</th>
            <th scope="col" class="c">{{ t('spending.gen.col.category') }}</th>
            <th scope="col">{{ t('spending.gen.col.bought') }}</th>
            <th scope="col" class="n">{{ t('spending.gen.col.amount') }}</th>
            <th scope="col" class="n">{{ t('spending.gen.col.krw') }}</th>
            <th scope="col">{{ t('spending.gen.col.pay') }}</th>
            <th scope="col">{{ t('spending.gen.col.reflect') }}</th>
            <th scope="col" class="c">{{ t('spending.gen.col.state') }}</th>
            <th scope="col" class="n"><span class="sr">{{ t('common.edit') }}</span></th>
          </tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.s.id" :class="{ off: r.st === 'cancelled' }">
              <td><b class="nm">{{ r.s.name }}</b><small class="hint">{{ r.s.note || '—' }}</small></td>
              <td class="c"><span class="pill tag">{{ r.s.category }}</span></td>
              <td class="mono">{{ fmtDate(r.s.bought) }}</td>
              <td class="n mono cell2">{{ r.orig }}</td>
              <td class="n amt">{{ fmtMoney(r.krw) }}</td>
              <td class="cell2">{{ r.pay }}</td>
              <td><span class="blk">{{ r.month }}</span><small class="hint">{{ r.where }}</small></td>
              <td class="c"><span class="pill" :class="PILL[r.st]">{{ t(`spending.gen.state.${r.st}` as 'spending.gen.state.paid') }}</span></td>
              <td class="n"><button class="btn sm ghost" type="button" :aria-label="t('common.editLabel', { name: r.s.name })" @click="editing = r.s">{{ t('common.edit') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul class="mlist">
        <li v-for="r in shown" :key="r.s.id" class="mcard" :class="{ off: r.st === 'cancelled' }">
          <div class="m1"><span class="m-name"><b>{{ r.s.name }}</b> <small class="hint">{{ r.s.category }}</small></span><b class="num m-amt">{{ fmtMoney(r.krw) }}</b></div>
          <div class="m2"><span>{{ r.pay }} · {{ r.month }}</span><span class="pill" :class="PILL[r.st]">{{ t(`spending.gen.state.${r.st}` as 'spending.gen.state.paid') }}</span></div>
          <div class="m3"><span class="mono hint">{{ fmtDate(r.s.bought) }} · {{ r.orig }}</span><button class="btn sm" type="button" :aria-label="t('common.editLabel', { name: r.s.name })" @click="editing = r.s">{{ t('common.edit') }}</button></div>
        </li>
      </ul>

      <div v-if="!shown.length" class="empty"><b>{{ t('spending.emptyTitle') }}</b><span class="hint">{{ t('spending.emptyGeneral') }}</span></div>
      <p class="foot">{{ t('spending.gen.footA', { day: store.settings.billingDay }) }}<RouterLink class="lnkbtn" to="/spend/inst">{{ t('spending.tabs.inst') }}</RouterLink>{{ t('spending.gen.footB') }}</p>
    </section>
    <SpendEditor v-if="editing" :initial="editing" @close="editing = null" />
  </section>
</template>

<style scoped>
.kp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kcard{padding:14px 18px;display:flex;flex-direction:column;gap:2px;min-height:148px;min-width:0}
.k1{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--muted)}
.k2{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px}
.k2 > b{font-size:20px;font-weight:700;overflow-wrap:anywhere}
.k2 > span{font-size:13px;font-weight:600;color:var(--text-2)}
.hint{font-size:12px;color:var(--subtle)}
.kvis{margin-top:auto;padding-top:12px;display:flex;flex-direction:column;gap:6px}
.kprogs{gap:8px}
.krow{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin-bottom:4px}
.krow .kl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krow b{color:var(--text);font-weight:600;flex:none}
.kstack{display:flex;height:10px;gap:2px;border-radius:2px;overflow:hidden}
.kstack .none{flex:1;background:var(--fill)}
.klg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}
.klg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
.klg b{color:var(--text);font-weight:600}
.prog{height:6px;border-radius:3px;background:var(--fill);overflow:hidden;display:block}
.prog i{display:block;height:100%}
.pane{overflow:hidden}
.frow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.vr{width:1px;height:24px;background:var(--border)}
.count{margin-left:auto}
.pane .tbl{border:0;border-radius:0}
.gen-t{min-width:1000px}
.gen-t th.c,.gen-t td.c{text-align:center}
.gen-t td b.nm{display:block;font-weight:600;overflow-wrap:anywhere}
.gen-t td small{display:block}
.gen-t td .blk{display:block}
.gen-t td.cell2{color:var(--muted)}
.gen-t td.n.mono{font-weight:400;font-size:12px}
.gen-t td.amt{font-weight:600}
.gen-t tr.off td{color:var(--subtle)}
.gen-t tr.off td .hint{color:var(--subtle)}
.pill.tag{font-weight:500}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.mlist{display:none;list-style:none;margin:0;padding:0}
.mcard{display:flex;flex-direction:column;gap:6px;padding:12px 16px;border-bottom:1px solid var(--divider)}
.mcard.off{color:var(--subtle)}
.m1,.m2,.m3{display:flex;justify-content:space-between;align-items:center;gap:8px}
.m1{align-items:baseline;gap:12px}
.m-name{min-width:0;overflow-wrap:anywhere}
.m2{font-size:12px;color:var(--muted)}
.m3 .btn{height:36px;flex:none}
.m3 > span{min-width:0;overflow-wrap:anywhere}
.empty{display:flex;flex-direction:column;align-items:center;gap:2px;padding:32px 18px;text-align:center;color:var(--muted)}
.empty b{color:var(--text)}
.foot{margin:0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2);border-top:1px solid var(--divider)}
.lnkbtn{font-weight:600;text-decoration:none}
.lnkbtn:hover{text-decoration:underline}
@media (max-width:760px){
  .kp{grid-template-columns:minmax(0,1fr)}
  .dtable,.vr{display:none}
  .mlist{display:block}
  .frow .count{margin-left:0;flex-basis:100%}
}
</style>
