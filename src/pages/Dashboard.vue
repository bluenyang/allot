<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import { saveItem, store, subName } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import { fmtDate, fmtMoney, fmtMoneyClass } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import {
  addYm, distributionAt, monthDates, splitRemainder, today, transferAt, upcomingPayments, ymOf, ymRange,
} from '../lib/calc'

// 현황 (spec 007 S-4): the canvas dashboard on the data we have. Not drawn (S-3): AI analysis,
// export, add-record, last sync, the statement card. "고정 지출 추이" looks ahead six months
// (the past is not stored; the user approved the change on 2026-11-15).
const now = today()
const ym = ymOf(now)
const [year, month] = [now.getFullYear(), now.getMonth() + 1]

const dist = computed(() => distributionAt(ym, store.settings.netPay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings))
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ym))
const pays = computed(() => upcomingPayments(store.subscriptions, store.planChanges, store.settings, now, 31))
const paysSum = computed(() => pays.value.reduce((a, p) => a + p.krw, 0))
const split = computed(() => (dist.value.remainderTarget ? splitRemainder(dist.value.remainder, store.remainderSplit) : []))
const subsMonthly = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
const activeSubs = computed(() => store.subscriptions.filter((s) => s.status === 'active').length)
const pct = (n: number) => (store.settings.netPay > 0 ? `${((n / store.settings.netPay) * 100).toFixed(1)}%` : '—')

