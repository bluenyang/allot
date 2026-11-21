<script setup lang="ts">
// 지출 추가·수정 (spec 011 S-2, S-3, S-4, S-6, S-8): three steps — 무엇을 샀나요, 내는 방식, 회차 확인 — for a one-off
// spending of the 일반 tab (a lump sum) and of the 할부 tab (card installment, split). The rounds are worked out by
// `planRounds` (calc.ts) and shown on the last step before they are saved; the saved spending carries them in its body.
// Edit mode opens with the stored values. While the inputs that decide the rounds (amount, currency, how, count, fee,
// interval, dates) are as they were, the stored rounds are saved untouched (edited flags and all); once one is
// changed the rounds are worked out again and the editor says so first (A-22: a round marked 냄 keeps that mark under
// the same number, an edited round and an early payoff are dropped). Delete asks first, like the subscription editor.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'
import DateInput from './DateInput.vue'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Select from './Select.vue'
import Seg from './Seg.vue'
import Tip from './Tip.vue'
import { addYm, monthDay, num, planRounds, spendingKrw, today, ymd } from '../lib/calc'
import { fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import type { Currency, PayBy, Spending, SpendingRound, SpendHow, SpendInterval } from '../data/types'

const props = defineProps<{ initial: Spending | null; /** which tab asked for a new one: decides how it starts (일시불 or 카드 할부) */ start?: 'general' | 'inst' }>()
const emit = defineEmits<{ close: [] }>()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const I = props.initial
// the stored words of the default categories (the data keeps what was typed; a chip matches the word of either language)
const CATS = [['living', '생활'], ['appliance', '가전'], ['travel', '여행'], ['event', '경조사'], ['medical', '의료'], ['insurance', '보험']] as const
const catWord = (id: string) => t(`spending.ed.cat.${id}` as 'spending.ed.cat.living')
const catOf = (c: string) => CATS.find(([id, ko]) => c === ko || c === catWord(id))?.[0] ?? (c === '기타' || c === catWord('other') ? 'other' : '')
const COUNTS: Record<'installment' | 'split', number[]> = { installment: [3, 6, 12], split: [2, 3, 4] }
const storedFirst = I?.rounds.find((r) => r.no === 1)?.date ?? ''
const storedCustom = I?.interval === 'custom' ? [...I.rounds].filter((r) => r.no <= I.count).sort((a, b) => a.no - b.no).map((r) => r.date) : []
const feeOf = (how: SpendHow, payBy: PayBy, fee: number) => (how === 'installment' && payBy === 'card' ? fee : 0)

const blank = (): Spending => ({
  id: '', name: '', note: '', category: '', bought: ymd(today()), amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: props.start === 'inst' ? 'installment' : 'lump', payBy: 'card', count: props.start === 'inst' ? 6 : 1, fee: 0, interval: null, cancelled: false, rounds: [],
})
const { item: edit, error, busy, open, close, save: saveDraft, remove } = useEditor('spendings', blank, validate)
open(I ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const isNew = !I
const title = I ? t(I.how === 'lump' ? 'spending.ed.editGeneral' : 'spending.ed.editInst', { name: I.name }) : t(props.start === 'inst' ? 'spending.addInst' : 'spending.addGeneral')

// ---------- what the user types ----------
const name = ref(I?.name ?? '')
const note = ref(I?.note ?? '')
const memoOpen = ref(!!I?.note)
const amount = ref<number | ''>(I ? I.amount : '')
const currency = ref<Currency>(I?.currency ?? 'KRW')
const bought = ref(I?.bought ?? edit.value!.bought)
const catId = ref(I ? catOf(I.category) || 'other' : 'living')
const catOther = ref(I && !catOf(I.category) ? I.category : '')
const catTouched = ref(false) // an untouched category is saved as it was stored, whatever language the chips are in
const pickCat = (id: string) => { catId.value = id; catTouched.value = true }
const how = ref<SpendHow>(edit.value!.how)
const payBy = ref<PayBy>(edit.value!.payBy)
const countSel = ref(I ? (how.value !== 'lump' && COUNTS[how.value].includes(I.count) ? String(I.count) : 'c') : how.value === 'installment' ? '6' : '3')
const countCustom = ref<number | ''>(I && countSel.value === 'c' && how.value !== 'lump' ? I.count : '')
const feeOn = ref((I?.fee ?? 0) > 0)
const fee = ref<number | ''>(I && I.fee > 0 ? I.fee : '')
const interval = ref<SpendInterval>(I?.interval ?? 'monthly')
const customDates = ref<string[]>([...storedCustom])
// a lump sum is 남음, 냄 or 취소 (review 13: the 일반 tab has no other place to cancel one); 취소 keeps its round, which then counts nowhere
const lumpState = ref<'left' | 'paid' | 'cancelled'>(I?.how === 'lump' ? (I.cancelled ? 'cancelled' : I.rounds.find((r) => r.state !== 'merged')?.state === 'paid' ? 'paid' : 'left') : 'left')

const step = ref(0)
const askDel = ref(false)
const askRe = ref(false)
const steps = computed(() => [t('spending.ed.stepBought'), t('spending.ed.stepHow'), t('spending.ed.stepRounds')])
const currencyOpts = [{ id: 'KRW', label: 'KRW' }, { id: 'USD', label: 'USD' }]
const howOpts = computed(() => [
  { id: 'lump', label: t('spending.ed.howLump') }, { id: 'installment', label: t('spending.ed.howInst') }, { id: 'split', label: t('spending.ed.howSplit') },
  { id: 'buffer', label: t('spending.ed.howBuffer'), disabled: true }, // 0.1.6
])
const stateOpts = computed(() => [{ id: 'left', label: t('spending.inst.round.left') }, { id: 'paid', label: t('spending.inst.round.paid') }, { id: 'cancelled', label: t('spending.ed.stateCancelled') }])
const feeOpts = computed(() => [{ id: 'free', label: t('spending.ed.interestFree') }, { id: 'fee', label: t('spending.ed.interestFee') }])
const intervalOpts = computed(() => (['monthly', 'biweekly', 'custom'] as const).map((v) => ({ value: v, label: t(`spending.ed.interval.${v}` as 'spending.ed.interval.monthly') })))
const payOpts = computed(() => (how.value === 'installment' ? ['card'] as const : ['card', 'salary', 'subs'] as const).map((v) => ({
  value: v, label: v === 'card' ? t('spending.ed.payCard', { day: store.settings.billingDay }) : t(`spending.ed.pay.${v}` as 'spending.ed.pay.salary'),
})))
const multi = computed(() => how.value !== 'lump')
const countOpts = computed(() => [
  ...COUNTS[how.value === 'split' ? 'split' : 'installment'].map((n) => ({ id: String(n), label: t(how.value === 'split' ? 'spending.ed.times' : 'spending.ed.months', { n }) })),
  { id: 'c', label: t('spending.ed.custom') },
])
const countLabel = computed(() => t(how.value === 'split' ? 'spending.ed.countSplit' : 'spending.ed.countInst'))
const countN = computed(() => (how.value === 'lump' ? 1 : countSel.value === 'c' ? (typeof countCustom.value === 'number' ? countCustom.value : NaN) : Number(countSel.value)))
const countOk = computed(() => Number.isInteger(countN.value) && countN.value >= (multi.value ? 2 : 1) && countN.value <= 60)
const feeN = computed(() => (feeOn.value && typeof fee.value === 'number' ? fee.value : 0))
const feeEff = computed(() => feeOf(how.value, payBy.value, feeN.value))
const customRound = computed(() => how.value === 'split' && interval.value === 'custom')

watch(how, (h) => {
  countSel.value = h === 'installment' ? '6' : '3'
  countCustom.value = ''
  if (h === 'installment') payBy.value = 'card'
  if (h !== 'installment') { feeOn.value = false; fee.value = '' }
})

// ---------- the principal, the dates, the plan ----------
const rate = computed(() => (currency.value === 'USD' ? (I?.currency === 'USD' && I.fxRate ? I.fxRate : store.settings.fxRate) : null))
const amountN = computed(() => (typeof amount.value === 'number' ? amount.value : NaN))
// the buffer is fixed with the rate when the spending is saved: an edit that keeps the rounds keeps the stored one, a new plan takes today's
const buffer = computed(() => (currency.value === 'USD' ? (I?.currency === 'USD' && I.fxBuffer !== null && !replan.value ? I.fxBuffer : store.settings.fxBuffer) : null))
const principal = computed(() => (Number.isFinite(amountN.value) ? spendingKrw(amountN.value, currency.value, { fxRate: rate.value ?? store.settings.fxRate, fxBuffer: buffer.value ?? store.settings.fxBuffer }) : 0))
// Holidays for every month a billing date is worked out in: from the purchase month or the first date the user set, whichever is
// earlier, to the later of them plus the rounds, with the month before and the months after that a moved date can reach (review 8).
const off = computed<ReadonlySet<string>>(() => {
  if ((store.settings.dayShift ?? 'none') === 'none' || !DATE.test(bought.value)) return new Set()
  const n = countOk.value ? countN.value : 1
  const yms = [bought.value.slice(0, 7), ...(firstManual.value && DATE.test(firstVal.value) ? [firstVal.value.slice(0, 7)] : [])].sort()
  return offDays(store.holidaySets, `${addYm(yms[0]!, -1)}-01`, `${addYm(yms[yms.length - 1]!, n + 3)}-01`) ?? new Set()
})
const cardDay = (ym: string) => monthDay(ym, store.settings.billingDay, store.settings.dayShift ?? 'none', off.value).date
/** The date the first round gets when the user does not set one: a card is billed the month after, the others pay on the day. */
const defaultFirst = computed(() => (!DATE.test(bought.value) ? '' : how.value !== 'split' && payBy.value === 'card' ? cardDay(addYm(bought.value.slice(0, 7), 1)) : bought.value))
const firstVal = ref(storedFirst)
const firstManual = ref(!!I) // an edit starts from the stored first date; changing what it follows from takes the default again
const first = computed({ get: () => (firstManual.value ? firstVal.value : defaultFirst.value), set: (v: string) => { firstVal.value = v; firstManual.value = true } })
watch([bought, how, () => payBy.value === 'card'], () => { firstManual.value = false })
const firstLabel = computed(() => t(how.value === 'installment' ? 'spending.ed.firstInst' : how.value === 'split' ? 'spending.ed.firstSplit' : payBy.value === 'card' ? 'spending.ed.firstLump' : 'spending.ed.firstPay'))

function planOf(over: { interval?: SpendInterval } = {}): SpendingRound[] {
  if (!countOk.value || !DATE.test(bought.value)) return []
  const f = first.value
  const sp = how.value === 'split'
  try {
    let r = planRounds({
      bought: bought.value, how: how.value, payBy: payBy.value, count: countN.value, principal: principal.value, fee: feeEff.value,
      interval: sp ? (over.interval ?? interval.value) : null, first: DATE.test(f) ? f : bought.value,
      dates: sp && (over.interval ?? interval.value) === 'custom' ? customDates.value : undefined,
    }, store.settings, off.value)
    // a first date the user set: the card goes on from it, month after month, on the billing day
    if (!sp && DATE.test(f) && r[0] && r[0].date !== f) {
      r = r.map((x, i) => ({ ...x, date: i === 0 ? f : cardDay(addYm(f.slice(0, 7), i)) }))
    }
    return r
  } catch {
    return []
  }
}
const planned = computed(() => planOf())

// ---------- did what decides the rounds change? ----------
const keyOf = (k: { amount: number; currency: string; how: string; n: number; fee: number; interval: string | null; first: string; dates: string[] | null; card: boolean | 'x' }) => JSON.stringify(k)
const initialKey = I
  ? keyOf({ amount: I.amount, currency: I.currency, how: I.how, n: I.how === 'lump' ? 1 : I.count, fee: feeOf(I.how, I.payBy, I.fee), interval: I.interval, first: storedFirst, dates: I.interval === 'custom' ? storedCustom : null, card: I.how === 'split' ? 'x' : I.payBy === 'card' })
  : ''
const currentKey = computed(() => keyOf({
  amount: amountN.value, currency: currency.value, how: how.value, n: countN.value, fee: feeEff.value, interval: how.value === 'split' ? interval.value : null,
  first: first.value, dates: customRound.value ? customDates.value : null, card: how.value === 'split' ? 'x' : payBy.value === 'card',
}))
const replan = computed(() => !I || currentKey.value !== initialKey)

// one date per round for "날짜 직접 정하기": kept while the count or the first date moves, new ones follow the month rhythm
watch([customRound, countN, countOk, first], () => {
  if (!customRound.value || !countOk.value) return
  const n = countN.value
  if (customDates.value.length === n) return
  const base = planOf({ interval: 'monthly' }).map((r) => r.date)
  customDates.value = Array.from({ length: n }, (_, i) => customDates.value[i] || base[i] || '')
}, { immediate: true })
/** What a new calculation would throw away of the stored rounds (A-22). */
const losing = computed(() => {
  if (!I || !replan.value) return null
  const edited = I.rounds.filter((r) => r.edited && r.state !== 'merged').length
  const merged = I.rounds.filter((r) => r.state === 'merged').length
  const paid = I.how === 'lump' ? 0 : I.rounds.filter((r) => r.state === 'paid').length
  return edited || merged || paid ? { edited, merged, paid } : null
})

// ---------- step 3: what will be saved ----------
interface Row { no: number; date: string; amount: number; tag: '' | 'edited' | 'merged' | 'paid' }
const rows = computed<Row[]>(() => {
  if (!replan.value && I) {
    return [...I.rounds].sort((a, b) => a.no - b.no).map((r) => ({ no: r.no, date: r.date, amount: r.amount, tag: r.state === 'merged' ? 'merged' : r.state === 'paid' && !isLumpEdit() ? 'paid' : r.edited ? 'edited' : '' }))
  }
  return planned.value.map((r) => ({ no: r.no, date: r.date, amount: r.amount, tag: keepPaid(r.no) ? 'paid' : '' }))
})
const isLumpEdit = () => how.value === 'lump'
const keepPaid = (no: number) => !!I && I.how !== 'lump' && how.value !== 'lump' && I.rounds.some((r) => r.no === no && r.state === 'paid')
const live = computed(() => rows.value.filter((r) => r.tag !== 'merged'))
const total = computed(() => live.value.reduce((a, r) => a + r.amount, 0))
const md = (d: string) => (DATE.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—')
const planLine = computed(() => {
  const f = live.value[0]?.date ?? ''
  const n = replan.value ? countN.value : (I?.how === 'lump' ? 1 : I?.count ?? 1)
  if (how.value === 'lump') return t('spending.ed.planLump', { date: md(f), total: fmtMoney(total.value) })
  if (how.value === 'split') return t('spending.ed.planSplit', { date: md(f), n })
  return t('spending.ed.planInst', { date: md(f), n }) + (feeEff.value > 0 ? t('spending.ed.planFee', { fee: fmtMoney(feeEff.value), total: fmtMoney(total.value) }) : t('spending.ed.planFree'))
})
const eachLine = computed(() => (multi.value ? t('spending.ed.each', { amount: fmtMoney(live.value[0]?.amount ?? 0) }) : fmtMoney(total.value)))
const remainder = computed(() => {
  const l = live.value
  return multi.value && l.length > 1 && !l.some((r) => r.tag === 'edited') ? (l[l.length - 1]!.amount - l[0]!.amount) : 0
})
const planHint = computed(() => {
  if (!multi.value) return t(payBy.value === 'card' ? 'spending.ed.hintLumpCard' : 'spending.ed.hintLumpPay')
  return (remainder.value > 0 ? t('spending.ed.hintRemainder', { amount: fmtMoney(remainder.value) }) : '') + t('spending.ed.hintMulti')
})
const whereLine = computed(() => {
  if (how.value === 'lump' && lumpState.value === 'cancelled') return t('spending.inst.reflectNone')
  const m = live.value[0]?.date ? Number(live.value[0].date.slice(5, 7)) : 0
  const k = `spending.ed.${multi.value ? 'whereMulti' : 'whereLump'}${payBy.value === 'subs' ? 'Subs' : 'Rem'}` as 'spending.ed.whereLumpRem'
  return t(k, { month: m })
})
const summary = computed(() => ({
  name: name.value.trim() || '—', date: md(bought.value),
  amt: (currency.value === 'USD' ? `USD ${typeof amount.value === 'number' ? amount.value.toFixed(2) : '—'} · ` : '') + fmtMoney(principal.value),
}))
const usdLine = computed(() => t('spending.ed.fxValue', { rate: num(rate.value ?? store.settings.fxRate), buffer: buffer.value ?? store.settings.fxBuffer }))

// ---------- checks, one per step ----------
function problem(s: number): string | null {
  if (s === 0) {
    if (!name.value.trim()) return t('spending.ed.needName')
    if (typeof amount.value !== 'number' || !(amount.value >= 0)) return t('spending.ed.needAmount')
    if (currency.value === 'KRW' && !Number.isInteger(amount.value)) return t('spending.ed.needWhole')
    if (!DATE.test(bought.value)) return t('spending.ed.needBought')
    return null
  }
  if (multi.value && !countOk.value) return t('spending.ed.needCount')
  if (feeOn.value && how.value === 'installment' && (typeof fee.value !== 'number' || !Number.isInteger(fee.value) || fee.value < 0)) return t('spending.ed.needFee')
  if (customRound.value) {
    const i = customDates.value.findIndex((d) => !DATE.test(d))
    if (i >= 0 || customDates.value.length !== countN.value) return t('spending.ed.needRoundDate', { no: (i < 0 ? 0 : i) + 1 })
  } else if (!DATE.test(first.value)) return t('spending.ed.needFirst')
  return null
}
function canAdvance(from: number) {
  const p = problem(from)
  error.value = p ?? ''
  return !p
}
/** Fill the draft from the form just before it is saved (useEditor's validate), or say what is wrong and show that step. */
function validate(x: Spending): string | null {
  for (const s of [0, 1]) {
    const p = problem(s)
    if (p) { step.value = s; return p }
  }
  if (!planned.value.length) return t('spending.ed.needCount')
  x.name = name.value.trim()
  x.note = note.value
  x.category = I && !catTouched.value ? I.category : catId.value === 'other' ? (catOther.value.trim() || catWord('other')) : catWord(catId.value)
  x.bought = bought.value
  x.amount = amount.value as number
  x.currency = currency.value
  x.fxRate = rate.value
  x.fxBuffer = buffer.value
  x.how = how.value
  x.payBy = payBy.value
  x.count = how.value === 'lump' ? 1 : countN.value
  x.fee = feeEff.value
  x.cancelled = how.value === 'lump' ? lumpState.value === 'cancelled' : !!I && I.how !== 'lump' && I.cancelled
  x.interval = how.value === 'split' ? interval.value : null
  if (!replan.value && I) {
    x.rounds = I.rounds.map((r) => ({ ...r }))
    if (how.value === 'lump' && lumpState.value !== 'cancelled') { const r = x.rounds.find((q) => q.state !== 'merged'); if (r) r.state = lumpState.value }
  } else {
    x.rounds = planned.value.map((r) => ({ ...r, state: how.value === 'lump' ? (lumpState.value === 'paid' ? 'paid' : 'left') : keepPaid(r.no) ? 'paid' : 'left' }))
  }
  return null
}
function onSave() {
  if (!askRe.value && losing.value) { askRe.value = true; return }
  void saveDraft()
}
function confirmReplan() {
  askRe.value = false
  void saveDraft()
}
async function confirmDelete() { await remove() }
</script>

<template>
  <EditSheet
    v-if="edit" v-model:step="step" :title="title" :steps="steps" :error="error" :busy="busy" :hint="t('spending.ed.foot')"
    :can-advance="canAdvance" @save="onSave" @cancel="close"
  >
    <template #default="{ step: s }">
      <!-- 1/3 무엇을 샀나요 -->
      <template v-if="s === 0">
        <div class="field">
          <label for="sp-name" class="req">{{ t('spending.ed.name') }}</label>
          <input id="sp-name" v-model="name" class="in" autocomplete="off" :placeholder="t('spending.ed.namePh')">
        </div>
        <div class="field">
          <label for="sp-amount" class="req">{{ t('spending.ed.amount') }}</label>
          <div class="amt-row">
            <Seg v-model="currency" class="cur" :options="currencyOpts" :label="t('spending.ed.currency')" />
            <MoneyInput id="sp-amount" v-model="amount" :decimal="currency === 'USD'" prefix="" />
          </div>
        </div>
        <div class="field">
          <div class="lrow"><label for="sp-bought">{{ t('spending.ed.bought') }}</label><Tip :text="t('spending.ed.boughtTip')" /></div>
          <DateInput id="sp-bought" v-model="bought" :aria-label="t('spending.ed.bought')" />
        </div>
        <template v-if="currency === 'USD'">
          <div class="field">
            <div class="lrow"><span class="flabel">{{ t('spending.ed.fx') }}</span><Tip :text="t('spending.ed.fxTip', { buffer: store.settings.fxBuffer })" /></div>
            <div class="line" data-testid="sp-fx">{{ usdLine }}</div>
          </div>
          <div class="field">
            <span class="flabel">{{ t('spending.ed.krw') }}</span>
            <div class="line strong num" data-testid="sp-krw">{{ fmtMoney(principal) }}</div>
          </div>
        </template>
        <div class="field">
          <span id="sp-cat-l" class="flabel">{{ t('spending.ed.category') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="sp-cat-l">
            <button v-for="[id] in CATS" :key="id" type="button" role="radio" class="chip" :class="{ on: catId === id }" :aria-checked="catId === id ? 'true' : 'false'" @click="pickCat(id)">{{ catWord(id) }}</button>
            <button type="button" role="radio" class="chip" :class="{ on: catId === 'other' }" :aria-checked="catId === 'other' ? 'true' : 'false'" @click="pickCat('other')">{{ t('spending.ed.catOther') }}</button>
          </div>
          <input v-if="catId === 'other'" v-model="catOther" class="in" @input="catTouched = true" :aria-label="t('spending.ed.catOtherLabel')" :placeholder="t('spending.ed.catOtherPh')" maxlength="40">
        </div>
      </template>

      <!-- 2/3 내는 방식 -->
      <template v-else-if="s === 1">
        <div class="sum"><span><b>{{ summary.name }}</b> <span class="hint">· {{ summary.date }}</span></span><b class="num">{{ summary.amt }}</b></div>
        <div class="field">
          <div class="lrow"><span id="sp-how-l" class="flabel">{{ t('spending.ed.how') }}</span><Tip :text="t('spending.ed.howTip')" /></div>
          <Seg v-model="how" block :options="howOpts" labelledby="sp-how-l" />
          <span class="hint">{{ t('spending.ed.bufferSoon') }}</span>
        </div>
        <div v-if="multi" class="field">
          <span id="sp-n-l" class="flabel">{{ countLabel }}</span>
          <Seg v-model="countSel" block :options="countOpts" labelledby="sp-n-l" />
        </div>
        <div v-if="multi && countSel === 'c'" class="field">
          <label for="sp-nc">{{ t('spending.ed.countCustom', { label: countLabel }) }}</label>
          <MoneyInput id="sp-nc" v-model="countCustom" prefix="" input-class="num" />
          <span class="hint">{{ t('spending.ed.countRange') }}</span>
        </div>
        <div v-if="how === 'installment'" class="field">
          <div class="lrow"><span id="sp-fee-l" class="flabel">{{ t('spending.ed.interest') }}</span><Tip :text="t('spending.ed.interestTip')" /></div>
          <Seg :model-value="feeOn ? 'fee' : 'free'" block :options="feeOpts" labelledby="sp-fee-l" @update:model-value="(v: string) => (feeOn = v === 'fee')" />
        </div>
        <div v-if="how === 'installment' && feeOn" class="field">
          <label for="sp-feeamt">{{ t('spending.ed.fee') }}</label>
          <MoneyInput id="sp-feeamt" v-model="fee" prefix="" />
        </div>
        <div v-if="how === 'split'" class="field">
          <label for="sp-every">{{ t('spending.ed.intervalLabel') }}</label>
          <Select id="sp-every" v-model="interval" :options="intervalOpts" />
        </div>
        <div class="field">
          <div class="lrow"><label for="sp-pay">{{ t('spending.ed.payBy') }}</label><Tip :text="t('spending.ed.payByTip')" /></div>
          <Select id="sp-pay" v-model="payBy" :options="payOpts" :disabled="how === 'installment'" />
        </div>
        <template v-if="customRound">
          <div v-for="(d, i) in customDates" :key="i" class="field">
            <label :for="`sp-d${i}`">{{ t('spending.ed.roundDate', { no: i + 1 }) }}</label>
            <DateInput :id="`sp-d${i}`" :model-value="d" :aria-label="t('spending.ed.roundDate', { no: i + 1 })" @update:model-value="(v: string) => (customDates[i] = v)" />
          </div>
        </template>
        <div v-else class="field">
          <label for="sp-first">{{ firstLabel }}</label>
          <DateInput id="sp-first" v-model="first" :aria-label="firstLabel" />
        </div>
      </template>

      <!-- 3/3 회차 확인 -->
      <template v-else>
        <div class="sum"><span><b>{{ summary.name }}</b> <span class="hint">· {{ summary.date }}</span></span><b class="num">{{ summary.amt }}</b></div>
        <div class="field">
          <div class="lrow"><span class="flabel">{{ t('spending.ed.rounds') }}</span><Tip :text="planHint" /></div>
          <div class="plan" data-testid="sp-plan">
            <div class="plan-h"><span>{{ planLine }}</span><b class="num">{{ eachLine }}</b></div>
            <ol class="rl" :aria-label="t('spending.ed.rounds')">
              <li v-for="r in rows" :key="r.no" :class="{ dim: r.tag === 'merged' }">
                <span class="num">{{ r.no }}</span><span class="num">{{ r.date }}</span><b class="num">{{ fmtMoney(r.amount) }}</b>
                <span v-if="r.tag" class="tg">{{ t(`spending.ed.tag.${r.tag}` as 'spending.ed.tag.edited') }}</span>
              </li>
            </ol>
          </div>
          <span v-if="remainder > 0" class="hint">{{ t('spending.ed.hintRemainder', { amount: fmtMoney(remainder) }) }}</span>
        </div>
        <div class="where"><span class="hint">{{ t('spending.ed.where') }}</span><b>{{ whereLine }}</b></div>
        <div v-if="how === 'lump'" class="field">
          <div class="lrow"><span id="sp-st-l" class="flabel">{{ t('spending.inst.round.state') }}</span><Tip :text="t('spending.ed.stateTip')" /></div>
          <Seg v-model="lumpState" :options="stateOpts" labelledby="sp-st-l" />
        </div>
        <div v-if="losing" class="callout warn" data-testid="sp-replan">
          <span class="lbl">{{ t('spending.ed.replanLabel') }}</span>
          <p>{{ t('spending.ed.replanText') }}
            <template v-if="losing.edited"> {{ t('spending.ed.replanEdited', { n: losing.edited }) }}</template>
            <template v-if="losing.merged"> {{ t('spending.ed.replanMerged') }}</template>
            <template v-if="losing.paid"> {{ t('spending.ed.replanPaid', { n: losing.paid }) }}</template>
          </p>
        </div>
        <div v-if="memoOpen" class="field">
          <label for="sp-note">{{ t('spending.ed.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
          <textarea id="sp-note" v-model="note" class="in" rows="2" :placeholder="t('spending.ed.notePh')"></textarea>
        </div>
        <div v-else class="field">
          <span class="flabel">{{ t('spending.ed.note') }} <span class="opt">{{ t('common.optional') }}</span></span>
          <button class="memo-add" type="button" @click="memoOpen = true">+ {{ t('spending.ed.addNote') }}</button>
        </div>
        <div v-if="!isNew" class="danger">
          <div class="drow">
            <span><b class="bad">{{ t('spending.ed.deleteSpend') }}</b>{{ t('spending.ed.deleteSpendText') }}</span>
            <button class="btn sm bad" type="button" @click="askDel = true">{{ t('common.delete') }}</button>
          </div>
        </div>
      </template>
    </template>
  </EditSheet>

  <ConfirmDialog
    v-if="askDel && edit" :title="t('spending.ed.deleteTitle', { name: I?.name ?? '' })" :confirm-label="t('common.delete')" danger :busy="busy"
    @confirm="confirmDelete" @cancel="askDel = false"
  >
    <p>{{ t('spending.ed.deleteBody') }}</p>
    <p class="hint">{{ t('spending.ed.deleteHint') }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </ConfirmDialog>

  <ConfirmDialog v-if="askRe && edit" :title="t('spending.ed.replanTitle')" :confirm-label="t('spending.ed.replanConfirm')" :busy="busy" @confirm="confirmReplan" @cancel="askRe = false">
    <p>{{ t('spending.ed.replanText') }}</p>
    <p v-if="losing?.edited">{{ t('spending.ed.replanEdited', { n: losing.edited }) }}</p>
    <p v-if="losing?.merged">{{ t('spending.ed.replanMerged') }}</p>
    <p v-if="losing?.paid">{{ t('spending.ed.replanPaid', { n: losing.paid }) }}</p>
  </ConfirmDialog>
</template>

<style scoped>
.req::after{content:" *";color:var(--accent-text)}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.err{font-size:12px;color:var(--neg-text);margin:0}
.lrow{display:flex;align-items:center;gap:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.amt-row{display:flex;gap:8px;align-items:center}
.amt-row :deep(.money){flex:1;min-width:0}
.amt-row .cur{flex:none;width:auto}
.line{display:flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface-2);font-size:14px;color:var(--text-2)}
.line.strong{justify-content:flex-end;font-weight:600;color:var(--text)}
.sum{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border);font-size:13px}
.sum > span{flex:1;min-width:0;overflow-wrap:anywhere}
.sum b.num{flex:none}
.plan{border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);overflow:hidden}
.plan-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;background:var(--primary-tint);border-bottom:1px solid var(--primary-line);font-size:13px}
.plan-h b{font-variant-numeric:tabular-nums;color:var(--primary-text);text-align:right}
.rl{list-style:none;margin:0;padding:0;max-height:220px;overflow:auto}
.rl li{display:grid;grid-template-columns:28px 1fr auto auto;gap:10px;align-items:center;padding:7px 12px;font-size:13px;border-top:1px solid var(--divider)}
.rl li:first-child{border-top:0}
.rl li.dim{color:var(--subtle)}
.rl .tg{font-size:11px;color:var(--accent-text);background:var(--accent-soft);border-radius:var(--r-badge);padding:1px 6px}
.where{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border);font-size:13px}
.where b{color:var(--primary-text);text-align:right;overflow-wrap:anywhere}
.memo-add{display:flex;align-items:center;gap:8px;width:100%;height:44px;padding:0 12px;border:1px dashed var(--border-strong);border-radius:var(--r-ctl);background:var(--input);color:var(--muted);font:inherit;font-size:14px;cursor:pointer;text-align:left}
.memo-add:hover{border-color:var(--primary-text);color:var(--primary-text)}
.callout{margin:0}
.danger{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.drow{display:flex;align-items:center;gap:12px}
.drow span{flex:1;min-width:0;font-size:13px;color:var(--text-2)}
.drow span b{display:block;color:var(--neg-text)}
.drow .btn{flex:none}
</style>
