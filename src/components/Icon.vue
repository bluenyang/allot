<script setup lang="ts">
// Nav glyphs and stroke follow the design canvas (spec 007 V-9 b, item 4).
defineProps<{ name: string; stroke?: number }>()
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="stroke ?? 1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'home'"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></template>
    <template v-else-if="name === 'subs'"><path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></template>
    <template v-else-if="name === 'pay'"><path d="M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3M15 9l6-6" /></template>
    <template v-else-if="name === 'money'"><path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3" /></template>
    <template v-else-if="name === 'events'"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></template>
    <template v-else-if="name === 'history'"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" /></template>
    <template v-else-if="name === 'pending'"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></template>
    <template v-else-if="name === 'dev'"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" /></template>
    <template v-else-if="name === 'account'"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></template>
    <template v-else-if="name === 'admin'"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></template>
    <template v-else-if="name === 'prev'"><path d="M15 6l-6 6 6 6" /></template>
    <template v-else-if="name === 'next'"><path d="M9 6l6 6-6 6" /></template>
    <template v-else-if="name === 'settings'"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></template>
    <template v-else-if="name === 'security'"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></template>
    <template v-else-if="name === 'theme'"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" /></template>
    <template v-else-if="name === 'sliders'"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></template>
    <template v-else-if="name === 'chart'"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></template>
    <template v-else-if="name === 'check'"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></template>
    <template v-else-if="name === 'list'"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></template>
    <template v-else-if="name === 'logout'"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></template>
    <template v-else-if="name === 'search'"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></template>
    <template v-else-if="name === 'bell'"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></template>
    <template v-else-if="name === 'sun'"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></template>
    <template v-else-if="name === 'moon'"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></template>
    <template v-else-if="name === 'chev'"><path d="m9 18 6-6-6-6" /></template>
    <template v-else-if="name === 'download'"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></template>
    <template v-else-if="name === 'panel'"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></template>
    <template v-else-if="name === 'living'"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></template>
    <template v-else-if="name === 'saving'"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z" /><path d="M2 9v1c0 1.1.9 2 2 2h1" /><path d="M16 11h.01" /></template>
    <template v-else-if="name === 'invest'"><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></template>
    <template v-else-if="name === 'statements'"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></template>
    <template v-else-if="name === 'assistant'"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8" /><path d="M8 13h5" /></template>
    <template v-else-if="name === 'more'"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></template>
    <template v-else-if="name === 'x'"><path d="M18 6 6 18M6 6l12 12" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
  </svg>
</template>
