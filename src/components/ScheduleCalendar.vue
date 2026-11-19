<script setup lang="ts">
// 일정 달력 탭 (spec 010 S-9, EV-5..21): the month grid in a card with its own header strip, and the month's
// agenda beside it. On a phone the grid is not drawn: a month bar (big previous / next buttons, no "오늘"
// button — D-3) and the agenda stay. Loaded only when the tab opens (the calendar code is heavy).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CalendarView from './CalendarView.vue'
import Icon from './Icon.vue'
import { addYm, parseDate, today, ymOf } from '../lib/calc'
import { calendarEvents, kindLabel } from '../lib/calendar-events'
import type { CalKind } from '../lib/calendar-events'
import { fmtMoney } from '../lib/display'
import { monthLong, weekdayShort } from '../lib/format'
import { lang, t } from '../i18n'

const now = today()
const nowYm = ymOf(now)
const ym = ref(nowYm)
const step = (n: number) => { ym.value = addYm(ym.value, n) }

const narrow = ref(false)
let mq: MediaQueryList | null = null
const onMq = () => { narrow.value = !!mq?.matches }
onMounted(() => { mq = window.matchMedia('(max-width: 760px)'); onMq(); mq.addEventListener('change', onMq) })
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

const monthNum = computed(() => Number(ym.value.slice(5)))
const title = computed(() => t('timeline.monthTitle', { year: ym.value.slice(0, 4), month: lang.value === 'en' ? monthLong(monthNum.value) : monthNum.value }))
const todayHint = computed(() => t('timeline.todayHint', { date: `${now.getMonth() + 1}/${now.getDate()}`, weekday: weekdayShort(now) }))

/** Every event of the shown month, in the order of the grid. */
const events = computed(() => calendarEvents(`${ym.value}-01`, `${addYm(ym.value, 1)}-01`).filter((e) => e.date.slice(0, 7) === ym.value))
const todayIso = `${nowYm}-${String(now.getDate()).padStart(2, '0')}`
const rows = computed(() => events.value.map((e) => {
  const d = parseDate(e.date)
  const label = kindLabel(e.kind)
  // the pill says the kind; the text is what is left of the title (a holiday's own name, a subscription's name)
  const text = e.kind === 'sub' ? (e.name ?? e.title) : e.title.startsWith(label) ? e.title.slice(label.length).trim() : e.title
  return { key: `${e.date}-${e.kind}-${e.title}`, day: d.getDate(), wd: weekdayShort(d), dow: d.getDay(), kind: e.kind as CalKind, label, text, amount: e.kind === 'sub' && e.krw !== undefined ? fmtMoney(e.krw) : '', past: e.date < todayIso }
}))
const subTotal = computed(() => events.value.reduce((n, e) => n + (e.kind === 'sub' ? e.krw ?? 0 : 0), 0))
const subsLabel = computed(() => (ym.value === nowYm ? t('timeline.subsThisMonth') : t('timeline.subsOfMonth', { month: lang.value === 'en' ? monthLong(monthNum.value) : monthNum.value })))
const dowCls = (dow: number) => (dow === 6 ? 'sat' : dow === 0 ? 'sun' : '')
</script>

