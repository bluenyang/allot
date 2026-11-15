<script setup lang="ts">
import { computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import SubTabs from '../components/SubTabs.vue'
import Account from './Account.vue'

// 설정 (spec 007 S-12): per-account settings in tabs. The tab is part of the hash (#settings/<tab>);
// #account opens the login & security tab.
const props = defineProps<{ sub?: string }>()
const tabs = [
  { id: 'security', label: '로그인·보안', icon: 'security' },
]
const tab = computed(() => (tabs.some((t) => t.id === props.sub) ? props.sub! : tabs[0]!.id))
const pick = (id: string) => { location.hash = `#settings/${id}` }
</script>

<template>
  <section>
    <PageHeader crumb="설정" title="설정" desc="계정마다 따로 저장돼요. 다른 사용자의 화면에는 영향이 없어요." />
    <SubTabs :model-value="tab" :tabs="tabs" @update:model-value="pick" />
    <Account v-if="tab === 'security'" />
  </section>
</template>
