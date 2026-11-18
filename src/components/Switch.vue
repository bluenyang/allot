<script setup lang="ts">
// On/off switch (spec 010 S-5): a button with role="switch". Name it with `label` (aria-label) or a
// <label for> pointing at `id`.
defineProps<{ modelValue: boolean; id?: string; label?: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [on: boolean] }>()
</script>

<template>
  <button :id="id" class="switch" type="button" role="switch" :aria-checked="modelValue ? 'true' : 'false'" :aria-label="label" :disabled="disabled" @click="$emit('update:modelValue', !modelValue)"><i></i></button>
</template>
