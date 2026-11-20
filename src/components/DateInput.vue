<script setup lang="ts">
// DateInput (spec 010 S-14, W-12): the one date field of the app, on Reka's DatePicker and the design
// tokens; the browser's own date input is not used anywhere. A field of three typed parts (year, month,
// day in the language's order; arrows and digits move through them) with a calendar button that opens
// a calendar card. The model is the string the app stores, `YYYY-MM-DD`, and '' for none; it is only
// ever a real day or '' (a half-typed date is '' until the last part is typed). `min` / `max` (same
// format) grey the days in the calendar and mark the field invalid; a typed day outside them is still
// taken (as the native input did). `clearable` adds a clear button. `aria-label` names the field (its group); `id` goes to the first part.
// Escape closes the calendar only (an open dialog around the field stays); the card opens inside the
// dialog that holds the field.
import { DatePickerCalendar, DatePickerCell, DatePickerCellTrigger, DatePickerContent, DatePickerField, DatePickerGrid, DatePickerGridBody, DatePickerGridHead, DatePickerGridRow, DatePickerHeadCell, DatePickerHeader, DatePickerHeading, DatePickerInput, DatePickerNext, DatePickerPrev, DatePickerRoot, DatePickerTrigger, PopoverPortal } from 'reka-ui'
import { computed, onMounted, ref } from 'vue'
import { lang, t } from '../i18n'
import { valueToYmd, ymdToValue } from '../lib/date-value'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: string | null; id?: string; min?: string; max?: string; clearable?: boolean; disabled?: boolean; ariaLabel?: string }>()
const locale = computed(() => lang.value)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const value = computed(() => ymdToValue(props.modelValue))
function pick(v: unknown) {
  const next = v && typeof v === 'object' ? valueToYmd(v as { year: number; month: number; day: number }) : ''
  if (next !== (props.modelValue ?? '')) emit('update:modelValue', next)
}
const open = ref(false)
const gen = ref(0) // a new key re-creates the field, which empties a half-typed date
function clear() {
  gen.value++
  if (props.modelValue) emit('update:modelValue', '')
}
const hasText = computed(() => !!props.modelValue)

const root = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | 'body'>('body')
onMounted(() => { host.value = (root.value?.closest('[role="dialog"],[role="alertdialog"]') as HTMLElement | null) ?? 'body' })
function onEscape(e: KeyboardEvent) {
  e.preventDefault()
  open.value = false
}
const wk = (i: number) => (i === 0 ? 'sun' : i === 6 ? 'sat' : '')
</script>

<template>
  <div ref="root" class="dpi" :class="$attrs.class" :style="$attrs.style as any">
    <DatePickerRoot :key="gen" v-model:open="open" :model-value="value" :min-value="ymdToValue(min)" :max-value="ymdToValue(max)" :locale="locale" :week-starts-on="0" :disabled="disabled" fixed-weeks prevent-deselect granularity="day" @update:model-value="pick">
      <DatePickerField v-slot="{ segments }" class="in dpf" :class="{ off: disabled }" :aria-label="ariaLabel">
        <div class="dp-seg">
          <template v-for="(s, i) in segments" :key="i">
            <span v-if="s.part === 'literal'" class="dp-lit" aria-hidden="true">{{ s.value }}</span>
            <DatePickerInput v-else :part="s.part" class="dp-part" :id="i === 0 ? id : undefined">{{ s.value }}</DatePickerInput>
          </template>
        </div>
        <button v-if="clearable && hasText && !disabled" class="dp-b" type="button" :aria-label="t('common.clear')" @click="clear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <DatePickerTrigger class="dp-b" :aria-label="t('common.openCalendar')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        </DatePickerTrigger>
      </DatePickerField>
      <PopoverPortal :to="host">
        <DatePickerContent class="dp-pop" :side-offset="4" :collision-padding="8" align="start" @escape-key-down="onEscape">
          <DatePickerCalendar v-slot="{ weekDays, grid }">
            <DatePickerHeader class="dp-h">
              <DatePickerPrev class="dp-n" :aria-label="t('shell.prevMonth')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></DatePickerPrev>
              <DatePickerHeading class="dp-t" />
              <DatePickerNext class="dp-n" :aria-label="t('shell.nextMonth')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></DatePickerNext>
            </DatePickerHeader>
            <DatePickerGrid v-for="m in grid" :key="m.value.toString()" class="dp-g">
              <DatePickerGridHead>
                <DatePickerGridRow>
                  <DatePickerHeadCell v-for="(d, i) in weekDays" :key="i" class="dp-w" :class="wk(i)">{{ d }}</DatePickerHeadCell>
                </DatePickerGridRow>
              </DatePickerGridHead>
              <DatePickerGridBody>
                <DatePickerGridRow v-for="(week, wi) in m.rows" :key="wi">
                  <DatePickerCell v-for="(d, di) in week" :key="d.toString()" :date="d" class="dp-c">
                    <DatePickerCellTrigger :day="d" :month="m.value" class="dp-d" :class="wk(di)" />
                  </DatePickerCell>
                </DatePickerGridRow>
              </DatePickerGridBody>
            </DatePickerGrid>
          </DatePickerCalendar>
        </DatePickerContent>
      </PopoverPortal>
    </DatePickerRoot>
  </div>
</template>
