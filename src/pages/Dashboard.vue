<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { saveItem, store, subName } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { notReady, view } from '../lib/view'
import { allocColor } from '../lib/colors'
import { fmtDate, fmtMoney, fmtMoneyClass } from '../lib/display'
import { moneyShort } from '../lib/format'
import { offDays } from '../lib/holidays-lazy'
import {
  addYm, distributionAt, monthDates, splitRemainder, today, transferAt, upcomingPayments, ymOf, ymRange,
} from '../lib/calc'

// 현황 (spec 007 S-4): the canvas dashboard on the data we have. Not drawn (S-3): AI analysis,
// export, add-record, last sync, the statement card. "고정 지출 추이" looks ahead six months
// (the past is not stored; the user approved the change on 2026-11-15).
const now = today()
// The month comes from the header's month switch (spec 007 S-15); payments stay "from today".
const ym = computed(() => view.ym)
const year = computed(() => Number(view.ym.slice(0, 4)))
const month = computed(() => Number(view.ym.slice(5, 7)))

const dist = computed(() => distributionAt(ym.value, store.settings.netPay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings))
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ym.value))
const pays = computed(() => upcomingPayments(store.subscriptions, store.planChanges, store.settings, now, 31))
const paysSum = computed(() => pays.value.reduce((a, p) => a + p.krw, 0))
const split = computed(() => (dist.value.remainderTarget ? splitRemainder(dist.value.remainder, store.remainderSplit) : []))
const subsMonthly = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
// Active in the shown month, with scheduled plan changes applied (the same set as the monthly total).
const activeSubs = computed(() => xfer.value.items.length)
const pct = (n: number) => (store.settings.netPay > 0 ? `${((n / store.settings.netPay) * 100).toFixed(1)}%` : '—')

// Monthly dates after the weekend/holiday shift; the holiday code loads only when a shift is set.
const dates = computed(() => {
  if (store.settings.dayShift === 'none') return monthDates(ym.value, store.settings, new Set())
  // A shift moves at most 31 days, into the month before or after: their holidays are needed too.
  const off = offDays(store.holidaySets, `${addYm(ym.value, -2)}-01`, `${addYm(ym.value, 3)}-01`)
  return monthDates(ym.value, store.settings, off ?? new Set())
})
const WD = ['일', '월', '화', '수', '목', '금', '토']
const md = (s: string) => { const d = new Date(`${s}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})` }
const moved = (s: 'before' | 'after' | null) => (s === 'before' ? '주말·공휴일이라 앞당김' : s === 'after' ? '주말·공휴일이라 미룸' : '')
/** The note after a monthly date: moved, or no business day within the limit (review 2, F3). */
const note = (x: { shifted: 'before' | 'after' | null; unresolved?: true }) =>
  x.unresolved ? ' (옮길 영업일 없음)' : x.shifted === 'before' ? ' (앞당김)' : x.shifted === 'after' ? ' (미룸)' : ''

// Six months ahead: subscription monthly total with scheduled plan changes.
const trend = computed(() => ymRange(ym.value, 6).map((m) => {
  const t = transferAt(store.subscriptions, store.planChanges, store.settings, m)
  return { ym: m, v: t.monthlySum + t.yearlyMonthly }
}))
const trendMax = computed(() => Math.max(1, ...trend.value.map((x) => x.v)))
// The y axis as in the design: three equal steps to a round top (만원).
const trendTop = computed(() => { const step = Math.max(1, Math.ceil(trendMax.value / 30_000)) * 10_000; return step * 3 })
const ticks = computed(() => [3, 2, 1, 0].map((i) => (i ? `${(trendTop.value / 3 * i) / 10_000}만` : '0')))

const tab = ref('month')
const horizon = computed(() => addYm(ym.value, 9))
const nextChanges = computed(() =>
  store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) >= ym.value).sort((a, b) => (a.effective! < b.effective! ? -1 : 1)),
)
const undated = computed(() => store.planChanges.filter((c) => !c.effective))
const nextEvents = computed(() => store.events.filter((e) => e.state !== 'done' && e.when.slice(0, 7) <= horizon.value))
const openChecks = computed(() => store.checks.filter((c) => !c.done).length)
const tabs = computed(() => [
  { id: 'month', label: '이번 달', icon: 'chart' },
  { id: 'next', label: '예정', icon: 'events', count: nextChanges.value.length + nextEvents.value.length },
  { id: 'checks', label: '확인할 것', icon: 'check', count: openChecks.value, signal: true },
])

