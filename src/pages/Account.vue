<script setup lang="ts">
import { t } from '../i18n'
import { onActivated, onMounted, ref } from 'vue'
import { ApiError, api } from '../lib/api'
import Icon from '../components/Icon.vue'
import { copyText } from '../lib/clipboard'
import { generatePassword } from '../lib/password-gen'
import { loadMethods, providerName, startSocial, takeErrorFromUrl, type Method } from '../lib/auth-ui'
import { authClient } from '../lib/auth-client'

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
/** The server's minimum for a new password (spec 013 S-24); 8 until it answers, as before the policy. */
const minLength = ref(8)
/** A password made by 만들기, shown until the form is saved or cleared; it is sent only with the form. */
const made = ref('')

const fail = (e: unknown, fallback: string) => { error.value = e instanceof ApiError ? e.message : fallback }

async function load() {
  error.value ||= takeErrorFromUrl()
  try {
    me.value = (await api<{ user: Me }>('GET', '/api/me')).user
    linked.value = await api<Linked[]>('GET', '/api/auth/list-accounts')
    methods.value = await loadMethods()
    // The server checks the minimum again; without an answer the screen keeps the last one it knew.
    const policy = await api<{ minLength: number }>('GET', '/api/password-policy').catch(() => null)
    if (policy) minLength.value = policy.minLength
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
    // Back to this tab (spec 012 S-5); a link started before 0.1.6 comes back to /#account, which the router turns into this.
    await startSocial(provider, `${window.location.origin}/settings/security`, true)
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
  if (pw.value.next.length < minLength.value) return (error.value = t('security.pwShort', { min: minLength.value }))
  if (pw.value.next !== pw.value.again) return (error.value = t('account.pwMismatch'))
  busy.value = true
  try {
    await api('POST', '/api/auth/change-password', { currentPassword: pw.value.current, newPassword: pw.value.next, revokeOtherSessions: true })
    pw.value = { current: '', next: '', again: '' }
    made.value = ''
    notice.value = t('account.pwChanged')
  } catch (e) {
    fail(e, t('account.pwFailed'))
  } finally {
    busy.value = false
  }
}

// ── adding a password to an account that signs in externally only (spec 016 S-5) ──
const np = ref({ next: '', again: '' })
/** The server said the session is more than a day old: sign in again first. */
const reauth = ref(false)
async function addPassword() {
  error.value = ''
  notice.value = ''
  reauth.value = false
  if (np.value.next.length < minLength.value) return (error.value = t('security.pwShort', { min: minLength.value }))
  if (np.value.next !== np.value.again) return (error.value = t('account.pwMismatch'))
  busy.value = true
  try {
    await api('POST', '/api/account/password', { newPassword: np.value.next })
    np.value = { next: '', again: '' }
    made.value = ''
    notice.value = t('account.pwAdded')
    await load()
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) reauth.value = true
    fail(e, t('account.addPwFailed'))
  } finally {
    busy.value = false
  }
}
function generateNew() {
  made.value = generatePassword()
  np.value = { next: made.value, again: made.value }
}
const signInAgain = () => authClient.signOut()

function generate() {
  made.value = generatePassword()
  pw.value = { ...pw.value, next: made.value, again: made.value }
}
async function copyMade() {
  if (await copyText(made.value)) { notice.value = t('security.copied'); error.value = '' } else error.value = t('security.copyFailed')
}

const fmt = (at: string) => new Date(at).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
</script>

