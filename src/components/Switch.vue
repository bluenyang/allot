<script setup lang="ts">
// On/off switch (spec 010 S-5, S-13): Reka's Switch (a button with role="switch"). Name it with `label`
// (aria-label) or a <label for> pointing at `id`.
import { SwitchRoot, SwitchThumb } from 'reka-ui'

defineProps<{ modelValue: boolean; id?: string; label?: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [on: boolean] }>()
</script>

<template>
  <SwitchRoot :id="id" class="switch" :model-value="modelValue" :aria-label="label" :disabled="disabled" @update:model-value="$emit('update:modelValue', $event)"><SwitchThumb as="i" /></SwitchRoot>
</template>
