<script setup lang="ts">
// Segmented control (spec 010 S-5): two to five exclusive options. Track variant by default
// (`--fill` track, raised selected button); `bordered` is the outlined one the dashboard keeps.
defineProps<{ options: { id: string | number; label: string; count?: number; disabled?: boolean }[]; modelValue: string | number; label?: string; labelledby?: string; bordered?: boolean }>()
defineEmits<{ 'update:modelValue': [id: any] }>()
</script>

<template>
  <div class="seg" :class="{ bordered }" role="group" :aria-label="label" :aria-labelledby="labelledby">
    <button v-for="o in options" :key="o.id" type="button" :aria-pressed="o.id === modelValue ? 'true' : 'false'" :disabled="o.disabled" @click="$emit('update:modelValue', o.id)">
      {{ o.label }}<span v-if="o.count !== undefined" class="c">{{ o.count }}</span>
    </button>
  </div>
</template>