<template>
  <section>
    <p class="lede">{{ t('account.lede') }}</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div class="cols">
      <div class="col">
        <section v-if="me" class="card">
          <div class="ch"><h2>{{ t('account.myInfo') }}</h2><RouterLink v-if="me.role === 'admin'" class="btn sm ghost" to="/admin">{{ t('account.adminLink') }}</RouterLink></div>
          <dl class="kv">
            <dt>{{ t('login.email') }}</dt><dd>{{ me.email }}</dd>
            <dt>{{ t('account.name') }}</dt><dd>{{ me.name }}</dd>
            <dt>{{ t('account.role') }}</dt><dd><span class="pill ok">{{ me.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</span></dd>
          </dl>
        </section>

        <section class="card">
          <div class="ch"><h2>{{ t('account.methods') }}</h2></div>
          <ul class="list methods">
            <li v-for="a in linked" :key="a.id">
              <span class="ic" aria-hidden="true"><Icon name="security" :stroke="1.75" /></span>
              <span class="mn"><b>{{ nameOf(a.providerId) }}</b><small class="hint num">{{ t('account.since', { date: fmt(a.createdAt) }) }}</small></span>
              <button class="btn sm" type="button" :disabled="busy || linked.length <= 1" @click="unlink(a)">{{ t('account.unlink') }}</button>
            </li>
          </ul>
          <div v-if="linkable().length" class="fs link">
            <button v-for="m in linkable()" :key="m.id" class="btn sm" type="button" :disabled="busy" @click="link(m.id)">{{ t('account.link', { name: m.name }) }}</button>
          </div>
        </section>
      </div>

      <form v-if="!hasPassword() && me" class="card pwc" :aria-label="t('account.addPw')" @submit.prevent="addPassword">
        <div class="ch"><h2>{{ t('account.addPw') }}</h2></div>
        <div class="fs">
          <p class="small muted" style="margin:0">{{ passwordOn() ? t('account.addPwNote', { email: me.email }) : t('account.addPwOff') }}</p>
          <div class="field"><label for="a-add">{{ t('account.newPw') }}</label>
            <div class="genrow"><input id="a-add" v-model="np.next" class="in" type="password" autocomplete="new-password" :minlength="minLength" required :disabled="!passwordOn()"><button class="btn" type="button" :disabled="!passwordOn()" @click="generateNew">{{ t('security.generate') }}</button></div>
            <span class="hint">{{ t('security.minLine', { min: minLength }) }}</span></div>
          <div v-if="made && np.next === made" class="field"><span class="lbl">{{ t('security.generated') }}</span>
            <div class="genrow"><input class="in mono" readonly :value="made" :aria-label="t('security.generated')" @focus="($event.target as HTMLInputElement).select()"><button class="btn" type="button" @click="copyMade">{{ t('security.copy') }}</button></div>
            <span class="hint">{{ t('security.generatedNote') }}</span></div>
          <div class="field"><label for="a-add-again">{{ t('account.newPwAgain') }}</label><input id="a-add-again" v-model="np.again" class="in" type="password" autocomplete="new-password" required :disabled="!passwordOn()"></div>
          <p v-if="reauth"><button class="btn sm" type="button" @click="signInAgain">{{ t('account.signInAgain') }}</button></p>
        </div>
        <div class="cf"><span class="sp"></span><button class="btn sm pri" type="submit" :disabled="busy || !passwordOn()">{{ t('account.addPwSubmit') }}</button></div>
      </form>

      <form v-if="hasPassword() && passwordOn()" class="card pwc" :aria-label="t('account.changePw')" @submit.prevent="changePassword">
        <div class="ch"><h2>{{ t('account.changePw') }}</h2></div>
        <div class="fs">
          <div class="field"><label for="a-cur">{{ t('account.currentPw') }}</label><input id="a-cur" v-model="pw.current" class="in" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="a-new">{{ t('account.newPw') }}</label>
            <div class="genrow"><input id="a-new" v-model="pw.next" class="in" type="password" autocomplete="new-password" :minlength="minLength" required><button class="btn" type="button" @click="generate">{{ t('security.generate') }}</button></div>
            <span class="hint">{{ t('security.minLine', { min: minLength }) }}</span></div>
          <div v-if="made && pw.next === made" class="field"><span class="lbl">{{ t('security.generated') }}</span>
            <div class="genrow"><input class="in mono" readonly :value="made" :aria-label="t('security.generated')" @focus="($event.target as HTMLInputElement).select()"><button class="btn" type="button" @click="copyMade">{{ t('security.copy') }}</button></div>
            <span class="hint">{{ t('security.generatedNote') }}</span></div>
          <div class="field"><label for="a-again">{{ t('account.newPwAgain') }}</label><input id="a-again" v-model="pw.again" class="in" type="password" autocomplete="new-password" required></div>
        </div>
        <div class="cf"><span class="sp"></span><button class="btn sm pri" type="submit" :disabled="busy">{{ t('account.change') }}</button></div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.cols{grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));align-items:start}
.col{display:flex;flex-direction:column;gap:16px}
.ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
.ch h2{margin:0;font-size:15px;font-weight:600}
.kv{margin:0;padding:6px 18px 12px;display:grid;grid-template-columns:96px 1fr;font-size:13px}
.kv dt{padding:8px 0;color:var(--subtle);border-bottom:1px solid var(--divider)}
.kv dd{margin:0;padding:8px 0;border-bottom:1px solid var(--divider);overflow-wrap:anywhere}
.methods{padding:0 18px}
.methods li{display:flex;align-items:center;gap:12px;padding:14px 0}
.ic{width:36px;height:36px;border-radius:var(--r-card);background:var(--fill);display:grid;place-items:center;color:var(--muted);flex:none}
.ic svg{width:18px;height:18px}
.mn{flex:1;min-width:0;display:flex;flex-direction:column}
.link{flex-direction:row;flex-wrap:wrap;border-top:1px solid var(--border)}
.fs .field{display:block}
.fs .field > label{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.in{height:40px}
.genrow{display:flex;gap:8px;align-items:center}
.genrow .in{flex:1;min-width:0}
.fs .field .lbl{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.fs .hint{display:block;margin-top:4px}
</style>
