<script setup lang="ts">
// The dates of a month next to its name (spec 018 S-3): " · 11/25~12/24" in the user's date format, wherever a screen
// names the month it is looking at. With the calendar basis it renders nothing: the screens look as they did.
import { computed } from 'vue'
import { periodLabel } from '../lib/month'
const props = defineProps<{ ym: string }>()
const label = computed(() => periodLabel(props.ym))
</script>

<template>
  <span v-if="label" class="mperiod num" data-testid="month-period"><span aria-hidden="true"> · </span>{{ label }}</span>
</template>

<style scoped>
.mperiod{font-weight:400;font-size:.86em;color:var(--muted);white-space:nowrap}
</style>
