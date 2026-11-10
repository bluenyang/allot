<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import Donut from '../components/Donut.vue'
import EditSheet from '../components/EditSheet.vue'
import { saveItem, store, subName } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import {
  splitRemainder,
  addYm, distributionAt, man, transferAt, today, upcomingPayments, won, ymLabel, ymOf,
} from '../lib/calc'

const tab = ref('month')
const tabs = [
  { id: 'month', label: '이번 달' },
  { id: 'next', label: '다가오는 변경' },
  { id: 'checks', label: '확인 필요' },
]

const now = today()
const ym = ymOf(now)
const dist = computed(() => distributionAt(ym, store.settings.netPay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings))
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ym))
const pays = computed(() => upcomingPayments(store.subscriptions, store.planChanges, store.settings, now, 31))
const paysSum = computed(() => pays.value.reduce((a, p) => a + p.krw, 0))
const split = computed(() => (dist.value.remainderTarget ? splitRemainder(dist.value.remainder, store.remainderSplit) : []))
const subsTarget = computed(() => store.targets.find((t) => t.kind === 'subscriptions'))

const horizon = addYm(ym, 9)
const nextChanges = computed(() =>
  store.planChanges.filter((c) => c.effective && c.effective.slice(0, 7) >= ym).sort((a, b) => (a.effective! < b.effective! ? -1 : 1)),
)
const undated = computed(() => store.planChanges.filter((c) => !c.effective))
const nextEvents = computed(() => store.events.filter((e) => e.state !== 'done' && e.when.slice(0, 7) <= horizon))
const openChecks = computed(() => store.checks.filter((c) => !c.done).length)

function changeDelta(id: string, eff: string) {
  const before = transferAt(store.subscriptions, store.planChanges.filter((c) => c.id !== id), store.settings, eff.slice(0, 7))
  const after = transferAt(store.subscriptions, store.planChanges, store.settings, eff.slice(0, 7))
  return after.needed - before.needed
}
const WD = ['일', '월', '화', '수', '목', '금', '토']
const chkEd = useEditor('checks', () => ({ id: '', text: '', done: false }), (c) => (!c.text.trim() ? '내용을 입력해 주세요.' : null))
</script>

