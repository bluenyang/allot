<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import EditSheet from '../components/EditSheet.vue'
import { saveItem, store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import { today, won, ymOf } from '../lib/calc'
import type { EventKind, EventState } from '../data/types'

const tab = ref('timeline')
const tabs = [
  { id: 'timeline', label: '타임라인' },
  { id: 'debt', label: '부채' },
]
const now = ymOf(today())
const kinds = computed(() => [...new Set(store.events.map((e) => e.kind))])
const kind = ref('')
const hideDone = ref(false)

const years = computed(() => {
  const list = store.events.filter((e) => (!kind.value || e.kind === kind.value) && (!hideDone.value || e.state !== 'done'))
  const map = new Map<string, typeof list>()
  for (const e of list) {
    const y = e.when.slice(0, 4)
    map.set(y, [...(map.get(y) ?? []), e])
  }
  return [...map.entries()]
})
const NEXT: Record<EventState, EventState> = { todo: 'doing', doing: 'done', done: 'todo' }
const LABEL: Record<EventState, string> = { todo: '예정', doing: '진행', done: '완료' }
const CLS: Record<EventState, string> = { todo: 'mute', doing: 'acc', done: 'ok' }
const KINDS: EventKind[] = ['통장', '구독', '분배', '정책', '세금', '카드', '저축', '수입', '대출', '투자']

const evEd = useEditor('events', () => ({ id: '', when: now, kind: '저축', title: '', state: 'todo' }),
  (e) => (!e.title.trim() ? '내용을 입력해 주세요.'
    : !/^\d{4}-\d{2}(~\d{2})?$/.test(e.when) ? '시기는 2027-03 또는 2027-03~05 형식으로 입력해 주세요.' : null))
const debtEd = useEditor('debts', () => ({ id: '', name: '', principal: 0, rate: '', method: '', plan: '' }),
  (d) => (!d.name.trim() ? '항목 이름을 입력해 주세요.' : !(d.principal >= 0) ? '원금을 숫자로 입력해 주세요.' : null))
</script>

<template>
  <section>
    <h1>이벤트</h1>
    <p class="lede">저축 금액이 바뀌는 시점, 상품 가입, 대출 상환 같은 일정. 상태 칩을 누르면 예정 → 진행 → 완료로 바뀌고, 내용을 누르면 수정해요.</p>
    <SubTabs v-model="tab" :tabs="tabs" />

    <div v-if="tab === 'timeline'">
      <div class="btns" style="margin:0 0 14px">
        <select id="ev-kind" v-model="kind" class="in" style="width:auto" aria-label="분류">
          <option value="">전체 분류</option>
          <option v-for="k in kinds" :key="k" :value="k">{{ k }}</option>
        </select>
        <label class="small"><input id="ev-hide" v-model="hideDone" type="checkbox" style="accent-color:var(--accent)"> 완료 숨기기</label>
        <button class="btn pri" type="button" style="margin-left:auto" @click="evEd.open()">+ 이벤트 추가</button>
      </div>
      <EditSheet v-if="evEd.item.value" :key="evEd.item.value.id || 'new'" :title="evEd.item.value.id ? '이벤트 수정' : '이벤트 추가'" :error="evEd.error.value" :busy="evEd.busy.value"
        :can-delete="!!evEd.item.value.id" @save="evEd.save" @cancel="evEd.close" @delete="evEd.remove">
        <div class="field"><label for="ev-when">시기 (YYYY-MM 또는 YYYY-MM~MM)</label><input id="ev-when" v-model="evEd.item.value.when" class="in" placeholder="2027-03"></div>
        <div class="field"><label for="ev-k">분류</label>
          <select id="ev-k" v-model="evEd.item.value.kind" class="in"><option v-for="k in KINDS" :key="k" :value="k">{{ k }}</option></select></div>
        <div class="field"><label for="ev-st">상태</label>
          <select id="ev-st" v-model="evEd.item.value.state" class="in"><option v-for="(v, k) in LABEL" :key="k" :value="k">{{ v }}</option></select></div>
        <div class="field" style="grid-column:1/-1"><label for="ev-title">내용</label><input id="ev-title" v-model="evEd.item.value.title" class="in"></div>
      </EditSheet>
      <div v-for="[y, list] in years" :key="y" class="panel">
        <h3 style="margin-top:0" class="mono">{{ y }}</h3>
        <ul class="list">
          <li v-for="e in list" :key="e.id" :style="{ opacity: e.state === 'done' ? 0.6 : 1 }">
            <span class="when" :style="{ color: e.when.slice(0, 7) === now ? 'var(--accent)' : '' }">{{ e.when.slice(5) }}월</span>
            <button type="button" class="ev-t" :aria-label="`${e.title} 수정`" @click="evEd.open(e)"><span class="pill mute">{{ e.kind }}</span> {{ e.title }}</button>
            <button type="button" class="pill" :class="CLS[e.state]" style="border:0;cursor:pointer;font-family:inherit" @click="saveItem('events', { ...e, state: NEXT[e.state] }).catch(() => {})">{{ LABEL[e.state] }}</button>
          </li>
        </ul>
      </div>
      <p v-if="!years.length" class="empty">조건에 맞는 이벤트가 없어요.</p>
    </div>

    <div v-else>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="debtEd.open()">+ 부채 추가</button></div>
      <EditSheet v-if="debtEd.item.value" :key="debtEd.item.value.id || 'new'" :title="debtEd.item.value.id ? '부채 수정' : '부채 추가'" :error="debtEd.error.value" :busy="debtEd.busy.value"
        :can-delete="!!debtEd.item.value.id" @save="debtEd.save" @cancel="debtEd.close" @delete="debtEd.remove">
        <div class="field"><label for="db-name">항목</label><input id="db-name" v-model="debtEd.item.value.name" class="in"></div>
        <div class="field"><label for="db-pr">원금</label><input id="db-pr" v-model.number="debtEd.item.value.principal" class="in" type="number" step="10000" min="0"></div>
        <div class="field"><label for="db-rate">금리</label><input id="db-rate" v-model="debtEd.item.value.rate" class="in"></div>
        <div class="field"><label for="db-m">상환 방식</label><input id="db-m" v-model="debtEd.item.value.method" class="in"></div>
        <div class="field" style="grid-column:1/-1"><label for="db-plan">계획</label><input id="db-plan" v-model="debtEd.item.value.plan" class="in"></div>
      </EditSheet>
      <div class="tbl">
        <table>
          <thead><tr><th>항목</th><th class="n">원금</th><th>금리</th><th>상환 방식</th><th>계획</th></tr></thead>
          <tbody>
            <tr v-for="d in store.debts" :key="d.id" class="click" tabindex="0" @click="debtEd.open(d)" @keydown.enter="debtEd.open(d)">
              <td>{{ d.name }}</td><td class="n">{{ won(d.principal) }}</td><td class="mono">{{ d.rate }}</td><td>{{ d.method }}</td><td>{{ d.plan }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
