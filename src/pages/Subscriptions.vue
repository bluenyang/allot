<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import MonthPicker from '../components/MonthPicker.vue'
import TransferChart from '../components/TransferChart.vue'
import EditSheet from '../components/EditSheet.vue'
import PageHeader from '../components/PageHeader.vue'
import Icon from '../components/Icon.vue'
import { removeChange, removeSub, saveSettings, store, subName, upsertChange, upsertSub } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import {
  addYm, chargeKrw, changesIn, monthlyKrw, nextOccurrence, num, planAt, today, transferAt, usd, won, ymd, ymLabel, ymOf, ymRange,
} from '../lib/calc'
import type { PlanChange, Subscription } from '../data/types'
import { CAT_COLORS, CAT_LABEL } from '../lib/colors'

// 구독 (spec 007 S-4): KPI strip, status/category/path filters, a table, the add/edit modal.
// Not drawn (S-3): CSV export, AI analysis, "명세서에서 채우기".
const tab = ref('list')
const tabs = [
  { id: 'list', label: '목록', icon: 'list' },
  { id: 'preview', label: '전환 미리보기', icon: 'chart' },
  { id: 'changes', label: '변경 일정', icon: 'events' },
  { id: 'calc', label: '이체액 계산', icon: 'pay' },
]
const now = today()
const ym = ref(ymOf(now))

const PATH: Record<string, string> = { direct: '직접 결제', google: 'Google Play', apple: 'App Store', telecom: '통신사' }
const STATUS: Record<string, string> = { active: '구독 중', cancelled: '해지', company: '회사 지원' }

// ---------- list ----------
const rows = computed(() =>
  store.subscriptions
    .map((base) => {
      const p = planAt(base, store.planChanges, ym.value)
      const pending = store.planChanges.filter((c) => c.subId === base.id && (!c.effective || c.effective.slice(0, 7) > ym.value))
      return { base, p, monthly: p.status === 'active' ? monthlyKrw(p, store.settings) : 0, next: nextOccurrence(p, now), pending }
    })
    .sort((a, b) => (a.p.status === 'active' ? 0 : 1) - (b.p.status === 'active' ? 0 : 1) || b.monthly - a.monthly),
)
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ym.value))
const monthlyTotal = computed(() => xfer.value.monthlySum + xfer.value.yearlyMonthly)
const unverified = computed(() => rows.value.filter((r) => r.p.status === 'active' && !r.p.verified).length)

// Filters: status (as a segmented control, so the page keeps one row of tabs), category, payment path.
const status = ref<'all' | 'active' | 'company' | 'cancelled'>('all')
const cat = ref('')
const path = ref('')
const STATUS_TABS = computed(() => (['all', 'active', 'company', 'cancelled'] as const).map((id) => ({
  id, label: { all: '전체', active: '활성', company: '회사 지원', cancelled: '해지' }[id],
  count: id === 'all' ? rows.value.length : rows.value.filter((r) => r.p.status === id).length,
})))
const shown = computed(() => rows.value
  .filter((r) => (status.value === 'all' || r.p.status === status.value) && (!cat.value || r.p.category === cat.value) && (!path.value || r.p.path === path.value))
  .sort((a, b) => (a.next && a.p.status === 'active' ? a.next.getTime() : Infinity) - (b.next && b.p.status === 'active' ? b.next.getTime() : Infinity)))
const charge = (p: Subscription) => p.currency === 'USD' ? `USD ${p.amount.toFixed(2)}${p.vat ? ` +${p.vat}%` : ''}` : `KRW ${num(p.amount)}`
const subsName = computed(() => store.targets.find((t) => t.kind === 'subscriptions')?.name ?? '구독 이체')

