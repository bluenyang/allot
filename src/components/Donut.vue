<script setup lang="ts">
import { computed } from 'vue'
import { allocColor } from '../lib/colors'
const props = defineProps<{ rows: { key: string; name: string; amount: number }[]; center: string; caption: string }>()
const R = 54, C = 2 * Math.PI * R
const segs = computed(() => {
  const list = props.rows.filter((r) => r.amount > 0)
  const total = list.reduce((a, r) => a + r.amount, 0)
  let off = 0
  return list.map((r) => {
    const len = (r.amount / total) * C
    const s = { key: r.key, len: Math.max(len - 2, 0), off }
    off += len
    return s
  })
})
</script>

<template>
  <svg viewBox="0 0 140 140" width="150" height="150" role="img" :aria-label="caption" style="flex:none">
    <circle cx="70" cy="70" :r="R" fill="none" stroke="var(--raised)" stroke-width="16" />
    <circle v-for="s in segs" :key="s.key" cx="70" cy="70" :r="R" fill="none" :stroke="allocColor(s.key)" stroke-width="16"
      :stroke-dasharray="`${s.len} ${C}`" :stroke-dashoffset="-s.off" transform="rotate(-90 70 70)" />
    <text x="70" y="66" text-anchor="middle" font-size="11" fill="var(--muted)">{{ caption }}</text>
    <text x="70" y="86" text-anchor="middle" font-size="19" font-weight="700" fill="var(--fg)" font-family="var(--f-num)">{{ center }}</text>
  </svg>
</template>
