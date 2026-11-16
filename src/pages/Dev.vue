<script setup lang="ts">
import { t } from '../i18n'
import PageHeader from '../components/PageHeader.vue'
import { computed, ref } from 'vue'
import SubTabs from '../components/SubTabs.vue'
import { exportJson } from '../lib/store'

// The schema lives in server/db/schema.ts and drizzle/; this tab only shows the data.
const tab = ref('json')
const tabs = computed(() => [{ id: 'json', label: t('dev.tabData'), icon: 'dev' }])

const json = computed(() => exportJson())
const copied = ref('')
async function copy() {
  try {
    await navigator.clipboard.writeText(json.value)
    copied.value = t('dev.copied')
  } catch {
    copied.value = t('dev.copyBlocked')
  }
}
</script>

<template>
  <section>
    <PageHeader :title="t('dev.title')">
      <template #desc><i18n-t keypath="dev.desc" tag="span"><template #seed><code>pnpm db:seed</code></template><template #schema><code>server/db/schema.ts</code></template></i18n-t></template>
    </PageHeader>
    <SubTabs v-model="tab" :tabs="tabs" />
    <div class="btns" style="margin:0 0 12px">
      <button class="btn pri" type="button" @click="copy">{{ t('dev.copyJson') }}</button>
      <span class="small muted" role="status">{{ copied }}</span>
    </div>
    <pre style="max-height:480px"><code>{{ json }}</code></pre>
  </section>
</template>
