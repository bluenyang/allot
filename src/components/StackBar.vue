<script setup lang="ts">
import { computed } from 'vue'
import { man } from '../lib/calc'
import { allocColor } from '../lib/colors'
const props = defineProps<{ rows: { key: string; name: string; amount: number }[] }>()
const total = computed(() => props.rows.reduce((a, r) => a + Math.max(r.amount, 0), 0))
</script>

<template>
  <div>
    <div style="display:flex;gap:3px;height:10px" role="img" :aria-label="rows.map((r) => r.name + ' ' + man(r.amount)).join(', ')">
      <div v-for="r in rows.filter((x) => x.amount > 0)" :key="r.key"
        :style="{ flex: r.amount / total, background: allocColor(r.key), borderRadius: '5px' }"></div>
    </div>
    <div class="legend">
      <span v-for="r in rows" :key="r.key"><i :style="{ background: allocColor(r.key) }"></i>{{ r.name.split(' ')[0] }} <b class="num" style="color:var(--fg)">{{ man(r.amount) }}</b></span>
    </div>
  </div>
</template>
