<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '../lib/auth-client'

const email = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

async function submit() {
  err.value = ''
  busy.value = true
  const { error } = await authClient.signIn.email({ email: email.value.trim(), password: password.value })
  busy.value = false
  if (!error) return
  err.value =
    error.status === 429 ? '로그인 시도가 너무 많아요. 1분 뒤에 다시 해 주세요.'
    : error.status === 401 ? '이메일 또는 비밀번호가 맞지 않아요.'
    : '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.'
}
</script>

<template>
  <main class="login">
    <form class="panel" @submit.prevent="submit">
      <div class="brand"><span class="logo">A</span><b>Allot</b></div>
      <div class="field"><label for="l-email">이메일</label><input id="l-email" v-model="email" class="in" type="email" autocomplete="username" required></div>
      <div class="field"><label for="l-pw">비밀번호</label><input id="l-pw" v-model="password" class="in" type="password" autocomplete="current-password" required></div>
      <p v-if="err" class="err" role="alert">{{ err }}</p>
      <button class="btn pri" type="submit" :disabled="busy">{{ busy ? '로그인 중…' : '로그인' }}</button>
    </form>
  </main>
</template>

<style scoped>
.login{min-height:100vh;display:grid;place-items:center;padding:16px}
.login form{width:min(360px,100%);display:grid;gap:12px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.brand b{font:700 17px var(--f-num)}
.err{margin:0;color:var(--neg);font-size:13px}
</style>
