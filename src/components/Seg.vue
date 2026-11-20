<script setup lang="ts">
// Segmented control (spec 010 S-5, S-13): two to five exclusive options on Reka's ToggleGroup (single).
// Track variant by default (`--fill` track, raised selected button); `bordered` is the outlined one the
// dashboard keeps. The selected option cannot be switched off: pressing it again keeps it. Ids may be
// strings or numbers; the model keeps the id's own type.
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

const props = defineProps<{ options: { id: string | number; label: string; count?: number; disabled?: boolean }[]; modelValue: string | number; label?: string; labelledby?: string; bordered?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [id: any] }>()

function pick(v: unknown) {
  if (typeof v !== 'string') return // a press on the selected option clears it (undefined) in Reka: keep it; '' is a real id (the "그대로" option)
  const o = props.options.find((x) => String(x.id) === v)
  if (o && o.id !== props.modelValue) emit('update:modelValue', o.id)
}
</script>

<template>
  <ToggleGroupRoot class="seg" :class="{ bordered }" type="single" :model-value="String(modelValue)" :aria-label="label" :aria-labelledby="labelledby" @update:model-value="pick">
    <ToggleGroupItem v-for="o in options" :key="o.id" :value="String(o.id)" :disabled="o.disabled">
      {{ o.label }}<span v-if="o.count !== undefined" class="c">{{ o.count }}</span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
