<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import { computed, onActivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import Icon from '../components/Icon.vue'
import Seg from '../components/Seg.vue'
import Soon from '../components/Soon.vue'
import SubTabs from '../components/SubTabs.vue'
import { ApiError, api } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { sessionScope } from '../lib/store'
import type { Scope } from '../lib/session-guard'
import { lang, t, type MessageKey } from '../i18n'
import { getKeyPolicy, setKeyPolicy, type KeyPolicy } from '../lib/keys'

// Admin (spec 006 S-3, S-8): accounts and login methods. Account details only; nobody's
// financial data is shown or reachable here. The server checks every action again.
interface User {
  id: string; email: string; name: string; role: 'admin' | 'user'; status: 'active' | 'pending'
  admission: string; banned: boolean; createdAt: string
}
type Field = 'enabled' | 'signup' | 'name' | 'clientId' | 'clientSecret' | 'discoveryUrl' | 'scopes' | 'groupsClaim' | `rules.${string}`
interface Provider {
  id: 'password' | 'oidc' | 'github' | 'google'
  values: { enabled: boolean; signup: 'closed' | 'approval' | 'rules'; rules: Record<string, string[]>; name: string; clientId: string; discoveryUrl: string; scopes: string[]; groupsClaim: string }
  secretSet: boolean
  source: Partial<Record<Field, 'default' | 'db' | 'env'>>
  problem: string | null
  usable: boolean
  ruleKinds: string[]
}

const origin = window.location.origin
const tab = ref('users')
const tabs = computed(() => [{ id: 'users', label: t('admin.tabUsers'), count: users.value.length }, { id: 'methods', label: t('admin.tabMethods') }, { id: 'keys', label: t('settingsAi.apiKey') }])
const error = ref('')
const notice = ref('')
const busy = ref(false)
const fail = (e: unknown, fallback: string) => { error.value = e instanceof ApiError ? e.message : fallback }
const say = (m: string) => { notice.value = m; error.value = '' }

// ── users ──
const users = ref<User[]>([])
const meId = ref('')
async function loadUsers(scope?: Scope) {
  const r = await api<{ users: User[] }>('GET', '/api/auth/admin/list-users?limit=500&sortBy=createdAt&sortDirection=asc')
  if (!scope || scope.alive()) users.value = r.users
}
const STATUS = (u: User) => (u.banned ? t('admin.statusBanned') : u.status === 'pending' ? t('admin.statusPending') : t('admin.statusActive'))
const ADMISSION = (a: string) => (['seed', 'admin', 'approval', 'rule', 'bootstrap'].includes(a) ? t(`admin.admission.${a}` as MessageKey) : a)
const summary = computed(() => {
  const n = users.value
  const banned = n.filter((u) => u.banned).length
  const waiting = n.filter((u) => u.status === 'pending' && !u.banned).length
  return t('admin.summary', { n: n.length, active: n.length - banned - waiting, waiting }) + (banned ? ` · ${t('admin.summaryBanned', { n: banned })}` : '')
})
const fmt = (at: string) => new Date(at).toLocaleDateString(lang.value === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'medium' })

type Status = 'active' | 'pending' | 'banned'
interface UserEdit { user: User | null; email: string; name: string; role: 'admin' | 'user'; status: Status; password: string; typePw: boolean; confirm: string; asking: boolean }
const statusOf = (u: User): Status => (u.banned ? 'banned' : u.status)
const edit = ref<UserEdit | null>(null)
const editError = ref('')
function openUser(u?: User) {
  editError.value = ''
  edit.value = u ? { user: u, email: u.email, name: u.name, role: u.role, status: statusOf(u), password: '', typePw: false, confirm: '', asking: false }
    : { user: null, email: '', name: '', role: 'user', status: 'active', password: '', typePw: false, confirm: '', asking: false }
}
/** Raised instead of sending a request when the session changed since the action started (spec 010 A-21). */
class SessionChanged extends Error {}
type Step = (request: () => Promise<unknown>) => Promise<unknown>
/**
 * Run one admin action: the session is noted when it starts and checked before every request (`step`) and
 * before its answer is applied, so a change of account in between sends nothing more and shows nothing.
 */