<template>
  <div class="calwrap">
    <div v-if="narrow" class="mbar2" role="group" :aria-label="t('timeline.chooseMonth')">
      <button class="btn ghost" type="button" :aria-label="t('shell.prevMonth')" @click="step(-1)"><Icon name="prev" :stroke="2.2" /></button>
      <div class="mid"><b class="num">{{ title }}</b><small class="hint">{{ todayHint }}</small></div>
      <button class="btn ghost" type="button" :aria-label="t('shell.nextMonth')" @click="step(1)"><Icon name="next" :stroke="2.2" /></button>
    </div>

    <section v-if="!narrow" class="card calcard">
      <div class="card-hd">
        <h2 class="num" data-cal-title>{{ title }}</h2>
        <div class="nav">
          <button class="btn sm" type="button" :aria-label="t('shell.prevMonth')" @click="step(-1)"><Icon name="prev" :stroke="2" /></button>
          <button class="btn sm" type="button" :disabled="ym === nowYm" @click="ym = nowYm">{{ t('timeline.today') }}</button>
          <button class="btn sm" type="button" :aria-label="t('shell.nextMonth')" @click="step(1)"><Icon name="next" :stroke="2" /></button>
        </div>
      </div>
      <CalendarView source="schedule" :month="ym" :label="t('timeline.calendarLabel')" />
      <p class="calnote">{{ t('timeline.calNote') }}</p>
    </section>

    <section class="card agenda" :aria-label="t('timeline.agendaTitle', { month: lang === 'en' ? monthLong(monthNum) : monthNum })">
      <div class="card-hd">
        <h2>{{ t('timeline.agendaTitle', { month: lang === 'en' ? monthLong(monthNum) : monthNum }) }}</h2>
        <span class="aux num">{{ t('timeline.agendaCount', { n: rows.length }) }}</span>
      </div>
      <ul class="ag">
        <li v-for="r in rows" :key="r.key" :class="{ past: r.past }" :data-kind="r.kind">
          <span class="dt" :class="dowCls(r.dow)"><b class="num">{{ r.day }}</b><small>{{ r.wd }}</small></span>
          <span class="tx"><span class="pill" :class="'k-' + r.kind">{{ r.label }}</span> <span class="tt">{{ r.text }}</span></span>
          <b v-if="r.amount" class="amt num">{{ r.amount }}</b>
        </li>
      </ul>
      <p v-if="!rows.length" class="empty">{{ t('timeline.agendaEmpty') }}</p>
      <div class="agf"><span>{{ subsLabel }}</span><b class="num">{{ fmtMoney(subTotal) }}</b></div>
    </section>
  </div>
</template>

<style scoped>
.calwrap{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;align-items:start}
.calcard{overflow:hidden;display:flex;flex-direction:column}
.nav{display:flex;gap:6px}
.nav .btn.sm:not(:nth-child(2)){width:30px;padding:0}
.nav .btn svg{width:15px;height:15px}
.nav .btn:disabled{color:var(--subtle)}
.calnote{margin:auto 0 0;padding:12px 18px;font-size:12px;color:var(--muted);background:var(--surface-2);border-top:1px solid var(--divider)}
.agenda{display:flex;flex-direction:column}
.ag{list-style:none;margin:0;padding:0;flex:1}
.ag li{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--divider)}
.ag li.past{opacity:.6}
.dt{width:40px;display:flex;flex-direction:column;align-items:center;line-height:1.2;color:var(--text-2);flex:none}
.dt b{font-size:16px}
.dt small{font-size:11px}
.dt.sat{color:var(--sat)}
.dt.sun{color:var(--sun)}
.tx{flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere}
.amt{font-size:13px;white-space:nowrap}
.pill.k-pay,.pill.k-transfer{color:var(--primary-text);background:var(--primary-soft)}
.pill.k-billing{color:var(--info-text);background:var(--info-soft)}
.pill.k-sub{color:var(--accent-text);background:var(--accent-soft)}
.pill.k-change{color:var(--accent-text);background:var(--surface);box-shadow:inset 0 0 0 1px var(--accent-line)}
.pill.k-holiday{color:var(--neg-text);background:var(--neg-soft)}
.agf{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid var(--border);font-size:13px}
.agf span{color:var(--muted)}
.mbar2{display:flex;align-items:center;gap:8px;padding:6px;margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pop)}
.mbar2 .btn{width:44px;height:44px;padding:0;flex:none}
.mbar2 .btn{color:var(--muted)}
.mbar2 .btn svg{width:20px;height:20px}
.mbar2 .mid{flex:1;text-align:center;line-height:1.3}
.mbar2 .mid b{display:block;font-size:17px}
@media (max-width:760px){.calwrap{display:block}}
</style>
