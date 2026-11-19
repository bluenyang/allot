<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'
import { api } from '../lib/api'
import { authClient } from '../lib/auth-client'
import { sessionScope } from '../lib/store'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import SubTabs from '../components/SubTabs.vue'
import Account from './Account.vue'
import SettingsAi from './SettingsAi.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsTheme from './SettingsTheme.vue'

// 설정 (spec 007 S-12, spec 010 S-11): per-account settings in tabs. The tab is part of the hash
// (#settings/<tab>); #account opens the login & security tab. On a phone the page opens with the
// account card (name, e-mail, role, sign out), as drawn in the canvas (SH-25).
const props = defineProps<{ sub?: string }>()
const tabs = computed(() => (['general', 'theme', 'ai', 'security'] as const).map((id) => ({ id, label: t(`settings.tabs.${id}`) })))
const tab = computed(() => (tabs.value.some((x) => x.id === props.sub) ? props.sub! : 'general'))
const pick = (id: string) => { location.hash = `#settings/${id}` }

interface Me { name: string; email: string; role: string }
const me = ref<Me | null>(null)
const phone = window.matchMedia('(max-width: 760px)')
async function loadMe() {
  if (me.value || !phone.matches) return
  const scope = sessionScope()
  try {
    const r = (await api<{ user: Me }>('GET', '/api/me')).user
    scope.ifCurrent(() => { me.value = r })
  } catch { /* the card is left out without it */ }
}
onMounted(() => { void loadMe(); phone.addEventListener('change', loadMe) })
onBeforeUnmount(() => phone.removeEventListener('change', loadMe))
const logout = () => authClient.signOut()
</script>

<template>
  <section>
    <section v-if="me" class="card acct ph-only" :aria-label="t('settings.myAccount')">
      <span class="ava" aria-hidden="true">{{ (me.name || me.email).slice(0, 1) }}</span>
      <span class="who"><b>{{ me.name || me.email }}</b><small class="hint">{{ me.email }} · {{ me.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</small></span>
      <button class="btn bad" type="button" @click="logout"><Icon name="logout" :stroke="1.9" />{{ t('shell.logout') }}</button>
    </section>
    <PageHeader :title="t('settings.title')" :desc="t('settings.desc')" />
    <SubTabs :model-value="tab" :tabs="tabs" :label="t('settings.tabsLabel')" @update:model-value="pick" />
    <SettingsGeneral v-if="tab === 'general'" />
    <SettingsTheme v-else-if="tab === 'theme'" />
    <SettingsAi v-else-if="tab === 'ai'" />
    <Account v-else />
  </section>
</template>

<style scoped>
.acct{display:none;align-items:center;gap:12px;padding:14px 16px;margin:0 0 16px}
.ava{width:40px;height:40px;border-radius:var(--r-card);background:var(--ava);color:var(--text-2);display:grid;place-items:center;font-weight:600;flex:none}
.who{flex:1;min-width:0;display:flex;flex-direction:column}
.who b,.who small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:760px){.acct{display:flex}}
</style>
