<script setup lang="ts">
import { watch } from 'vue'
import App from './App.vue'
import Login from './pages/Login.vue'
import { authClient } from './lib/auth-client'
import { onUnauthorized } from './lib/api'
import { loadState, status } from './lib/store'

const session = authClient.useSession()
// The API said the session is gone (expired or signed out elsewhere): show the login screen.
onUnauthorized.handler = () => window.location.reload()

watch(
  () => session.value.data?.session.id,
  (id) => {
    if (id) loadState()
    else status.loaded = false
  },
  { immediate: true },
)
</script>

<template>
  <p v-if="session.isPending" class="muted" style="padding:24px">불러오는 중…</p>
  <Login v-else-if="!session.data" />
  <App v-else-if="status.loaded" />
  <div v-else class="boot">
    <p v-if="status.error" class="err" role="alert">{{ status.error }}</p>
    <p v-else class="muted">데이터를 불러오는 중…</p>
    <button v-if="status.error" class="btn" type="button" @click="loadState">다시 시도</button>
  </div>
</template>

<style scoped>
.boot{padding:24px;display:grid;gap:10px;justify-items:start}
.err{margin:0;color:var(--neg)}
</style>