function changeDelta(id: string, eff: string) {
  const before = transferAt(store.subscriptions, store.planChanges.filter((c) => c.id !== id), store.settings, eff.slice(0, 7))
  const after = transferAt(store.subscriptions, store.planChanges, store.settings, eff.slice(0, 7))
  return (after.monthlySum + after.yearlyMonthly) - (before.monthlySum + before.yearlyMonthly)
}
const signed = (n: number) => (n > 0 ? '+' : '') + fmtMoney(n)
const chkEd = useEditor('checks', () => ({ id: '', text: '', done: false }), (c) => (!c.text.trim() ? '내용을 입력해 주세요.' : null))
</script>

<template>
  <section class="page-gap">
    <!-- On a phone the header bar is hidden: the month switch and the phase sit here (review 11). -->
    <div class="mnav" aria-label="현황 달">
      <button class="btn icon" type="button" aria-label="이전 달" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" /></button>
      <b>{{ year }}. {{ String(month).padStart(2, '0') }}</b>
      <button class="btn icon" type="button" aria-label="다음 달" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" /></button>
      <span class="pill tag">{{ dist.phase ? `${dist.phase.label} · ${dist.phase.name}` : '구간 밖' }}</span>
    </div>
    <PageHeader :title="`${year}년 ${month}월 현황`">
      <template #desc>
        월급 <span :title="moved(dates.pay.shifted)">{{ md(dates.pay.date) }}<small v-if="note(dates.pay)">{{ note(dates.pay) }}</small></span>
        · 분배 <span :title="moved(dates.transfer.shifted)">{{ md(dates.transfer.date) }}<small v-if="note(dates.transfer)">{{ note(dates.transfer) }}</small></span>
        · 카드 결제 <span :title="moved(dates.billing.shifted)">{{ md(dates.billing.date) }}<small v-if="note(dates.billing)">{{ note(dates.billing) }}</small></span>
        · <button class="linkish" type="button" @click="notReady('마지막 동기화')">마지막 동기화 —</button>
      </template>
      <button class="btn" type="button" @click="notReady('내보내기')"><Icon name="download" />내보내기</button>
      <button class="btn pri" type="button" @click="notReady('기록 추가')"><Icon name="plus" />기록 추가</button>
    </PageHeader>

    <section class="strip" aria-label="이번 달 요약">
      <div v-if="dist.remainderTarget" class="hl">
        <span class="l">이번 달 나머지 → {{ dist.remainderTarget.name }}</span>
        <span class="v" :class="fmtMoneyClass(dist.remainder)">{{ fmtMoney(dist.remainder) }}</span>
        <span class="s">실수령 {{ fmtMoney(store.settings.netPay) }} 중 {{ pct(dist.remainder) }}</span>
      </div>
      <div v-else class="hl"><span class="l">나머지</span><span class="v">—</span><span class="s">월급 분배에서 나머지 대상을 정해 주세요</span></div>
      <div><span class="l">구독 월 환산</span><span class="v">{{ fmtMoney(subsMonthly) }}</span><span class="s">활성 {{ activeSubs }}건 · 이체 {{ fmtMoney(dist.subscriptions || xfer.transfer) }}</span></div>
      <div><span class="l">31일 내 결제</span><span class="v">{{ fmtMoney(paysSum) }}</span><span class="s">{{ pays.length }}건<template v-if="pays.length"> · 가장 가까운 결제 D-{{ pays[0]!.dday }}</template></span></div>
      <div><span class="l">확인 필요</span><span class="v" :class="{ sig: openChecks > 0 }">{{ openChecks }}<small class="unit"> 건</small></span><span class="s">할 일 {{ openChecks }}</span></div>
    </section>

    <div>
      <SubTabs v-model="tab" :tabs="tabs" aria-label="현황 보기" />

      <!-- 이번 달 shows every card, as the design canvas does; 예정 and 확인할 것 show only theirs (spec 007 S-19) -->
      <div class="tabbody">
      <div v-if="tab === 'month'" class="flexcols">
        <div class="col-main">
          <section class="card">
            <div class="card-hd"><h2>{{ dates.transfer.date.slice(8).replace(/^0/, '') }}일 자동이체 분배</h2><span class="aux">실수령 {{ fmtMoney(store.settings.netPay) }}</span></div>
            <div class="card-bd">
              <div class="ratio" role="img" :aria-label="`분배 비율: ${dist.rows.map((r) => `${r.name} ${pct(r.amount)}`).join(', ')}`">
                <i v-for="r in dist.rows.filter((x) => x.amount > 0)" :key="r.key" :style="{ flexGrow: r.amount, background: allocColor(r.key) }"></i>
              </div>
            </div>
            <div class="tbl">
              <table>
                <thead><tr><th scope="col">대상</th><th scope="col" class="c-how">계산 방식</th><th scope="col" class="n">비율</th><th scope="col" class="n">금액</th></tr></thead>
                <tbody>
                  <tr v-for="r in dist.rows" :key="r.key">
                    <td><span class="tname"><i :style="{ background: allocColor(r.key) }"></i>{{ r.name }}</span><span v-if="r.detail" class="how-sm">{{ r.detail }}</span></td>
                    <td class="muted c-how">{{ r.detail }}</td>
                    <td class="n muted num">{{ pct(r.amount) }}</td>
                    <td class="n" :class="fmtMoneyClass(r.amount)">{{ fmtMoney(r.amount) }}</td>
                  </tr>
                  <tr class="sum"><td>합계</td><td class="c-how"></td><td></td><td class="n">{{ fmtMoney(dist.rows.reduce((a, r) => a + r.amount, 0)) }}</td></tr>
                </tbody>
              </table>
            </div>
            <p v-if="split.length" class="split small subtle">{{ dist.remainderTarget?.name }} 나누기: {{ split.map((x) => `${x.name} ${fmtMoney(x.amount)}`).join(' · ') }}</p>
          </section>

          <section class="card">
            <div class="card-hd"><h2>고정 지출 추이</h2><span class="aux">앞으로 6개월 · 구독 월 환산</span></div>
            <div class="trend">
              <div class="axis" aria-hidden="true"><span v-for="t in ticks" :key="t">{{ t }}</span></div>
              <div class="plot" role="img" :aria-label="`앞으로 6개월 구독 월 환산: ${trend.map((b) => `${Number(b.ym.slice(5))}월 ${fmtMoney(b.v)}`).join(', ')}`">
                <div class="bars">
                  <div v-for="b in trend" :key="b.ym" class="bar">
                    <span class="bv bv-full">{{ fmtMoney(b.v) }}</span><span class="bv bv-short" aria-hidden="true">{{ moneyShort(b.v) }}</span>
                    <i :style="{ height: `${Math.max(2, (b.v / trendTop) * 100)}%` }" :class="{ now: b.ym === ym }"></i>
                  </div>
                </div>
                <div class="months"><span v-for="b in trend" :key="b.ym">{{ Number(b.ym.slice(5)) }}월</span></div>
              </div>
            </div>
          </section>
        </div>

        <div class="col-side">
          <section class="card">
            <div class="card-hd"><h2>결제 예정</h2><a href="#subs" class="aux">구독 전체 보기</a></div>
            <ul class="items pays">
              <li v-for="p in pays" :key="p.sub.id + p.date.getTime()">
                <span class="dbox" :class="{ sat: p.date.getDay() === 6, sun: p.date.getDay() === 0 }"><b>{{ p.date.getDate() }}</b><span>{{ p.date.getMonth() + 1 }}월 {{ WD[p.date.getDay()] }}</span></span>
                <span class="pn"><b>{{ p.sub.name }}</b><span>{{ p.sub.plan || '—' }}</span></span>
                <span class="pa"><b>{{ fmtMoney(p.krw) }}</b><span :class="{ soon: p.dday <= 3 }">D-{{ p.dday }}</span></span>
              </li>
            </ul>
            <p v-if="!pays.length" class="empty">31일 안에 결제할 구독이 없어요.</p>
          </section>
        </div>
      </div>

      <div v-if="tab !== 'checks'" class="flexcols">
        <section class="card half">
          <div class="card-hd"><h2>예약된 플랜 전환</h2><span class="aux">월 환산 차액</span></div>
          <ul class="items">
            <li v-for="c in nextChanges" :key="c.id">
              <span class="when wide">{{ fmtDate(c.effective!) }}</span>
              <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
              <b class="num" :class="changeDelta(c.id, c.effective!) > 0 ? 'up' : 'down'">{{ signed(changeDelta(c.id, c.effective!)) }}</b>
            </li>
            <li v-for="c in undated" :key="c.id" class="dim">
              <span class="when">미정</span>
              <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
              <span class="pill mute">미반영</span>
            </li>
          </ul>
          <p v-if="!nextChanges.length && !undated.length" class="empty">예약된 전환이 없어요.</p>
        </section>
        <section class="card half">
          <div class="card-hd"><h2>다가오는 일정</h2><span class="aux">~ {{ horizon.replace('-', '. ') }}</span></div>
          <ul class="items">
            <li v-for="e in nextEvents" :key="e.id">
              <span class="when">{{ e.when.slice(2).replace('-', '.') }}</span>
              <span class="grow">{{ e.title }}</span>
              <span class="pill" :class="e.state === 'doing' ? 'acc' : 'mute'">{{ e.kind }}</span>
            </li>
          </ul>
          <p v-if="!nextEvents.length" class="empty">다가오는 일정이 없어요.</p>
        </section>
      </div>

      <section v-if="tab !== 'next'" class="card checks">
        <div class="card-hd"><h2>확인할 것</h2><button class="btn sm add" type="button" aria-label="확인할 것 추가" @click="chkEd.open()">+ 추가</button></div>
        <EditSheet v-if="chkEd.item.value" :key="chkEd.item.value.id || 'new'" :title="chkEd.item.value.id ? '확인할 것 수정' : '확인할 것 추가'" :error="chkEd.error.value" :busy="chkEd.busy.value"
          :can-delete="!!chkEd.item.value.id" @save="chkEd.save" @cancel="chkEd.close" @delete="chkEd.remove">
          <div class="field" style="grid-column:1/-1"><label for="ck-text">내용</label><input id="ck-text" v-model="chkEd.item.value.text" class="in"></div>
        </EditSheet>
        <ul class="items">
          <li v-for="c in store.checks" :key="c.id" class="ck">
            <input :id="'chk-' + c.id" :checked="c.done" type="checkbox" @change="saveItem('checks', { ...c, done: !c.done }).catch(() => {})">
            <label :for="'chk-' + c.id" :class="{ done: c.done }">{{ c.text }}</label>
            <button class="btn sm" type="button" :aria-label="`${c.text} 수정`" @click="chkEd.open(c)">수정</button>
          </li>
        </ul>
        <p v-if="!store.checks.length" class="empty">확인할 것이 없어요.</p>
      </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.unit{font-size:14px;font-weight:500;color:var(--muted)}
