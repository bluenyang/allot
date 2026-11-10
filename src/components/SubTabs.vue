<script setup lang="ts">
defineProps<{ tabs: { id: string; label: string }[]; modelValue: string }>()
defineEmits<{ 'update:modelValue': [id: string] }>()
</script>

<template>
  <div class="subtabs" role="tablist">
    <button
      v-for="t in tabs" :key="t.id" type="button" role="tab"
      :aria-selected="t.id === modelValue ? 'true' : 'false'"
      @click="$emit('update:modelValue', t.id)"
    >{{ t.label }}</button>
  </div>
</template>
