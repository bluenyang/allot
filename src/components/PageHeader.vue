<script setup lang="ts">
// Page header (spec 007 S-2, S-15): the title, one line on what the page does, and the page's main
// buttons on the right. Where you are (group / page) is in the shell's header bar, as in the design.
defineProps<{ title: string; desc?: string }>()
</script>

<template>
  <header class="ph">
    <div class="ph-t">
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
.ph-a{display:flex;gap:8px;flex-wrap:wrap}
</style>