.col-main{flex:3 1 520px;display:flex;flex-direction:column;gap:20px}
.col-side{flex:2 1 340px;display:flex;flex-direction:column;gap:20px}
.half{flex:1 1 420px}
.ratio{display:flex;height:14px;border-radius:var(--r-tag);overflow:hidden;gap:2px}
.ratio i{display:block;min-width:2px}
.tname{display:inline-flex;align-items:center;gap:8px}
.tname i{width:10px;height:10px;border-radius:var(--r-tag);flex:none}
tr.sum td{font-weight:600;border-bottom:0}
tr.sum td.n{font-weight:700}
.trend{display:flex;gap:14px;padding:18px 18px 14px}
.axis{display:flex;flex-direction:column;justify-content:space-between;height:160px;font-size:11px;color:var(--subtle);text-align:right;font-variant-numeric:tabular-nums}
.plot{flex-grow:1;display:flex;flex-direction:column;gap:6px;min-width:0}
.bars{height:160px;display:flex;align-items:flex-end;gap:18px;border-bottom:1px solid var(--border-strong);background:linear-gradient(var(--fill) 1px,transparent 1px) 0 0/100% 53.33px}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;min-width:0}
.bar i{display:block;width:100%;max-width:44px;background:var(--primary-mid);border-radius:var(--r-tag) var(--r-tag) 0 0}
.bar i.now{background:var(--primary)}
.bv{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.months{display:flex;gap:18px;font-size:12px;color:var(--subtle)}
.months span{flex:1;text-align:center}
.pays > li{gap:14px;padding:10px 18px}
.dbox{width:44px;flex-shrink:0;text-align:center;border:1px solid var(--border);border-radius:var(--r-ctl);padding:3px 0;line-height:1.2}
.dbox b{display:block;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.dbox span{font-size:11px;color:var(--subtle)}
/* Saturday blue, Sunday red (the user, 2026-11-15) */
.dbox.sat,.dbox.sat span{color:var(--info-text)}
.dbox.sun,.dbox.sun span{color:var(--neg-text)}
.pn{flex-grow:1;display:flex;flex-direction:column;min-width:0}
.pn b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pn span{font-size:12px;color:var(--subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa{display:flex;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums;white-space:nowrap}
.pa b{font-weight:600}
.pa span{font-size:12px;font-weight:600;color:var(--subtle)}
.pa span.soon{color:var(--accent-text)}
.when{width:52px;flex:none;font:12px var(--f-mono);color:var(--muted)}
.when.wide{width:auto;min-width:84px}
.linkish{all:unset;cursor:pointer}
.linkish:hover{text-decoration:underline}
.linkish:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px;border-radius:var(--r-ctl)}
.split{margin:0;padding:12px 18px;border-top:1px solid var(--divider)}
.mnav{display:none;align-items:center;gap:6px}
.mnav b{padding:0 6px;font-variant-numeric:tabular-nums}
.mnav .btn{width:32px;height:32px}
@media (max-width:760px){.mnav{display:flex}}
.how-sm,.bv-short{display:none}
/* Phone: the method moves under the name, bar labels shorten (spec 007 V-9 b, items 1-2) */
@media (max-width:760px){
  .c-how{display:none}
  .how-sm{display:block;margin:2px 0 0 18px;font-size:12px;color:var(--subtle)}
  .bv-full{display:none}
  .bv-short{display:inline}
  .bars,.months{gap:8px}
}
.grow{flex-grow:1}
.items > li.dim{opacity:.6}
.tabbody{display:flex;flex-direction:column;gap:20px}
.checks{max-width:760px}
.checks .add{height:32px;font-size:13px;color:var(--text);border-color:var(--border-strong)}
.ck{gap:12px !important;padding:0 18px !important;min-height:48px}
.ck input{width:16px;height:16px;margin:0;accent-color:var(--primary)}
.ck label{flex-grow:1;cursor:pointer}
.ck label.done{color:var(--subtle);text-decoration:line-through}
</style>
