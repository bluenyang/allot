<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { store, upsertSpending } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { monthShort } from '../lib/format'
import { addYm, billingDayOf, cardBillDate, cardBillYm, needsHolidays, spendingIn, spendingKrw, ymLabel } from '../lib/calc'
import { monthBasis, roundYmOf, thisYm, ymOfDay } from '../lib/month'
import type { Card, PayBy, Spending, SpendingRound } from '../data/types'
import ConfirmDialog from './ConfirmDialog.vue'
import PayOffDialog from './PayOffDialog.vue'
import RoundEditor from './RoundEditor.vue'
import Seg from './Seg.vue'
import Select from './Select.vue'
import SpendEditor from './SpendEditor.vue'
import { downloadCsv } from '../lib/csv'
import { spendingCsvRows } from '../lib/spending-csv'

// 할부 tab (spec 011 S-4, S-6, S-7): the installment and split spendings as a list with the one picked shown
// beside it (stacked on a phone), three summary cards and the rounds table. Every number is worked out here
// from the store through calc.ts: the month sums by `spendingIn`, the principal by `spendingKrw`. A change to a
// round, an early payoff and a cancel are each one `upsertSpending` of the whole spending (its rounds travel in
// the body); the editors are RoundEditor and PayOffDialog. The whole-spending editor is SpendEditor (W-7).
// A buffer use (spec 013 S-8) is listed here too: its rounds are the refills, taken off the remainder of their months.
const ym = thisYm()
// the month a date lies in: the one whose period holds it (spec 018 S-3)
const mon = (d: string) => monthShort(Number(ymOfDay(d).slice(5, 7)))
// a month's short name, from its name (YYYY-MM)
const monOf = (m: string) => monthShort(Number(m.slice(5, 7)))
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const ymText = (d: string) => ymLabel(ymOfDay(d)).replace('.', '. ')
const payName = (p: PayBy) => t(`spending.gen.pay.${p}` as 'spending.gen.pay.card')
/** The card bill date of a buffer use (its note): the first billing date after the card's usage period, moved for holidays as the editor does. */
function billOf(s: Spending, card: Card | null) {
  // the card's own billing month (a calendar month: the card's schedule does not follow the month basis)
  const ym = cardBillYm(s.bought, card, store.settings)
  const off = !needsHolidays(store.settings, store.schedules) ? new Set<string>() : offDays(store.holidaySets, `${addYm(ym, -1)}-01`, `${addYm(ym, 2)}-01`) ?? new Set<string>()
  return cardBillDate(s.bought, card, store.settings, off)
}

const inst = computed(() => store.spendings.filter((s) => s.how !== 'lump'))
/** The KRW principal as it was fixed when the spending was saved: its own rate and buffer, never today's settings (S-3). */
const principalOf = (s: Spending) =>
  spendingKrw(s.amount, s.currency, { fxRate: s.fxRate ?? store.settings.fxRate, fxBuffer: s.fxBuffer ?? store.settings.fxBuffer })
/** The total: the principal plus the fee (only a card installment has one). */
const totalOf = (s: Spending) => principalOf(s) + (s.how === 'installment' && s.payBy === 'card' ? s.fee : 0)

const items = computed(() => inst.value.map((s) => {
  const live = s.rounds.filter((r) => r.state !== 'merged').sort((a, b) => a.no - b.no)
  const left = live.filter((r) => r.state === 'left')
  const paid = live.filter((r) => r.state === 'paid')
  const next = s.cancelled ? undefined : left[0]
  const last = live[live.length - 1]
  const sum = (l: SpendingRound[]) => l.reduce((a, r) => a + r.amount, 0)
  return {
    s, live, left, paid, next, last, n: live.length, paidN: paid.length, leftSum: sum(left), paidSum: sum(paid), liveSum: sum(live),
    done: !left.length, active: !s.cancelled && !!left.length,
  }
}))
type Item = (typeof items.value)[number]

