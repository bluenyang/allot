<script setup lang="ts">
// The currency of an amount (spec 013 S-23): KRW, USD and every code of the currency list. Up to five choices it is the
// segmented control it was (KRW | USD); more choices make it a select, so a long list fits beside the amount.
import Seg from './Seg.vue'
import Select from './Select.vue'

const props = defineProps<{ options: { id: string; label: string }[]; modelValue: string; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()
const pick = (v: unknown) => emit('update:modelValue', String(v ?? ''))
</script>

<template>
  <Seg v-if="props.options.length <= 5" class="cur" :options="props.options" :model-value="props.modelValue" :label="props.label" @update:model-value="pick" />
  <span v-else class="cur cur-sel" role="group" :aria-label="props.label">
    <Select :model-value="props.modelValue" :options="props.options.map((o) => ({ value: o.id, label: o.label }))" @update:model-value="pick" />
  </span>
</template>

<style scoped>
.cur-sel{display:block;min-width:104px}
</style>
