<script setup lang="ts">
import Icon from './Icon.vue'

// Page tabs (spec 007 S-1): icon + label, the selected one gets the soft face and a 2px underline.
// Only for switching views inside a page.
defineProps<{ tabs: { id: string; label: string; icon?: string; count?: number; signal?: boolean }[]; modelValue: string }>()
defineEmits<{ 'update:modelValue': [id: string] }>()
</script>

<template>
  <div class="subtabs" role="tablist">
    <button
      v-for="t in tabs" :key="t.id" type="button" role="tab"
      :aria-selected="t.id === modelValue ? 'true' : 'false'"
      @click="$emit('update:modelValue', t.id)"
    ><Icon v-if="t.icon" :name="t.icon" />{{ t.label }}<span v-if="t.count !== undefined" class="cnt" :class="{ acc: t.signal && t.count > 0 }">{{ t.count }}</span></button>
  </div>
</template>
