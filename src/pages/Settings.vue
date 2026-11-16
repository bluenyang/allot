<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import PageHeader from '../components/PageHeader.vue'
import SubTabs from '../components/SubTabs.vue'
import Account from './Account.vue'
import SettingsAi from './SettingsAi.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsTheme from './SettingsTheme.vue'

// 설정 (spec 007 S-12): per-account settings in tabs. The tab is part of the hash (#settings/<tab>);
// #account opens the login & security tab.
const props = defineProps<{ sub?: string }>()
const tabs = computed(() => (['general', 'theme', 'ai', 'security'] as const).map((id) => ({ id, label: t(`settings.tabs.${id}`) })))
const tab = computed(() => (tabs.value.some((x) => x.id === props.sub) ? props.sub! : 'general'))
const pick = (id: string) => { location.hash = `#settings/${id}` }
</script>

<template>
  <section>
    <PageHeader :title="t('settings.title')" :desc="t('settings.desc')" />
    <SubTabs :model-value="tab" :tabs="tabs" @update:model-value="pick" />
    <SettingsGeneral v-if="tab === 'general'" />
    <SettingsTheme v-else-if="tab === 'theme'" />
    <SettingsAi v-else-if="tab === 'ai'" />
    <Account v-else />
  </section>
</template>
