<script setup lang="ts">
// 지출 추가·수정 (spec 011 S-2, S-3, S-4, S-6, S-8): three steps — 무엇을 샀나요, 내는 방식, 회차 확인 — for a one-off
// spending of the 일반 tab (a lump sum) and of the 할부 tab (card installment, split). The rounds are worked out by
// `planRounds` (calc.ts) and shown on the last step before they are saved; the saved spending carries them in its body.
// Edit mode opens with the stored values. While the inputs that decide the rounds (amount, currency, how, count, fee,
// interval, dates) are as they were, the stored rounds are saved untouched (edited flags and all); once one is
// changed the rounds are worked out again and the editor says so first (A-22: a round marked 냄 keeps that mark under
// the same number, an edited round and an early payoff are dropped). Delete asks first, like the subscription editor.
// Spec 013: a card payment may name its card (S-13; its billing day plans the rounds, none = the settings' day), and
// 버퍼 사용 (S-8) pays the card bill from the buffer of the card's paying account and refills it on pay days over the
// chosen months. The card and the refill start are inputs that decide the rounds, like the others.
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'
import DateInput from './DateInput.vue'
import EditSheet from './EditSheet.vue'
import MoneyInput from './MoneyInput.vue'
import Select from './Select.vue'
import Seg from './Seg.vue'
import CurrencyPick from './CurrencyPick.vue'
import { currencyCodes, rateFor, rateNum } from '../lib/currency'
import Tip from './Tip.vue'
import { addYm, billingDayOf, bufferGauge, cardBillDate, monthDay, num, payDayFrom, planRounds, replan as doReplan, spendingKrw, today, ymd } from '../lib/calc'
import { fmtMoney } from '../lib/display'
import { offDays } from '../lib/holidays-lazy'
import { store } from '../lib/store'
import { useEditor } from '../lib/useEditor'
import type { Card, Currency, PayBy, Spending, SpendingRound, SpendHow, SpendInterval } from '../data/types'
import { localToday } from '../lib/now'

const props = defineProps<{ initial: Spending | null; /** which tab asked for a new one: decides how it starts (일시불 or 카드 할부) */ start?: 'general' | 'inst' }>()
const emit = defineEmits<{ close: [] }>()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const I = props.initial
// the stored words of the default categories (the data keeps what was typed; a chip matches the word of either language)
const CATS = [['living', '생활'], ['appliance', '가전'], ['travel', '여행'], ['event', '경조사'], ['medical', '의료'], ['insurance', '보험']] as const
const catWord = (id: string) => t(`spending.ed.cat.${id}` as 'spending.ed.cat.living')
const catOf = (c: string) => CATS.find(([id, ko]) => c === ko || c === catWord(id))?.[0] ?? (c === '기타' || c === catWord('other') ? 'other' : '')
const COUNTS: Record<'installment' | 'split' | 'buffer', number[]> = { installment: [3, 6, 12], split: [2, 3, 4], buffer: [3, 6, 12] }
const storedFirst = I?.rounds.find((r) => r.no === 1)?.date ?? ''
const storedCustom = I?.interval === 'custom' ? [...I.rounds].filter((r) => r.no <= I.count).sort((a, b) => a.no - b.no).map((r) => r.date) : []
const feeOf = (how: SpendHow, payBy: PayBy, fee: number) => (how === 'installment' && payBy === 'card' ? fee : 0)

