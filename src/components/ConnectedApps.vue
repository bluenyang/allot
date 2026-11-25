<script setup lang="ts">
// 설정 › AI·연동 › 연결된 앱 (spec 015 S-10): the apps the user connected with OAuth, their permission, when they were
// connected and last used, and 끊기 (GET / DELETE /api/oauth-apps). Disconnecting refuses the app's token at once.
import { onActivated, onMounted, ref } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { api, ApiError } from '../lib/api'
import { lang, t, type MessageKey } from '../i18n'
import { sessionScope } from '../lib/store'

type Scope = 'allot:read' | 'allot:propose' | 'allot:apply'
interface App { clientId: string; name: string; scope: Scope | null; connectedAt: string; lastUsedAt: string | null }

const SCOPE: Record<Scope, MessageKey> = { 'allot:read': 'oauth.apps.read', 'allot:propose': 'oauth.apps.propose', 'allot:apply': 'oauth.apps.apply' }
const apps = ref<App[]>([])
const enabled = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const asking = ref<App | null>(null)

const loc = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
const day = (at: string) => new Date(at).toLocaleDateString(loc(), { dateStyle: 'medium' })
const used = (at: string | null) => (at ? new Date(at).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }) : t('oauth.apps.neverUsed'))
const scopeText = (s: Scope | null) => (s ? t(SCOPE[s]) : '—')

async function load() {
  const scope = sessionScope()
  try {
    const r = await api<{ enabled: boolean; apps: App[] }>('GET', '/api/oauth-apps')
    if (!scope.alive()) return
    apps.value = r.apps
    enabled.value = r.enabled
    loaded.value = true
  } catch (e) {
    if (scope.alive()) error.value = e instanceof ApiError ? e.message : t('oauth.apps.failed')
  }
}
onMounted(load)
onActivated(load)

async function disconnect() {
  const app = asking.value
  if (!app) return
  busy.value = true
  error.value = ''
  try {
    await api('DELETE', `/api/oauth-apps/${encodeURIComponent(app.clientId)}`)
    notice.value = t('oauth.apps.disconnected', { name: app.name })
    asking.value = null
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('oauth.apps.failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="apps">
    <span class="lbl">{{ t('oauth.apps.title') }}</span>
    <p>{{ enabled ? t('oauth.apps.intro') : t('oauth.apps.off') }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>
    <ul v-if="apps.length" class="alist">
      <li v-for="a in apps" :key="a.clientId">
        <span class="an"><b>{{ a.name }}</b><span class="pill" :class="a.scope === 'allot:read' ? 'mute' : 'ok'">{{ scopeText(a.scope) }}</span></span>
        <span class="hint">{{ t('oauth.apps.colConnected') }} {{ day(a.connectedAt) }} · {{ t('oauth.apps.colLastUsed') }} {{ used(a.lastUsedAt) }}</span>
        <button class="btn sm" type="button" :disabled="busy" :aria-label="t('oauth.apps.disconnectLabel', { name: a.name })" @click="asking = a">{{ t('oauth.apps.disconnect') }}</button>
      </li>
    </ul>
    <p v-else-if="loaded" class="hint">{{ t('oauth.apps.none') }}</p>
    <ConfirmDialog v-if="asking" :title="t('oauth.apps.confirmTitle', { name: asking.name })" :confirm-label="t('oauth.apps.disconnect')" danger :busy="busy" @confirm="disconnect" @cancel="asking = null">
      {{ t('oauth.apps.confirmBody') }}
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.apps{border-top:1px solid var(--border);padding-top:16px;display:flex;flex-direction:column;gap:10px;align-items:stretch}
.apps .lbl{margin:0}
.apps > p{margin:0;font-size:13px;color:var(--text-2)}
.alist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.alist li{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:center;padding:12px;border:1px solid var(--border);border-radius:var(--r-card)}
.an{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.an b{overflow-wrap:anywhere}
.alist .hint{grid-column:1}
.alist .btn{grid-column:2;grid-row:1 / span 2}
.err{margin:0;color:var(--neg-text);font-size:13px}
</style>
