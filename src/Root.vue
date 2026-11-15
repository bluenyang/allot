<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import App from './App.vue'
import Login from './pages/Login.vue'
import { authClient, lastRetryAfter } from './lib/auth-client'
import { ApiError, api, onUnauthorized } from './lib/api'
import { loadState, status, store } from './lib/store'
import { applyTheme } from './lib/theme'

const session = authClient.useSession()
// Too many session checks (429) is not "signed out": say so and load the page again once the time
// the server gave (X-Retry-After) has passed, instead of showing the login form (spec 007 S-14).
// Only a 429 is handled here; any other error shows as before. A reload starts everything afresh,
// so there is no retry state to get wrong (reviews 6–9).
const limited = computed(() => !session.value.data && session.value.error?.status === 429)
let reload: ReturnType<typeof setTimeout> | undefined
watch(limited, (on) => {
  clearTimeout(reload)
  if (on) reload = setTimeout(() => window.location.reload(), Math.min(Math.max(lastRetryAfter() || 5, 1), 120) * 1000)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(reload))
// The user's theme (spec 007 S-7): applied whenever the saved settings change (load, save, revert).
watch(() => status.loaded && { ...store.preferences }, (p) => { if (p) applyTheme(p) }, { deep: true })
// The API said the session is gone (expired or signed out elsewhere): show the login screen.
onUnauthorized.handler = () => window.location.reload()

// #app-login?return=<app URL> (spec 006 S-6): sign in here, then hand the app a one-time token.
const appReturn = (() => {
  const h = window.location.hash
  if (!h.startsWith('#app-login')) return ''
  return new URLSearchParams(h.slice(h.indexOf('?') + 1)).get('return') ?? ''
})()
const relay = ref<'idle' | 'sending' | 'error'>('idle')
const relayError = ref('')
async function handOver() {
  relay.value = 'sending'
  try {
    const { url } = await api<{ url: string }>('POST', '/api/app-login/ticket', { returnTo: appReturn })
    window.location.href = url
  } catch (e) {
    relay.value = 'error'
    relayError.value = e instanceof ApiError ? e.message : '앱으로 돌아가지 못했어요.'
  }
}

watch(
  () => session.value.data?.session.id,
  (id) => {
    if (id && appReturn) handOver()
    else if (id) loadState()
    else status.loaded = false
  },
  { immediate: true },
)
</script>

<template>
  <p v-if="session.isPending" class="muted" style="padding:24px">불러오는 중…</p>
  <div v-else-if="limited" class="boot" role="status"><p class="muted">요청이 많아요. 잠시 뒤 다시 확인해요…</p></div>
  <Login v-else-if="!session.data" :app-return="!!appReturn" />
  <div v-else-if="appReturn" class="boot" role="status">
    <p v-if="relay === 'error'" class="err" role="alert">{{ relayError }}</p>
    <p v-else class="muted">앱으로 돌아가는 중…</p>
  </div>
  <App v-else-if="status.loaded" />
  <div v-else class="boot">
    <p v-if="status.error" class="err" role="alert">{{ status.error }}</p>
    <p v-else class="muted">데이터를 불러오는 중…</p>
    <button v-if="status.error" class="btn" type="button" @click="loadState">다시 시도</button>
  </div>
</template>

<style scoped>
.boot{padding:24px;display:grid;gap:10px;justify-items:start}
.err{margin:0;color:var(--neg-text)}
</style>
