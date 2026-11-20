<script setup lang="ts">
// MonthInput (spec 010 S-14, W-12): the one month field of the app, in place of the browser's month
// input. A text field (`YYYY-MM`; `2027-3`, `2027.03` and `202703` are read too) with a calendar button that
// opens a year card of twelve months (Reka's MonthPicker, on the design tokens). The model is the string the
// app stores, `YYYY-MM`, and '' for none. A complete month is taken as it is typed; on leaving the field
// whatever is not a month goes back to the model's value, or to '' when `clearable` and the field was emptied
// (without `clearable`, an emptied field keeps the old month). `min` / `max` (same format) grey months in the
// card; a typed month outside them is still taken (as the native input did). `id` / `aria-label` go to the text field.
// Escape closes the card only (an open dialog around the field stays); the card opens inside the dialog
// that holds the field.
import { MonthPickerCell, MonthPickerCellTrigger, MonthPickerGrid, MonthPickerGridBody, MonthPickerGridRow, MonthPickerHeader, MonthPickerHeading, MonthPickerNext, MonthPickerPrev, MonthPickerRoot, PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { lang, t } from '../i18n'
import { parseMonthText, valueToYm, ymToValue } from '../lib/date-value'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: string | null; id?: string; min?: string; max?: string; clearable?: boolean; disabled?: boolean; placeholder?: string; ariaLabel?: string }>()
const locale = computed(() => lang.value)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const model = computed(() => props.modelValue ?? '')
const text = ref(model.value)
watch(model, (v) => { if (parseMonthText(text.value) !== v) text.value = v })

function commit(next: string) {
  if (next !== model.value) emit('update:modelValue', next)
}
function onInput() {
  const ym = parseMonthText(text.value)
  if (ym && /^\d{4}-\d{2}$/.test(text.value.trim())) commit(ym) // typed out in full: taken at once
  else if (!text.value.trim() && props.clearable) commit('')
}
function settle() {
  const ym = parseMonthText(text.value)
  if (ym) commit(ym)
  else if (!text.value.trim() && props.clearable) commit('')
  text.value = ym ?? (!text.value.trim() && props.clearable ? '' : model.value)
}
function clear() {
  text.value = ''
  commit('')
}

const open = ref(false)
const value = computed(() => ymToValue(model.value))
function pick(v: unknown) {
  if (!v || typeof v !== 'object') return
  const ym = valueToYm(v as { year: number; month: number })
  text.value = ym
  commit(ym)
  open.value = false
}

const root = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | 'body'>('body')
onMounted(() => { host.value = (root.value?.closest('[role="dialog"],[role="alertdialog"]') as HTMLElement | null) ?? 'body' })
function onEscape(e: KeyboardEvent) {
  e.preventDefault()
  open.value = false
}
</script>

<template>
  <div ref="root" class="dpi" :class="$attrs.class" :style="$attrs.style as any">
    <PopoverRoot v-model:open="open">
      <PopoverAnchor as-child>
        <div class="in dpf" :class="{ off: disabled }">
          <input :id="id" v-model="text" class="dp-txt num" inputmode="numeric" autocomplete="off" :placeholder="placeholder ?? 'YYYY-MM'" :aria-label="ariaLabel" :disabled="disabled" @input="onInput" @blur="settle" @keydown.enter="settle">
          <button v-if="clearable && text && !disabled" class="dp-b" type="button" :aria-label="t('common.clear')" @click="clear">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <PopoverTrigger class="dp-b" type="button" :aria-label="t('common.openCalendar')" :disabled="disabled">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverPortal :to="host">
        <PopoverContent class="dp-pop mp" :side-offset="4" :collision-padding="8" align="start" @escape-key-down="onEscape" @open-auto-focus="(e: Event) => e.preventDefault()">
          <MonthPickerRoot v-slot="{ grid }" :model-value="value" :min-value="ymToValue(min)" :max-value="ymToValue(max)" :locale="locale" prevent-deselect initial-focus @update:model-value="pick">
            <MonthPickerHeader class="dp-h">
              <MonthPickerPrev class="dp-n" :aria-label="t('common.prevYear')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></MonthPickerPrev>
              <MonthPickerHeading class="dp-t" />
              <MonthPickerNext class="dp-n" :aria-label="t('common.nextYear')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></MonthPickerNext>
            </MonthPickerHeader>
            <MonthPickerGrid class="dp-g">
              <MonthPickerGridBody>
                <MonthPickerGridRow v-for="(row, ri) in grid.rows" :key="ri">
                  <MonthPickerCell v-for="m in row" :key="m.toString()" :date="m" class="dp-c">
                    <MonthPickerCellTrigger :month="m" class="dp-d dp-m" />
                  </MonthPickerCell>
                </MonthPickerGridRow>
              </MonthPickerGridBody>
            </MonthPickerGrid>
          </MonthPickerRoot>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
