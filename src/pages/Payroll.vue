<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import MonthPicker from '../components/MonthPicker.vue'
import StackBar from '../components/StackBar.vue'
import EditSheet from '../components/EditSheet.vue'
import { saveLiving, saveSettings, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { allocColor } from '../lib/colors'
import { distributionAt, man, splitRemainder, today, won, ymLabel, ymOf } from '../lib/calc'
import type { AllocationKind, Settings } from '../data/types'

const tab = ref('phases')
const tabs = [
  { id: 'phases', label: '구간' },
  { id: 'sim', label: '월별 시뮬레이션' },
  { id: 'accounts', label: '통장·생활비·설정' },
]
const now = ymOf(today())
const dist = (ym: string, pay = store.settings.netPay) =>
  distributionAt(ym, pay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings)

const phaseRows = computed(() =>
  store.phases.map((p) => {
    const start = p.from < now && (p.to === null || now <= p.to) ? now : p.from
    return { p, start, d: dist(start), current: p.from <= now && (p.to === null || now <= p.to) }
  }),
)

const ym = ref(now)
const pay = ref(store.settings.netPay)
const sim = computed(() => dist(ym.value, pay.value))
// Without a remainder target there is nothing to split (spec 003 S-1: exactly one remainder).
const split = computed(() => (sim.value.remainderTarget ? splitRemainder(sim.value.remainder, store.remainderSplit) : []))
const livingSum = computed(() => store.living.food + store.living.transit + store.living.allowance)
const livingName = computed(() => store.targets.find((t) => t.kind === 'living')?.name ?? '생활비')
const remainderName = computed(() => store.targets.find((t) => t.kind === 'remainder')?.name ?? '나머지')
const fixedTargets = computed(() => store.targets.filter((t) => t.kind === 'fixed'))

// ---------- editors ----------
const YM = /^\d{4}-(0[1-9]|1[0-2])$/
const phaseEd = useEditor(
  'phases',
  () => ({ id: '', label: '', name: '', from: now, to: null, amounts: {}, note: '' }),
  (p) => (!p.name.trim() ? '구간 이름을 입력해 주세요.'
    : !YM.test(p.from) ? '시작 월을 골라 주세요.'
    : p.to !== null && (!YM.test(p.to) || p.to < p.from) ? '끝 월은 시작 월과 같거나 뒤여야 해요.'
    : null),
)
// <input type="month"> gives '' for "no end"; the API wants null.
const phaseTo = computed({
  get: () => phaseEd.item.value?.to ?? '',
  set: (v: string) => { if (phaseEd.item.value) phaseEd.item.value.to = v || null },
})

const splitEd = useEditor('remainderSplit', () => ({ id: '', name: '', code: '', ratio: 0 }),
  (x) => (!x.name.trim() ? '항목 이름을 입력해 주세요.' : x.ratio < 0 || x.ratio > 1 ? '비율은 0~100% 사이여야 해요.' : null))
const splitPct = computed({
  get: () => Math.round((splitEd.item.value?.ratio ?? 0) * 10_000) / 100,
  set: (v: number) => { if (splitEd.item.value) splitEd.item.value.ratio = (Number(v) || 0) / 100 },
})
const ratioSum = computed(() => Math.round(store.remainderSplit.reduce((a, x) => a + x.ratio, 0) * 100))

const KIND: Record<AllocationKind, string> = { living: '생활비 합계', subscriptions: '구독 이체액', fixed: '구간별 고정', remainder: '나머지 전부' }
const targetEd = useEditor('targets', () => ({ id: '', name: '', kind: 'fixed', note: '' }),
  (x) => (!x.name.trim() ? '이름을 입력해 주세요.' : null))

const accEd = useEditor('accounts', () => ({ id: '', name: '', role: '', inflow: '', outflow: '' }),
  (a) => (!a.name.trim() ? '통장 이름을 입력해 주세요.' : null))

// Settings: edited as a copy and saved with a button, like the list editors.
const set = ref<Settings>({ ...store.settings })
const setMsg = ref('')
function resetSettings() {
  set.value = { ...store.settings }
  setMsg.value = ''
}
async function submitSettings() {
  try {
    await saveSettings(set.value)
    set.value = { ...store.settings }
    setMsg.value = '저장했어요.'
  } catch (e) {
    setMsg.value = (e as Error).message
  }
}
</script>

<template>
  <section>
    <h1>월급 분배</h1>
    <p class="lede">{{ store.settings.payDay }}일 월급 → {{ store.settings.transferDay }}일 분배. 생활비·구독 이체는 자동으로 계산하고, 고정 금액은 구간마다 정하고, 남는 금액은 전부 '{{ remainderName }}'으로 가요.</p>

    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'phases'">
      <div class="panel">
        <div class="card-h"><h3>분배 대상</h3><button class="btn sm" type="button" @click="targetEd.open()">+ 분배 대상 추가</button></div>
        <EditSheet v-if="targetEd.item.value" :key="targetEd.item.value.id || 'new'" :title="targetEd.item.value.id ? '분배 대상 수정' : '분배 대상 추가'" :error="targetEd.error.value" :busy="targetEd.busy.value"
          :can-delete="!!targetEd.item.value.id" @save="targetEd.save" @cancel="targetEd.close" @delete="targetEd.remove">
          <div class="field"><label for="tg-name">이름</label><input id="tg-name" v-model="targetEd.item.value.name" class="in"></div>
          <div class="field"><label for="tg-kind">종류</label>
            <select id="tg-kind" v-model="targetEd.item.value.kind" class="in"><option v-for="(v, k) in KIND" :key="k" :value="k">{{ v }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="tg-note">메모</label><input id="tg-note" v-model="targetEd.item.value.note" class="in"></div>
        </EditSheet>
        <div class="tbl">
          <table>
            <thead><tr><th>이름</th><th>종류</th><th>메모</th></tr></thead>
            <tbody>
              <tr v-for="t in store.targets" :key="t.id" class="click" tabindex="0" @click="targetEd.open(t)" @keydown.enter="targetEd.open(t)">
                <td><i class="dot" :style="{ background: allocColor(t.id) }"></i>{{ t.name }}</td><td>{{ KIND[t.kind] }}</td><td class="small muted">{{ t.note }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin:0">생활비 합계·구독 이체액·나머지는 하나씩만 둘 수 있어요. 나머지는 꼭 하나 있어야 해요.</p>
      </div>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="phaseEd.open()">+ 구간 추가</button></div>
      <EditSheet v-if="phaseEd.item.value" :key="phaseEd.item.value.id || 'new'" :title="phaseEd.item.value.id ? '구간 수정' : '구간 추가'" :error="phaseEd.error.value" :busy="phaseEd.busy.value"
        :can-delete="!!phaseEd.item.value.id" @save="phaseEd.save" @cancel="phaseEd.close" @delete="phaseEd.remove">
        <div class="field"><label for="ph-label">기호</label><input id="ph-label" v-model="phaseEd.item.value.label" class="in" placeholder="①"></div>
        <div class="field"><label for="ph-name">이름</label><input id="ph-name" v-model="phaseEd.item.value.name" class="in"></div>
        <div class="field"><label for="ph-from">시작 월</label><input id="ph-from" v-model="phaseEd.item.value.from" class="in" type="month"></div>
        <div class="field"><label for="ph-to">끝 월 (비우면 계속)</label><input id="ph-to" v-model="phaseTo" class="in" type="month"></div>
        <div v-for="t in fixedTargets" :key="t.id" class="field"><label :for="`ph-amt-${t.id}`">{{ t.name }}</label>
          <input :id="`ph-amt-${t.id}`" :value="phaseEd.item.value.amounts[t.id] ?? 0" class="in" type="number" step="10000" min="0"
            @input="phaseEd.item.value!.amounts[t.id] = Number(($event.target as HTMLInputElement).value) || 0"></div>
        <div class="field" style="grid-column:1/-1"><label for="ph-note">메모</label><input id="ph-note" v-model="phaseEd.item.value.note" class="in"></div>
      </EditSheet>
      <div v-for="r in phaseRows" :key="r.p.id" class="panel">
        <div class="btns" style="margin:0 0 10px;justify-content:space-between">
          <h3 style="margin:0">{{ r.p.label }} {{ r.p.name }} <span v-if="r.current" class="pill acc">지금</span></h3>
          <span class="mono small muted">{{ ymLabel(r.p.from) }} ~ {{ r.p.to ? ymLabel(r.p.to) : '' }}
            <button class="btn sm" type="button" :aria-label="`${r.p.name} 구간 수정`" @click="phaseEd.open(r.p)">수정</button></span>
        </div>
        <StackBar :rows="r.d.rows" />
        <p class="small muted" style="margin:8px 0 0">
          {{ ymLabel(r.start) }} 기준<template v-if="r.d.remainderTarget"> · {{ remainderName }} {{ man(r.d.remainder) }}</template><template v-if="r.p.note"> · {{ r.p.note }}</template>
        </p>
      </div>
    </div>

    <div v-else-if="tab === 'sim'">
      <MonthPicker v-model="ym" label="이체 월" />
      <div class="cols">
        <div class="panel">
          <div class="field" style="margin-bottom:14px"><label for="sim-pay">실수령 시뮬레이션 (원, 저장 안 됨 — 저장값은 설정에서)</label>
            <input id="sim-pay" v-model.number="pay" class="in" type="number" step="10000"></div>
          <p class="small" style="margin:0 0 10px">
            <span class="pill acc" v-if="sim.phase">{{ sim.phase.label }} {{ sim.phase.name }}</span>
            <span class="pill bad" v-else>구간 없음</span>
          </p>
          <StackBar :rows="sim.rows" />
          <div class="tbl" style="margin-top:14px">
            <table>
              <thead><tr><th>목적지</th><th class="n">금액</th><th>메모</th></tr></thead>
              <tbody>
                <tr v-for="r in sim.rows" :key="r.key"><td>{{ r.name }}</td><td class="n">{{ won(r.amount) }}</td><td class="small muted">{{ r.detail }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <h3 style="margin-top:0">'{{ remainderName }}' 나누기</h3>
          <div v-if="!sim.remainderTarget" class="callout warn"><span class="lbl">나머지 없음</span><p>남는 금액을 받을 '나머지 전부' 대상이 없어요. 구간 탭의 분배 대상에서 하나 정해 주세요.</p></div>
          <div v-else-if="sim.remainder < 0" class="callout warn"><span class="lbl">부족</span><p>나가는 금액이 실수령보다 {{ won(-sim.remainder) }} 많아요. 고정 금액이나 구독을 줄여야 해요.</p></div>
          <EditSheet v-if="splitEd.item.value" :key="splitEd.item.value.id || 'new'" :title="splitEd.item.value.id ? '나머지 분배 수정' : '나머지 분배 추가'" :error="splitEd.error.value" :busy="splitEd.busy.value"
            :can-delete="!!splitEd.item.value.id" @save="splitEd.save" @cancel="splitEd.close" @delete="splitEd.remove">
            <div class="field"><label for="rs-name">항목</label><input id="rs-name" v-model="splitEd.item.value.name" class="in"></div>
            <div class="field"><label for="rs-code">코드</label><input id="rs-code" v-model="splitEd.item.value.code" class="in"></div>
            <div class="field"><label for="rs-ratio">비율 %</label><input id="rs-ratio" v-model.number="splitPct" class="in" type="number" step="1" min="0" max="100"></div>
          </EditSheet>
          <div class="tbl">
            <table>
              <thead><tr><th>항목</th><th>코드</th><th class="n">비율</th><th class="n">금액</th></tr></thead>
              <tbody>
                <tr v-for="s in split" :key="s.id" class="click" tabindex="0" @click="splitEd.open(store.remainderSplit.find((x) => x.id === s.id))" @keydown.enter="splitEd.open(store.remainderSplit.find((x) => x.id === s.id))">
                  <td>{{ s.name }}</td><td class="mono small">{{ s.code }}</td><td class="n">{{ Math.round(s.ratio * 100) }}%</td><td class="n">{{ won(s.amount) }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="btns" style="margin:0 0 10px">
            <button class="btn sm" type="button" @click="splitEd.open()">+ 나머지 분배 추가</button>
            <span v-if="split.length && ratioSum !== 100" class="small" style="color:var(--warn)">비율 합계 {{ ratioSum }}% (마지막 항목이 남는 금액을 받아요)</span>
          </div>
          <p class="small muted" style="margin:0">마지막 항목을 뺀 나머지는 만 원 단위로 반올림하고, 마지막 항목이 남는 금액을 받아요.</p>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="accEd.open()">+ 통장 추가</button></div>
      <EditSheet v-if="accEd.item.value" :key="accEd.item.value.id || 'new'" :title="accEd.item.value.id ? '통장 수정' : '통장 추가'" :error="accEd.error.value" :busy="accEd.busy.value"
        :can-delete="!!accEd.item.value.id" @save="accEd.save" @cancel="accEd.close" @delete="accEd.remove">
        <div class="field"><label for="ac-name">통장</label><input id="ac-name" v-model="accEd.item.value.name" class="in"></div>
        <div class="field"><label for="ac-role">역할</label><input id="ac-role" v-model="accEd.item.value.role" class="in"></div>
        <div class="field"><label for="ac-in">입금</label><input id="ac-in" v-model="accEd.item.value.inflow" class="in"></div>
        <div class="field"><label for="ac-out">출금</label><input id="ac-out" v-model="accEd.item.value.outflow" class="in"></div>
      </EditSheet>
      <div class="tbl">
        <table>
          <thead><tr><th>통장</th><th>역할</th><th>입금</th><th>출금</th></tr></thead>
          <tbody>
            <tr v-for="a in store.accounts" :key="a.id" class="click" tabindex="0" @click="accEd.open(a)" @keydown.enter="accEd.open(a)">
              <td>{{ a.name }}</td><td>{{ a.role }}</td><td class="small">{{ a.inflow }}</td><td class="small">{{ a.outflow }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel" style="max-width:520px">
        <h3 style="margin-top:0">{{ livingName }} <span class="mono muted small">{{ won(livingSum) }}</span></h3>
        <div class="form">
          <div class="field"><label for="l-food">식비</label><input id="l-food" v-model.number="store.living.food" class="in" type="number" step="10000" @change="saveLiving()"></div>
          <div class="field"><label for="l-tr">교통비</label><input id="l-tr" v-model.number="store.living.transit" class="in" type="number" step="10000" @change="saveLiving()"></div>
          <div class="field"><label for="l-al">용돈</label><input id="l-al" v-model.number="store.living.allowance" class="in" type="number" step="10000" @change="saveLiving()"></div>
        </div>
      </div>
      <form class="panel" style="max-width:720px" aria-label="설정" novalidate @submit.prevent="submitSettings">
        <h3 style="margin-top:0">설정</h3>
        <div class="form">
          <div class="field"><label for="st-pay">월 실수령</label><input id="st-pay" v-model.number="set.netPay" class="in" type="number" step="10000" min="0"></div>
          <div class="field"><label for="st-payday">월급일</label><input id="st-payday" v-model.number="set.payDay" class="in" type="number" min="1" max="31"></div>
          <div class="field"><label for="st-xfer">분배 이체일</label><input id="st-xfer" v-model.number="set.transferDay" class="in" type="number" min="1" max="31"></div>
          <div class="field"><label for="st-bill">카드 결제일</label><input id="st-bill" v-model.number="set.billingDay" class="in" type="number" min="1" max="31"></div>
          <div class="field"><label for="st-round">구독 이체 올림 단위</label><input id="st-round" v-model.number="set.subRound" class="in" type="number" step="1000" min="1"></div>
          <div class="field"><label for="st-fx">환율 (원/$)</label><input id="st-fx" v-model.number="set.fxRate" class="in" type="number" step="any" min="0"></div>
          <div class="field"><label for="st-buf">환율 여유분 %</label><input id="st-buf" v-model.number="set.fxBuffer" class="in" type="number" step="any" min="0"></div>
        </div>
        <div class="btns">
          <button class="btn pri" type="submit">설정 저장</button>
          <button class="btn" type="button" @click="resetSettings">되돌리기</button>
          <span class="small muted" role="status">{{ setMsg }}</span>
        </div>
      </form>
    </div>
  </section>
</template>