const blank = (): Spending => ({
  id: '', name: '', note: '', category: '', bought: ymd(localToday()), amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: props.start === 'inst' ? 'installment' : 'lump', payBy: 'card', count: props.start === 'inst' ? 6 : 1, fee: 0, interval: null, cancelled: false,
  cardId: null, refillFrom: null, rounds: [],
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
const countSel = ref(I ? (how.value !== 'lump' && COUNTS[how.value as keyof typeof COUNTS]?.includes(I.count) ? String(I.count) : 'c') : how.value === 'split' ? '3' : '6')
const countCustom = ref<number | ''>(I && countSel.value === 'c' && how.value !== 'lump' ? I.count : '')
const feeOn = ref((I?.fee ?? 0) > 0)
const fee = ref<number | ''>(I && I.fee > 0 ? I.fee : '')
const interval = ref<SpendInterval>(I?.interval ?? 'monthly')
const customDates = ref<string[]>([...storedCustom])
// a lump sum is 남음, 냄 or 취소 (review 13: the 일반 tab has no other place to cancel one); 취소 means refunded or never paid (A-38): cancelled, and its round is left, so it counts nowhere
// the card (S-13): a stored one stays as it is until the user picks another; '' = none
const cardId = ref(I?.cardId ?? '')
const lumpState = ref<'left' | 'paid' | 'cancelled'>(I?.how === 'lump' ? (I.cancelled ? 'cancelled' : I.rounds.find((r) => r.state !== 'merged')?.state === 'paid' ? 'paid' : 'left') : 'left')

const step = ref(0)
const askDel = ref(false)
const askRe = ref(false)
const steps = computed(() => [t('spending.ed.stepBought'), t('spending.ed.stepHow'), t('spending.ed.stepRounds')])
// KRW, USD and every listed code (spec 013 S-23); the stored code stays an option
const currencyOpts = computed(() => currencyCodes(store.currencies, I?.currency).map((id) => ({ id, label: id })))
const howOpts = computed(() => [
  { id: 'lump', label: t('spending.ed.howLump') }, { id: 'installment', label: t('spending.ed.howInst') }, { id: 'split', label: t('spending.ed.howSplit') },
  { id: 'buffer', label: t('spending.ed.howBuffer') },
])
const stateOpts = computed(() => [{ id: 'left', label: t('spending.inst.round.left') }, { id: 'paid', label: t('spending.inst.round.paid') }, { id: 'cancelled', label: t('spending.ed.stateCancelled') }])
const feeOpts = computed(() => [{ id: 'free', label: t('spending.ed.interestFree') }, { id: 'fee', label: t('spending.ed.interestFee') }])
const intervalOpts = computed(() => (['monthly', 'biweekly', 'custom'] as const).map((v) => ({ value: v, label: t(`spending.ed.interval.${v}` as 'spending.ed.interval.monthly') })))
const payOpts = computed(() => (how.value === 'installment' ? ['card'] as const : ['card', 'salary', 'subs'] as const).map((v) => ({
  value: v, label: v === 'card' ? t('spending.ed.payCard', { day: billingDay.value }) : t(`spending.ed.pay.${v}` as 'spending.ed.pay.salary'),
})))
const multi = computed(() => how.value !== 'lump')
const isBuf = computed(() => how.value === 'buffer')
const countOpts = computed(() => [
  ...COUNTS[how.value === 'lump' ? 'installment' : how.value].map((n) => ({ id: String(n), label: t(how.value === 'split' ? 'spending.ed.times' : 'spending.ed.months', { n }) })),
  { id: 'c', label: t('spending.ed.custom') },
])
const countLabel = computed(() => t(how.value === 'split' ? 'spending.ed.countSplit' : isBuf.value ? 'spending.ed.countBuffer' : 'spending.ed.countInst'))
const countN = computed(() => (how.value === 'lump' ? 1 : countSel.value === 'c' ? (typeof countCustom.value === 'number' ? countCustom.value : NaN) : Number(countSel.value)))
// a buffer use refills over 1..60 months (spec 013 S-8, the server's rule); installments and splits have 2..60 rounds
const countMin = computed(() => (isBuf.value ? 1 : multi.value ? 2 : 1))
const countOk = computed(() => Number.isInteger(countN.value) && countN.value >= countMin.value && countN.value <= 60)
const feeN = computed(() => (feeOn.value && typeof fee.value === 'number' ? fee.value : 0))
const feeEff = computed(() => feeOf(how.value, payBy.value, feeN.value))
const customRound = computed(() => how.value === 'split' && interval.value === 'custom')

watch(how, (h) => {
  countSel.value = h === 'split' ? '3' : '6'
  countCustom.value = ''
  if (h === 'installment' || h === 'buffer') payBy.value = 'card'
  if (h !== 'installment') { feeOn.value = false; fee.value = '' }
  // an installment or split made a lump sum: it is paid when every round that still counted was paid, else left (A-39); the control can change it
  if (h === 'lump' && I && I.how !== 'lump') {
    lumpState.value = doReplan(I.rounds, [], 'lump').lumpDefault
  }
})

// ---------- the card (S-13) and the buffer (S-8) ----------
/** The optional card select is shown for a lump sum or an installment by card; a buffer use has its own, required one. */
const cardShown = computed(() => payBy.value === 'card' && (how.value === 'lump' || how.value === 'installment'))
const card = computed(() => (payBy.value === 'card' && cardId.value ? store.cards.find((c) => c.id === cardId.value) ?? null : null))
const billingDay = computed(() => billingDayOf(card.value, store.settings))
const cardName = (c: Card) => c.name + (c.last4 ? ` ${c.last4}` : '')
const cardOpts = computed(() => [
  { value: '', label: t('spending.ed.cardNone') },
  ...store.cards.map((c) => ({ value: c.id, label: t('spending.ed.cardOpt', { name: cardName(c), day: billingDayOf(c, store.settings) }) })),
])
/** A buffer use needs a card with a paying account; each option names the account and its buffer. */
const bufCards = computed(() => store.cards.flatMap((c) => {
  const acc = c.accountId ? store.accounts.find((a) => a.id === c.accountId) : undefined
  return acc ? [{ card: c, acc }] : []
}))
const bufOpts = computed(() => {
  const opts: { value: string; label: string; disabled?: boolean }[] = bufCards.value.map(({ card: c, acc }) => ({ value: c.id, label: t('spending.ed.bufOpt', { card: cardName(c), account: acc.name, buffer: fmtMoney(acc.buffer ?? 0) }) }))
  // a chosen card that has no paying account (any more) is shown by its name, not offered
  const cur = store.cards.find((c) => c.id === cardId.value)
  if (cur && !opts.some((o) => o.value === cur.id)) opts.push({ value: cur.id, label: t('spending.ed.bufOptNone', { card: cardName(cur) }), disabled: true })
  return opts
})
const bufAcc = computed(() => (isBuf.value ? bufCards.value.find((x) => x.card.id === cardId.value)?.acc ?? null : null))
// a payment that is not by card has no card (the server's rule): it goes when the user moves off the card
watch(payBy, (p) => { if (p !== 'card') cardId.value = '' })

// ---------- the principal, the dates, the plan ----------
/** Today's rate and buffer of the picked foreign currency: the settings' for USD (as before), the list's for another code. */
const fxDefault = computed(() => rateFor(currency.value, store.settings, store.currencies) ?? { rate: store.settings.fxRate, buffer: store.settings.fxBuffer })
const foreign = computed(() => currency.value !== 'KRW')
const rate = computed(() => (foreign.value ? (I?.currency === currency.value && I.fxRate ? I.fxRate : fxDefault.value.rate) : null))
const amountN = computed(() => (typeof amount.value === 'number' ? amount.value : NaN))
// the buffer is fixed with the rate when the spending is saved: an edit that keeps the rounds keeps the stored one, a new plan takes today's
const buffer = computed(() => (foreign.value ? (I?.currency === currency.value && I.fxBuffer !== null && !replan.value ? I.fxBuffer : fxDefault.value.buffer) : null))
const principal = computed(() => (Number.isFinite(amountN.value) ? spendingKrw(amountN.value, currency.value, { fxRate: rate.value ?? fxDefault.value.rate, fxBuffer: buffer.value ?? fxDefault.value.buffer }) : 0))
// Holidays for every month a billing date is worked out in: from the purchase month or the first date the user set, whichever is
// earlier, to the later of them plus the rounds, with the month before and the months after that a moved date can reach (review 8).
const off = computed<ReadonlySet<string>>(() => {
  if ((store.settings.dayShift ?? 'none') === 'none' || !DATE.test(bought.value)) return new Set()
  const n = countOk.value ? countN.value : 1
  const yms = [
    bought.value.slice(0, 7), ...(firstManual.value && DATE.test(firstVal.value) ? [firstVal.value.slice(0, 7)] : []),
    ...(refillManual.value && DATE.test(refillVal.value) ? [refillVal.value.slice(0, 7)] : []),
  ].sort()
  return offDays(store.holidaySets, `${addYm(yms[0]!, -1)}-01`, `${addYm(yms[yms.length - 1]!, n + 3)}-01`) ?? new Set()
})
const cardDay = (ym: string) => monthDay(ym, billingDay.value, store.settings.dayShift ?? 'none', off.value).date
/** The date the first round gets when the user does not set one: a card is billed the month after, the others pay on the day. */
const defaultFirst = computed(() => (!DATE.test(bought.value) ? '' : how.value !== 'split' && payBy.value === 'card' ? cardDay(addYm(bought.value.slice(0, 7), 1)) : bought.value))
const firstVal = ref(storedFirst)
const firstManual = ref(!!I) // an edit starts from the stored first date; changing what it follows from takes the default again
const first = computed({ get: () => (firstManual.value ? firstVal.value : defaultFirst.value), set: (v: string) => { firstVal.value = v; firstManual.value = true } })
watch([bought, how, () => payBy.value === 'card', cardId], () => { firstManual.value = false })
/** A buffer use: the card bill's date, and the refill start (default: the first pay day on or after the bill, S-8). */
const billDate = computed(() => (DATE.test(bought.value) ? cardBillDate(bought.value, billingDay.value, store.settings, off.value) : ''))
const defaultRefill = computed(() => (billDate.value ? payDayFrom(billDate.value, store.settings, off.value) : ''))
const refillVal = ref(I?.refillFrom ?? '')
const refillManual = ref(!!I?.refillFrom)
const refill = computed({ get: () => (refillManual.value ? refillVal.value : defaultRefill.value), set: (v: string) => { refillVal.value = v; refillManual.value = true } })
watch([bought, how, cardId], () => { refillManual.value = false })
const firstLabel = computed(() => t(how.value === 'installment' ? 'spending.ed.firstInst' : how.value === 'split' ? 'spending.ed.firstSplit' : payBy.value === 'card' ? 'spending.ed.firstLump' : 'spending.ed.firstPay'))

function planOf(over: { interval?: SpendInterval } = {}): SpendingRound[] {
  if (!countOk.value || !DATE.test(bought.value)) return []
  const f = first.value
  const sp = how.value === 'split'
  try {
    if (isBuf.value) {
      if (!DATE.test(refill.value)) return []
      return planRounds({ bought: bought.value, how: 'buffer', payBy: 'card', count: countN.value, principal: principal.value, refillFrom: refill.value }, store.settings, off.value)
    }
    let r = planRounds({
      bought: bought.value, how: how.value, payBy: payBy.value, count: countN.value, principal: principal.value, fee: feeEff.value,
      interval: sp ? (over.interval ?? interval.value) : null, first: DATE.test(f) ? f : bought.value,
      dates: sp && (over.interval ?? interval.value) === 'custom' ? customDates.value : undefined,
      billingDay: card.value?.billingDay ?? null,
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
// the card (S-13) and, for a buffer use, the refill start in place of the first date (S-8) decide the rounds too
const keyOf = (k: { amount: number; currency: string; how: string; n: number; fee: number; interval: string | null; first: string; dates: string[] | null; card: boolean | 'x'; cardId: string }) => JSON.stringify(k)
const initialKey = I
  ? keyOf({
    amount: I.amount, currency: I.currency, how: I.how, n: I.how === 'lump' ? 1 : I.count, fee: feeOf(I.how, I.payBy, I.fee), interval: I.interval,
    first: I.how === 'buffer' ? I.refillFrom ?? storedFirst : storedFirst, dates: I.interval === 'custom' ? storedCustom : null, card: I.how === 'split' ? 'x' : I.payBy === 'card',
    cardId: I.payBy === 'card' ? I.cardId ?? '' : '',
  })
  : ''
const currentKey = computed(() => keyOf({
  amount: amountN.value, currency: currency.value, how: how.value, n: countN.value, fee: feeEff.value, interval: how.value === 'split' ? interval.value : null,
  first: isBuf.value ? refill.value : first.value, dates: customRound.value ? customDates.value : null, card: how.value === 'split' ? 'x' : payBy.value === 'card',
  cardId: payBy.value === 'card' ? cardId.value : '',
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
/** The rounds that will be saved when the inputs changed: `replan` (calc.ts) is the one rule, and step 3 lists exactly these. */
const outcome = computed(() => {
  if (!I || !replan.value) return null
  return doReplan(I.rounds, planned.value, how.value, lumpState.value)
})
/** The warning: the inputs changed and the stored rounds carry marks (paid, edited, merged). It counts the marks of the stored rounds and promises nothing more; step 3 shows the new rounds. */
const losing = computed(() => {
  if (!I || !replan.value) return null
  const paid = I.rounds.filter((r) => r.state === 'paid').length
  const edited = I.rounds.filter((r) => r.edited && r.state !== 'merged').length
  const merged = I.rounds.filter((r) => r.state === 'merged').length
  return paid || edited || merged ? { paid, edited, merged } : null
})
const marks = computed(() => {
  const l = losing.value
  if (!l) return ''
  return [l.paid && t('spending.ed.markPaid', { n: l.paid }), l.edited && t('spending.ed.markEdited', { n: l.edited }), l.merged && t('spending.ed.markMerged', { n: l.merged })].filter(Boolean).join(' · ')
})

// ---------- step 3: what will be saved ----------
interface Row { no: number; date: string; amount: number; state: 'left' | 'paid' | 'merged'; edited: boolean }
const rows = computed<Row[]>(() => {
  if (!replan.value && I) {
    // the stored rounds as they are; a lump sum's one round follows the state control
    return [...I.rounds].sort((a, b) => a.no - b.no).map((r) => ({ no: r.no, date: r.date, amount: r.amount, edited: r.edited, state: r.state === 'merged' ? 'merged' : how.value === 'lump' ? (lumpState.value === 'paid' ? 'paid' : 'left') : r.state }))
  }
  const out = I ? outcome.value!.rounds : doReplan([], planned.value, how.value, lumpState.value).rounds
  return out.map((r) => ({ no: r.no, date: r.date, amount: r.amount, edited: false, state: r.state }))
})
const live = computed(() => rows.value.filter((r) => r.state !== 'merged'))
const total = computed(() => live.value.reduce((a, r) => a + r.amount, 0))
const md = (d: string) => (DATE.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—')
const planLine = computed(() => {
  const f = live.value[0]?.date ?? ''
  const n = replan.value ? countN.value : (I?.how === 'lump' ? 1 : I?.count ?? 1)
  if (how.value === 'lump') return t('spending.ed.planLump', { date: md(f), total: fmtMoney(total.value) })
  if (isBuf.value) return t('spending.ed.planBuffer', { date: md(f), n })
  if (how.value === 'split') return t('spending.ed.planSplit', { date: md(f), n })
  return t('spending.ed.planInst', { date: md(f), n }) + (feeEff.value > 0 ? t('spending.ed.planFee', { fee: fmtMoney(feeEff.value), total: fmtMoney(total.value) }) : t('spending.ed.planFree'))
})
const eachLine = computed(() => (isBuf.value ? t('spending.ed.eachBuffer', { amount: fmtMoney(live.value[0]?.amount ?? 0) }) : multi.value ? t('spending.ed.each', { amount: fmtMoney(live.value[0]?.amount ?? 0) }) : fmtMoney(total.value)))
const remainder = computed(() => {
  const l = live.value
  return multi.value && l.length > 1 && !l.some((r) => r.edited) ? (l[l.length - 1]!.amount - l[0]!.amount) : 0
})
const planHint = computed(() => {
  if (!multi.value) return t(payBy.value === 'card' ? 'spending.ed.hintLumpCard' : 'spending.ed.hintLumpPay')
  return (remainder.value > 0 ? t('spending.ed.hintRemainder', { amount: fmtMoney(remainder.value) }) : '') + t('spending.ed.hintMulti')
})
const whereLine = computed(() => {
  if (how.value === 'lump' && lumpState.value === 'cancelled') return t('spending.inst.reflectNone')
  if (isBuf.value) return t('spending.ed.whereBuffer', { date: md(billDate.value) })
  const m = live.value[0]?.date ? Number(live.value[0].date.slice(5, 7)) : 0
  const k = `spending.ed.${multi.value ? 'whereMulti' : 'whereLump'}${payBy.value === 'subs' ? 'Subs' : 'Rem'}` as 'spending.ed.whereLumpRem'
  return t(k, { month: m })
})
const summary = computed(() => ({
  name: name.value.trim() || '—', date: md(bought.value),
  amt: (foreign.value ? `${currency.value} ${typeof amount.value === 'number' ? amount.value.toFixed(2) : '—'} · ` : '') + fmtMoney(principal.value),
}))
/** The buffer gauge (S-8): the account's buffer, what other buffer uses have not refilled yet, and this spending on top. */
const gauge = computed(() => {
  const acc = bufAcc.value
  if (!acc) return null
  const g = bufferGauge(acc, store, ymd(localToday()), I?.id)
  const use = g.used + principal.value
  const left = g.left - principal.value
  const l = live.value
  const lastD = l[l.length - 1]?.date ?? ''
  return {
    buffer: g.buffer, use, left, short: left < 0 ? -left : 0, w: g.buffer > 0 ? Math.min(100, (Math.min(use, g.buffer) / g.buffer) * 100) : use > 0 ? 100 : 0,
    until: DATE.test(lastD) ? `${lastD.slice(0, 4)}. ${lastD.slice(5, 7)}` : '—', each: l[0]?.amount ?? 0,
  }
})
const usdLine = computed(() => { const r = rate.value ?? fxDefault.value.rate; return t('spending.ed.fxValue', { rate: currency.value === 'USD' ? num(r) : rateNum(r), buffer: buffer.value ?? fxDefault.value.buffer }) })

// ---------- checks, one per step ----------
function problem(s: number): string | null {
  if (s === 0) {
    if (!name.value.trim()) return t('spending.ed.needName')
    if (typeof amount.value !== 'number' || !(amount.value >= 0)) return t('spending.ed.needAmount')
    if (currency.value === 'KRW' && !Number.isInteger(amount.value)) return t('spending.ed.needWhole')
    if (!DATE.test(bought.value)) return t('spending.ed.needBought')
    return null
  }
  if (isBuf.value && !bufCards.value.some((x) => x.card.id === cardId.value)) return t('spending.ed.needCard')
  if (multi.value && !countOk.value) return t(isBuf.value ? 'spending.ed.needCountBuffer' : 'spending.ed.needCount')
  if (feeOn.value && how.value === 'installment' && (typeof fee.value !== 'number' || !Number.isInteger(fee.value) || fee.value < 0)) return t('spending.ed.needFee')
  if (customRound.value) {
    const i = customDates.value.findIndex((d) => !DATE.test(d))
    if (i >= 0 || customDates.value.length !== countN.value) return t('spending.ed.needRoundDate', { no: (i < 0 ? 0 : i) + 1 })
  } else if (isBuf.value) {
    if (!DATE.test(refill.value)) return t('spending.ed.needRefill')
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
  if (!planned.value.length) return t(isBuf.value ? 'spending.ed.needCountBuffer' : 'spending.ed.needCount')
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
  // the card and the refill start are sent back as they are unless changed (spec 013 S-8, S-13)
  x.cardId = payBy.value === 'card' && cardId.value ? cardId.value : null
  x.refillFrom = isBuf.value ? refill.value : null
  if (!replan.value && I) {
    x.rounds = I.rounds.map((r) => ({ ...r }))
    if (how.value === 'lump') { const r = x.rounds.find((q) => q.state !== 'merged'); if (r) r.state = lumpState.value === 'paid' ? 'paid' : 'left' }
  } else {
    x.rounds = I ? outcome.value!.rounds : doReplan([], planned.value, how.value, lumpState.value).rounds
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
            <CurrencyPick v-model="currency" :options="currencyOpts" :label="t('spending.ed.currency')" />
            <MoneyInput id="sp-amount" v-model="amount" :decimal="foreign" prefix="" />
          </div>
        </div>
        <div class="field">
          <div class="lrow"><label for="sp-bought">{{ t('spending.ed.bought') }}</label><Tip :text="t('spending.ed.boughtTip')" /></div>
          <DateInput id="sp-bought" v-model="bought" :aria-label="t('spending.ed.bought')" />
        </div>
        <template v-if="foreign">
          <div class="field">
            <div class="lrow"><span class="flabel">{{ t('spending.ed.fx') }}</span><Tip :text="t('spending.ed.fxTip', { buffer: fxDefault.buffer })" /></div>
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
        </div>
        <template v-if="isBuf">
          <div class="field">
            <div class="lrow"><label for="sp-bcard" class="req">{{ t('spending.ed.bufCard') }}</label><Tip :text="t('spending.ed.bufCardTip')" /></div>
            <Select v-if="bufCards.length" id="sp-bcard" v-model="cardId" :options="bufOpts" :placeholder="t('spending.ed.bufPick')" />
            <div v-else class="callout" data-testid="sp-nocard">
              <p>{{ t('spending.ed.bufNoCard') }}</p>
              <RouterLink class="lnk" to="/pay">{{ t('spending.ed.bufToCards') }}</RouterLink>
            </div>
          </div>
        </template>
        <div v-if="multi" class="field">
          <span id="sp-n-l" class="flabel">{{ countLabel }}</span>
          <Seg v-model="countSel" block :options="countOpts" labelledby="sp-n-l" />
        </div>
        <div v-if="multi && countSel === 'c'" class="field">
          <label for="sp-nc">{{ t('spending.ed.countCustom', { label: countLabel }) }}</label>
          <MoneyInput id="sp-nc" v-model="countCustom" prefix="" input-class="num" />
          <span class="hint">{{ t(isBuf ? 'spending.ed.countRangeBuffer' : 'spending.ed.countRange') }}</span>
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
        <div v-if="!isBuf" class="field">
          <div class="lrow"><label for="sp-pay">{{ t('spending.ed.payBy') }}</label><Tip :text="t('spending.ed.payByTip')" /></div>
          <Select id="sp-pay" v-model="payBy" :options="payOpts" :disabled="how === 'installment'" />
        </div>
        <div v-if="cardShown" class="field">
          <div class="lrow"><label for="sp-card">{{ t('spending.ed.card') }} <span class="opt">{{ t('common.optional') }}</span></label><Tip :text="t('spending.ed.cardTip')" /></div>
          <Select id="sp-card" v-model="cardId" :options="cardOpts" />
        </div>
        <template v-if="isBuf">
          <div class="field">
            <div class="lrow"><label for="sp-refill">{{ t('spending.ed.refillFrom') }}</label><Tip :text="t('spending.ed.refillTip', { date: md(billDate) })" /></div>
            <DateInput id="sp-refill" v-model="refill" :aria-label="t('spending.ed.refillFrom')" />
          </div>
          <div v-if="gauge" class="bufbox" :class="{ short: gauge.short > 0 }" data-testid="sp-gauge">
            <div class="plan-h"><span>{{ t('spending.ed.gaugeUse', { buffer: fmtMoney(gauge.buffer), use: fmtMoney(gauge.use) }) }}</span><span>{{ t('spending.ed.gaugeLeft') }} <b class="num">{{ gauge.left < 0 ? '−' : '' }}{{ fmtMoney(Math.abs(gauge.left)) }}</b></span></div>
            <div class="kstack" role="img" :aria-label="t('spending.ed.gaugeUse', { buffer: fmtMoney(gauge.buffer), use: fmtMoney(gauge.use) })"><span :style="{ width: `${gauge.w}%` }"></span><span class="rest"></span></div>
            <small v-if="gauge.short" class="warn" role="status" data-testid="sp-short">{{ t('spending.ed.gaugeShort', { amount: fmtMoney(gauge.short) }) }}</small>
            <small v-else class="hint">{{ t('spending.ed.gaugeBack', { until: gauge.until, each: fmtMoney(gauge.each), buffer: fmtMoney(gauge.buffer) }) }}</small>
          </div>
        </template>
        <template v-else-if="customRound">
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
              <li v-for="r in rows" :key="r.no" :class="{ dim: r.state === 'merged' }">
                <span class="num">{{ r.no }}</span><span class="num">{{ r.date }}</span><b class="num">{{ fmtMoney(r.amount) }}</b>
                <span class="tgs"><span class="st" :class="r.state">{{ t(`spending.ed.tag.${r.state}` as 'spending.ed.tag.paid') }}</span><span v-if="r.edited" class="tg">{{ t('spending.ed.tag.edited') }}</span></span>
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
          <p>{{ t('spending.ed.replanText', { marks }) }}</p>
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
    <p>{{ t('spending.ed.replanText', { marks }) }}</p>
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
.rl .tgs{display:flex;gap:4px;justify-content:flex-end}
.rl .st{font-size:11px;color:var(--subtle)}
.rl .st.paid{color:var(--primary-text)}
.rl .tg{font-size:11px;color:var(--accent-text);background:var(--accent-soft);border-radius:var(--r-badge);padding:1px 6px}
.where{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--r-ctl);background:var(--surface-2);border:1px solid var(--border);font-size:13px}
.where b{color:var(--primary-text);text-align:right;overflow-wrap:anywhere}
.memo-add{display:flex;align-items:center;gap:8px;width:100%;height:44px;padding:0 12px;border:1px dashed var(--border-strong);border-radius:var(--r-ctl);background:var(--input);color:var(--muted);font:inherit;font-size:14px;cursor:pointer;text-align:left}
.memo-add:hover{border-color:var(--primary-text);color:var(--primary-text)}
.callout{margin:0}
.callout p{margin:0 0 4px}
.lnk{font-size:13px;font-weight:600;color:var(--primary-text);text-decoration:none}
.lnk:hover{text-decoration:underline}
.bufbox{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--primary-line);border-radius:var(--r-card);background:var(--primary-tint);font-size:13px}
.bufbox .plan-h{padding:0;background:none;border:0;flex-wrap:wrap}
.bufbox .kstack{display:flex;height:10px;gap:2px;border-radius:2px;overflow:hidden}
.bufbox .kstack span{background:var(--primary)}
.bufbox .kstack .rest{flex:1;background:var(--fill)}
.bufbox.short{border-color:var(--neg-line);background:var(--neg-soft)}
.bufbox.short .kstack span:first-child{background:var(--neg-text)}
.bufbox.short .plan-h b{color:var(--neg-text)}
.bufbox .warn{font-size:12px;color:var(--neg-text)}
.danger{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.drow{display:flex;align-items:center;gap:12px}
.drow span{flex:1;min-width:0;font-size:13px;color:var(--text-2)}
.drow span b{display:block;color:var(--neg-text)}
.drow .btn{flex:none}
</style>
