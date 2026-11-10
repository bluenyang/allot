<script setup lang="ts">
import { computed } from 'vue'
import { man } from '../lib/calc'

const props = defineProps<{ points: { ym: string; value: number; changed: boolean }[]; selected: string }>()
defineEmits<{ pick: [ym: string] }>()

const W = 720, H = 230, L = 52, R = 12, T = 22, B = 34
const max = computed(() => {
  const m = Math.max(...props.points.map((p) => p.value), 1)
  const step = 100_000
  return Math.ceil(m / step) * step
})
const ticks = computed(() => {
  const n = 4
  return Array.from({ length: n + 1 }, (_, i) => (max.value / n) * i)
})
const bw = computed(() => (W - L - R) / props.points.length)
const y = (v: number) => T + (H - T - B) * (1 - v / max.value)
</script>

<template>
  <div class="chart">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="월별 구독 필요 이체액">
      <g v-for="t in ticks" :key="t">
        <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" stroke="var(--line)" stroke-width="1" />
        <text :x="L - 8" :y="y(t) + 4" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">{{ man(t) }}</text>
      </g>
      <g v-for="(p, i) in points" :key="p.ym" style="cursor:pointer" @click="$emit('pick', p.ym)">
        <rect :x="L + i * bw" :y="T" :width="bw" :height="H - T - B" fill="transparent" />
        <rect :x="L + i * bw + bw * 0.18" :y="y(p.value)" :width="bw * 0.64" :height="H - B - y(p.value)" rx="5"
          :fill="p.ym === selected ? 'var(--accent)' : 'var(--c7)'" />
        <text v-if="p.changed" :x="L + i * bw + bw / 2" :y="y(p.value) - 6" text-anchor="middle" font-size="11" fill="var(--warn)" font-weight="700">변경</text>
        <text :x="L + i * bw + bw / 2" :y="H - B + 16" text-anchor="middle" font-size="11"
          :fill="p.ym === selected ? 'var(--accent)' : 'var(--muted)'" font-family="var(--f-num)">{{ p.ym.slice(2).replace('-', '.') }}</text>
      </g>
      <line :x1="L" :x2="W - R" :y1="H - B" :y2="H - B" stroke="var(--muted)" stroke-width="1" />
    </svg>
  </div>
</template>
