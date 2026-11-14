<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { authClient } from '../lib/auth-client'
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
    error.status === 429 ? '로그인 시도가 너무 많아요. 1분 뒤에 다시 해 주세요.'
    : error.status === 401 ? '이메일 또는 비밀번호가 맞지 않아요.'
    : error.code === 'BANNED_USER' ? '정지된 계정이에요. 관리자에게 문의해 주세요.'
    : error.code === 'PENDING_APPROVAL' ? '관리자 승인을 기다리고 있어요.'
    : '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.'
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
      <div class="brand"><span class="logo">A</span><b>Allot</b></div>
      <p v-if="appReturn" class="note">로그인하면 앱으로 돌아가요.</p>
      <p v-if="methods === null" class="note">불러오는 중…</p>
      <form v-if="hasPassword()" class="pw" @submit.prevent="submit">
        <div class="field"><label for="l-email">이메일</label><input id="l-email" v-model="email" class="in" type="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pw">비밀번호</label><input id="l-pw" v-model="password" class="in" type="password" autocomplete="current-password" required></div>
        <button class="btn pri" type="submit" :disabled="busy">{{ busy ? '로그인 중…' : '로그인' }}</button>
      </form>
      <p v-if="hasPassword() && externals().length" class="or" aria-hidden="true">또는</p>
      <div v-if="externals().length" class="ext">
        <button v-for="m in externals()" :key="m.id" class="btn" type="button" :disabled="busy" @click="social(m.id)">{{ m.name }}(으)로 로그인</button>
      </div>
      <p v-if="methods !== null && !methods.length" class="err">사용할 수 있는 로그인 방식이 없어요. 관리자에게 문의해 주세요.</p>
      <p v-if="err" class="err" role="alert">{{ err }}</p>
    </div>
  </main>
</template>

<style scoped>
.login{min-height:100vh;display:grid;place-items:center;padding:16px}
.panel{width:min(360px,100%);display:grid;gap:12px}
.pw,.ext{display:grid;gap:12px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.brand b{font:700 17px var(--f-num)}
.or{margin:0;text-align:center;font-size:12px;color:var(--muted)}
.err{margin:0;color:var(--neg);font-size:13px}
.note{margin:0;font-size:13px;color:var(--muted)}
</style>