// Monthly dates after the weekend/holiday shift; the holiday code loads only when a shift is set.
const dates = computed(() => {
  if (store.settings.dayShift === 'none') return monthDates(ym, store.settings, new Set())
  // A shift moves at most 31 days, into the month before or after: their holidays are needed too.
  const off = offDays(store.holidaySets, `${addYm(ym, -2)}-01`, `${addYm(ym, 3)}-01`)
  return monthDates(ym, store.settings, off ?? new Set())
})
const WD = ['일', '월', '화', '수', '목', '금', '토']
const md = (s: string) => { const d = new Date(`${s}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})` }
const moved = (s: 'before' | 'after' | null) => (s === 'before' ? '주말·공휴일이라 앞당김' : s === 'after' ? '주말·공휴일이라 미룸' : '')
/** The note after a monthly date: moved, or no business day within the limit (review 2, F3). */
const note = (x: { shifted: 'before' | 'after' | null; unresolved?: true }) =>
  x.unresolved ? ' (옮길 영업일 없음)' : x.shifted === 'before' ? ' (앞당김)' : x.shifted === 'after' ? ' (미룸)' : ''

// Six months ahead: subscription monthly total with scheduled plan changes.
const trend = computed(() => ymRange(ym, 6).map((m) => {
  const t = transferAt(store.subscriptions, store.planChanges, store.settings, m)
  return { ym: m, v: t.monthlySum + t.yearlyMonthly }
}))
const trendMax = computed(() => Math.max(1, ...trend.value.map((x) => x.v)))

const tab = ref('month')
const horizon = addYm(ym, 9)
const nextChanges = computed(() =>
  store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) >= ym).sort((a, b) => (a.effective! < b.effective! ? -1 : 1)),
)
const undated = computed(() => store.planChanges.filter((c) => !c.effective))
const nextEvents = computed(() => store.events.filter((e) => e.state !== 'done' && e.when.slice(0, 7) <= horizon))
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
  <section>
    <PageHeader crumb="개요" :title="`${year}년 ${month}월 현황`">
      <template #meta><span v-if="dist.phase" class="pill tag">{{ dist.phase.label }} · {{ dist.phase.name }}</span><span v-else class="pill tag">구간 밖</span></template>
      <template #desc>
        월급 <span :title="moved(dates.pay.shifted)">{{ md(dates.pay.date) }}<small v-if="note(dates.pay)">{{ note(dates.pay) }}</small></span>
        · 분배 <span :title="moved(dates.transfer.shifted)">{{ md(dates.transfer.date) }}<small v-if="note(dates.transfer)">{{ note(dates.transfer) }}</small></span>
        · 카드 결제 <span :title="moved(dates.billing.shifted)">{{ md(dates.billing.date) }}<small v-if="note(dates.billing)">{{ note(dates.billing) }}</small></span>
      </template>
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
      <div><span class="l">확인 필요</span><span class="v" :class="{ sig: openChecks > 0 }">{{ openChecks }}<small class="unit"> 건</small></span><span class="s">확인할 것 {{ store.checks.length }}개 중</span></div>
    </section>

    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'month'" class="cols wide">
      <div class="stack">
        <section class="panel">
          <div class="card-h"><h2>{{ dates.transfer.date.slice(8).replace(/^0/, '') }}일 자동이체 분배</h2><span class="small muted">실수령 {{ fmtMoney(store.settings.netPay) }}</span></div>
          <div class="ratio" role="img" :aria-label="`분배 비율: ${dist.rows.map((r) => `${r.name} ${pct(r.amount)}`).join(', ')}`">
            <i v-for="r in dist.rows.filter((x) => x.amount > 0)" :key="r.key" :style="{ flexGrow: r.amount, background: allocColor(r.key) }"></i>
          </div>
          <div class="tbl flat">
            <table>
              <thead><tr><th scope="col">대상</th><th scope="col">계산 방식</th><th scope="col" class="n">비율</th><th scope="col" class="n">금액</th></tr></thead>
              <tbody>
                <tr v-for="r in dist.rows" :key="r.key">
                  <td><span class="tname"><i :style="{ background: allocColor(r.key) }"></i>{{ r.name }}</span></td>
                  <td class="muted">{{ r.detail }}</td>
                  <td class="n mono">{{ pct(r.amount) }}</td>
                  <td class="n" :class="fmtMoneyClass(r.amount)">{{ fmtMoney(r.amount) }}</td>
                </tr>
                <tr class="total"><td colspan="3">합계</td><td class="n">{{ fmtMoney(dist.rows.reduce((a, r) => a + r.amount, 0)) }}</td></tr>
              </tbody>
            </table>
          </div>
          <p v-if="split.length" class="small muted split">{{ dist.remainderTarget?.name }}: {{ split.map((x) => `${x.name} ${fmtMoney(x.amount)}`).join(' · ') }}</p>
        </section>

        <section class="panel">
          <div class="card-h"><h2>고정 지출 추이</h2><span class="small muted">앞으로 6개월 · 구독 월 환산, 예약된 전환 반영</span></div>
          <div class="bars" role="img" :aria-label="`앞으로 6개월 구독 월 환산: ${trend.map((b) => `${b.ym.slice(5)}월 ${fmtMoney(b.v)}`).join(', ')}`">
            <div v-for="b in trend" :key="b.ym" class="bar">
              <span class="bv">{{ fmtMoney(b.v) }}</span>
              <i :style="{ height: `${Math.max(2, (b.v / trendMax) * 100)}%` }" :class="{ now: b.ym === ym }"></i>
              <span class="bm">{{ Number(b.ym.slice(5)) }}월</span>
            </div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="card-h"><h2>결제 예정</h2><a href="#subs" class="small">구독 전체 보기</a></div>
        <ul class="pays">
          <li v-for="p in pays" :key="p.sub.id + p.date.getTime()">
            <span class="date"><b>{{ p.date.getDate() }}</b><span>{{ p.date.getMonth() + 1 }}월 {{ WD[p.date.getDay()] }}</span></span>
            <span class="pn"><b>{{ p.sub.name }}</b><span>{{ p.sub.plan || '—' }}</span></span>
            <span class="pa"><b>{{ fmtMoney(p.krw) }}</b><span :class="{ soon: p.dday <= 3 }">D-{{ p.dday }}</span></span>
          </li>
        </ul>
        <p v-if="!pays.length" class="empty">31일 안에 결제할 구독이 없어요.</p>
      </section>
    </div>

    <div v-else-if="tab === 'next'" class="cols">
      <section class="panel">
        <div class="card-h"><h2>예약된 플랜 전환</h2><span class="small muted">월 환산 차액</span></div>
        <ul class="plain">
          <li v-for="c in nextChanges" :key="c.id">
            <span class="mono muted">{{ fmtDate(c.effective!) }}</span>
            <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
            <span class="pa" :class="changeDelta(c.id, c.effective!) > 0 ? 'up' : 'down'"><b>{{ signed(changeDelta(c.id, c.effective!)) }}</b></span>
          </li>
          <li v-for="c in undated" :key="c.id" class="dim">
            <span class="small muted">미정</span>
            <span class="pn"><b>{{ subName(c.subId) }}</b><span>{{ c.note }}</span></span>
            <span class="pill mute">미반영</span>
          </li>
        </ul>
        <p v-if="!nextChanges.length && !undated.length" class="empty">예약된 전환이 없어요. <a href="#subs">구독</a>에서 예약해요.</p>
      </section>
      <section class="panel">
        <div class="card-h"><h2>다가오는 일정</h2><span class="small muted">~ {{ horizon.replace('-', '. ') }}</span></div>
        <ul class="plain">
          <li v-for="e in nextEvents" :key="e.id">
            <span class="mono muted">{{ e.when.slice(2).replace('-', '.') }}</span>
            <span class="pn"><b class="wrap">{{ e.title }}</b></span>
            <span class="pill" :class="e.state === 'doing' ? 'acc' : 'mute'">{{ e.kind }}</span>
          </li>
        </ul>
        <p v-if="!nextEvents.length" class="empty">다가오는 일정이 없어요.</p>
      </section>
    </div>

    <section v-else class="panel narrow">
      <div class="card-h"><h2>확인할 것</h2><button class="btn sm" type="button" aria-label="확인할 것 추가" @click="chkEd.open()">+ 추가</button></div>
      <EditSheet v-if="chkEd.item.value" :key="chkEd.item.value.id || 'new'" :title="chkEd.item.value.id ? '확인할 것 수정' : '확인할 것 추가'" :error="chkEd.error.value" :busy="chkEd.busy.value"
        :can-delete="!!chkEd.item.value.id" @save="chkEd.save" @cancel="chkEd.close" @delete="chkEd.remove">
        <div class="field" style="grid-column:1/-1"><label for="ck-text">내용</label><input id="ck-text" v-model="chkEd.item.value.text" class="in"></div>
      </EditSheet>
      <div v-for="c in store.checks" :key="c.id" class="chk-row">
        <label class="chk" :class="{ done: c.done }">
          <input :id="'chk-' + c.id" :checked="c.done" type="checkbox" @change="saveItem('checks', { ...c, done: !c.done }).catch(() => {})"><span>{{ c.text }}</span>
        </label>
        <button class="btn sm" type="button" :aria-label="`${c.text} 수정`" @click="chkEd.open(c)">수정</button>
      </div>
      <p v-if="!store.checks.length" class="empty">확인할 것이 없어요.</p>
    </section>
  </section>