// ---------- filters and the list (next round first; the ones with none last, latest ended first) ----------
const status = ref<'on' | 'done' | 'all'>('on')
const how = ref<'' | 'installment' | 'split' | 'buffer'>('')
const inStatus = (i: Item, id: string) => id === 'all' || (id === 'on' ? i.active : i.done)
const statusOpts = computed(() => (['on', 'done', 'all'] as const).map((id) => ({ id, label: t(`spending.inst.filter.${id}` as 'spending.inst.filter.on'), count: items.value.filter((i) => inStatus(i, id)).length })))
const howOpts = computed(() => [
  { value: '', label: t('spending.inst.how.all') },
  { value: 'installment', label: t('spending.inst.how.installment') },
  { value: 'split', label: t('spending.inst.how.split') },
  { value: 'buffer', label: t('spending.inst.how.buffer') },
])
const shown = computed(() => items.value
  .filter((i) => inStatus(i, status.value) && (!how.value || i.s.how === how.value))
  .sort((a, b) => {
    const x = a.next?.date, y = b.next?.date
    if (x && y) return x < y ? -1 : x > y ? 1 : a.s.name.localeCompare(b.s.name)
    if (x || y) return x ? -1 : 1
    const p = a.last?.date ?? '', q = b.last?.date ?? ''
    return p < q ? 1 : p > q ? -1 : a.s.name.localeCompare(b.s.name)
  }))

/** The page's CSV button (spec 013 S-17): the spendings shown with these filters, one row per round. */
function exportCsv() { downloadCsv(`allot-spending-installments-${ym}.csv`, spendingCsvRows(shown.value.map((i) => i.s))) }
defineExpose({ exportCsv })

const picked = ref('')
const sel = computed(() => shown.value.find((i) => i.s.id === picked.value) ?? shown.value[0])

const howText = (s: Spending) => `${t(`spending.inst.howText.${s.how as 'installment'}`, { n: s.count })}${s.how === 'installment' ? ` · ${s.fee > 0 ? t('spending.inst.withFee') : t('spending.inst.free')}` : ''}`
const row = (i: Item) => {
  const r = i.next ?? i.last
  return {
    i, name: i.s.name, how: howText(i.s), each: fmtMoney(r?.amount ?? 0), eachLbl: t(`spending.inst.eachLbl.${i.s.how as 'installment'}`),
    done: t('spending.inst.progress', { done: i.paidN, n: i.n }), w: i.n ? (i.paidN / i.n) * 100 : 0,
    next: i.next ? t('spending.inst.next', { date: md(i.next.date) }) : i.s.cancelled && i.left.length ? t('spending.inst.cancelledNext') : t('spending.inst.finished', { ym: i.last ? ymText(i.last.date) : '—' }),
    late: !!i.next,
  }
}
const list = computed(() => shown.value.map(row))

