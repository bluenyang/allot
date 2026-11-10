<script setup lang="ts">
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import { exportJson } from '../lib/store'

// The schema lives in server/db/schema.ts and drizzle/; this tab only shows the data.
const tab = ref('json')
const tabs = [{ id: 'json', label: '현재 데이터' }]

const json = computed(() => exportJson())
const copied = ref('')
async function copy() {
  try {
    await navigator.clipboard.writeText(json.value)
    copied.value = '복사했어요.'
  } catch {
    copied.value = '복사가 막혀 있어요. 아래 텍스트를 직접 선택해 주세요.'
  }
}
</script>

<template>
  <section>
    <h1>개발</h1>
    <p class="lede">데이터는 PostgreSQL에 저장돼요. 처음 데이터는 <code>pnpm db:seed</code>로 넣어요. 스키마는 <code>server/db/schema.ts</code>에 있어요.</p>
    <SubTabs v-model="tab" :tabs="tabs" />
    <div class="btns" style="margin:0 0 12px">
      <button class="btn pri" type="button" @click="copy">JSON 복사</button>
      <span class="small muted" role="status">{{ copied }}</span>
    </div>
    <pre style="max-height:480px"><code>{{ json }}</code></pre>
  </section>
</template>
