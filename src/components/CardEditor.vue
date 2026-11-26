<script setup lang="ts">
// 카드 추가·수정 (spec 013 S-13): name, last 4 digits, the paying account (its bill leaves that account) and
// the billing day (empty = the settings' billing day), note. EditSheet + useEditor; the API decides what
// is valid (last 4 digits, day 1–31) and its message is shown. Delete is refused while a buffer use goes
// through the card; otherwise the spendings that named it lose the card (their rounds stay as saved).
// The first day of the usage period (spec 018 S-2) is optional: with it, a purchase is billed on the first billing
// day after the period that holds it ends; the line under the field shows the period of today and its bill.
import { computed, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import Select from './Select.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import { addYm, cardBillDate, needsHolidays, usagePeriod, ymd } from '../lib/calc'
import { offDays } from '../lib/holidays-lazy'
import { localToday } from '../lib/now'
import type { Card } from '../data/types'

const props = defineProps<{ initial: Card | null }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): Card => ({ id: '', name: '', last4: '', accountId: null, billingDay: null, usageFrom: null, note: '' })
const { item: edit, error, busy, open, close, save, remove } = useEditor('cards', blank, (c) => (!c.name.trim() ? t('accounts.cardEditor.needName') : null))
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('accounts.cardEditor.editTitle') : t('accounts.cardEditor.addTitle')

// '' in a select is "none" (null).
const account = computed({
  get: () => edit.value?.accountId ?? '',
  set: (v: string) => { edit.value!.accountId = v || null },
})
const accountOpts = computed(() => [{ value: '', label: t('accounts.cardEditor.accountNone') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
const day = computed({
  get: () => edit.value?.billingDay ?? '',
  set: (v: number | '') => { edit.value!.billingDay = v === '' ? null : v },
})
const dayOpts = computed(() => [
  { value: '', label: t('accounts.cardEditor.dayDefault', { n: store.settings.billingDay }) },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('accounts.cards.dayOf', { n: i + 1 }) })),
])
const usage = computed({
  get: () => edit.value?.usageFrom ?? '',
  set: (v: number | '') => { edit.value!.usageFrom = v === '' ? null : v },
})
const usageOpts = computed(() => [
  { value: '', label: t('accounts.cardEditor.usageNone') },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('accounts.cards.dayOf', { n: i + 1 }) })),
])
/** The usage period that holds today and the bill it goes to, with the days picked here (not saved yet). */
const usageNow = computed(() => {
  const c = edit.value
  if (!c?.usageFrom) return ''
  const today = ymd(localToday())
  // the card's own usage period and bill, by dates: they do not follow the month basis (the calendar month only sets the holiday range)
  const ym = today.slice(0, 7)
  const off = needsHolidays(store.settings, store.schedules) ? offDays(store.holidaySets, `${addYm(ym, -1)}-01`, `${addYm(ym, 4)}-01`) ?? new Set<string>() : new Set<string>()
  const p = usagePeriod(today, c.usageFrom)
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  return t('accounts.cardEditor.usageNow', { start: md(p.start), end: md(p.end), bill: md(cardBillDate(today, c, store.settings, off)) })
})
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="t('accounts.cardEditor.desc')" :error="error" :busy="busy"
    :can-delete="!!edit.id" :delete-name="edit.name" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="cd-name">{{ t('accounts.cardEditor.name') }} <span class="star" aria-hidden="true">*</span></label>
      <input id="cd-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('accounts.cardEditor.namePh')">
    </div>
    <div class="field">
      <label for="cd-last4">{{ t('accounts.cardEditor.last4') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="cd-last4" v-model="edit.last4" class="in" inputmode="numeric" autocomplete="off" :placeholder="t('accounts.editor.last4Ph')">
    </div>
    <div class="field">
      <label for="cd-acc">{{ t('accounts.cardEditor.account') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="cd-acc" v-model="account" :options="accountOpts" />
      <span class="hint">{{ t('accounts.cardEditor.accountHint') }}</span>
    </div>
    <div class="field">
      <label for="cd-day">{{ t('accounts.cardEditor.day') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="cd-day" v-model="day" :options="dayOpts" />
      <span class="hint">{{ t('accounts.cardEditor.dayHint') }}</span>
    </div>
    <div class="field">
      <label for="cd-usage">{{ t('accounts.cardEditor.usage') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="cd-usage" v-model="usage" :options="usageOpts" />
      <span class="hint">{{ t('accounts.cardEditor.usageHint') }}</span>
      <span v-if="usageNow" class="hint now" data-testid="cd-usage-now">{{ usageNow }}</span>
      <span class="hint">{{ t('accounts.cardEditor.usageNote') }}</span>
    </div>
    <div class="field">
      <label for="cd-note">{{ t('accounts.cardEditor.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="cd-note" v-model="edit.note" class="in" autocomplete="off">
    </div>
  </EditSheet>
</template>

<style scoped>
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
.hint.now{color:var(--text-2)}
</style>