// ---------- the three cards (S-7) ----------
const k1 = computed(() => {
  const on = items.value.filter((i) => i.active)
  const card = on.filter((i) => i.s.how === 'installment').length
  const buffer = on.filter((i) => i.s.how === 'buffer').length
  return {
    n: on.length, left: on.reduce((a, i) => a + i.leftSum, 0),
    sub: t('spending.inst.k1Sub', { card, split: on.length - card - buffer }) + (buffer ? t('spending.inst.k1SubBuffer', { n: buffer }) : ''),
    progs: on.map((i) => ({ label: t('spending.inst.progLabel', { name: i.s.name, done: i.paidN, n: i.n }), v: i.leftSum, w: i.n ? (i.paidN / i.n) * 100 : 0 })),
  }
})
const k2 = computed(() => {
  const months = Array.from({ length: 6 }, (_, k) => addYm(ym, k))
  const per = months.map((m) => { const x = spendingIn(inst.value, m, monthBasis.value); return { m, v: x.remainder + x.subs, n: x.items.length } })
  const max = Math.max(0, ...per.map((p) => p.v))
  const top = max ? per.find((p) => p.v === max) : undefined
  const first = months[0]!, last = months[months.length - 1]!
  const mname = (m: string) => monthShort(Number(m.slice(5, 7)))
  return {
    badge: `${mname(first)} ~ ${mname(last)}`, value: per[0]!.v, right: `${mname(per[1]!.m)} ${fmtMoney(per[1]!.v)}`,
    sub: t('spending.inst.k2Sub', { now: per[0]!.n, next: per[1]!.n }) + (top ? t('spending.inst.k2Top', { month: mname(top.m) }) : ''),
    axisL: mname(first), axisR: mname(last), aria: per.map((p) => `${mname(p.m)} ${fmtMoney(p.v)}`).join(', '),
    bars: per.map((p, k) => ({ h: max ? Math.max((p.v / max) * 100, 4) : 4, c: k === 0 ? 'var(--accent)' : p.v === max && max ? 'var(--primary)' : 'var(--primary-mid)', t: `${mname(p.m)} ${fmtMoney(p.v)}` })),
  }
})
const k3 = computed(() => {
  const live = items.value.filter((i) => !i.s.cancelled && i.s.how === 'installment')
  const fees = live.filter((i) => i.s.fee > 0)
  const fee = fees.reduce((a, i) => a + i.s.fee, 0)
  const principal = fees.reduce((a, i) => a + totalOf(i.s) - i.s.fee, 0)
  const sum = principal + fee
  return {
    fee, n: fees.length, free: live.length - fees.length, right: fees.length === 1 ? fees[0]!.s.name : fees.length ? t('spending.inst.count', { n: fees.length }) : '',
    principal, w1: sum ? (principal / sum) * 100 : 0, w2: sum ? (fee / sum) * 100 : 0,
  }
})

