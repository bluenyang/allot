<script setup lang="ts">
// Amount field (spec 010 S-5, S-10): `type="text"` with `inputmode`, a currency prefix and thousands
// separators while typing. It takes everything a `type="number"` field took (integers, decimals,
// zero, a sign, with or without commas) and never narrows what the server takes. v-model holds a
// number, or the field's own "empty" (`''` like v-model.number, or `null` with `empty="null"`);
// text that is not a number is "empty" too, as a number input reports it. Attributes (id, class on
// the input via `inputClass`, aria-*, placeholder, disabled, @change) go to the <input>.
import { computed, nextTick, ref, watch } from 'vue'
import { groupMoney, moneyText, moneyValue, parseMoney, sameMoney } from '../lib/money-input'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  modelValue?: number | '' | null
  /** Show a decimal keypad (fields that take fractions: foreign currency, rates). */
  decimal?: boolean
  /** Text before the number; "₩" by default, "" for none. */
  prefix?: string
  /** Text after the number, e.g. "%" or "USD". */
  suffix?: string
  /** What the model holds when the field is empty. */
  empty?: '' | 'null'
  inputClass?: string
}>(), { modelValue: '', prefix: '₩', empty: '' })
const emit = defineEmits<{ 'update:modelValue': [v: number | '' | null] }>()

const el = ref<HTMLInputElement | null>(null)
const text = ref(moneyText(props.modelValue))
const bad = computed(() => parseMoney(text.value).kind === 'bad')

watch(() => props.modelValue, (m) => { if (!sameMoney(text.value, m)) text.value = moneyText(m) })

// The caret stays after the same characters when separators are added or removed.
const sig = (s: string) => s.replace(/[^\d.eE+\-−]/g, '').length

function onInput(e: Event) {
  const input = e.target as HTMLInputElement
  const raw = input.value
  const caret = input.selectionStart ?? raw.length
  const before = sig(raw.slice(0, caret))
  const shown = groupMoney(raw)
  text.value = shown
  if (input.value !== shown) {
    input.value = shown
    let n = 0, pos = 0
    while (pos < shown.length && n < before) { if (sig(shown[pos]!) === 1) n++; pos++ }
    void nextTick(() => input.setSelectionRange(pos, pos))
  }
  emit('update:modelValue', moneyValue(parseMoney(shown), props.empty === 'null' ? null : ''))
}
function onBlur() {
  // A finished number reads in its plain form ("5." → "5", "007" → "7"); other text is left to be seen.
  const p = parseMoney(text.value)
  if (p.kind === 'ok') text.value = moneyText(p.value)
}
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <span class="money" :class="{ bad }">
    <span v-if="prefix" class="mp" aria-hidden="true">{{ prefix }}</span>
    <input
      v-bind="$attrs" ref="el" class="in num" :class="inputClass" type="text" :inputmode="decimal ? 'decimal' : 'numeric'" autocomplete="off"
      :value="text" :aria-invalid="bad ? 'true' : ($attrs['aria-invalid'] as 'true' | 'false' | undefined)" @input="onInput" @blur="onBlur"
    >
    <span v-if="suffix" class="ms" aria-hidden="true">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.money{position:relative;display:block;width:100%}
.mp,.ms{position:absolute;top:50%;transform:translateY(-50%);color:var(--subtle);font-size:13px;pointer-events:none}
.mp{left:11px}
.ms{right:11px}
.money:has(.mp) input{padding-left:28px}
.money:has(.ms) input{padding-right:40px}
input{text-align:right}
</style>