// ---------- editor ----------
const blank = (): Subscription => ({
  id: '', name: '', category: 'tool', plan: '', amount: 0, currency: 'KRW', vat: 0, cycle: 'monthly',
  status: 'active', nextDate: '', path: 'direct', verified: false,
})
const edit = ref<Subscription | null>(null)
const err = ref('')
function openEdit(s?: Subscription) {
  edit.value = s ? { ...s, note: s.note ?? '' } : { ...blank(), note: '' }
  err.value = ''
}
const PLAN_KEYS = ['plan', 'amount', 'currency', 'vat', 'cycle', 'status'] as const
const PLAN_LABEL: Record<(typeof PLAN_KEYS)[number], string> = { plan: '플랜', amount: '금액', currency: '통화', vat: 'VAT', cycle: '주기', status: '상태' }
/** For the open editor: fields where a plan change already in effect at the 기준 월 overrides the base value. */
const overridden = computed(() => {
  const e = edit.value
  if (!e?.id) return null
  const applied = store.planChanges.filter((c) => c.subId === e.id && c.effective && c.effective.slice(0, 7) <= ym.value)
  if (!applied.length) return null
  const eff = planAt(e, store.planChanges, ym.value)
  const fields = PLAN_KEYS.filter((k) => eff[k] !== e[k]).map((k) => ({ k, label: PLAN_LABEL[k], base: show(k, e), now: show(k, eff) }))
  return fields.length ? { fields, changes: applied } : null
})
function show(k: (typeof PLAN_KEYS)[number], p: Subscription) {
  if (k === 'amount') return p.currency === 'USD' ? usd(p.amount) : won(p.amount)
  if (k === 'cycle') return p.cycle === 'yearly' ? '연간' : '월간'
  if (k === 'status') return STATUS[p.status] ?? p.status
  if (k === 'vat') return `${p.vat}%`
  return String(p[k] || '—')
}
const preview = computed(() => (edit.value ? monthlyKrw({ ...edit.value, amount: Number(edit.value.amount) || 0 }, store.settings) : 0))
async function save() {
  const s = edit.value!
  if (!s.name.trim()) return (err.value = '서비스 이름을 입력해 주세요.')
  if (!(s.amount >= 0)) return (err.value = '금액은 숫자만 입력할 수 있어요.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.nextDate)) return (err.value = '다음 결제일을 선택해 주세요.')
  if (s.currency === 'KRW') s.vat = 0
  try {
    await upsertSub(s)
    edit.value = null
  } catch (e) {
    err.value = (e as Error).message
  }
}
async function del() {
  try {
    await removeSub(edit.value!.id)
    edit.value = null
  } catch (e) {
    err.value = (e as Error).message
  }
}

// ---------- preview ----------
const from = ref(ymOf(now))
const series = computed(() =>
  ymRange(from.value, 12).map((m) => ({
    ym: m,
    value: transferAt(store.subscriptions, store.planChanges, store.settings, m).needed,
    changed: changesIn(store.planChanges, m).length > 0,
  })),
)
const pick = ref(ymOf(now))
const pickPrev = computed(() => addYm(pick.value, -1))
const cmp = computed(() => {
  const a = transferAt(store.subscriptions, store.planChanges, store.settings, pickPrev.value)
  const b = transferAt(store.subscriptions, store.planChanges, store.settings, pick.value)
  const ids = new Set([...a.items, ...b.items].map((i) => i.sub.id))
  const list = [...ids].map((id) => {
    const x = a.items.find((i) => i.sub.id === id)
    const y = b.items.find((i) => i.sub.id === id)
    return { id, name: (y ?? x)!.sub.name, before: x, after: y, diff: (y?.monthly ?? 0) - (x?.monthly ?? 0) }
  }).filter((r) => Math.abs(r.diff) >= 1 || r.before?.sub.plan !== r.after?.sub.plan)
  return { a, b, list }
})

// ---------- changes ----------
const sortedChanges = computed(() =>
  [...store.planChanges].sort((a, b) => (a.effective ?? '9999') < (b.effective ?? '9999') ? -1 : 1),
)
const chg = ref<PlanChange | null>(null)
const chgErr = ref('')
function openChange(c?: PlanChange) {
  chg.value = c ? JSON.parse(JSON.stringify(c)) : { id: '', subId: store.subscriptions[0]?.id ?? '', effective: '', to: {}, note: '' }
  chgErr.value = ''
}
function setTo(key: string, v: string) {
  const to = chg.value!.to as Record<string, unknown>
  if (v === '') delete to[key]
  else to[key] = key === 'amount' || key === 'vat' ? Number(v) : v
}
async function saveChange() {
  const c = chg.value!
  if (!c.subId) return (chgErr.value = '구독을 골라 주세요.')
  if (!Object.keys(c.to).length) return (chgErr.value = '바뀌는 항목을 하나 이상 입력해 주세요.')
  if (c.effective === '') c.effective = null
  try {
    await upsertChange(c)
    chg.value = null
  } catch (e) {
    chgErr.value = (e as Error).message
  }
}
async function delChange(id: string) {
  try {
    await removeChange(id)
    chg.value = null
  } catch (e) {
    chgErr.value = (e as Error).message
  }
}
function describe(c: PlanChange) {
  const base = store.subscriptions.find((s) => s.id === c.subId)
  const t = c.to
  const parts: string[] = []
  if (t.plan) parts.push(t.plan)
  if (t.amount != null) parts.push((t.currency ?? base?.currency) === 'USD' ? usd(t.amount) : won(t.amount))
  if (t.cycle) parts.push(t.cycle === 'yearly' ? '연간' : '월간')
  if (t.status) parts.push(STATUS[t.status])
  return parts.join(' · ')
}
</script>

<template>
  <section>
    <PageHeader crumb="관리" title="구독" desc="정기 결제와 플랜 전환을 관리해요. USD 항목은 적용 환율과 VAT로 원화 환산합니다.">
      <button class="btn pri" type="button" @click="tab = 'list'; openEdit()"><Icon name="plus" />구독 추가</button>
    </PageHeader>

    <section class="strip" aria-label="구독 요약">
      <div><span class="l">월 환산 합계</span><span class="v">{{ fmtMoney(monthlyTotal) }}</span><span class="s">{{ ymLabel(ym) }} 기준</span></div>
      <div><span class="l">연 환산 합계</span><span class="v">{{ fmtMoney(monthlyTotal * 12) }}</span><span class="s">월 환산 × 12</span></div>
      <div><span class="l">영수증 미확인</span><span class="v" :class="{ sig: unverified > 0 }">{{ unverified }}<small class="unit"> 건</small></span><span class="s">활성 구독 중</span></div>
      <div><span class="l">적용 환율</span><span class="v">₩{{ num(store.settings.fxRate) }}</span><span class="s">버퍼 {{ store.settings.fxBuffer }}%</span></div>
    </section>

    <SubTabs v-model="tab" :tabs="tabs" />

    <!-- 목록 -->
    <div v-if="tab === 'list'">
      <div class="filters">
        <div class="seg" role="group" aria-label="상태">
          <button v-for="t in STATUS_TABS" :key="t.id" type="button" :aria-pressed="status === t.id" @click="status = t.id">{{ t.label }} <span class="c">{{ t.count }}</span></button>
        </div>
        <select v-model="cat" class="in fsel" aria-label="분류"><option value="">분류 전체</option><option v-for="(v, k) in CAT_LABEL" :key="k" :value="k">{{ v }}</option></select>
        <select v-model="path" class="in fsel" aria-label="결제 경로"><option value="">결제 경로 전체</option><option v-for="(v, k) in PATH" :key="k" :value="k">{{ v }}</option></select>
        <span class="sp"></span>
        <MonthPicker v-model="ym" label="기준 월" />
      </div>

      <EditSheet v-if="edit" :key="edit.id || 'new'" :title="edit.id ? '구독 수정' : '구독 추가'" :error="err" :can-delete="!!edit.id"
        desc="저장하면 서버에 먼저 기록되고 변경 내역에 남아요." @save="save" @cancel="edit = null" @delete="del">
          <div class="field" style="grid-column:1/-1"><label for="e-name" class="req">서비스 이름</label><input id="e-name" v-model="edit.name" class="in" placeholder="예: 영상 스트리밍" required></div>
          <div class="field"><label for="e-cat">분류</label>
            <select id="e-cat" v-model="edit.category" class="in"><option v-for="(v, k) in CAT_LABEL" :key="k" :value="k">{{ v }}</option></select></div>
          <div class="field"><label for="e-plan">플랜</label><input id="e-plan" v-model="edit.plan" class="in"></div>
          <div class="field"><span class="flabel" id="e-cycle-l">결제 주기</span>
            <div class="seg" role="group" aria-labelledby="e-cycle-l">
              <button type="button" :aria-pressed="edit.cycle === 'monthly'" @click="edit.cycle = 'monthly'">월간</button>
              <button type="button" :aria-pressed="edit.cycle === 'yearly'" @click="edit.cycle = 'yearly'">연간</button>
            </div></div>
          <div class="field"><label for="e-amount" class="req">금액</label><input id="e-amount" v-model.number="edit.amount" class="in num" type="number" step="any" min="0" required></div>
          <div class="field"><label for="e-cur">통화</label>
            <select id="e-cur" v-model="edit.currency" class="in"><option value="KRW">KRW · 원</option><option value="USD">USD · 달러</option></select></div>
          <div v-if="edit.currency === 'USD'" class="field"><label for="e-vat">VAT (%)</label><input id="e-vat" v-model.number="edit.vat" class="in num" type="number" step="any" min="0"><span class="hint">USD 결제에 붙는 부가세</span></div>
          <div class="field"><label for="e-next">다음 결제일</label><input id="e-next" v-model="edit.nextDate" class="in" type="date"></div>
          <div class="field"><label for="e-path">결제 경로</label>
            <select id="e-path" v-model="edit.path" class="in"><option v-for="(v, k) in PATH" :key="k" :value="k">{{ v }}</option></select></div>
          <div class="field"><label for="e-status">상태</label>
            <select id="e-status" v-model="edit.status" class="in"><option v-for="(v, k) in STATUS" :key="k" :value="k">{{ v }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="e-note">메모</label><input id="e-note" v-model="edit.note" class="in"></div>
        <template #after>
          <label class="chk" style="border:0"><input id="e-ver" v-model="edit.verified" type="checkbox"><span>영수증으로 금액과 VAT를 확인했어요</span></label>
          <div class="pvw"><span>월 환산 미리보기</span><b>{{ fmtMoney(preview) }}</b></div>
          <div v-if="overridden" class="callout warn" data-testid="override-note">
            <span class="lbl">전환 적용 중</span>
            <p>여기서는 <b>기본값</b>(전환 전)을 고쳐요. {{ ymLabel(ym) }}에는 예약된 전환이 적용돼서 목록에 이렇게 보여요:
              <template v-for="(f, i) in overridden.fields" :key="f.k">{{ i ? ', ' : ' ' }}{{ f.label }} 기본값 {{ f.base }} → 적용값 <b>{{ f.now }}</b></template>.
              목록 값을 바꾸려면 전환을 고쳐 주세요.
              <button v-for="c in overridden.changes" :key="c.id" class="btn sm" type="button" @click="edit = null; tab = 'changes'; openChange(c)">{{ c.effective }} 전환 수정</button>
            </p>
          </div>
        </template>
      </EditSheet>

      <p class="small muted count">{{ shown.length }}개 · 다음 결제일 순 · 서비스를 누르면 수정(기준 플랜, 전환 전)</p>
      <div class="tbl">
        <table>
          <thead><tr><th scope="col">서비스</th><th scope="col">분류</th><th scope="col">주기</th><th scope="col" class="n">청구 금액</th><th scope="col" class="n">월 환산</th><th scope="col">다음 결제</th><th scope="col">결제 경로</th><th scope="col">영수증</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.base.id" :class="{ dim: r.p.status !== 'active' }">
              <td><button type="button" class="svc" @click="openEdit(r.base)"><b>{{ r.p.name }}</b><span>{{ r.p.plan || '—' }}<template v-if="r.pending.length"> · 전환 예정</template></span></button></td>
              <td><span class="pill tag">{{ CAT_LABEL[r.p.category] }}</span></td>
              <td>{{ r.p.cycle === 'yearly' ? '연간' : '월간' }}</td>
              <td class="n mono">{{ r.p.status === 'company' ? '회사 부담' : charge(r.p) }}</td>
              <td class="n">{{ r.p.status === 'active' ? fmtMoney(r.monthly) : fmtMoney(0) }}</td>
              <td class="mono">{{ r.next && r.p.status === 'active' ? fmtDate(r.next) : '—' }}</td>
              <td>{{ r.p.status === 'company' ? '회사' : PATH[r.p.path] }}</td>
              <td><span v-if="r.p.status !== 'active'" class="pill mute">{{ STATUS[r.p.status] }}</span><span v-else-if="r.p.verified" class="pill ok">확인됨</span><span v-else class="pill warn">미확인</span></td>
            </tr>
            <tr v-if="!shown.length"><td colspan="8" class="muted">조건에 맞는 구독이 없어요.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 전환 미리보기 -->
    <div v-else-if="tab === 'preview'">
      <MonthPicker v-model="from" label="시작 월" />
      <div class="panel">
        <h3 style="margin-top:0">12개월 필요 이체액 <span class="small muted">막대를 누르면 전월 대비를 봐요</span></h3>
        <TransferChart :points="series" :selected="pick" @pick="(m) => (pick = m)" />
      </div>
      <div class="strip">
        <div><div class="l">{{ ymLabel(pickPrev) }}</div><div class="v">{{ fmtMoney(cmp.a.needed) }}</div></div>
        <div><div class="l">{{ ymLabel(pick) }}</div><div class="v">{{ fmtMoney(cmp.b.needed) }}</div></div>
        <div><div class="l">차이</div><div class="v" :style="{ color: cmp.b.needed > cmp.a.needed ? 'var(--neg-text)' : cmp.b.needed < cmp.a.needed ? 'var(--primary-text)' : '' }">{{ cmp.b.needed - cmp.a.needed > 0 ? '+' : '' }}{{ fmtMoney(cmp.b.needed - cmp.a.needed) }}</div><div class="s">{{ subsName }} {{ fmtMoney(cmp.a.transfer) }} → {{ fmtMoney(cmp.b.transfer) }}</div></div>
      </div>
      <div class="panel"><div class="tbl">
        <table>
          <thead><tr><th>서비스</th><th>{{ ymLabel(pickPrev) }}</th><th>{{ ymLabel(pick) }}</th><th class="n">월 환산 차이</th></tr></thead>
          <tbody>
            <tr v-for="r in cmp.list" :key="r.id">
              <td>{{ r.name }}</td>
              <td class="small">{{ r.before ? `${r.before.sub.plan} · ${fmtMoney(r.before.monthly)}` : '—' }}</td>
              <td class="small">{{ r.after ? `${r.after.sub.plan} · ${fmtMoney(r.after.monthly)}` : '—' }}</td>
              <td class="n" :class="r.diff > 0 ? 'up' : 'down'">{{ r.diff > 0 ? '+' : '' }}{{ fmtMoney(r.diff) }}</td>
            </tr>
            <tr v-if="!cmp.list.length"><td colspan="4" class="muted">전월과 같아요.</td></tr>
          </tbody>
        </table>
      </div></div>
      <div class="callout ok"><span class="lbl">분배 반영</span><p>구독 이체액이 바뀌는 달은 분배 자동이체 금액도 같이 바꿔요. 줄어든 만큼은 나머지로 가요.</p></div>
    </div>

    <!-- 변경 일정 -->
    <div v-else-if="tab === 'changes'">
      <EditSheet v-if="chg" :key="chg.id || 'new'" :title="chg.id ? '전환 수정' : '전환 예약'" :error="chgErr" :can-delete="!!chg.id"
        @save="saveChange" @cancel="chg = null" @delete="delChange(chg.id)">
          <div class="field"><label for="c-sub">구독</label>
            <select id="c-sub" v-model="chg.subId" class="in"><option v-for="s in store.subscriptions" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
          <div class="field"><label for="c-eff">적용일 (비우면 날짜 미정)</label><input id="c-eff" v-model="chg.effective" class="in" type="date"></div>
          <div class="field"><label for="c-plan">새 플랜</label><input id="c-plan" :value="chg.to.plan ?? ''" class="in" @input="setTo('plan', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-amt">새 금액</label><input id="c-amt" :value="chg.to.amount ?? ''" class="in" type="number" step="any" @input="setTo('amount', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-cur">통화</label>
            <select id="c-cur" :value="chg.to.currency ?? ''" class="in" @change="setTo('currency', ($event.target as HTMLSelectElement).value)"><option value="">그대로</option><option value="KRW">원</option><option value="USD">달러</option></select></div>
          <div class="field"><label for="c-vat">VAT %</label><input id="c-vat" :value="chg.to.vat ?? ''" class="in" type="number" step="any" @input="setTo('vat', ($event.target as HTMLInputElement).value)"></div>
          <div class="field"><label for="c-cyc">주기</label>
            <select id="c-cyc" :value="chg.to.cycle ?? ''" class="in" @change="setTo('cycle', ($event.target as HTMLSelectElement).value)"><option value="">그대로</option><option value="monthly">월간</option><option value="yearly">연간</option></select></div>
          <div class="field"><label for="c-st">상태</label>
            <select id="c-st" :value="chg.to.status ?? ''" class="in" @change="setTo('status', ($event.target as HTMLSelectElement).value)"><option value="">그대로</option><option v-for="(v, k) in STATUS" :key="k" :value="k">{{ v }}</option></select></div>
          <div class="field" style="grid-column:1/-1"><label for="c-note">메모</label><input id="c-note" v-model="chg.note" class="in"></div>
      </EditSheet>
      <div class="panel">
      <div class="card-h"><h3>예약된 전환</h3><button class="btn sm" type="button" @click="openChange()">+ 전환 예약</button></div>
      <p class="small muted" style="margin:-6px 0 8px">해지는 상태를 '해지'로 바꾸는 전환으로 예약해요.</p>
      <div class="tbl">
        <table>
          <thead><tr><th>적용일</th><th>구독</th><th>바뀌는 내용</th><th>메모</th></tr></thead>
          <tbody>
            <tr v-for="c in sortedChanges" :key="c.id" class="click" @click="openChange(c)">
              <td class="mono">{{ c.effective ? fmtDate(c.effective) : '날짜 미정' }}</td>
              <td>{{ subName(c.subId) }}</td>
              <td>{{ describe(c) }}</td>
              <td class="small muted">{{ c.note }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>
    </div>

    <!-- 계산 -->
    <div v-else>
      <MonthPicker v-model="ym" label="기준 월" />
      <div class="cols">
        <div class="panel">
          <h3 style="margin-top:0">기준값</h3>
          <div class="form">
            <div class="field"><label for="s-fx">환율 (원/$)</label><input id="s-fx" v-model.number="store.settings.fxRate" class="in" type="number" step="any" @change="saveSettings()"></div>
            <div class="field"><label for="s-buf">환율 여유분 %</label><input id="s-buf" v-model.number="store.settings.fxBuffer" class="in" type="number" step="any" @change="saveSettings()"></div>
          </div>
          <pre style="margin:14px 0 0"><code>원화 결제액 = 금액 × (1 + VAT) × 환율   (달러)
월 환산     = 원화 결제액 ÷ 12           (연간)
여유분      = 달러 항목 월 환산 × {{ store.settings.fxBuffer }}%
필요 이체액 = 합계 + 여유분 → 1,000원 올림
구독 이체   = 필요 이체액 → {{ num(store.settings.subRound) }}원 단위 올림</code></pre>
        </div>
        <div class="panel">
          <h3 style="margin-top:0">{{ ymLabel(ym) }} 구성</h3>
          <div class="tbl">
            <table>
              <tbody>
                <tr><td>월간 구독</td><td class="n">{{ fmtMoney(xfer.monthlySum) }}</td></tr>
                <tr><td>연간 구독 ÷ 12</td><td class="n">{{ fmtMoney(xfer.yearlyMonthly) }}</td></tr>
                <tr><td>환율 여유분 ({{ store.settings.fxBuffer }}%)</td><td class="n">{{ fmtMoney(xfer.buffer) }}</td></tr>
                <tr class="total"><td>필요 이체액</td><td class="n">{{ fmtMoney(xfer.needed) }}</td></tr>
                <tr><td>{{ subsName }}</td><td class="n">{{ fmtMoney(xfer.transfer) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="tbl">
        <table>
          <thead><tr><th>서비스</th><th>플랜</th><th class="n">월 환산</th><th class="n">비중</th></tr></thead>
          <tbody>
            <tr v-for="i in xfer.items" :key="i.sub.id">
              <td>{{ i.sub.name }}</td><td class="small">{{ i.sub.plan }}</td>
              <td class="n">{{ fmtMoney(i.monthly) }}</td>
              <td class="n small">{{ Math.round((i.monthly / (xfer.monthlySum + xfer.yearlyMonthly)) * 100) }}%</td>
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>
  </section>
</template>

<style scoped>
.unit{font-size:14px;font-weight:500;color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px}
.filters .ymbar{margin:0}
.fsel{width:auto;min-width:140px}
.seg .c{font-size:11px;color:var(--subtle);font-variant-numeric:tabular-nums}
.sp{flex:1}
.count{margin:0 0 8px}
.svc{all:unset;cursor:pointer;display:flex;flex-direction:column;min-width:0}
.svc b{font-weight:600}
.svc span{font-size:12px;color:var(--muted)}
.svc:hover b{text-decoration:underline}
.svc:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px;border-radius:var(--r-ctl)}
.req::after{content:" *";color:var(--neg-text)}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.hint{font-size:12px;color:var(--subtle)}
.pvw{display:flex;justify-content:space-between;align-items:center;margin:12px 0;padding:12px 14px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border)}
.pvw span{font-size:13px;color:var(--muted)}
.pvw b{font-size:18px;font-variant-numeric:tabular-nums}
</style>