// ---------- the one picked ----------
const d = computed(() => {
  const i = sel.value
  if (!i) return null
  const s = i.s
  const totalSub = s.how === 'split' ? t('spending.inst.totalSplit') : s.how === 'buffer' ? t('spending.inst.totalBuffer') : s.fee > 0 ? t('spending.inst.totalFee', { p: fmtMoney(totalOf(s) - s.fee), f: fmtMoney(s.fee) }) : t('spending.inst.totalFree')
  const orig = s.rounds.filter((r) => r.no <= s.count).sort((a, b) => a.no - b.no)
  // the per-round amount is the first round that is neither edited nor the last (the last takes the odd won); with none, the first round
  const lastO = orig[orig.length - 1]
  const eachR = orig.find((r) => !r.edited && r !== lastO) ?? orig[0]
  const editedN = s.rounds.filter((r) => r.edited && r.state !== 'merged').length
  const lastDiffers = !!lastO && !!eachR && lastO !== eachR && lastO.amount !== eachR.amount
  const eachSub = [
    ...(lastDiffers ? [t('spending.inst.eachLast', { amount: fmtMoney(lastO!.amount) })] : []),
    ...(editedN ? [t('spending.inst.eachEdited', { n: editedN })] : []),
  ].join(' · ') || t('spending.inst.eachSame', { n: s.count })
  const end = i.last ? ymText(i.last.date) : '—'
  const leftSum = s.cancelled ? 0 : i.leftSum
  const leftSub = s.cancelled && i.left.length ? t('spending.inst.leftCancelled') : i.left.length ? t('spending.inst.leftN', { n: i.left.length, ym: end }) : t('spending.inst.leftDone', { ym: end })
  const stateName = s.cancelled ? 'cancelled' : i.done ? 'done' : 'active'
  const per = s.how === 'split'
    ? { monthly: t('spending.inst.interval.monthly', { day: Number(s.rounds[0]?.date.slice(8, 10) ?? 1) }), biweekly: t('spending.inst.interval.biweekly'), custom: t('spending.inst.interval.custom') }[s.interval ?? 'monthly']
    : ''
  // the card (spec 013 S-13): a chosen one names itself and its billing day; a buffer use names the account whose buffer pays
  const card = s.cardId ? store.cards.find((c) => c.id === s.cardId) ?? null : null
  const acc = card?.accountId ? store.accounts.find((a) => a.id === card.accountId) ?? null : null
  const cardLabel = card ? card.name + (card.last4 ? ` ${card.last4}` : '') : t('spending.gen.pay.card')
  const pay = s.how === 'buffer'
    ? (acc ? t('spending.inst.payBuffer', { card: cardLabel, account: acc.name, buffer: fmtMoney(acc.buffer ?? 0) }) : t('spending.inst.payBufferNone', { card: cardLabel }))
    : s.payBy === 'card'
      ? (card ? t('spending.inst.payCardNamed', { card: cardLabel, day: billingDayOf(card, store.settings) }) : t('spending.inst.pay.card', { day: store.settings.billingDay }))
      : `${t(`spending.inst.pay.${s.payBy}` as 'spending.inst.pay.salary')}${per ? ` · ${per}` : ''}`
  // a card installment counts with the pay before each bill (spec 018 S-5); a split, also one paid by card, on the dates it is paid
  const where = s.how === 'buffer' ? t('spending.inst.whereBuffer', { account: acc?.name ?? '—' })
    : t(`spending.inst.where.${s.how === 'split' && s.payBy === 'card' ? 'salary' : s.payBy}` as 'spending.inst.where.card')
  // an edited round or an early payoff may leave the rounds adding up to something else than the total (S-4)
  const total = totalOf(s)
  const diff = s.rounds.some((r) => r.edited || r.state === 'merged') ? i.liveSum - total : 0
  const fee = s.how === 'installment' && s.fee > 0 ? s.fee : 0
  const rem = lastO && eachR ? lastO.amount - eachR.amount : 0
  const notes = [
    s.cancelled ? t('spending.inst.noteCancelled') : i.done ? t('spending.inst.noteDone') : s.how === 'split' ? t('spending.inst.noteSplit')
    : s.how === 'buffer' ? t('spending.inst.noteBuffer', {
      total: fmtMoney(total), date: md(billOf(s, card)), account: acc?.name ?? '—',
      month: orig[0] ? mon(orig[0].date) : '—', each: fmtMoney(eachR?.amount ?? 0),
    })
    : t('spending.inst.noteCard'),
    ...(fee ? [t('spending.inst.noteFee', { fee: fmtMoney(fee), n: s.count })] : []),
    ...(!editedN && rem > 0 && s.how === 'installment' ? [t('spending.inst.noteRemainder', { amount: fmtMoney(rem) })] : []),
  ]
  const nextNo = i.next?.no
  const rounds = [...s.rounds].sort((a, b) => a.no - b.no).map((r) => {
    const st = r.state === 'merged' ? 'merged' : r.state === 'paid' ? 'paid' : r.no === nextNo ? 'next' : 'left'
    // the month that counts the round (spec 018 S-5); a card bill counted in another month than its date's says which month's allocation pays it
    const rym = roundYmOf(s, r)
    const m = monOf(rym)
    const none = r.state === 'merged' || (s.cancelled && r.state === 'left')
    const reflect = none ? t('spending.inst.reflectNone') : s.payBy === 'subs' ? t('spending.inst.reflectSubs', { month: m }) : t('spending.inst.reflectRem', { month: m })
    const paidIn = !none && rym !== ymOfDay(r.date) ? t('spending.paidIn', { month: m }) : ''
    return { r, st, label: roundLabel(s, r.no), reflect, paidIn, rym }
  })
  return {
    i, s, name: s.name, state: t(`spending.inst.state.${stateName}`), pill: stateName === 'active' ? 'ok' : 'mute',
    sub: `${howText(s)} · ${t(s.how === 'split' ? 'spending.inst.boughtSplit' : 'spending.inst.bought', { date: fmtDate(s.bought) })}`,
    total: fmtMoney(total), totalSub, each: fmtMoney(eachR?.amount ?? 0), eachSub,
    paid: fmtMoney(i.paidSum), paidSub: i.paidN ? t('spending.inst.paidN', { n: i.paidN }) : i.left[0] ? t('spending.inst.paidFrom', { date: md(i.left[0].date) }) : '—',
    left: fmtMoney(leftSum), leftSub, pay, where, notes, diff, rounds,
    leftN: i.left.length,
  }
})
function roundLabel(s: Spending, no: number) {
  return no <= s.count ? t('spending.inst.roundOf', { no, n: s.count }) : t('spending.inst.payoffRound')
}
const ST_PILL: Record<string, string> = { paid: 'ok', next: 'warn', left: 'mute', merged: 'mute' }
const diffText = computed(() => {
  const x = d.value?.diff ?? 0
  return !x ? '' : t(x > 0 ? 'spending.inst.diffMore' : 'spending.inst.diffLess', { amount: fmtMoney(Math.abs(x)) })
})

