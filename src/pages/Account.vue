<script setup lang="ts">
import { t } from '../i18n'
import { onActivated, onMounted, ref } from 'vue'
import { ApiError, api } from '../lib/api'
import { loadMethods, providerName, startSocial, takeErrorFromUrl, type Method } from '../lib/auth-ui'

// My account (spec 006 S-1, S-11): who I am, the logins linked to me, my password.
// Shown as the 설정 › 로그인·보안 tab (spec 007 S-12), so it has no page header of its own.
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
    fail(e, t('account.loadFailed'))
  }
}
onMounted(load)
onActivated(load)

const hasPassword = () => linked.value.some((a) => a.providerId === 'credential')
const passwordOn = () => methods.value.some((m) => m.id === 'password')
const linkable = () => methods.value.filter((m) => m.id !== 'password' && !linked.value.some((a) => a.providerId === m.id))
const nameOf = (id: string) => methods.value.find((m) => m.id === id)?.name ?? providerName(id)

async function link(provider: string) {
  error.value = ''
  busy.value = true
  try {
    await startSocial(provider, `${window.location.origin}/#account`, true)
  } catch (e) {
    busy.value = false
    fail(e, t('account.linkFailed'))
  }
}

async function unlink(a: Linked) {
  if (linked.value.length <= 1) return (error.value = t('account.lastMethod'))
  if (!confirm(t('account.confirmUnlink', { name: nameOf(a.providerId) }))) return
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    await api('POST', '/api/auth/unlink-account', { accountId: a.id })
    notice.value = t('account.unlinked')
    await load()
  } catch (e) {
    fail(e, t('account.unlinkFailed'))
  } finally {
    busy.value = false
  }
}

async function changePassword() {
  error.value = ''
  notice.value = ''
  if (pw.value.next.length < 8) return (error.value = t('account.pwShort'))
  if (pw.value.next !== pw.value.again) return (error.value = t('account.pwMismatch'))
  busy.value = true
  try {
    await api('POST', '/api/auth/change-password', { currentPassword: pw.value.current, newPassword: pw.value.next, revokeOtherSessions: true })
    pw.value = { current: '', next: '', again: '' }
    notice.value = t('account.pwChanged')
  } catch (e) {
    fail(e, t('account.pwFailed'))
  } finally {
    busy.value = false
  }
}

const fmt = (at: string) => new Date(at).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
</script>

<template>
  <section>
    <p class="lede">{{ t('account.lede') }}</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div v-if="me" class="panel">
      <h3 style="margin-top:0">{{ t('account.myInfo') }}</h3>
      <p class="kv"><span class="muted">{{ t('login.email') }}</span> {{ me.email }}</p>
      <p class="kv"><span class="muted">{{ t('account.name') }}</span> {{ me.name }}</p>
      <p class="kv"><span class="muted">{{ t('account.role') }}</span> {{ me.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }} <a v-if="me.role === 'admin'" href="#admin">{{ t('account.adminLink') }}</a></p>
    </div>

    <div class="panel">
      <h3 style="margin-top:0">{{ t('account.methods') }}</h3>
      <ul class="list">
        <li v-for="a in linked" :key="a.id">
          <span>{{ nameOf(a.providerId) }}</span>
          <span class="small muted">{{ t('account.since', { date: fmt(a.createdAt) }) }}</span>
          <button class="btn" type="button" :disabled="busy || linked.length <= 1" @click="unlink(a)">{{ t('account.unlink') }}</button>
        </li>
      </ul>
      <div v-if="linkable().length" class="btns">
        <button v-for="m in linkable()" :key="m.id" class="btn" type="button" :disabled="busy" @click="link(m.id)">{{ t('account.link', { name: m.name }) }}</button>
      </div>
    </div>

    <form v-if="hasPassword() && passwordOn()" class="panel" @submit.prevent="changePassword">
      <h3 style="margin-top:0">{{ t('account.changePw') }}</h3>
      <div class="form">
        <div class="field"><label for="a-cur">{{ t('account.currentPw') }}</label><input id="a-cur" v-model="pw.current" class="in" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="a-new">{{ t('account.newPw') }}</label><input id="a-new" v-model="pw.next" class="in" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="a-again">{{ t('account.newPwAgain') }}</label><input id="a-again" v-model="pw.again" class="in" type="password" autocomplete="new-password" required></div>
      </div>
      <div class="btns"><button class="btn pri" type="submit" :disabled="busy">{{ t('account.change') }}</button></div>
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
