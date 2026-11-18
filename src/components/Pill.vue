<script setup lang="ts">
// A fully rounded choice or filter (spec 010 S-5; the canvas `.chip`). Selected = `--sel` ground with
// a primary border. Not the small status badge (`span.pill`).
defineProps<{ selected?: boolean; count?: number; signal?: boolean; disabled?: boolean }>()
</script>

<template>
  <button class="chip" type="button" :aria-pressed="selected ? 'true' : 'false'" :class="{ on: selected }" :disabled="disabled">
    <slot /><span v-if="count !== undefined" class="c" :class="{ sig: signal && count > 0 }">{{ count }}</span>
  </button>
</template>
