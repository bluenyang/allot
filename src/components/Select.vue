<script setup lang="ts">
// Select (spec 010 S-13, W-10): the one dropdown of the app, on Reka's Select and the design tokens.
// The browser's own select element is not used anywhere: its opened list cannot be styled and differs per
// platform. Close to the native one: `v-model`, `options`, `id` (so a <label for> names it), `aria-label`
// / `aria-labelledby` (passed to the trigger), `placeholder`, `disabled`.
// Option values may be strings or numbers; Reka's values are strings, so each option gets its position as
// the key and the model gets the option's own value back (a number stays a number). A stored value that
// is not among the options is still shown and stays selected, as an extra option at the end.
import { computed, onMounted, ref } from 'vue'
import { SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectScrollDownButton, SelectScrollUpButton, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'

type Val = string | number
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue?: Val | null; options: { value: Val; label: string; disabled?: boolean }[]; id?: string; placeholder?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const items = computed(() => {
  const list = props.options.map((o) => ({ ...o }))
  const v = props.modelValue
  if (v !== undefined && v !== null && v !== '' && !list.some((o) => o.value === v || String(o.value) === String(v))) list.push({ value: v, label: String(v) })
  return list
})
const index = computed(() => {
  const v = props.modelValue
  let i = items.value.findIndex((o) => o.value === v)
  if (i < 0 && v !== undefined && v !== null) i = items.value.findIndex((o) => String(o.value) === String(v))
  return i
})
const key = computed(() => (index.value < 0 ? undefined : String(index.value)))
const shown = computed(() => (index.value < 0 ? '' : items.value[index.value].label))
function pick(k: unknown) {
  if (typeof k !== 'string') return
  const o = items.value[Number(k)]
  if (o && o.value !== props.modelValue) emit('update:modelValue', o.value)
}

// Escape closes the list only: the list is the topmost Reka layer, so a Dialog around the trigger leaves
// the key alone; the list is closed here (and the key cancelled, so nothing else acts on it).
const isOpen = ref(false)
function onEscape(e: KeyboardEvent) {
  e.preventDefault()
  isOpen.value = false
}

// The list opens inside the dialog that holds the trigger (a Reka Dialog makes everything outside it inert).
const trigger = ref<{ $el: HTMLElement } | null>(null)
const host = ref<HTMLElement | 'body'>('body')
onMounted(() => { host.value = (trigger.value?.$el.closest('[role="dialog"],[role="alertdialog"]') as HTMLElement | null) ?? 'body' })
</script>

<template>
  <SelectRoot v-model:open="isOpen" :model-value="key" :disabled="disabled" @update:model-value="pick">
    <SelectTrigger :id="id" ref="trigger" v-bind="$attrs" class="in sel-t" :data-value="modelValue ?? ''" :disabled="disabled">
      <SelectValue :placeholder="placeholder"><span class="sel-v" :class="{ ph: !shown }">{{ shown || placeholder }}</span></SelectValue>
      <SelectIcon class="sel-i" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg></SelectIcon>
    </SelectTrigger>
    <SelectPortal :to="host">
      <SelectContent class="sel-pop" position="popper" :side-offset="4" :collision-padding="8" @escape-key-down="onEscape">
        <SelectScrollUpButton class="sel-sc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></SelectScrollUpButton>
        <SelectViewport class="sel-vp">
          <SelectItem v-for="(o, i) in items" :key="i" :value="String(i)" :disabled="o.disabled" class="sel-o" :data-value="String(o.value)">
            <SelectItemText>{{ o.label }}</SelectItemText>
            <SelectItemIndicator class="sel-ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
        <SelectScrollDownButton class="sel-sc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
