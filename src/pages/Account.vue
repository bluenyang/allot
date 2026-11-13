<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { ApiError, api } from '../lib/api'
import { loadMethods, PROVIDER_NAME, startSocial, takeErrorFromUrl, type Method } from '../lib/auth-ui'

// My account (spec 006 S-1, S-11): who I am, the logins linked to me, my password.
interface Me { id: string; email: string; name: string; role: string }
interface Linked { id: string; providerId: string; accountId: string; createdAt: string }

const me = ref<Me | null>(null)
const linked = ref<Linked[]>([])
const methods = ref<Method[]>([])
const error = ref('')
const notice = ref('')
const busy = ref(false)
const pw = ref({ current: '', next: '', again: '' })

const fail = (e: unknown, fallback: string) => { error.value = e instanceof ApiError ? e.message : fallback }

async function load() {
  error.value ||= takeErrorFromUrl()
  try {
    me.value = (await api<{ user: Me }>('GET', '/api/me')).user
    linked.value = await api<Linked[]>('GET', '/api/auth/list-accounts')
    methods.value = await loadMethods()
  } catch (e) {
    fail(e, '계정 정보를 불러오지 못했어요.')
  }
}
onMounted(load)
onActivated(load)

const hasPassword = () => linked.value.some((a) => a.providerId === 'credential')
const passwordOn = () => methods.value.some((m) => m.id === 'password')
const linkable = () => methods.value.filter((m) => m.id !== 'password' && !linked.value.some((a) => a.providerId === m.id))
const nameOf = (id: string) => methods.value.find((m) => m.id === id)?.name ?? PROVIDER_NAME[id] ?? id

async function link(provider: string) {
  error.value = ''
  busy.value = true
  try {
    await startSocial(provider, `${window.location.origin}/#account`, true)
  } catch (e) {
    busy.value = false
    fail(e, '연결하지 못했어요.')
  }
}

async function unlink(a: Linked) {
  if (linked.value.length <= 1) return (error.value = '마지막 로그인 방식은 해제할 수 없어요.')
  if (!confirm(`${nameOf(a.providerId)} 연결을 해제할까요?`)) return
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    await api('POST', '/api/auth/unlink-account', { accountId: a.id })
    notice.value = '연결을 해제했어요.'
    await load()
  } catch (e) {
    fail(e, '해제하지 못했어요.')
  } finally {
    busy.value = false
  }
}

async function changePassword() {
  error.value = ''
  notice.value = ''
  if (pw.value.next.length < 8) return (error.value = '새 비밀번호는 8자 이상이어야 해요.')
  if (pw.value.next !== pw.value.again) return (error.value = '새 비밀번호가 서로 달라요.')
  busy.value = true
  try {
    await api('POST', '/api/auth/change-password', { currentPassword: pw.value.current, newPassword: pw.value.next, revokeOtherSessions: true })
    pw.value = { current: '', next: '', again: '' }
    notice.value = '비밀번호를 바꿨어요. 다른 기기의 로그인은 끊었어요.'
  } catch (e) {
    fail(e, '비밀번호를 바꾸지 못했어요.')
  } finally {
    busy.value = false
  }
}

const fmt = (at: string) => new Date(at).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
</script>

<template>
  <section>
    <h1>계정</h1>
    <p class="lede">로그인 방식을 연결하거나 해제하고, 비밀번호를 바꿔요.</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">닫기</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div v-if="me" class="panel">
      <h3 style="margin-top:0">내 정보</h3>
      <p class="kv"><span class="muted">이메일</span> {{ me.email }}</p>
      <p class="kv"><span class="muted">이름</span> {{ me.name }}</p>
      <p class="kv"><span class="muted">역할</span> {{ me.role === 'admin' ? '관리자' : '사용자' }} <a v-if="me.role === 'admin'" href="#admin">관리 화면</a></p>
    </div>

    <div class="panel">
      <h3 style="margin-top:0">로그인 방식</h3>
      <ul class="list">
        <li v-for="a in linked" :key="a.id">
          <span>{{ nameOf(a.providerId) }}</span>
          <span class="small muted">{{ fmt(a.createdAt) }}부터</span>
          <button class="btn" type="button" :disabled="busy || linked.length <= 1" @click="unlink(a)">해제</button>
        </li>
      </ul>
      <div v-if="linkable().length" class="btns">
        <button v-for="m in linkable()" :key="m.id" class="btn" type="button" :disabled="busy" @click="link(m.id)">{{ m.name }} 연결</button>
      </div>
    </div>

    <form v-if="hasPassword() && passwordOn()" class="panel" @submit.prevent="changePassword">
      <h3 style="margin-top:0">비밀번호 바꾸기</h3>
      <div class="form">
        <div class="field"><label for="a-cur">지금 비밀번호</label><input id="a-cur" v-model="pw.current" class="in" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="a-new">새 비밀번호</label><input id="a-new" v-model="pw.next" class="in" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="a-again">새 비밀번호 확인</label><input id="a-again" v-model="pw.again" class="in" type="password" autocomplete="new-password" required></div>
      </div>
      <div class="btns"><button class="btn pri" type="submit" :disabled="busy">바꾸기</button></div>
    </form>
  </section>
</template>

<style scoped>
.panel{margin-bottom:14px}
.kv{margin:4px 0;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.list{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:8px}
.list li{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.list li .btn{margin-left:auto}
</style>