</template>

<style scoped>
.stack{display:flex;flex-direction:column;gap:16px;min-width:0}
.stack > .panel{margin:0}
.unit{font-size:14px;font-weight:500;color:var(--muted)}
.ratio{display:flex;height:10px;border-radius:var(--r-badge);overflow:hidden;gap:2px;margin:0 0 14px;background:var(--fill)}
.ratio i{display:block;min-width:2px}
.tbl.flat{border:0;border-radius:0}
.tname{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.tname i{width:10px;height:10px;border-radius:var(--r-tag);flex:none}
.split{margin:10px 0 0}
.bars{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;height:180px;align-items:end;padding-top:8px}
.bar{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;min-width:0}
.bar i{display:block;width:100%;max-width:44px;background:var(--primary-mid);border-radius:var(--r-badge) var(--r-badge) 0 0}
.bar i.now{background:var(--primary)}
.bv{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.bm{font-size:12px;color:var(--subtle)}
.pays,.plain{list-style:none;margin:0;padding:0}
.pays li,.plain li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:var(--row-pad) 0;border-bottom:1px solid var(--divider)}
.pays li:last-child,.plain li:last-child{border-bottom:0}
.plain li.dim{opacity:.6}
.pn{display:flex;flex-direction:column;min-width:0}
.pn b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pn b.wrap{white-space:normal}
.pn span{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pa{display:flex;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums;white-space:nowrap}
.pa b{font-weight:600}
.pa span{font-size:12px;color:var(--muted)}
.pa span.soon{color:var(--accent-text);font-weight:600}
.narrow{max-width:760px}
</style>
