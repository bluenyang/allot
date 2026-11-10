<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'home'"><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></template>
    <template v-else-if="name === 'subs'"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></template>
    <template v-else-if="name === 'pay'"><path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3" /></template>
    <template v-else-if="name === 'events'"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></template>
    <template v-else-if="name === 'dev'"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" /></template>
    <template v-else-if="name === 'prev'"><path d="M15 6l-6 6 6 6" /></template>
    <template v-else-if="name === 'next'"><path d="M9 6l6 6-6 6" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
  </svg>
</template>
