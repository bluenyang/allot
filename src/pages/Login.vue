<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { authClient } from '../lib/auth-client'
import { t } from '../i18n'
import { loadMethods, startSocial, takeErrorFromUrl, type Method } from '../lib/auth-ui'

/** Opened by a mobile app (#app-login): after signing in, the browser goes back to the app. */
defineProps<{ appReturn?: boolean }>()

const email = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)
const methods = ref<Method[] | null>(null)
const hasPassword = () => methods.value?.some((m) => m.id === 'password') ?? false
const externals = () => (methods.value ?? []).filter((m) => m.id !== 'password')

onMounted(async () => {
  err.value = takeErrorFromUrl()
  methods.value = await loadMethods()
})

async function submit() {
  err.value = ''
  busy.value = true
  const { error } = await authClient.signIn.email({ email: email.value.trim(), password: password.value })
  busy.value = false
  if (!error) return
  err.value =
    error.status === 429 ? t('login.tooMany')
    : error.status === 401 ? t('login.wrong')
    : error.code === 'BANNED_USER' ? t('login.banned')
    : error.code === 'PENDING_APPROVAL' ? t('login.pending')
    : t('login.failed')
}

async function social(id: string) {
  err.value = ''
  busy.value = true
  try {
    // Back to this very address (keeps #app-login for a mobile app).
    await startSocial(id, window.location.href)
  } catch (e) {
    busy.value = false
    err.value = (e as Error).message
  }
}
</script>

<template>
  <main class="login">
    <div class="panel">
      <div class="brand"><span class="logo" aria-hidden="true">A</span><span class="bn"><b>Allot</b><small>{{ t('login.tagline') }}</small></span></div>
      <p v-if="appReturn" class="note">{{ t('login.returnNote') }}</p>
      <p v-if="methods === null" class="note">{{ t('common.loading') }}</p>
      <form v-if="hasPassword()" class="pw" @submit.prevent="submit">
        <div class="field"><label for="l-email">{{ t('login.email') }}</label><input id="l-email" v-model="email" class="in" type="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pw">{{ t('login.password') }}</label><input id="l-pw" v-model="password" class="in" type="password" autocomplete="current-password" required></div>
        <button class="btn pri" type="submit" :disabled="busy">{{ busy ? t('login.submitting') : t('login.submit') }}</button>
      </form>
      <p v-if="hasPassword() && externals().length" class="or" aria-hidden="true">{{ t('login.or') }}</p>
      <div v-if="externals().length" class="ext">
        <button v-for="m in externals()" :key="m.id" class="btn" type="button" :disabled="busy" @click="social(m.id)">{{ t('login.with', { name: m.name }) }}</button>
      </div>
      <p v-if="methods !== null && !methods.length" class="err">{{ t('login.noMethods') }}</p>
      <p v-if="err" class="err" role="alert">{{ err }}</p>
    </div>
  </main>
</template>

<style scoped>
.login{min-height:100vh;display:grid;place-items:center;padding:16px}
.panel{width:min(360px,100%);display:grid;gap:12px}
.pw,.ext{display:grid;gap:12px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.brand{padding-bottom:12px;border-bottom:1px solid var(--border)}
.bn{display:flex;flex-direction:column;line-height:1.25}
.bn b{font-weight:700;font-size:17px}
.bn small{font-size:11px;color:var(--subtle)}
.panel{padding:24px}
.or{margin:0;text-align:center;font-size:12px;color:var(--muted)}
.err{margin:0;color:var(--neg-text);font-size:13px}
.note{margin:0;font-size:13px;color:var(--muted)}
</style>
