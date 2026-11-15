<script setup lang="ts">
// Page header (spec 007 S-2): where you are (group / page), the title, one line on what the
// page does, and the page's main buttons on the right.
defineProps<{ crumb?: string; title: string; desc?: string }>()
</script>

<template>
  <header class="ph">
    <div class="ph-t">
      <p v-if="crumb || $slots.meta" class="crumb"><span v-if="crumb">{{ crumb }}</span><slot name="meta" /></p>
      <h1>{{ title }}</h1>
      <p v-if="desc || $slots.desc" class="sub"><slot name="desc">{{ desc }}</slot></p>
    </div>
    <div v-if="$slots.default" class="ph-a"><slot /></div>
  </header>
</template>

<style scoped>
.ph-t{display:flex;flex-direction:column;gap:4px;min-width:0}
.ph-t h1{margin:0}
.ph-t .sub{margin:0}
.crumb{margin:0 0 2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--subtle)}
.ph-a{display:flex;gap:8px;flex-wrap:wrap}
</style>