async function act(fn: (step: Step) => Promise<unknown>, done: string | (() => string), keepOpen = false) {
  const scope = sessionScope()
  const step: Step = async (request) => {
    if (!scope.alive()) throw new SessionChanged()
    return request()
  }
  busy.value = true
  editError.value = ''
  try {
    await fn(step)
    if (!scope.alive()) return
    await loadUsers(scope)
    if (!scope.alive()) return
    say(typeof done === 'string' ? done : done())
    if (!keepOpen) edit.value = null
    else if (edit.value?.user) edit.value.user = users.value.find((x) => x.id === edit.value!.user!.id) ?? null
  } catch (e) {
    if (e instanceof SessionChanged || !scope.alive()) return
    editError.value = e instanceof ApiError ? e.message : t('admin.failed')
  } finally {
    if (scope.alive()) busy.value = false
  }
}
async function saveUser() {
  const e = edit.value
  if (!e) return
  if (!e.user) {
    if (!/^\S+@\S+\.\S+$/.test(e.email.trim())) return (editError.value = t('admin.checkEmail'))
    if (!e.name.trim()) return (editError.value = t('admin.needName'))
    if (e.password && e.password.length < 8) return (editError.value = t('admin.tempPwShort'))
    return act((step) => step(() => api('POST', '/api/auth/admin/create-user', {
      email: e.email.trim(), name: e.name.trim(), role: e.role, ...(e.password ? { password: e.password } : {}),
    })), e.password ? t('admin.created') : t('admin.createdLink'))
  }
  const u = e.user
  if (e.typePw && e.password && e.password.length < 8) return (editError.value = t('account.pwShort'))
  const from = statusOf(u)
  if (e.status === 'banned' && from !== 'banned' && !confirm(t('admin.confirmBan', { email: u.email }))) return
  let done = t('settings.general.saved')
  await act(async (step) => {
    if (e.name.trim() && e.name.trim() !== u.name) await step(() => api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { name: e.name.trim() } }))
    if (e.role !== u.role) await step(() => api('POST', `/api/admin/users/${u.id}/role`, { role: e.role }))
    if (e.status !== from) {
      if (e.status === 'banned') { await step(() => api('POST', `/api/admin/users/${u.id}/ban`, {})); done = t('admin.banned') }
      else if (from === 'banned') { await step(() => api('POST', '/api/auth/admin/unban-user', { userId: u.id })); done = t('admin.unbanned') }
      else if (e.status === 'active' && from === 'pending') { await step(() => api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { status: 'active' } })); done = t('admin.approved', { email: u.email }) }
    }
    if (e.typePw && e.password) { await step(() => api('POST', '/api/auth/admin/set-user-password', { userId: u.id, newPassword: e.password })); done = t('admin.pwReset') }
  }, () => done)
}
const endSessions = (u: User) => act((step) => step(() => api('POST', '/api/auth/admin/revoke-user-sessions', { userId: u.id })), t('admin.sessionsEnded'), true)
function remove(u: User) {
  if ((edit.value?.confirm ?? '').trim().toLowerCase() !== u.email.toLowerCase()) return (editError.value = t('admin.confirmEmailText'))
  return act((step) => step(() => api('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: edit.value!.confirm.trim() })), t('admin.deleted', { email: u.email }))
}
const lastAdmin = computed(() => users.value.filter((x) => x.role === 'admin' && !x.banned).length <= 1)
const ROLES = computed(() => [{ id: 'user', label: t('shell.roleUser') }, { id: 'admin', label: t('shell.roleAdmin') }])
const roleHint = (r: string) => t(r === 'admin' ? 'admin.roleHintAdmin' : 'admin.roleHintUser')
const stateOptions = (u: User) => [
  { id: 'active', label: t('admin.statusActive') },
  { id: 'pending', label: t('admin.statusPending'), disabled: statusOf(u) !== 'pending' },
  { id: 'banned', label: t('admin.statusBanned'), disabled: u.id === meId.value },
]
const stateHint = (s: Status) => t(`admin.stateHint.${s}` as MessageKey)

// ── login methods ──
const providers = ref<Provider[]>([])
interface ProvEdit { id: Provider['id']; enabled: boolean; signup: Provider['values']['signup']; name: string; clientId: string; discoveryUrl: string; scopes: string; groupsClaim: string; rules: Record<string, string>; secret: string; dropSecret: boolean }
const pedit = ref<ProvEdit | null>(null)
const peditError = ref('')
const TITLE = (id: string) => (id === 'password' ? t('auth.password') : ({ oidc: 'OIDC', github: 'GitHub', google: 'Google' } as Record<string, string>)[id] ?? id)
const SIGNUP_IDS = ['closed', 'approval', 'rules'] as const
const SIGNUP = (id: string) => t(`admin.signup.${id}` as MessageKey)
const RULE_LABEL = (k: string) => t(`admin.ruleKind.${k}` as MessageKey)
const RULE_PH = (k: string) => (k === 'emails' ? `${t('admin.eg')} family@example.com, me@example.com` : t(`admin.rulePh.${k}` as MessageKey))
const RULE_HINT = (k: string) => t(`admin.ruleHint.${k}` as MessageKey)
const pstep = ref(0)
const SIGNUP_OPTS = computed(() => SIGNUP_IDS.map((k) => ({ id: k, label: SIGNUP(k), desc: t(`admin.signupDesc.${k}` as MessageKey) })))
async function copyCallback(text: string) {
  if (await copyText(text)) say(t('settingsAi.copied', { what: t('admin.callbackWhat') }))
  else error.value = t('settingsAi.copyFailed')
}
async function loadProviders() {
  providers.value = (await api<{ providers: Provider[] }>('GET', '/api/admin/providers')).providers
}
const locked = (p: Provider, f: Field) => p.source[f] === 'env'
const current = () => providers.value.find((p) => p.id === pedit.value?.id)
function openProvider(p: Provider) {
  peditError.value = ''
  pstep.value = 0
  pedit.value = {
    id: p.id, enabled: p.values.enabled, signup: p.values.signup, name: p.values.name, clientId: p.values.clientId,
    discoveryUrl: p.values.discoveryUrl, scopes: p.values.scopes.join(' '), groupsClaim: p.values.groupsClaim,
    rules: Object.fromEntries(p.ruleKinds.map((k) => [k, (p.values.rules[k] ?? []).join(', ')])), secret: '', dropSecret: false,
  }
}
const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
async function saveProvider() {
  const e = pedit.value
  const p = current()
  if (!e || !p) return
  // Send only what changed and what env does not set.
  const body: Record<string, unknown> = {}
  const can = (f: Field) => !locked(p, f)
  if (can('enabled') && e.enabled !== p.values.enabled) body.enabled = e.enabled
  if (p.id !== 'password') {
    if (can('signup') && e.signup !== p.values.signup) body.signup = e.signup
    const rules: Record<string, string[]> = {}
    for (const k of p.ruleKinds) {
      const next = lines(e.rules[k] ?? '')
      if (can(`rules.${k}`) && JSON.stringify(next) !== JSON.stringify(p.values.rules[k] ?? [])) rules[k] = next
    }
    if (Object.keys(rules).length) body.rules = rules
    const options: Record<string, unknown> = {}
    if (can('clientId') && e.clientId.trim() && e.clientId.trim() !== p.values.clientId) options.clientId = e.clientId.trim()
    if (p.id === 'oidc') {
      if (can('name') && e.name.trim() && e.name.trim() !== p.values.name) options.name = e.name.trim()
      if (can('discoveryUrl') && e.discoveryUrl.trim() && e.discoveryUrl.trim() !== p.values.discoveryUrl) options.discoveryUrl = e.discoveryUrl.trim()
      const scopes = e.scopes.split(/\s+/).filter(Boolean)
      if (can('scopes') && scopes.length && scopes.join(' ') !== p.values.scopes.join(' ')) options.scopes = scopes
      if (can('groupsClaim') && e.groupsClaim.trim() && e.groupsClaim.trim() !== p.values.groupsClaim) options.groupsClaim = e.groupsClaim.trim()
    }
    if (Object.keys(options).length) body.options = options
    if (can('clientSecret') && e.secret) body.clientSecret = e.secret
    else if (can('clientSecret') && e.dropSecret) body.clientSecret = null
  }
  if (!Object.keys(body).length) return (pedit.value = null)
  busy.value = true
  peditError.value = ''
  try {
    await api('PUT', `/api/admin/providers/${p.id}`, body)
    await loadProviders()
    say(t('admin.providerSaved', { name: TITLE(p.id) }))
    pedit.value = null
  } catch (err) {
    peditError.value = err instanceof ApiError ? err.message : t('admin.saveFailed')
  } finally {
    busy.value = false
  }
}

// ── API keys (spec 008 S-3): may a key have no expiry date ──
const keyPolicy = ref<KeyPolicy | null>(null)
async function toggleNoExpiry(e: Event) {
  const box = e.target as HTMLInputElement
  const next = box.checked
  if (!next && !confirm(t('admin.confirmOff'))) { box.checked = true; return }
  busy.value = true
  error.value = ''
  try {
    keyPolicy.value = await setKeyPolicy(next)
    say(next ? t('admin.noExpiryOn') : t('admin.noExpiryOff') + (keyPolicy.value.capped ? ` ${t('admin.capped', { n: keyPolicy.value.capped })}` : ''))
  } catch (err) {
    box.checked = !next
    fail(err, t('admin.saveFailed'))
  } finally {
    busy.value = false
  }
}

async function load() {
  try {
    meId.value = (await api<{ user: { id: string } }>('GET', '/api/me')).user.id
    await Promise.all([loadUsers(), loadProviders(), getKeyPolicy().then((p) => { keyPolicy.value = p })])
  } catch (e) {
    fail(e, t('admin.loadFailed'))
  }
}
onMounted(load)
onActivated(load)
</script>

<template>
  <section>
    <PageHeader :title="t('admin.title')" :desc="t('admin.desc')">
      <button v-if="tab === 'users'" class="btn pri" type="button" @click="openUser()"><Icon name="plus" :stroke="2.2" />{{ t('admin.newAccountBtn') }}</button>
    </PageHeader>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>
    <SubTabs v-model="tab" :tabs="tabs" :label="t('admin.tabsLabel')" />

    <template v-if="tab === 'users'">
      <section class="card">
        <div class="ch"><h2>{{ t('admin.accounts') }}</h2><span class="hint">{{ summary }}</span></div>
        <div class="scroll-x">
          <table class="utbl">
            <thead><tr><th scope="col">{{ t('login.email') }}</th><th scope="col">{{ t('admin.name') }}</th><th scope="col" class="c">{{ t('admin.role') }}</th><th scope="col" class="c">{{ t('admin.status') }}</th><th scope="col">{{ t('admin.admissionCol') }}</th><th scope="col" class="c">{{ t('admin.createdCol') }}</th><th scope="col" class="r"><span class="sr">{{ t('admin.manage') }}</span></th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td><b>{{ u.email }}</b><small v-if="u.id === meId" class="hint"> {{ t('admin.me') }}</small></td><td>{{ u.name }}</td>
                <td class="c"><span class="pill" :class="u.role === 'admin' ? 'ok' : 'mute'">{{ u.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</span></td>
                <td class="c"><span class="pill" :class="u.banned ? 'mute' : u.status === 'pending' ? 'acc' : 'ok'">{{ STATUS(u) }}</span></td>
                <td class="via">{{ ADMISSION(u.admission) }}</td><td class="c mono made">{{ fmt(u.createdAt) }}</td>
                <td class="r"><button class="btn sm" type="button" :aria-label="t('admin.manageLabel', { email: u.email })" @click="openUser(u)">{{ t('admin.manage') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <EditSheet v-if="edit && !edit.user" :title="t('admin.newAccount')" :desc="t('admin.newAccountSub')" :error="editError" :busy="busy" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="u-email">{{ t('login.email') }} <span class="req">*</span></label><input id="u-email" v-model="edit.email" class="in" type="email" autocomplete="off" placeholder="name@example.com"></div>
        <div class="field"><label for="u-name">{{ t('admin.name') }}</label><input id="u-name" v-model="edit.name" class="in" :placeholder="t('admin.namePh')"></div>
        <div class="field"><span id="u-role" class="lbl">{{ t('admin.role') }}</span>
          <Seg :options="ROLES" :model-value="edit.role" labelledby="u-role" @update:model-value="edit.role = $event" />
          <span class="hint">{{ roleHint(edit.role) }}</span></div>
        <div v-if="edit.typePw" class="field"><label for="u-pw">{{ t('admin.tempPw') }}</label><input id="u-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password" :placeholder="t('admin.tempPwPh')"><span class="hint">{{ t('admin.tempPwNote') }}</span></div>
        <div v-else class="field">
          <div class="pwbox"><span>{{ t('admin.noPwBox') }}</span><button class="btn sm ghost" type="button" @click="edit.typePw = true">{{ t('admin.pickPw') }}</button><Soon class="btn sm ghost">{{ t('admin.autoPw') }}</Soon></div>
          <span class="hint">{{ t('admin.noPwHint') }}</span></div>
      </EditSheet>

      <EditSheet v-if="edit && edit.user" :title="edit.user.email" :desc="t('admin.userSub', { via: ADMISSION(edit.user.admission), date: fmt(edit.user.createdAt) })" :error="editError" :busy="busy"
        :hint="edit.user.id === meId ? t('admin.ownNoDelete') : ''" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="ue-name">{{ t('admin.name') }}</label><input id="ue-name" v-model="edit.name" class="in"></div>
        <div class="field"><span id="ue-role" class="lbl">{{ t('admin.role') }}</span>
          <Seg class="full" :options="ROLES.map((r) => ({ ...r, disabled: edit!.user!.id === meId && edit!.user!.role === 'admin' && lastAdmin }))" :model-value="edit.role" labelledby="ue-role" @update:model-value="edit.role = $event" /></div>
        <div class="field"><span id="ue-st" class="lbl">{{ t('admin.status') }}</span>
          <Seg class="full" :options="stateOptions(edit.user)" :model-value="edit.status" labelledby="ue-st" @update:model-value="edit.status = $event" />
          <span class="hint">{{ stateHint(edit.status) }}</span></div>
        <div class="field acts"><button class="btn" type="button" :disabled="busy" @click="endSessions(edit.user)">{{ t('admin.endSessions') }}</button></div>
        <div v-if="edit.typePw" class="field"><label for="ue-pw">{{ t('admin.newPw') }}</label><input id="ue-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password"><span class="hint">{{ t('admin.newPwHint') }}</span></div>
        <div v-else class="field acts"><Soon class="btn">{{ t('admin.makePw') }}</Soon><button class="btn ghost" type="button" @click="edit.typePw = true">{{ t('admin.typePw') }}</button></div>
        <div class="dbox">
          <span><b>{{ t('admin.deleteTitle') }}</b>{{ t('admin.deleteNote') }}</span>
          <button class="btn sm bad" type="button" :disabled="edit.user.id === meId" @click="edit.asking = true">{{ t('admin.delete') }}</button>
        </div>
        <template v-if="edit.asking && edit.user.id !== meId">
          <div class="field"><label for="ue-del">{{ t('admin.deleteLabel') }}</label><input id="ue-del" v-model="edit.confirm" class="in" autocomplete="off"></div>
          <div class="acts"><button class="btn bad" type="button" :disabled="busy" @click="remove(edit.user)">{{ t('admin.deleteBtn') }}</button></div>
        </template>
      </EditSheet>
    </template>

    <template v-else-if="tab === 'keys'">
      <section class="card">
        <div class="ch"><h2>{{ t('admin.noExpiryTitle') }}</h2><span v-if="keyPolicy" class="pill" :class="keyPolicy.noExpiry ? 'acc' : 'mute'">{{ keyPolicy.noExpiry ? t('admin.allowed') : t('admin.notAllowed') }}</span></div>
        <div class="fs">
          <label v-if="keyPolicy" class="swrow">
            <span><b>{{ t('admin.noExpiryLabel') }}</b><span class="hint">{{ t('admin.noExpiryDesc') }}</span></span>
            <span class="swin"><input type="checkbox" role="switch" :aria-label="t('admin.noExpiryLabel')" :checked="keyPolicy.noExpiry" :disabled="keyPolicy.locked || busy" @change="toggleNoExpiry"><span></span></span>
          </label>
          <i18n-t v-if="keyPolicy?.locked" keypath="admin.envLocked" tag="p" class="small muted"><template #env><span class="mono">ALLOT_API_KEY_NO_EXPIRY</span></template></i18n-t>
          <p v-else class="note">{{ t('admin.noExpiryNote') }}</p>
        </div>
      </section>
    </template>

    <template v-else>
      <div class="cards">
        <section v-for="p in providers" :key="p.id" class="card pcard">
          <div class="p1"><h2>{{ TITLE(p.id) }}<span v-if="p.id === 'oidc' && p.values.name !== 'OIDC'" class="small muted"> · {{ p.values.name }}</span></h2>
            <span class="pill" :class="p.usable ? 'ok' : p.values.enabled ? 'acc' : 'mute'">{{ p.usable ? t('common.on') : p.values.enabled ? t('admin.onUnusable') : t('common.off') }}</span></div>
          <span class="hint grow">{{ p.id === 'password' ? t('admin.pwPolicyHint') : t('admin.signupIs', { how: SIGNUP(p.values.signup) }) }}</span>
          <p v-if="p.problem" class="small" style="color:var(--neg-text);margin:0">{{ p.problem }}</p>
          <p v-if="Object.values(p.source).includes('env')" class="small muted" style="margin:0">{{ t('admin.someEnv') }}</p>
          <button class="btn sm" type="button" :aria-label="t('admin.configLabel', { name: TITLE(p.id) })" @click="openProvider(p)">{{ t('admin.config') }}</button>
        </section>
      </div>

      <EditSheet v-if="pedit && current()" v-model:step="pstep" :width="640" :title="t('admin.providerTitle', { name: TITLE(pedit.id) })" :desc="pedit.id === 'password' ? t('admin.pwSub') : t('admin.extSub')"
        :steps="pedit.id === 'password' ? undefined : [t('admin.stepConnect'), t('admin.stepSignup')]" :hint="pedit.id === 'password' ? t('admin.pwFoot') : pstep === 0 ? t('admin.foot1') : t('admin.foot2')"
        :error="peditError" :busy="busy" @save="saveProvider" @cancel="pedit = null">
        <template #head>
          <span class="swin hd"><input type="checkbox" role="switch" :aria-label="t('admin.turnOnLabel', { name: TITLE(pedit.id) })" :checked="pedit.enabled" :disabled="locked(current()!, 'enabled')" @change="pedit.enabled = ($event.target as HTMLInputElement).checked"><span></span></span>
        </template>
        <template v-if="pedit.id === 'password'">
          <div class="field"><span class="lbl">{{ t('admin.pwPolicyTitle') }}</span>
            <div class="acts"><Soon class="btn sm">{{ t('admin.pwMinLen') }}</Soon><Soon class="btn sm">{{ t('admin.pwLock') }}</Soon><Soon class="btn sm">{{ t('admin.pwSignup') }}</Soon></div></div>
          <p class="small muted" style="margin:0">{{ t('admin.pwOffNote') }}</p>
        </template>
        <template v-else-if="pstep === 0">
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-disc">discovery URL</label><input id="p-disc" v-model="pedit.discoveryUrl" class="in mono" type="url" placeholder="https://…/.well-known/openid-configuration" :disabled="locked(current()!, 'discoveryUrl')"><span class="hint">{{ t('admin.discoveryHint') }}</span></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-name">{{ t('admin.buttonName') }}</label><input id="p-name" v-model="pedit.name" class="in" :disabled="locked(current()!, 'name')"><span class="hint">{{ t('admin.buttonHint') }}</span></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-scopes">Scope</label><input id="p-scopes" v-model="pedit.scopes" class="in mono" :disabled="locked(current()!, 'scopes')"><span class="hint">{{ t('admin.scopeHint') }}</span></div>
          <div class="field"><label for="p-cid">client id</label><input id="p-cid" v-model="pedit.clientId" class="in mono" autocomplete="off" :disabled="locked(current()!, 'clientId')"></div>
          <div class="field"><label for="p-sec">client secret {{ current()!.secretSet ? t('admin.secretSaved') : t('admin.secretNone') }}</label>
            <input id="p-sec" v-model="pedit.secret" class="in" type="password" autocomplete="new-password" :disabled="locked(current()!, 'clientSecret')"><span class="hint">{{ t('admin.secretHint') }}</span></div>
          <label v-if="current()!.secretSet && !locked(current()!, 'clientSecret')" class="small"><input v-model="pedit.dropSecret" type="checkbox"> {{ t('admin.dropSecret') }}</label>
          <div class="field"><span class="lbl">{{ t('admin.callbackLabel') }}</span>
            <div class="cbrow"><code class="codebox">{{ origin }}/api/auth/callback/{{ pedit.id }}</code><button class="btn" type="button" @click="copyCallback(`${origin}/api/auth/callback/${pedit.id}`)">{{ t('settingsAi.copy') }}</button></div>
            <span class="hint">{{ t('admin.callbackHint') }}</span></div>
        </template>
        <template v-else>
          <div class="field"><span id="pv-pol" class="lbl">{{ t('admin.firstLogin') }}</span>
            <div class="choices" role="radiogroup" aria-labelledby="pv-pol">
              <button v-for="o in SIGNUP_OPTS" :key="o.id" type="button" role="radio" class="choice" :class="{ on: pedit.signup === o.id }" :aria-checked="pedit.signup === o.id" :disabled="locked(current()!, 'signup')" @click="pedit.signup = o.id"><b>{{ o.label }}</b><small class="hint">{{ o.desc }}</small></button>
            </div></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-gc">{{ t('admin.groupClaim') }}</label><input id="p-gc" v-model="pedit.groupsClaim" class="in mono" :disabled="locked(current()!, 'groupsClaim')"><span class="hint">{{ t('admin.groupClaimHint') }}</span></div>
          <div v-for="k in current()!.ruleKinds" :key="k" class="field">
            <label :for="'p-r-' + k">{{ RULE_LABEL(k) }}</label>
            <input :id="'p-r-' + k" v-model="pedit.rules[k]" class="in" :placeholder="RULE_PH(k)" :disabled="locked(current()!, `rules.${k}`)">
            <span class="hint">{{ RULE_HINT(k) }}</span>
          </div>
        </template>
        <template #after>
          <p v-if="Object.values(current()!.source).includes('env')" class="small muted">{{ t('admin.greyEnv') }}</p>
        </template>
      </EditSheet>
    </template>
  </section>
</template>

<style scoped>
.ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
.ch h2{margin:0;font-size:15px;font-weight:600}
.scroll-x{overflow-x:auto;position:relative}
.utbl{min-width:860px}
.utbl td.c,.utbl th.c{text-align:center}
.utbl td.r,.utbl th.r{text-align:right}
.utbl td b{font-weight:600}
.utbl td.via{color:var(--muted)}
.utbl td.made{font-size:12px;color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.acts{display:flex;gap:8px;flex-wrap:wrap}
.field .lbl,.field > label{font-size:12px;font-weight:600;color:var(--text-2)}
.full{display:flex}
.full :deep(button){flex:1;justify-content:center}
.pwbox{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--r-card);background:var(--surface-2);border:1px solid var(--border);font-size:13px;color:var(--text-2)}
.pwbox > span{flex-grow:1}
.dbox{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.dbox span{flex:1;font-size:13px;color:var(--text-2)}
.dbox b{display:block;color:var(--neg-text)}
.fs .swrow{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer}
.swrow b{display:block;font-size:14px}
.swrow .hint{display:block}
.note{margin:0;padding:10px 12px;border-radius:var(--r-card);background:var(--surface-2);border:1px solid var(--border);font-size:12px;color:var(--muted)}
.swin{position:relative;flex:none;width:44px;height:26px}
.swin input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}
.swin span{position:absolute;inset:0;border-radius:13px;background:var(--border-strong);pointer-events:none}
.swin span::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--surface);box-shadow:0 1px 2px rgba(16,24,20,.2)}
.swin input:checked + span{background:var(--primary)}
.swin input:checked + span::after{left:21px;background:var(--primary-ink)}
.swin input:disabled{cursor:not-allowed}
.swin input:disabled + span{opacity:.5}
.swin input:focus-visible + span{outline:2px solid var(--primary-text);outline-offset:2px}
.swin.hd{align-self:center;margin-right:4px}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.pcard{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.p1{display:flex;align-items:center;justify-content:space-between;gap:8px}
.p1 h2{margin:0;font-size:15px;font-weight:600}
.pcard .btn{align-self:flex-start}
.grow{flex-grow:1}
.cbrow{display:flex;gap:8px;align-items:center}
.codebox{display:flex;align-items:center;flex:1;min-width:0;min-height:44px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface-2);font:12px var(--f-mono);overflow-x:auto;white-space:nowrap}
.choices{display:flex;flex-direction:column;gap:8px}
.choice{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer;font:inherit}
.choice:hover:not(:disabled){border-color:var(--border-strong)}
.choice:disabled{opacity:.6;cursor:not-allowed}
.choice.on{border:2px solid var(--primary-text);padding:11px;background:var(--primary-tint)}
.choice b{font-size:14px}
</style>