<template>
  <section>
    <div class="ph">
      <div>
        <h1>{{ ymLabel(ym) }}</h1>
        <p class="sub">{{ dist.phase ? `${dist.phase.label} ${dist.phase.name}` : '구간 밖' }} · 월급 {{ store.settings.payDay }}일 · 분배 {{ store.settings.transferDay }}일 · 카드 {{ store.settings.billingDay }}일</p>
      </div>
    </div>

    <div class="strip">
      <div v-if="dist.remainderTarget" class="hl"><div class="l">이번 달 {{ dist.remainderTarget.name }}</div><div class="v">{{ man(dist.remainder) }}</div><div class="s">{{ split.map((x) => `${x.name} ${man(x.amount)}`).join(' · ') || '나머지 분배 없음' }}</div></div>
      <div v-else class="hl"><div class="l">나머지</div><div class="v">—</div><div class="s">분배 화면에서 나머지 대상을 정해 주세요</div></div>
      <div><div class="l">{{ subsTarget?.name ?? '구독 이체' }}</div><div class="v">{{ man(dist.subscriptions) }}</div><div class="s">필요 {{ won(xfer.needed) }}</div></div>
      <div><div class="l">31일 내 결제</div><div class="v">{{ man(paysSum) }}</div><div class="s">{{ pays.length }}건</div></div>
      <div><div class="l">확인 필요</div><div class="v">{{ openChecks }}<span class="small muted" style="font-weight:500"> 건</span></div><div class="s">정책·구독 체크</div></div>
    </div>

    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'month'" class="cols wide">
      <div class="panel">
        <div class="card-h"><h3>{{ store.settings.transferDay }}일 자동이체</h3><span class="small muted">실수령 {{ won(store.settings.netPay) }}</span></div>
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <Donut :rows="dist.rows" :center="man(store.settings.netPay)" caption="실수령" />
          <div class="rows" style="flex:1;min-width:220px">
            <div v-for="r in dist.rows" :key="r.key" class="row" style="padding:8px 0">
              <i :style="{ width: '10px', height: '10px', borderRadius: '50%', background: allocColor(r.key) }"></i>
              <span class="t">{{ r.name }}</span>
              <span class="r">{{ won(r.amount) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="card-h"><h3>결제 예정</h3><span class="small muted">31일</span></div>
        <div class="rows">
          <div v-for="p in pays" :key="p.sub.id + p.date.getTime()" class="row">
            <span class="date"><b>{{ p.date.getDate() }}</b><span>{{ p.date.getMonth() + 1 }}월 {{ WD[p.date.getDay()] }}</span></span>
            <span style="min-width:0"><span class="t" style="display:block">{{ p.sub.name }}</span><span class="d" style="display:block">{{ p.sub.plan || '—' }}</span></span>
            <span class="r">{{ won(p.krw) }}<small :style="{ color: p.dday <= 3 ? 'var(--warn)' : '' }">D-{{ p.dday }}</small></span>
          </div>
        </div>
        <p v-if="!pays.length" class="empty">31일 안에 결제할 구독이 없어요.</p>
      </div>
    </div>

    <div v-else-if="tab === 'next'" class="cols">
      <div class="panel">
        <div class="card-h"><h3>플랜 전환</h3><a href="#subs" class="small">구독에서 보기</a></div>
        <div class="rows">
          <div v-for="c in nextChanges" :key="c.id" class="row">
            <span class="when mono small muted">{{ c.effective!.slice(5).replace('-', '/') }}</span>
            <span style="min-width:0"><span class="t" style="display:block">{{ subName(c.subId) }}</span><span class="d" style="display:block">{{ c.note }}</span></span>
            <span class="r" :class="changeDelta(c.id, c.effective!) > 0 ? 'up' : 'down'">{{ changeDelta(c.id, c.effective!) > 0 ? '+' : '' }}{{ won(changeDelta(c.id, c.effective!)) }}</span>
          </div>
          <div v-for="c in undated" :key="c.id" class="row dim">
            <span class="small muted">미정</span>
            <span style="min-width:0"><span class="t" style="display:block">{{ subName(c.subId) }}</span><span class="d" style="display:block">{{ c.note }}</span></span>
            <span class="pill mute">미반영</span>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="card-h"><h3>할 일</h3><span class="small muted">~{{ ymLabel(horizon) }}</span></div>
        <div class="rows">
          <div v-for="e in nextEvents" :key="e.id" class="row">
            <span class="mono small muted">{{ e.when.slice(2).replace('-', '.') }}</span>
            <span class="t" style="white-space:normal">{{ e.title }}</span>
            <span class="pill" :class="e.state === 'doing' ? 'acc' : 'mute'">{{ e.kind }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else style="max-width:760px">
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="chkEd.open()">+ 확인할 것 추가</button></div>
      <EditSheet v-if="chkEd.item.value" :key="chkEd.item.value.id || 'new'" :title="chkEd.item.value.id ? '확인할 것 수정' : '확인할 것 추가'" :error="chkEd.error.value" :busy="chkEd.busy.value"
        :can-delete="!!chkEd.item.value.id" @save="chkEd.save" @cancel="chkEd.close" @delete="chkEd.remove">
        <div class="field" style="grid-column:1/-1"><label for="ck-text">내용</label><input id="ck-text" v-model="chkEd.item.value.text" class="in"></div>
      </EditSheet>
      <div class="panel">
        <div v-for="c in store.checks" :key="c.id" class="chk-row">
          <label class="chk" :class="{ done: c.done }">
            <input :id="'chk-' + c.id" :checked="c.done" type="checkbox" @change="saveItem('checks', { ...c, done: !c.done }).catch(() => {})"><span>{{ c.text }}</span>
          </label>
          <button class="btn sm" type="button" :aria-label="`${c.text} 수정`" @click="chkEd.open(c)">수정</button>
        </div>
      </div>
    </div>
  </section>
</template>