// ---------- editors: a round, an early payoff, a cancel ----------
const editing = ref<Spending | null>(null)
const roundNo = ref<number | null>(null)
const paying = ref(false)
const asking = ref(false)
const busy = ref(false)
const error = ref('')
async function setCancelled(cancelled: boolean) {
  const s = sel.value?.s
  if (!s) return
  busy.value = true
  error.value = ''
  try {
    await upsertSpending({ ...JSON.parse(JSON.stringify(s)) as Spending, cancelled })
    asking.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const pickItem = (id: string) => { picked.value = id; error.value = '' }
</script>

<template>
  <section class="page-gap inst">
    <!-- spec 014 S-8 (W-6): the first row is what goes out every month; what is left to pay and the fees are the second -->
    <section class="kp" :aria-label="t('spending.inst.summaryLabel')">
      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.inst.k2') }}</span><span class="hint">{{ k2.badge }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k2.value) }}</b><span class="num">{{ k2.right }}</span></div>
        <div class="hint">{{ k2.sub }}</div>
        <div class="kvis">
          <div class="kbars" role="img" :aria-label="k2.aria"><span v-for="(b, k) in k2.bars" :key="k" :style="{ height: `${b.h}%`, background: b.c }" :title="b.t"></span></div>
          <div class="kaxis"><span>{{ k2.axisL }}</span><span>{{ k2.axisR }}</span></div>
        </div>
      </div>
    </section>

    <section class="kp" :aria-label="t('spending.inst.laterLabel')">
      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.inst.k1') }}</span><span class="hint">{{ t('spending.inst.count', { n: k1.n }) }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k1.left) }}</b><span>{{ t('spending.inst.k1Right') }}</span></div>
        <div class="hint">{{ k1.n ? k1.sub : t('spending.inst.k1Empty') }}</div>
        <div v-if="k1.progs.length" class="kvis kprogs">
          <div v-for="(g, k) in k1.progs" :key="k">
            <div class="krow"><span class="kl">{{ g.label }}</span><b class="num">{{ fmtMoney(g.v) }}</b></div>
            <div class="prog"><i :style="{ width: `${g.w}%`, background: 'var(--primary)' }"></i></div>
          </div>
        </div>
      </div>

      <div class="card kcard">
        <div class="k1"><span>{{ t('spending.inst.k3') }}</span><span class="hint">{{ t('spending.inst.k3Badge', { n: k3.n }) }}</span></div>
        <div class="k2"><b class="num">{{ fmtMoney(k3.fee) }}</b><span>{{ k3.right }}</span></div>
        <div class="hint">{{ t('spending.inst.k3Sub', { free: k3.free }) }}</div>
        <div class="kvis">
          <div class="kstack" role="img" :aria-label="t('spending.inst.k3Aria', { p: fmtMoney(k3.principal), f: fmtMoney(k3.fee) })">
            <template v-if="k3.n"><span :style="{ width: `${k3.w1}%`, background: 'var(--primary)' }"></span><span :style="{ width: `${k3.w2}%`, background: 'var(--accent)' }"></span></template>
            <span v-else class="none"></span>
          </div>
          <div class="klg"><span><i style="background:var(--primary)"></i>{{ t('spending.inst.principal') }} <b class="num">{{ fmtMoney(k3.principal) }}</b></span><span><i style="background:var(--accent)"></i>{{ t('spending.inst.feeWord') }} <b class="num">{{ fmtMoney(k3.fee) }}</b></span></div>
        </div>
      </div>
    </section>

    <section class="card pane">
      <div class="frow">
        <Seg v-model="status" :options="statusOpts" :label="t('spending.inst.byStatus')" />
        <span class="vr" aria-hidden="true"></span>
        <Select v-model="how" class="fsel" :aria-label="t('spending.inst.howLabel')" :options="howOpts" />
        <span class="hint count">{{ t('spending.inst.order') }}</span>
      </div>

      <div v-if="!list.length" class="empty"><b>{{ t('spending.emptyTitle') }}</b><span class="hint">{{ t('spending.emptyInst') }}</span></div>
      <div v-else class="ig">
        <ul class="ilist" :aria-label="t('spending.inst.listLabel')">
          <li v-for="it in list" :key="it.i.s.id">
            <button type="button" class="ii" :class="{ on: sel?.s.id === it.i.s.id }" :aria-pressed="sel?.s.id === it.i.s.id" @click="pickItem(it.i.s.id)">
              <span class="ii-a"><b class="nm">{{ it.name }}</b><b class="num">{{ it.each }}</b></span>
              <span class="ii-b"><span>{{ it.how }}</span><span>{{ it.eachLbl }}</span></span>
              <span class="prog"><i :style="{ width: `${it.w}%`, background: it.i.done ? 'var(--muted)' : 'var(--primary)' }"></i></span>
              <span class="ii-b"><span class="num">{{ it.done }}</span><span class="num" :class="it.late ? 'late' : 'fin'">{{ it.next }}</span></span>
            </button>
          </li>
        </ul>

        <div v-if="d" class="idet">
          <div class="id-h">
            <div class="id-t1">
              <span class="id-n"><h2>{{ d.name }}</h2><span class="pill" :class="d.pill">{{ d.state }}</span></span>
              <small class="hint">{{ d.sub }}</small>
            </div>
            <div class="id-a">
              <button class="btn sm" type="button" :aria-label="t('common.editLabel', { name: d.name })" @click="editing = d.s">{{ t('common.edit') }}</button>
              <button v-if="d.leftN && !d.s.cancelled" class="btn sm" type="button" @click="paying = true">{{ t('spending.inst.payoff') }}</button>
              <button v-if="!d.s.cancelled" class="btn sm ghost cx" type="button" @click="asking = true">{{ t('spending.inst.cancel') }}</button>
              <button v-else class="btn sm" type="button" :disabled="busy" @click="setCancelled(false)">{{ t('spending.inst.resume') }}</button>
            </div>
          </div>
          <p v-if="error" class="err" role="alert">{{ error }}</p>
          <dl class="id-s">
            <div><dt>{{ t('spending.inst.total') }}</dt><dd class="num">{{ d.total }}</dd><small class="hint">{{ d.totalSub }}</small></div>
            <div><dt>{{ t('spending.inst.each') }}</dt><dd class="num">{{ d.each }}</dd><small class="hint">{{ d.eachSub }}</small></div>
            <div><dt>{{ t('spending.inst.paid') }}</dt><dd class="num">{{ d.paid }}</dd><small class="hint">{{ d.paidSub }}</small></div>
            <div><dt>{{ t('spending.inst.left') }}</dt><dd class="num lf">{{ d.left }}</dd><small class="hint">{{ d.leftSub }}</small></div>
          </dl>
          <div class="id-i"><span><span class="hint">{{ t('spending.inst.payLabel') }}</span> {{ d.pay }}</span><span><span class="hint">{{ t('spending.inst.whereLabel') }}</span> {{ d.where }}</span></div>
          <div class="id-tb">
            <table class="rt">
              <thead><tr>
                <th scope="col" class="pl">{{ t('spending.inst.col.round') }}</th>
                <th scope="col">{{ t('spending.inst.col.date') }}</th>
                <th scope="col" class="r">{{ t('spending.inst.col.amount') }}</th>
                <th scope="col" class="refl">{{ t('spending.inst.col.reflect') }}</th>
                <th scope="col" class="c">{{ t('spending.inst.col.state') }}</th>
                <th scope="col" class="r pr"><span class="sr">{{ t('common.edit') }}</span></th>
              </tr></thead>
              <tbody>
                <tr v-for="x in d.rounds" :key="x.r.no" :class="{ nx: x.st === 'next', gone: x.st === 'merged' }">
                  <td class="num pl lbl">{{ x.label }}</td>
                  <td class="mono dt" :data-paid-in="x.paidIn ? x.rym : undefined">{{ x.r.date }}<small v-if="x.paidIn" class="hint pin">{{ x.paidIn }}</small></td>
                  <td class="r num amt">{{ fmtMoney(x.r.amount) }}<span v-if="x.r.edited && x.st !== 'merged'" class="hint ed" :title="t('spending.inst.editedTitle')">{{ t('spending.inst.edited') }}</span></td>
                  <td class="refl">{{ x.reflect }}</td>
                  <td class="c"><span class="pill" :class="ST_PILL[x.st]">{{ t(`spending.inst.st.${x.st}` as 'spending.inst.st.paid') }}</span></td>
                  <td class="r pr"><button v-if="x.st !== 'merged'" class="btn sm ghost" type="button" :aria-label="t('common.editLabel', { name: x.r.no <= d.s.count ? t('spending.inst.roundName', { no: x.r.no }) : x.label })" @click="roundNo = x.r.no">{{ t('common.edit') }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="diffText" class="diff" role="status">{{ diffText }}</p>
          <p v-for="(n, k) in d.notes" :key="k" class="cfoot">{{ n }}</p>
          <p v-if="d.s.note" class="cfoot"><b>{{ t('spending.inst.memo') }}</b> {{ d.s.note }}</p>
        </div>
        <div v-else class="idet pick hint">{{ t('spending.inst.pickOne') }}</div>
      </div>
    </section>

    <SpendEditor v-if="editing" :initial="editing" @close="editing = null" />
    <RoundEditor v-if="roundNo !== null && d" :spending="d.s" :no="roundNo" @close="roundNo = null" />
    <PayOffDialog v-if="paying && d" :spending="d.s" @close="paying = false" />
    <ConfirmDialog
      v-if="asking && d" :title="t('spending.inst.cancelAsk', { name: d.name })" :confirm-label="t('spending.inst.cancelDo')" :cancel-label="t('spending.inst.cancelKeep')" danger :busy="busy"
      @confirm="setCancelled(true)" @cancel="asking = false"
    >
      <p>{{ t('spending.inst.cancelBody') }}</p>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.kp{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px} /* a row of one or two cards fills the width (review 1 F-4) */
.kcard{padding:14px 18px;display:flex;flex-direction:column;gap:2px;min-height:148px;min-width:0}
.k1{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--muted)}
.k2{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px}
.k2 > b{font-size:20px;font-weight:700;overflow-wrap:anywhere}
.k2 > span{font-size:13px;font-weight:600;color:var(--text-2);text-align:right;overflow-wrap:anywhere}
.hint{font-size:12px;color:var(--subtle)}
.kvis{margin-top:auto;padding-top:12px;display:flex;flex-direction:column;gap:6px}
.kprogs{gap:8px}
.krow{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin-bottom:4px}
.krow .kl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.krow b{color:var(--text);font-weight:600;flex:none}
.kbars{display:flex;align-items:flex-end;gap:4px;height:36px}
.kbars span{flex:1;border-radius:2px 2px 0 0;min-height:2px}
.kaxis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
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
.empty{display:flex;flex-direction:column;align-items:center;gap:2px;padding:32px 18px;text-align:center;color:var(--muted)}
.empty b{color:var(--text)}
.ig{display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr)}
.ilist{list-style:none;margin:0;padding:8px;display:flex;flex-direction:column;gap:6px;border-right:1px solid var(--divider);align-self:start;min-width:0}
.ii{display:flex;flex-direction:column;gap:6px;width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface);font:inherit;color:inherit;text-align:left;cursor:pointer}
.ii:hover{border-color:var(--border-strong)}
.ii.on{border-color:var(--primary);background:var(--sel);box-shadow:inset 0 0 0 1px var(--primary)}
.ii-a{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:14px}
.ii-a .nm{min-width:0;overflow-wrap:anywhere}
.ii-b{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted)}
.ii-b .late{color:var(--accent-text)}
.ii-b .fin{color:var(--muted)}
.idet{display:flex;flex-direction:column;min-width:0}
.idet.pick{padding:32px 18px;text-align:center}
.id-h{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:16px 18px 12px}
.id-t1{min-width:0;flex:1 1 220px}
.id-n{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.id-n h2{margin:0;font-size:17px;overflow-wrap:anywhere}
.id-a{display:flex;gap:6px;flex-wrap:wrap}
.id-a .cx{color:var(--neg-text)}
.err{margin:0;padding:0 18px 10px;font-size:12px;color:var(--neg-text)}
.id-s{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border-top:1px solid var(--divider);border-bottom:1px solid var(--divider)}
.id-s > div{padding:12px 18px;display:flex;flex-direction:column;gap:2px;min-width:0}
.id-s > div + div{border-left:1px solid var(--divider)}
.id-s dt{font-size:12px;font-weight:600;color:var(--text-2)}
.id-s dd{margin:0;font-size:17px;font-weight:700;overflow-wrap:anywhere}
.id-s dd.lf{color:var(--primary-text)}
.id-i{display:flex;flex-wrap:wrap;gap:6px 24px;padding:10px 18px;font-size:13px;color:var(--text-2)}
.id-tb{max-height:420px;overflow:auto;border-top:1px solid var(--divider)}
.rt{width:100%;border-collapse:collapse;font-size:13px}
.rt th{position:sticky;top:0;z-index:1}
.rt th.pl,.rt td.pl{padding-left:16px}
.rt th.pr,.rt td.pr{padding-right:16px}
.rt th.r,.rt td.r{text-align:right}
.rt th.c,.rt td.c{text-align:center}
.rt td.lbl{color:var(--text-2)}
.rt td.dt{font-size:12px}
.rt td.dt .pin{display:block;font-family:var(--font);font-size:11px;white-space:nowrap}
.rt td.amt{font-weight:600}
.rt td.amt .ed{font-weight:500}
.rt tr.nx{background:color-mix(in srgb,var(--accent-soft) 45%,transparent)}
.rt tr.gone td{color:var(--subtle)}
.rt td.refl{color:var(--text-2)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.diff{margin:0;padding:10px 18px;font-size:13px;font-weight:600;color:var(--accent-text);background:var(--accent-soft);border-top:1px solid var(--divider)}
.cfoot{margin:0;padding:12px 18px;font-size:12px;color:var(--text-2);background:var(--surface-2);border-top:1px solid var(--divider)}
.cfoot + .cfoot{border-top:0;padding-top:0}
@media (max-width:760px){
  .kp{grid-template-columns:minmax(0,1fr)}
  .vr{display:none}
  .frow .count{margin-left:0;flex-basis:100%}
  .ig{grid-template-columns:minmax(0,1fr)}
  .ilist{border-right:0;border-bottom:1px solid var(--divider)}
  .id-s{grid-template-columns:repeat(2,minmax(0,1fr))}
  .id-s > div:nth-child(3){border-left:0}
  .id-s > div:nth-child(n+3){border-top:1px solid var(--divider)}
  .rt th.refl,.rt td.refl{display:none}
  .rt th,.rt td{padding-left:8px;padding-right:8px}
  .rt th.pl,.rt td.pl{padding-left:12px}
  .rt th.pr,.rt td.pr{padding-right:12px}
}
</style>
